import pLimit from 'p-limit'; // Use this library to control concurrency
import {hashFileChunk, hashString, rebasePath, withConcurrency} from "../utils/helpers.mjs";
import logger from "../utils/logger.mjs";

const CHUNK_SIZE = 131072; // Default chunk size for partial hashing
const HASH_LIMIT = pLimit(10); // Limit concurrency to 10

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
function determineOriginal(files) {
    return files.reduce((oldest, file) => {
        // Determine the earliest timestamp for the current file
        const fileTimestamp = Math.min(
          new Date(file.createdTime ?? Infinity).getTime(),
          new Date(file.modifiedTime ?? Infinity).getTime()
        );

        // Determine the earliest timestamp for the current oldest file
        const oldestTimestamp = Math.min(
          new Date(oldest.createdTime ?? Infinity).getTime(),
          new Date(oldest.modifiedTime ?? Infinity).getTime()
        );

        // Compare timestamps and use filename length as a tie-breaker
        if (fileTimestamp < oldestTimestamp ||
          (fileTimestamp === oldestTimestamp && file.name.length < oldest.name.length)) {
            return file;
        }
        return oldest;
    }, files[0]);
}

/**
 * Groups files by their prefix (base name) based on a set of allowed extensions.
 *
 * @param {object[]} files - Array of file objects to be grouped. Each file object should include:
 *   - {string} path - The full file path.
 * @param {string[]} extensions - Array of file extensions that are likely accompanied by metadata-files (e.g., ['jpg', 'jpeg', 'mp4', 'avi']).
 * @param {number} chunkSize - Number of bytes to hash for grouping (defaults to CHUNK_SIZE).
 * @returns {Promise<object[]>} - Array of groups. Each group contains an array of file objects sharing the same base name.
 */
async function smartGroupFiles(files, extensions, chunkSize) {
    const pattern = new RegExp(`(.*)\\.(${extensions.join('|')})$`, 'i');
    const itemGroups = [];
    const returnData = {};
    const processedItems = new Set();

    files.forEach(item => {
        // Skip items that have already been processed
        if (processedItems.has(item)) {
            return;
        }

        logger.text(`Checking for filesets... ${item.path}`);

        const match = item.path.match(pattern);
        let relatedItems = [];

        if (match) {
            const baseName = match[1];
            // Find all items with the same base name
            relatedItems = files.filter(i => !i.path.match(pattern) && i.path.includes(baseName));

            // Add them to the return object
            itemGroups.push([item, ...relatedItems]);

            // Mark all related items as processed
            relatedItems.forEach(i => processedItems.add(i));
        } else {
            // Single file match
            itemGroups.push([item]);
        }
    });

    logger.text(`Found ${itemGroups.length} potential duplicate files / filesets. Now hashing...`);

    for (const group of itemGroups) {
        const hashedGroup = await withConcurrency(HASH_LIMIT, group.map(file => async () => {
            logger.text(`Hashing... ${file.path}`);
            return { ...file, hash: await hashFileChunk(file.path, chunkSize) };
        }));
        const groupHash = hashString(hashedGroup.map(file => file.hash).join());

        (returnData[groupHash] = returnData[groupHash] ?? []).push(hashedGroup)
    }

    return Object.entries(returnData).filter(([key, value]) => value.length > 1);
}

/**
 * Identifies duplicate files based on size, hash, and sibling file filtering.
 *
 * @param {object} filesObject - Object mapping file paths to file details. Each file object should include:
 *   - {boolean} isFile - Whether the entry is a file.
 *   - {number} size - The file size in bytes.
 *   - {string} path - The file path.
 * @param {string} binPath - The path to the recycle bin.
 * @param {string[]} [dupeSetExts=['jpg', 'jpeg', 'mp4', 'avi']] - Extensions to consider for duplicate grouping - see docs for smartGroupFiles.
 * @param {number} chunkSize - Number of bytes to hash for partial comparison (defaults to CHUNK_SIZE).
 * @returns {Promise<Array>} - Array of duplicate groups. Each group includes the original file and its duplicates.
 */
async function getDuplicateItems(filesObject, binPath, dupeSetExts = ['jpg', 'jpeg', 'mp4', 'avi'], chunkSize = CHUNK_SIZE) {
    const duplicates = [];

    // Pre-filter files object to only retain files that actually have a size
    const files = Object.values(filesObject).filter(file => file.isFile && file.size > 0);

    // Smart group these files to create single- or multi filesets, and compute hashes for all these
    const smartSizeGroups = await smartGroupFiles(files, dupeSetExts, chunkSize);

    logger.text(`Found ${smartSizeGroups.length} suspected duplicates.`);

    for (const [hash, itemSet] of smartSizeGroups) {
        let single = itemSet.every(items => items.length === 1);
        const fileDupes = itemSet.flat();
        const originalFile = determineOriginal(fileDupes);
        let originalSet;
        let duplicatesOnly;

        if (single) {

            //single file dupes
            duplicatesOnly = fileDupes.filter(file => file !== originalFile).map(item => {
                return {
                    ...item,
                    original: originalFile.path,
                    move_to: rebasePath(binPath, item.path),
                }
            });

        } else {

            //fileset dupes
            //find the original file, and select the 'original set' based on in which set we find it
            originalSet = itemSet.find(subArray => subArray.includes(originalFile));
            duplicatesOnly = itemSet.filter(set => set !== originalSet).map(item => item.map(item => {
                return {
                    ...item,
                    original: originalSet.filter(origItem => origItem.hash === item.hash)[0].path,
                    move_to: rebasePath(binPath, item.path),
                }
            }));

        }

        duplicates.push({
            type: single ? 'file' : 'set',
            original: single ? originalFile : originalSet,
            duplicates: duplicatesOnly
        });
    }

    return duplicates;
}

export default getDuplicateItems;
