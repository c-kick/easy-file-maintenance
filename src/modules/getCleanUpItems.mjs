import {rebasePath} from "../utils/helpers.mjs";
import logger from "../utils/logger.mjs";

import pLimit from "p-limit";
const FILE_LIMIT = pLimit(5); // Limit concurrency

/**
 * Moves empty files and directories to the specified recycle bin while retaining their relative paths.
 * @param {object} items - Object containing both 'files' and 'directories' from the scanner.
 * @param {string} scanDir - The root directory being scanned.
 * @param {string} binPath - The path to the recycle bin.
 */
async function getCleanUpItems(items, scanDir, binPath) {
  // Initialize a set to keep track of parent paths
  const removalPaths = new Set();
  let progress = 0;
  const processItems = async (items) => {
    const tasks = Array.from(items, ([value, item]) => {
      return FILE_LIMIT(async () => {

        // Exclude items nested in a path already marked for removal and skip if path is the path we're scanning
        if (removalPaths.has(item.dir) || (item.isDirectory && item.path === scanDir)) {
          // Add the item's path to the removal set, else recursion will fail
          removalPaths.add(item.path);
          return null;
        }

        progress += 1; // Increment progress after processing
        logger.text(`Scanning for items to clean up... ${progress}/${items.size}`);

        if (item.totalSize === 0 || item.delete) {
          // Add the current item's path to the removal set
          removalPaths.add(item.path);
          return {
            ...item,
            move_to: rebasePath(binPath, item.path),
            reason:  `${item.totalSize === 0 ? `is considered empty (${!item.isEmpty ? 'is not actually empty, but ' : ''}contains empty directories and/or no/ignored files)` : item.delete ? 'should be deleted' : 'unknown'}`
          };
        }

        return null; // Skip

      });
    })

    // Wait for all tasks to complete
    return await Promise.all(tasks);
  }

  const returnFiles = (await processItems(items.files)).filter(item => item !== null);

  // Calculate the total size of cleanable files
  const totalSize = returnFiles.reduce((sum, file) => sum + file.size, 0);

  //Directories should be processed first to correctly establish emptiness
  return ({
    directories: (await processItems(items.directories)).filter(item => item !== null),
    files:       returnFiles,
    size:        totalSize // Include total size of duplicate files
  });
}

export default getCleanUpItems;
