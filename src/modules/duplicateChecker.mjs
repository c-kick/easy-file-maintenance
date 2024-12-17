import {
    calculateDirectoryHash,
    filterGroupsWithMultipleEntries,
    getSideCarFiles,
    hashFileChunk,
    rebasePath
} from "../utils/helpers.mjs";
import logger from "../utils/logger.mjs";
import crypto from "crypto";

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

/**
 * Processes grouped items to identify duplicates by calculating hashes and filtering based on unique hashes.
 *
 * @template T
 * @param {Object<string, T[]>} groupedItems - An object where keys represent groups and values are arrays of items to process.
 * @param {function(T): Promise<string>} hashFunction - A function that calculates a hash for an item. Must return a promise resolving to the item's hash.
 * @param {function(T[]): Promise<T>} determineOriginal - A function that determines the original item from a group. Must return a promise resolving to the original item.
 * @param {function(T, number): Object} [processExtras] - Optional function to process additional properties for each duplicate.
 *        Receives the item and its index as arguments. Defaults to a no-op function.
 * @returns {Promise<Object<string, T[]>>} - A promise resolving to an object where keys are group keys and values are arrays of processed duplicate items.
 *
 */
async function processGroupedItems(groupedItems, hashFunction, determineOriginal, processExtras = () => ({})) {
    const duplicates = {};
    const groups = Object.entries(groupedItems);
    let progress = 0;

    for (const [key, items] of groups) {
        if (items.length > 1) {
            const originalItem = await determineOriginal(items);

            // Hash each item and log the operation
            const hashes = await Promise.all(
              items.map(async item => {
                  logger.text(`Hashing ${item.isFile ? 'file' : 'directory'} ${progress}/${groups.length}...`);
                  return await hashFunction(item);
              })
            );

            // Identify duplicate hashes
            const uniqueHashes = new Set(
              hashes.filter((hash, idx, arr) => arr.indexOf(hash) !== idx && arr.lastIndexOf(hash) === idx)
            );

            // Filter and map duplicates
            duplicates[key] = items
            .filter((item, idx) => uniqueHashes.has(hashes[idx]) && item !== originalItem)
            .map((item, idx) => ({
                ...item,
                hash: hashes[idx],
                duplicate_of: originalItem.path,
                ...processExtras(item, idx) // Add extra properties if needed
            }));

            progress += 1; // Increment progress after processing
        }
    }

    return duplicates;
}


async function getDuplicateItems(items, binPath) {

    //first handle directories
    const groupedDirs = {};
    items.directories.forEach((dir) => {
        const key = [dir.intrinsicSize, dir.size, dir.fileCount, dir.stats.nlink, dir.stats.size].join('_');
        if (!groupedDirs[key]) groupedDirs[key] = [];
        if (dir.size > 0) groupedDirs[key].push(dir);
    });
    const filteredGroupedDirs = filterGroupsWithMultipleEntries(groupedDirs);

    const duplicateDirs = await processGroupedItems(
      filteredGroupedDirs,
      dir => calculateDirectoryHash(dir, items),
      determineOriginal,
    );

    //create a set of duplicate directory paths found, to cross-reference files later
    const duplicateDirPaths = new Set(
      Object.values(duplicateDirs).flat().map(dir => dir.path)
    );

    //now handle files
    const filesBySize = {};
    items.files.forEach((file) => {
        if (duplicateDirPaths.has(file.dir)) {
            //file is in a duplicate directory, so can be ignored
            return;
        }
        const key = `${file.size}`;
        if (!filesBySize[key]) filesBySize[key] = [];
        filesBySize[key].push(file);
    });
    const filteredFilesBySize = filterGroupsWithMultipleEntries(filesBySize);

    const filesByDir = {};
    items.files.forEach((file) => {
        if (!filesByDir[file.dir]) filesByDir[file.dir] = [];
        filesByDir[file.dir].push(file);
        return filesByDir;
    }, {});

    const duplicateFiles = await processGroupedItems(
      filteredFilesBySize,
      file => hashFileChunk(file.path),
      determineOriginal,
      (file, idx) => ({
          sidecars: getSideCarFiles(file, filesByDir).map(sidecarFile => ({
              ...sidecarFile,
              move_to: rebasePath(binPath, sidecarFile.path)
          }))
      })
    );

    //create a set of sidecar files found
    const sidecarPaths = new Set(
      Object.values(duplicateFiles).flat().flatMap(file =>
        (file.sidecars || []).map(sidecar => sidecar.path)
      )
    );

    //filter out any duplicates that are sidecars, and add move_to paths
    const returnFiles = Object.values(duplicateFiles)
    .flat() // Flatten the object values into a single array
    .filter(file => !sidecarPaths.has(file.path))
    .map(file => ({
        ...file,
        move_to: rebasePath(binPath, file.path)
    }));

    const returnDirs = Object.values(duplicateDirs).flat().map(dir => ({
        ...dir,
        move_to: rebasePath(binPath, dir.path)
    }));

    // Calculate the total size of duplicate files
    const totalSize = returnFiles.reduce((sum, file) => sum + file.size, 0);

    return ({
        directories: returnDirs,
        files: returnFiles,
        size: totalSize // Include total size of duplicate files
    });
}

export default getDuplicateItems;
