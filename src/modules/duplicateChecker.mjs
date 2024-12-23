import {
  calculateDirectoryHash,
  getFilesetForFile,
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
    logger.text(`Verifying potential directory duplicates ${progress}/${groups.length}...`);
    if (items.length > 1) {
      const originalItem = await determineOriginal(items);

      // Hash each item and log the operation
      const hashes = await Promise.all(
        items.map(async item => {
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
        hash:         hashes[idx],
        duplicate_of: originalItem.path,
        ...processExtras(item, idx) // Add extra properties if needed
      }));

      progress += 1; // Increment progress after processing
    }
  }

  return duplicates;
}

/**
 * Groups items into directories, files, and dirFiles, and identifies duplicates.
 *
 * This function processes an array of items, grouping them by properties that are likely to indicate duplicates.
 * It then verifies if the suspected duplicate directories and files are indeed duplicates by calculating hashes
 * and filtering based on unique hashes.
 *
 * @param {Object} items - The items to be grouped and checked for duplicates.
 * @param {Object[]} items.directories - Array of directory objects.
 * @param {Object[]} items.files - Array of file objects.
 * @returns {Promise<Object>} - A promise that resolves to an object containing grouped and filtered duplicate items.
 */
async function groupItems(items) {
  const groupedItems = {
    directories: {},
    files:       {},
    dirFiles:    {}
  };
  const fileDupeSets = new Set();

  /**
   * Helper that filters out groups that contain only a single item (i.e. non-duplicate groups).
   *
   * @param {Object} groupedItems - The grouped items to be filtered.
   * @returns {Object} - The filtered grouped items containing only groups with more than one item.
   */
  function filterOutSingleGroups(groupedItems) {
    return Object.keys(groupedItems).reduce((filtered, key) => {
      if (groupedItems[key].length > 1) {
        filtered[key] = groupedItems[key];
      }
      return filtered;
    }, {});
  }

  //First, group directories by properties that are likely to indicate duplicates
  items.directories.forEach((dir) => {
    const key = [dir.intrinsicSize, dir.totalSize, dir.fileCount, dir.stats.nlink, dir.stats.size].join('_');
    if (!groupedItems.directories[key]) groupedItems.directories[key] = [];
    if (dir.size > 0) groupedItems.directories[key].push(dir);
  });

  //Then, verify if the suspected duplicate directories are indeed duplicates
  const duplicateDirs = await processGroupedItems(
    filterOutSingleGroups(groupedItems.directories),
    dir => calculateDirectoryHash(dir, items),
    determineOriginal,
  );

  //create a set of any duplicate directory paths found, to cross-reference with files
  const duplicateDirPaths = new Set(
    Object.values(duplicateDirs).flat().map(dir => dir.path)
  );

  //Group files by properties that are likely to indicate duplicates, rejecting files in duplicate directories
  items.files.forEach((file) => {
    if (duplicateDirPaths.has(file.dir)) {
      return;
    }
    const key = `${file.stats.size}`;
    if (!groupedItems.files[key]) groupedItems.files[key] = [];
    groupedItems.files[key].push(file);

    //Also group files by directory, to check for sidecar files
    if (!groupedItems.dirFiles[file.dir]) groupedItems.dirFiles[file.dir] = [];
    groupedItems.dirFiles[file.dir].push(file);
  });

  //Set up progress counter
  let progress = 0;

  //Filter out single groups and process duplicate files
  const filteredGroupedFiles = Object.entries(groupedItems.files).filter(([_, dupeSet]) => dupeSet.length > 1);

  //Verify suspected file duplicates
  // Filtering Rules:
  // - Exclude the reference entry (the one containing the "original" file) itself,
  //   as it is not considered a duplicate.
  // - If the entry is not a set and not the original:
  //   - Include it if its hash matches any of the hashes in the reference entry's items.
  // - If the entry is a set but not the original:
  //   - Include it if the overall hash of the set matches the reference entry's hash.
  // - If the reference entry is not a set:
  //   - Include the entry if its hash matches the reference entry's hash.
  // - This ensures that:
  //   - Sets are treated as higher-priority duplicates (representing logically related groups).
  //   - Single files are compared at an individual hash level for duplicates.
  //   - Only valid duplicates are included, maintaining the reference entry's integrity.
  for (const [setId, dupeSet] of filteredGroupedFiles) {
    logger.text(`Verifying potential file duplicates ${progress}/${filteredGroupedFiles.length}...`);
    //determine what should be considered the original in the set of duplicates
    const processedDupeSet = [];
    const setOriginal = await determineOriginal(dupeSet);

    for (const dupe of dupeSet) {
      if (dupe.hasOwnProperty('path')) {
        const hashSet = {set: false, hash: null, original: false, items: []};
        const fileSet = getFilesetForFile(dupe.path, groupedItems.dirFiles[dupe.dir]);
        hashSet.set = (fileSet.length > 1);
        hashSet.original = (dupe.path === setOriginal.path);
        hashSet.items = await Promise.all((hashSet.set ? fileSet : [dupe]).map(async file => {
          const hash = await hashFileChunk(file.path);
          return {...file, hash};
        }));
        hashSet.hash = hashSet.set ?
          crypto.createHash('md5').update(hashSet.items.map(item => item.hash).join('')).digest('hex').toString() :
          hashSet.items[0].hash;
        processedDupeSet.push(hashSet);
      }
    }

    // Find the original entry
    let referenceEntry = processedDupeSet.find(entry => entry.original);
    if (!referenceEntry) {
      throw new Error("No 'original' entry found in the processedDupeSet.");
    }

    // If the original entry is not a set, determine if another entry should become the new reference,
    // as fileset duplicates take precedence over single file duplicates
    if (!referenceEntry.set) {
      for (let entry of processedDupeSet) {
        if (entry.set && entry.items.some(item => item.hash === referenceEntry.hash)) {
          referenceEntry = entry;
          break;
        }
      }
    }

    // Map reference items for quick lookup
    const referenceItemsMap = new Map(
      referenceEntry.items.map(item => [item.hash, item.path])
    );


    // Filter entries based on the rules
    const filteredSet = processedDupeSet.filter(entry => {
      // Always filter out the reference entry
      if (entry === referenceEntry) return false;

      if (!entry.set && !entry.original) {
        // If not a set and not original, check hash matches one of the reference items
        return referenceEntry.items.some(item => item.hash === entry.hash);
      } else if (entry.set && !entry.original) {
        // If it is a set but not original, check hash matches the reference hash
        return entry.hash === referenceEntry.hash;
      } else if (!referenceEntry.set) {
        // If the reference is not a set, compare hashes directly
        return entry.hash === referenceEntry.hash;
      }

      return false;
    });

    // Add 'duplicate_of' property to each item in the filtered entries
    filteredSet.forEach(entry => {
      entry.items.forEach(item => {
        const duplicatePath = referenceItemsMap.get(item.hash);
        if (duplicatePath) {
          item.duplicate_of = duplicatePath;
        }
        item.part_of_set = entry.set;
      });
    });


    filteredSet.forEach(entry => fileDupeSets.add(entry));
    //finalDupeSets.add(...filteredSet);

    progress += 1; // Increment progress after processing
  }

  return {
    directories: filterOutSingleGroups(groupedItems.directories),
    files:       Object.fromEntries(
      [...fileDupeSets].flatMap(entry => entry.items.map(item => [item.path, item]))
    )
  };
}


async function getDuplicateItems(items, binPath) {

  const duplicates = await groupItems(items);

  const returnFiles = Object.values(duplicates.files).map(file => ({
    ...file,
    move_to: rebasePath(binPath, file.path)
  }));

  const returnDirs = Object.values(duplicates.directories).map(dir => ({
    ...dir,
    move_to: rebasePath(binPath, dir.path)
  }));

  // Calculate the total size of duplicate files
  const totalSize = returnFiles.reduce((sum, file) => sum + file.stats.size, 0);

  return ({
    directories: returnDirs,
    files:       returnFiles,
    size:        totalSize // Include total size of duplicate files
  });
}

export default getDuplicateItems;
