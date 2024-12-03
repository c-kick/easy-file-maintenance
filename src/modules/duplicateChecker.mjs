
import fs from 'fs/promises';
import crypto from 'crypto';
import pLimit from 'p-limit'; // Use this library to control concurrency
import {extractOldestDate} from "./reorganizer.mjs";

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
        const hash = crypto.createHash('md5').update(buffer).digest('hex');
        return hash;
    } finally {
        await fileHandle.close();
    }
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
 * Finds duplicate files based on size, hash, and sibling file filtering.
 * @param {object} filesObject - Object containing file details from the scanner.
 * @param {number} chunkSize - Number of bytes to hash for partial comparison.
 * @returns {Promise<Array>} - Array of duplicate groups, each with the original file and its duplicates.
 */
async function findDuplicates(filesObject, chunkSize = CHUNK_SIZE) {
    const files = Object.values(filesObject).filter(file => file.isFile && file.size > 0);

    const sizeGroups = files.reduce((groups, file) => {
        (groups[file.size] = groups[file.size] || []).push(file);
        return groups;
    }, {});

    const duplicates = [];

    for (const [size, group] of Object.entries(sizeGroups)) {
        if (group.length < 2) continue; // Skip unique sizes

        // Concurrently hash file chunks
        const hashPromises = group.map(file => HASH_LIMIT(() => hashFileChunk(file.path, chunkSize)));
        const hashes = await Promise.all(hashPromises);

        // Group by hash and determine duplicates
        const hashGroups = hashes.reduce((hashMap, hash, index) => {
            if (hash) {
                (hashMap[hash] = hashMap[hash] || []).push(group[index]);
        }
            return hashMap;
        }, {});

        // Collect duplicates and determine original files
        for (const [hash, hashGroup] of Object.entries(hashGroups)) {
            if (hashGroup.length > 1) {
                const original = determineOriginal(hashGroup);
                const duplicatesOnly = hashGroup.filter(file => file !== original);
                duplicates.push({ original, duplicates: duplicatesOnly });
            }
        }
    }

    return duplicates;
}

export default findDuplicates;
