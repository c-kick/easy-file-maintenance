import logger from '../utils/logger.mjs';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

function matchPattern(str, pattern) {
    const regex = new RegExp(
      '^' + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    return regex.test(str);
}

function createEntry(itemPath, itemName, stats, depth) {
    return {
        depth,
        path: itemPath,
        name: itemName,
        baseName: path.basename(itemName, path.extname(itemPath)),
        extension: itemName.split('.').pop().toLowerCase(),
        dir: path.dirname(itemPath),
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        modifiedTime: stats.mtime,
        createdTime: stats.ctime,
        stats,
    };
}

function sortAndProcess(results) {
    // Combine sorting and attribute calculation
    results.directories = new Map(
        Array.from(results.directories.entries())
            .sort(([, a], [, b]) => b.depth - a.depth)
            .map(([dirPath, dirEntry]) => {
                const subScan = {
                    intrinsicSize: 0,
                    size: 0,
                    fileCount: 0,
                    consideredEmpty: true,
                    isEmpty: true,
                };

                // Calculate intrinsic size and file count for direct files
                for (const [filePath, fileEntry] of results.files) {
                    if (path.dirname(filePath) === dirPath) {
                        subScan.intrinsicSize += fileEntry.size;
                        subScan.fileCount += 1;

                        if (!fileEntry.ignore) {
                            subScan.consideredEmpty = false;
                        }
                        subScan.isEmpty = false;
                    }
                }

                // Incorporate sizes and file counts recursively from subdirectories
                for (const [subDirPath, subDirEntry] of results.directories) {
                    if (path.dirname(subDirPath.toString()) === dirPath) {
                        subScan.size += subDirEntry.size;
                        subScan.fileCount += subDirEntry.fileCount;

                        if (!subDirEntry.consideredEmpty) {
                            subScan.consideredEmpty = false;
                        }
                        if (!subDirEntry.isEmpty) {
                            subScan.isEmpty = false;
                        }
                    }
                }

                // Add intrinsic size to recursive size
                subScan.size += subScan.intrinsicSize;

                // Update the directory entry with calculated values
                Object.assign(dirEntry, subScan);

                return [dirPath, dirEntry];
            })
            .sort(([, a], [, b]) => a.depth - b.depth)
    );

    results.files = new Map(
        Array.from(results.files.entries()).sort(([, a], [, b]) => a.depth - b.depth)
    );

    return results;
}

async function scanDirectory(dirPath, config) {
    const results = { directories: new Map(), files: new Map() };
    const queue = [{ dirPath, depth: 0 }];

    while (queue.length > 0) {
        const { dirPath, depth } = queue.shift();
        const items = await readdir(dirPath);
        const fileStats = await Promise.all(items.map(async item => {
            const itemPath = path.join(dirPath, item);
            try {
                const stats = await stat(itemPath);
                return { item, itemPath, stats };
            } catch (error) {
                logger.fail(`Error accessing ${itemPath}: ${error.message}`);
                return null;
            }
        }));

        for (const fileStat of fileStats) {
            if (!fileStat) continue; // Skip entries with errors
            const { item, itemPath, stats } = fileStat;
            const itemName = path.basename(itemPath);
            const isIgnoredDir = stats.isDirectory() && config.ignoreDirectories.some(pattern => matchPattern(item, pattern));
            const isIgnoredFile = stats.isFile() && config.ignoreFiles.some(pattern => matchPattern(item, pattern));

            if (isIgnoredDir) {
                logger.text(`Ignoring directory: ${itemPath}`);
                continue;
            } else {
                logger.text(`Scanning... ${itemPath}`);
            }

            const entry = createEntry(itemPath, itemName, stats, depth);

            // Check for forced ignores
            entry.ignore = isIgnoredFile;

            // Check for forced deletes (moves)
            entry.delete = entry.isFile && config.removeFiles.some(pattern => matchPattern(itemName, pattern));

            if (entry.isFile) {
                results.files.set(itemPath, entry);
            } else if (stats.isDirectory()) {
                results.directories.set(itemPath, entry);
                queue.push({ dirPath: itemPath, depth: depth + 1 });
            }

        }
    }

    return sortAndProcess(results);
}

export default scanDirectory;
