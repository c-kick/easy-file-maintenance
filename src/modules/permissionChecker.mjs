import fs from 'fs/promises';

const debugMode = true; // Debug mode flag

/**
 * Ensures file and directory permissions match the specified CHMOD values.
 * @param {object} filesObject - Object containing both 'files' and 'directories' from the scanner.
 * @param {number} filePerm - Desired file permissions (default: 0o664).
 * @param {number} dirPerm - Desired directory permissions (default: 0o775).
 * @returns {Promise<object[]>} - Array of objects representing files/directories with incorrect permissions.
 */
async function checkPermissions(filesObject, filePerm = 0o664, dirPerm = 0o775) {
    const wrongPerms = [];

    // Combine files and directories into a single array
    const allEntries = [
        ...Object.values(filesObject.files),
        ...Object.values(filesObject.directories)
    ];

    for (const entry of allEntries) {
        const desiredPerm = entry.isFile ? filePerm : dirPerm;
        const stats = entry.stats ?? await fs.stat(entry.path);
        if ((stats.mode & 0o777) !== desiredPerm) {
            wrongPerms.push({
                ...entry,
                mode: stats.mode & 0o777,
                new_mode: desiredPerm
            });
        }
    }

    return wrongPerms;
}

export default checkPermissions;
