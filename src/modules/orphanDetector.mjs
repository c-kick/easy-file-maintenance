import path from 'path';
import {rebasePath} from "../utils/helpers.mjs";

import pLimit from "p-limit";

const FILE_LIMIT = pLimit(10); // Limit concurrency

async function getOrphanItems(items, scanDir, binPath, emptyThreshold  = 0) {
  // Initialize a set to keep track of parent paths
  const totalSize = 0;
  const removalPaths = new Set();
  let progress = 0;

  const processItems = async (input) => {
    const tasks = Array.from(input, ([value, item]) => {
      return FILE_LIMIT(async () => {


        if (items.directories.get(item.dir)?.fileCount === 1) {
          // Add the current item's path to the removal set
          removalPaths.add(item.path);
          return {
            ...item,
            move_to: rebasePath(binPath, item.path)
          };
        }

        return null; // Skip

      });
    })

    // Wait for all tasks to complete
    return await Promise.all(tasks);
  }

  const returnFiles = (await processItems(items.files)).filter(item => item !== null);

  //Directories should be processed first to correctly establish cascading emptiness
  return ({
    files:       returnFiles,
    size:        totalSize // Include total size of duplicate files
  });
}

export default getOrphanItems;
