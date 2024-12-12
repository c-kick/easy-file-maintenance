import {rebasePath} from "../utils/helpers.mjs";

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
 * @param {object} filesObject - Object containing both 'files' and 'directories' from the scanner.
 * @param {string} scanDir - The root directory being scanned.
 * @param {string} binPath - The path to the recycle bin.
 * @returns {Promise<Object[]>}
 */
async function getCleanUpItems(filesObject, scanDir, binPath) {
    const allEntries = [
        ...Object.values(filesObject.files),
        ...Object.values(filesObject.directories)
    ];

    // Sort entries by depth (shallowest paths first)
    allEntries.sort((a, b) => a.depth - b.depth);

    // Initialize a set to keep track of parent paths
    const removalPaths = new Set();

    return allEntries
    .filter(item => (item.isEmpty || item.delete) && (item.path !== scanDir))
    .filter(item => {
        // Exclude items nested in a path already marked for removal
        for (const path of removalPaths) {
            if (item.path.startsWith(path)) {
                return false;
            }
        }
        // Add the current item's path to the removal set
        removalPaths.add(item.path);
        return true;
    })
    .map(item => {
        return {
            item,
            path:    item.path,
            move_to: rebasePath(binPath, item.path),
            reason:  `${item.isEmpty ? 'is empty' : item.delete ? 'should always be deleted' : 'unknown'}`
        };
    });
}

export default getCleanUpItems;
