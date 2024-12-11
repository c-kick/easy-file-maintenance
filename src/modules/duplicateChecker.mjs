import pLimit from 'p-limit'; // Use this library to control concurrency
import {hashFileChunk, hashString, rebasePath, withConcurrency} from "../utils/helpers.mjs";
import logger from "../utils/logger.mjs";
import path from "path";

const CHUNK_SIZE = 131072; // Default chunk size for partial hashing
const FILE_LIMIT = pLimit(5); // Limit concurrency to 10

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

function partitionFilesByDirectory(files) {
    logger.text(`Arranging files into directory-sets...`);
    const partitions = {};
    files.forEach(file => {
        const {dir} = file;
        if (!partitions[dir]) {
            partitions[dir] = [];
        }
        partitions[dir].push(file);
    });
    return partitions;
}

async function duplicatesGrouper(files, extensions) {
    const filesetMap = [];
    const duplicates = {
        files: [], sets: []
    }

    // Pre-group files by directory
    const filesByDir = files.reduce((acc, file) => {
        if (!acc[file.dir]) acc[file.dir] = [];
        acc[file.dir].push(file);
        return acc;
    }, {});

    // Process each directory to determine filesets and arrange them into groups by their combined file size
    const filesetSizeGroups = {};
    for (const [dirPath, dirFiles] of Object.entries(filesByDir)) {
        const dirFilesByBase = {};

        for (const file of dirFiles) {
            if (extensions.includes(file.extension)) {
                const basePattern = new RegExp(`^${file.baseName}(?![a-zA-Z0-9])`);

                if (!dirFilesByBase[file.baseName]) dirFilesByBase[file.baseName] = [];

                // Find matching files for this fileset
                for (const otherFile of dirFiles) {
                    if (basePattern.test(otherFile.baseName) && file !== otherFile) {
                        dirFilesByBase[file.baseName].push(otherFile);
                    }
                }
                if (!dirFilesByBase[file.baseName].length) continue;
                // Include the triggering file itself
                file.isSetMaster = true;
                dirFilesByBase[file.baseName].push(file);
            }
        }

        // Convert matches into filesets
        for (const [baseName, fileSet] of Object.entries(dirFilesByBase)) {
            if (fileSet.length > 1) { //skip sets that are not duplicates
                const filesetSize = fileSet.reduce((sum, f) => sum + f.size, 0);
                for (const file of fileSet) {
                    filesetMap.push(file.path);
                }
                (filesetSizeGroups[filesetSize] = filesetSizeGroups[filesetSize] ?? []).push(fileSet);

            }
        }
    }

    for (const [size, fileSets] of Object.entries(filesetSizeGroups)) {
        if (fileSets.length > 1) {
            const masterFiles = fileSets.flat().filter(file => file.isSetMaster);
            const original = await determineOriginal(masterFiles);
            const originalSet = fileSets.filter(fileSet => fileSet.includes(original));
            const duplicateSets = fileSets.filter(fileSet => !fileSet.includes(original));
            duplicates.sets.push({
                original: [...originalSet[0]],
                duplicates: duplicateSets
            });
        }
    }

    // Process file groups of equal size, but ignore those who are already in a fileset.
    const fileSizeGroups = {};
    // Group files by size
    const sizeGroups = files.reduce((acc, file) => {
        if (!acc[file.size]) acc[file.size] = [];
        acc[file.size].push(file);
        return acc;
    }, {});

    // Process duplicate groups and filesets
    for (const [size, group] of Object.entries(sizeGroups)) {
        if (group.length > 1) {

            const original = await determineOriginal(group);
            const nonFilesetFiles = group.filter(file => !filesetMap.includes(file.path));

            for (const file of nonFilesetFiles) {
                if (file !== original) {
                    file.suspected_duplicate_of = original.path;
                    duplicates.files.push(file);
                }
                (fileSizeGroups[size] = fileSizeGroups[size] ?? []).push(file);
            }
        }
    }
    return duplicates;
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
    const newDuplicates = {};

    logger.text(`Filtering files first...`);
    // Pre-filter files object to only retain files that actually have a size
    const files = Object.values(filesObject).filter(file => file.isFile && file.size > 0);

    logger.text(`Grouping ${files.length} files...`);
    // Smart group these files to create single- or multi filesets, and compute hashes for all these
    const smartSizeGroups = await duplicatesGrouper(files, dupeSetExts);

    logger.text(`Found ${Object.entries(smartSizeGroups.sets).length} suspected fileset duplicates, and ${Object.entries(smartSizeGroups.files).length} suspected individual file duplicates`);

    for (const dupeType in smartSizeGroups) {
        const items = smartSizeGroups[dupeType];
        switch (dupeType) {

            case 'files':
                //hash files first
                const hashedItems = await Promise.all(items.map(async file => {
                    const hash = await hashFileChunk(file.path, chunkSize);
                    logger.start(`Hashing... ${file.path}`);
                    return { ...file, hash };
                }));
                //process files
                for (const file of hashedItems) {
                    const originalFile = file.suspected_duplicate_of;
                    if (!originalFile) {
                        console.error(`No duplicate reference found for "${file.path}"`);
                    } else {
                        const origHash = await hashFileChunk(originalFile, chunkSize);
                        logger.start(`Hashing... ${file.path}`);
                        const confirmedDupe = (file.hash === origHash);
                        if (confirmedDupe) {
                            delete file.suspected_duplicate_of;
                            (newDuplicates[originalFile] = newDuplicates[originalFile] ?? []).push({...file, duplicate_of: originalFile, move_to: rebasePath(binPath, file.path)});
                        } else {
                            //not a duplicate based on md5 hash
                            //console.log(`${file.path} is not a duplicate of ${originalFile}, based on MD5 hash:`);
                            //console.log(`${file.hash} != ${origHash}`);
                        }
                    }
                }
                break;

            case 'sets':
                for (const set of items) {

                    //hash files in the original set
                    const hashedSet = await Promise.all(set.original.map(async file => {
                        return { ...file, hash: await hashFileChunk(file.path, chunkSize) };
                    }));
                    //combine hashes into a single original group hash
                    const originalSetHash = hashString(hashedSet.map(file => file.hash).join());
                    // Create a lookup map for hashedSet by hash
                    const hashMap = Object.fromEntries(hashedSet.map(file => [file.hash, file.path]));

                    for (const duplicateSet of set.duplicates) {
                        //hash files in subset
                        const hashedGroup = await Promise.all(duplicateSet.map(async file => {
                            const hash = await hashFileChunk(file.path, chunkSize);
                            logger.start(`Hashing... ${file.path}`);
                            return { ...file, hash  };
                        }));
                        //combine hashes into a single group hash
                        const groupHash = hashString(hashedGroup.map(file => file.hash).join());
                        const confirmedDupe = (originalSetHash === groupHash);
                        if (confirmedDupe) {
                            hashedGroup.forEach(file => {
                                const originalFile = hashMap[file.hash] || null; // Use null if no match is found
                                (newDuplicates[originalFile] = newDuplicates[originalFile] ?? []).push(
                                  {...file, isInFileset: true, duplicate_of: originalFile, move_to: rebasePath(binPath, file.path) }
                                );
                            });
                        } else {
                            //not a duplicate based on md5 hash
                            //console.log(`Fileset ${hashedGroup.map(item => item.path).join(', ')} is not a duplicate of fileset ${hashedSet.map(item => item.path).join(', ')} , based on MD5 hash:`);
                            //console.log(`${groupHash} != ${originalSetHash}`);
                        }
                    }

                }
                break;

            default:
                console.error(`"${dupeType}" not defined`);
        }
    }

    //newDuplicates now contains all duplicates that need handling, whether they are part of a fileset or not.
    return newDuplicates;

}

export default getDuplicateItems;
