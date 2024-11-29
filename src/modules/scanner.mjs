import logger from '../utils/logger.mjs';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import ora from 'ora';

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
 * @returns {Promise<object[]>} - List of file and directory details.
 */
async function scanDirectory(dirPath, config, depth = 0) {
    const results = [];
    const items = await readdir(dirPath);

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
            dir: path.dirname(itemPath),
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            modifiedTime: stats.mtime,
            createdTime: stats.ctime,
            isEmpty: stats.isDirectory() ? (await readdir(itemPath)).length === 0 : stats.size === 0,
            delete: isForceMovedFile,
            stats
        };

        results.push(entry);

        // Update spinner progress
        logger.text(`Scanning: ${itemPath}`);

        // Recursively scan directories
        if (entry.isDirectory) {
            const subResults = await scanDirectory(itemPath, config, depth + 1);
            results.push(...subResults);
        }
    }

    return results;
}

export default scanDirectory;
