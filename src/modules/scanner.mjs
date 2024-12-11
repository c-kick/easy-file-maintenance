import logger from '../utils/logger.mjs';
import fs from 'fs';
import path from 'path';
import {promisify} from 'util';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Matches a string against a pattern with basic wildcard (*) support.
 * @param {string} str - The string to match.
 * @param {string} pattern - The pattern to match against.
 * @returns {boolean} - True if the string matches the pattern.
 */
function matchPattern(str, pattern) {
    const regex = new RegExp(
        '^' + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\$&').replace(/\*/g, '.*') + '$'
    );
    return regex.test(str);
}

/**
 * Recursively scans a directory and collects details about files and directories.
 * @param {string} dirPath - Path to the directory to scan.
 * @param {object} config - Configuration object containing exclusion rules.
 * @param {number} depth - Current depth in the directory tree.
 * @returns {Promise<{}>} - List of file and directory details.
 */
async function scanDirectory(dirPath, config, depth = 0) {
    const results = { directories: {}, files: {} };
    const items = await readdir(dirPath);
    let intrinsicFileCount = 0, fileCount = 0, dirCount = 1;
    let intrinsicDirectorySize = 0, directorySize = 0;

    // Paths to always ignore
    const forcedIgnorePaths = [
        config.recycleBinPath,
        path.join(config.scanPath, 'duplicates')
    ].map(p => path.resolve(p));

    logger.text(`Scanning directory: ${dirPath} (${items.length} items)`);

    for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const itemName = path.basename(itemPath);
        const resolvedItemPath = path.resolve(itemPath);
        const stats = await stat(itemPath);

        // Check for forced ignores
        const isForcedIgnored = forcedIgnorePaths.some(ignorePath =>
          resolvedItemPath.startsWith(ignorePath)
        );

        // Check for forced deletes (moves)
        const isForceMovedFile = stats.isFile() &&
          Array.isArray(config.removeFiles) &&
          config.removeFiles.some(pattern => matchPattern(itemName, pattern));

        // Check for ignored directories and files
        const isIgnoredDir = stats.isDirectory() &&
          !isForcedIgnored &&
          Array.isArray(config.ignoreDirectories) &&
          config.ignoreDirectories.some(pattern => matchPattern(item, pattern));

        const isIgnoredFile = stats.isFile() &&
          !isForcedIgnored &&
          Array.isArray(config.ignoreFiles) &&
          config.ignoreFiles.some(pattern => matchPattern(item, pattern));

        if (isForcedIgnored || isIgnoredDir || (isIgnoredFile && !isForceMovedFile)) {
            logger.text(`Ignoring: ${itemPath}`);
            continue;
        }

        const entry = {
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
            isAlone: false, // Initially set to false
            delete: isForceMovedFile,
            ignore: isForcedIgnored || isIgnoredDir || (isIgnoredFile && !isForceMovedFile),
            stats
        };

        if (stats.isFile()) {
            results.files[itemPath] = entry;
            intrinsicFileCount++;
            intrinsicDirectorySize += stats.size;
        }
        if (stats.isDirectory()) {
            results.directories[itemPath] = entry;
            dirCount++;
        }

        // Update spinner progress
        logger.text(`Scanning: ${itemPath}`);

        // Recursively scan directories
        if (entry.isDirectory) {
            const subScan = await scanDirectory(itemPath, config, depth + 1);

            // Merge subScan results into current results
            results.files = { ...results.files, ...subScan.results.files };
            results.directories = { ...results.directories, ...subScan.results.directories };

            // Update directory attributes with subdirectory data
            fileCount += subScan.fileCount;
            directorySize += subScan.directorySize ?? 0;
            dirCount += subScan.dirCount;
        }
    }

    // Update the current directory entry with the aggregated data
    results.directories[dirPath] = {
        depth,
        path:          dirPath,
        name:          path.basename(dirPath),
        dir:           path.dirname(dirPath),
        isDirectory:   true,
        intrinsicFileCount,
        fileCount:     fileCount + intrinsicFileCount, // Include own files and subdirectory files
        intrinsicDirectorySize,
        directorySize: directorySize + intrinsicDirectorySize, // Include own size and subdirectory size
        size:          directorySize + intrinsicDirectorySize, // Include own size and subdirectory size
        isEmpty:       (directorySize + fileCount) === 0,
        stats:         await stat(dirPath)
    };

    // Update `isAlone` for files based on the directory information
    if (intrinsicFileCount === 1) {
        const singleFilePath = Object.keys(results.files).find(
          filePath => path.dirname(filePath) === dirPath
        );
        if (singleFilePath) {
            results.files[singleFilePath].isAlone = true;
        }
    }

    return { results, fileCount: fileCount + intrinsicFileCount, dirCount };
}

export default scanDirectory;
