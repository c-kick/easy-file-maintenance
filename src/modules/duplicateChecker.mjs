import fs from 'fs/promises';
import crypto from 'crypto';
import pLimit from 'p-limit'; // Use this library to control concurrency
import {rebasePath} from "../utils/helpers.mjs";
import logger from "../utils/logger.mjs";

const CHUNK_SIZE = 2048; // Default chunk size for partial hashing
const HASH_LIMIT = pLimit(10); // Limit concurrency to 10

/**
 * Hashes the first CHUNK_SIZE bytes of a file.
 * @param {string} filePath - Path to the file.
 * @param {number} chunkSize - Number of bytes to hash.
 * @returns {Promise<string>} - The hash of the file chunk.
 */
async function hashFileChunk(filePath, chunkSize = CHUNK_SIZE) {
    const fileHandle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(chunkSize);
    try {
        await fileHandle.read(buffer, 0, chunkSize, 0);
        return crypto.createHash('md5').update(buffer).digest('hex').toString();
    } finally {
        await fileHandle.close();
    }
}

function hashString(string) {
    return crypto.createHash('md5').update(string).digest('hex').toString();
}

/**
 * Determines the original file from a group of duplicates based on the oldest creation or modification date,
 * or the shortest filename as a tiebreaker.
 * @param {object[]} files - Array of file objects representing duplicates.
 * @returns {object} - The original file object.
 */
function determineOriginal(files) {
    let oldestFile = files[0];
    let oldestDate = new Date(Math.min(
      files[0].createdTime ? new Date(files[0].createdTime).getTime() : Infinity,
      files[0].modifiedTime ? new Date(files[0].modifiedTime).getTime() : Infinity
    ));

    for (const file of files) {
        // Convert created and modified times to timestamps
        const createdTimestamp = file.createdTime ? new Date(file.createdTime).getTime() : Infinity;
        const modifiedTimestamp = file.modifiedTime ? new Date(file.modifiedTime).getTime() : Infinity;

        // Determine the earliest timestamp for this file
        const fileTimestamp = Math.min(createdTimestamp, modifiedTimestamp);

        // If this file is older, update oldestFile and oldestDate
        if (fileTimestamp < oldestDate.getTime()) {
            oldestDate = new Date(fileTimestamp);
            oldestFile = file;
        } else if (fileTimestamp === oldestDate.getTime()) {
            // If timestamps are identical, select the file with the shortest name
            if (file.name.length < oldestFile.name.length) {
                oldestFile = file;
            }
        }
    }

    return oldestFile;
}

/**
 * Groups files by their prefix (base name) based on a set of allowed extensions.
 *
 * @param {{}} files - An object of files to be grouped.
 * @param {string[]} extensions - An array of file extensions to include in the grouping (e.g., ['jpg', 'jpeg', 'mp4', 'avi']).
 * @param chunkSize
 * @returns {Promise<[]>} - An array of groups, where each group is an array of file names sharing the same base name.
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

    for (const group of itemGroups) {
        const hashedGroup = await Promise.all(
          group.map(file => HASH_LIMIT(async () => {
              return {...file, hash: await hashFileChunk(file.path, chunkSize)}
          }))
        );
        const groupHash = hashString(hashedGroup.map(file => file.hash).join());

        (returnData[groupHash] = returnData[groupHash] ?? []).push(hashedGroup)
    }

    return Object.entries(returnData).filter(([key, value]) => value.length > 1);
}


/**
 * Finds duplicate files based on size, hash, and sibling file filtering.
 * @param {object} filesObject - Object containing file details from the scanner.
 * @param {string} binPath - The path to the recycle bin.
 * @param dupeSetExts
 * @param {number} chunkSize - Number of bytes to hash for partial comparison.
 * @returns {Promise<Array>} - Array of duplicate groups, each with the original file and its duplicates.
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
        console.log(`Duplicate set: ${hash}`);
        const fileDupes = itemSet.flat();
        const originalFile = determineOriginal(fileDupes);

        if (single) {

            console.log(`Type: File dupes`)
            const duplicatesOnly = fileDupes.filter(file => file !== originalFile).map(item => {
                return {
                    ...item,
                    original: originalFile.path,
                    move_to: rebasePath(binPath, item.path),
                }
            });
            duplicates.push({ type: 'file', original: originalFile, duplicates: duplicatesOnly });

        } else {

            console.log(`Type: Fileset dupes`);
            //find the original file, and select the 'original' set based on in which set we find it
            const originalSet = itemSet.find(subArray => subArray.includes(originalFile));
            const duplicatesOnly = itemSet.filter(set => set !== originalSet).map(item => item.map(item => {
                return {
                    ...item,
                    original: originalSet.filter(origItem => origItem.hash === item.hash)[0].path,
                    move_to: rebasePath(binPath, item.path),
                }
            }));
            duplicates.push({ type: 'set', original: originalSet, duplicates: duplicatesOnly });

        }
    }

    return duplicates;
}

export default getDuplicateItems;
