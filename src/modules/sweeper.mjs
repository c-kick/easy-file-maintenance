import {rebasePath} from "../utils/helpers.mjs";

/**
 * Moves empty files and directories to the specified recycle bin while retaining their relative paths.
 * @param {object} filesObject - Object containing both 'files' and 'directories' from the scanner.
 * @param {string} scanDir - The root directory being scanned.
 * @param {string} binPath - The path to the recycle bin.
 * @returns {Promise<Object[]>}
 */
async function sweeper(filesObject, scanDir, binPath) {
    // Combine files and directories into a single array
    const allEntries = [
        ...Object.values(filesObject.files),
        ...Object.values(filesObject.directories)
    ];

    return allEntries
    .filter(item => (item.isEmpty || item.delete))
    .map(item => {
        return {
            ...item,
            move_to: rebasePath(binPath, item.path),
            reason: `${item.isEmpty ? 'is empty' : item.delete ? 'should always be deleted' : 'unknown'}`
        };
    });
}

export default sweeper;
