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

function shouldIgnore(itemName, resolvedItemPath, stats, config) {
    const forcedIgnorePaths = [config.recycleBinPath].map(p => path.resolve(p));
    const isForcedIgnored = forcedIgnorePaths.some(ignorePath =>
      resolvedItemPath.startsWith(ignorePath)
    );

    if (isForcedIgnored) return true;

    if (stats.isDirectory() && config.ignoreDirectories.some(pattern => matchPattern(itemName, pattern))) {
        return true;
    }

    return !!(stats.isFile() && config.ignoreFiles.some(pattern => matchPattern(itemName, pattern)));


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
        isAlone: false,
        stats,
    };
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
            const resolvedItemPath = path.resolve(itemPath);
            const itemName = path.basename(itemPath);

            if (shouldIgnore(itemName, resolvedItemPath, stats, config)) {
                logger.text(`Ignoring: ${itemPath}`);
                continue;
            } else {
                logger.text(`Scanning... ${itemPath}`);
            }

            const entry = createEntry(itemPath, itemName, stats, depth);
            if (stats.isFile()) {
                results.files.set(itemPath, entry);
            } else if (stats.isDirectory()) {
                results.directories.set(itemPath, entry);
                queue.push({ dirPath: itemPath, depth: depth + 1 });
            }
        }
    }

    return results;
}

export default scanDirectory;
