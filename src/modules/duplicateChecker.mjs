
import fs from 'fs/promises';
import crypto from 'crypto';

const CHUNK_SIZE = 2048; // Default chunk size for partial hashing

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
 * Determines the original file from a duplicate group based on criteria
 * such as the smallest size and earliest modification time.
 * @param {Array<Object>} group - Array of files in a duplicate group.
 * @returns {Object} - The original file.
 */
function determineOriginal(group) {
    return group.reduce((original, current) => {
        // Prioritize smallest size, then earliest modified time
        if (current.size < original.size ||
            (current.size === original.size && current.modifiedTime < original.modifiedTime)) {
            return current;
        }
        return original;
    });
}


/**
 * Finds duplicate files based on size, hash, and sibling file filtering.
 * @param {object} filesObject - Object containing file details from the scanner.
 * @param {number} chunkSize - Number of bytes to hash for partial comparison.
 * @returns {Promise<Array>} - Array of duplicate groups, each with the original file and its duplicates.
 */
async function findDuplicates(filesObject, chunkSize = CHUNK_SIZE) {
    // Convert filesObject to an array of file entries
    const files = Object.values(filesObject);
    // Group files by size
    const sizeGroups = files.reduce((groups, file) => {
        if (!file.isFile) return groups; // Ignore directories
        if (!file.size) return groups; // Ignore zero byte files
        (groups[file.size] = groups[file.size] || []).push(file);
        return groups;
    }, {});

    const duplicates = [];

    for (const [size, group] of Object.entries(sizeGroups)) {
        if (group.length < 2) continue; // Skip unique sizes

        // Hash the first chunk of each file and group by hash
        const hashGroups = {};
        for (const file of group) {
            const hash = await hashFileChunk(file.path, chunkSize);
            (hashGroups[hash] = hashGroups[hash] || []).push(file);
        }

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
