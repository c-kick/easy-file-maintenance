import {rebasePath} from "../utils/helpers.mjs";
import pLimit from "p-limit";
import logger from "../utils/logger.mjs";
import path from "path";

const FILE_LIMIT = pLimit(2); // Limit concurrency

/**
 * Moves empty files and directories to the specified recycle bin while retaining their relative paths.
 * @param {object} filesObject - Object containing both 'files' and 'directories' from the scanner.
 * @param {string} scanDir - The root directory being scanned.
 * @param {string} binPath - The path to the recycle bin.
 * @returns {Promise<Object[]>}
 */
async function getCleanUpItemsOld(filesObject, scanDir, binPath) {
  // Combine files and directories into a single array
  //todo: sort by path, so root gets deleted last!
  const allEntries = [
    ...Object.values(filesObject.files),
    ...Object.values(filesObject.directories)
  ];
  return allEntries
  .filter(item => (item.isEmpty || item.delete))
  .map(item => {
    return {
      item,
      path:    item.path,
      move_to: rebasePath(binPath, item.path),
      reason:  `${item.isEmpty ? 'is empty' : item.delete ? 'should always be deleted' : 'unknown'}`
    };
  });
}

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
                    return null;
                }

                progress += 1; // Increment progress after processing
                logger.text(`Scanning for items to clean up... ${progress}/${items.size}`);

                if (item.consideredEmpty || item.delete) {
                    // Add the current item's path to the removal set
                    removalPaths.add(item.path);
                    return {
                        ...item,
                        move_to: rebasePath(binPath, item.path),
                        reason:  `${item.consideredEmpty ? `is considered empty ${!item.isEmpty ? '(is not actually empty, but contains ignored items)' : ''}` : item.delete ? 'should be deleted' : 'unknown'}`
                    };
                }

                return null; // Skip

            });
        })

        // Wait for all tasks to complete
        return await Promise.all(tasks);
    }

    //Directories should be processed first to correctly establish emptiness
    const processedDirs = await processItems(items.directories);
    const processedFiles = await processItems(items.files);

    return ({
        directories: processedDirs.filter(item => item !== null),
        files: processedFiles.filter(item => item !== null)
    });
}

export default getCleanUpItems;
