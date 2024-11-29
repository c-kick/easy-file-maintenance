
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
 * Filters file groups by excluding files that are likely part of a fileset,
 * based on the presence of sibling files (i.e., files with the same base name
 * but different extensions) in the same directory.
 * @param {Array<Array<Object>>} dupeSets - Array of file groups where each group
 * contains files with identical hash values.
 * @param {Array<Object>} files - Array of all file objects, which is used to
 * check for siblings in the same directory as potential duplicates.
 * @returns {Array<Array<Object>>} - An array of filtered file groups where each
 * group excludes files with siblings, retaining only true duplicates.
 */
function fileSiblingCheck(dupeSets, files) {
    return dupeSets.map((dupeSet) => {
        const baseDir = dupeSet[0].path.replace(/\/[^\/]+$/, '');
        const siblingCandidates = files.filter(file =>
            file.path.startsWith(baseDir)
        );

        const filteredDupes = dupeSet.slice(1).filter(dupe => {
            const baseName = dupe.path.split('/').pop().split('.')[0];
            const siblings = siblingCandidates.filter(file =>
                file.path.split('/').pop().split('.')[0] === baseName &&
                file.path !== dupe.path
            );
            return siblings.length === 0;
        });

        return filteredDupes.length > 0 ? [dupeSet[0], ...filteredDupes] : null;
    }).filter(Boolean);
}

/**
 * Finds duplicate files based on size, hash, and sibling file filtering.
 * @param {object[]} files - Array of file details from the scanner.
 * @param {number} chunkSize - Number of bytes to hash for partial comparison.
 * @returns {Promise<Array>} - Array of duplicate groups, each with the original file and its duplicates.
 */
async function findDuplicates(files, chunkSize = CHUNK_SIZE) {
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

    // Apply sibling file filtering
    const filteredDuplicates = fileSiblingCheck(duplicates.map(group => [group.original, ...group.duplicates]), files);

    // Reformat filtered results into the original/duplicates structure
    return filteredDuplicates.map(group => ({
        original: group[0],
        duplicates: group.slice(1)
    }));
}

export default findDuplicates;
