import pLimit from 'p-limit'; // Use this library to control concurrency
import {hashFileChunk, hashString, rebasePath, withConcurrency} from "../utils/helpers.mjs";
import logger from "../utils/logger.mjs";
import crypto from "crypto";

const FILE_LIMIT = pLimit(2); // Limit concurrency
const CHUNK_SIZE = 131072; // Default chunk size for partial hashing

/**
 * Determines the "original" file from a list of duplicate files.
 *
 * This function evaluates an array of file objects and identifies the original file
 * based on the following criteria:
 *
 * 1. **Oldest Date**: The file with the earliest creation or modification date is considered the original.
 * 2. **Shortest Filename (Tie-breaker)**: If two or more files have identical timestamps, the file
 *    with the shortest filename is chosen as the original.
 *
 * How It Works:
 * - The function uses the `Array.prototype.reduce` method to iterate over the array of files.
 * - For each file, the earliest of its creation and modification dates is calculated.
 * - These timestamps are compared to determine the oldest file. If the timestamps are identical,
 *   the filename length is compared.
 *
 * @param {object[]} files - Array of file objects. Each file object should include:
 *   - {string} name - The file name.
 *   - {string} [createdTime] - The file's creation date (optional).
 *   - {string} [modifiedTime] - The file's last modification date (optional).
 * @returns {object} - The file object deemed as the "original" based on the described criteria.
 *
 * @example
 * const files = [
 *   { name: 'fileA.txt', createdTime: '2022-01-01T10:00:00Z', modifiedTime: '2022-01-02T10:00:00Z' },
 *   { name: 'fileB.txt', createdTime: '2022-01-01T08:00:00Z', modifiedTime: '2022-01-01T12:00:00Z' },
 *   { name: 'fileC.txt', createdTime: '2022-01-01T08:00:00Z', modifiedTime: '2022-01-01T12:00:00Z' },
 * ];
 *
 * const originalFile = determineOriginal(files);
 * console.log(originalFile);
 * // Output: { name: 'fileB.txt', createdTime: '2022-01-01T08:00:00Z', modifiedTime: '2022-01-01T12:00:00Z' }
 */
async function determineOriginal(files) {
    return files.reduce((oldest, file) => {
        const fileTimestamp = Math.min(
          file.stats.ctimeMs,
          file.stats.birthtimeMs
        );

        const oldestTimestamp = Math.min(
          oldest.stats.ctimeMs,
          oldest.stats.birthtimeMs
        );

        if (fileTimestamp < oldestTimestamp ||
          (fileTimestamp === oldestTimestamp && file.name.length < oldest.name.length)) {
            return file;
        }
        return oldest;
    }, files[0]);
}

function getSideCarFiles(file, filesInThisDir, extensions = ['jpg', 'jpeg', 'mp4', 'avi']) {
    const basePattern = new RegExp(`^${file.baseName}(?![a-zA-Z0-9 \-])`);
    const sideCarFiles = [];
    if (extensions.includes(file.extension)) {
        for (const otherFile of filesInThisDir[file.dir].filter(otherFile => otherFile !== file)) {
            if (basePattern.test(otherFile.baseName) && file.size > otherFile.size) {
                sideCarFiles.push(otherFile);
            }
        }

    }
    return sideCarFiles;
}

async function calculateDirectoryHash(dirEntry, results) {
    const hash = crypto.createHash('md5');
    const childFiles = Array.from(results.files.values()).filter((file) => file.dir === dirEntry.path);
    const childDirs = Array.from(results.directories.values()).filter((subDir) => subDir.dir === dirEntry.path);

    for (const file of childFiles) {
        hash.update(await hashFileChunk(file.path));
    }
    for (const subDir of childDirs) {
        hash.update(await calculateDirectoryHash(subDir, results));
    }
    return hash.digest('hex');
}

async function getDuplicateItems(items, binPath) {

    //first handle directories

    const groupedDirs = {};
    items.directories.forEach((dir) => {
        const key = [dir.intrinsicSize, dir.size, dir.fileCount, dir.stats.nlink, dir.stats.size].join('_');
        if (!groupedDirs[key]) groupedDirs[key] = [];
        if (dir.size > 0) groupedDirs[key].push(dir);
    });

    const duplicateDirs = {};
    logger.text(`Found ${Object.entries(groupedDirs).length} potential duplicate directories.`);
    for (const [key, dirs] of Object.entries(groupedDirs)) {
        if (dirs.length > 1) {
            const originalDir = await determineOriginal(dirs);
            const dirHashes = await Promise.all(dirs.map((dir) => {
                logger.start(`Hashing directory ${dir.path}...`);
                return calculateDirectoryHash(dir, items)
            }));
            const uniqueHashes = new Set(
              dirHashes.filter((item, index, arr) => arr.indexOf(item) !== index && arr.lastIndexOf(item) === index)
            );
            duplicateDirs[key] = dirs
            .filter((dir, idx) => uniqueHashes.has(dirHashes[idx]) && dir !== originalDir)
            .map((file, idx) => ({...file, hash: dirHashes[idx], duplicate_of: originalDir.path}));
        }
    }
    const duplicateDirPaths = Object.values(duplicateDirs).flat().map(dir => dir.path);

    //now handle files

    const filesByDir = {};
    items.files.forEach((file) => {
        if (!filesByDir[file.dir]) filesByDir[file.dir] = [];
        filesByDir[file.dir].push(file);
        return filesByDir;
    }, {});

    const groupedFiles = {};
    items.files.forEach((file) => {
        if (duplicateDirPaths.includes(file.dir)) {
            //file is in a duplicate directory, so can be ignored
            return
        }
        const key = `${file.size}_${file.extension}`;
        if (!groupedFiles[key]) groupedFiles[key] = [];
        groupedFiles[key].push(file);
    });

    const duplicateFiles = {};;
    logger.text(`Found ${Object.entries(groupedFiles).length} potential duplicate files.`);
    for (const [key, files] of Object.entries(groupedFiles)) {
        if (files.length > 1) {
            const originalFile = await determineOriginal(files);
            const hashedGroup = await Promise.all(files.map(async file => {
                logger.start(`Hashing file ${file.path}...`);
                return await hashFileChunk(file.path);
            }));
            const uniqueHashes = new Set(
              hashedGroup.filter((item, index, arr) => arr.indexOf(item) !== index && arr.lastIndexOf(item) === index)
            );
            duplicateFiles[key] = files
            .filter((file, idx) => uniqueHashes.has(hashedGroup[idx]) && file !== originalFile)
            .map((file, idx) => ({...file,
                hash: hashedGroup[idx],
                duplicate_of: originalFile.path,
                sidecars : getSideCarFiles(file, filesByDir).map(sidecarFile => ({
                    ...sidecarFile,
                    move_to: rebasePath(binPath, sidecarFile.path)
                }))
            }));
        }
    }

    //filter out any duplicates that are sidecars, and add move_to paths
    const duplicateFilesFiltered = Object.values(duplicateFiles)
    .flat() // Flatten the object values into a single array
    .filter((duplicate, _, allDuplicates) => {
        // Extract all `path` values from sidecars across all duplicates
        const sidecarPaths = allDuplicates.flatMap(item =>
          (item.sidecars || []).map(sidecar => sidecar.path)
        );
        return !sidecarPaths.includes(duplicate.path);
    }).map(file => ({
        ...file,
        move_to: rebasePath(binPath, file.path)
    }));

    const duplicateDirsFiltered = Object.values(duplicateDirs).flat().map(dir => ({
        ...dir,
        move_to: rebasePath(binPath, dir.path)
    }));

    return ({
        directories: duplicateDirsFiltered,
        files: duplicateFilesFiltered
    });
}

export default getDuplicateItems;
