
import fs from 'fs/promises';

const debugMode = true; // Debug mode flag

/**
 * Ensures file and directory permissions match the specified CHMOD values.
 * @param {object[]} files - Array of file details from the scanner.
 * @param {number} filePerm - Desired file permissions (default: 0o664).
 * @param {number} dirPerm - Desired directory permissions (default: 0o775).
 * @returns {Promise<*[]>}
 */
async function checkPermissions(files, filePerm = 0o664, dirPerm = 0o775) {
    const wrongPerms = [];
    for (const file of files) {
        const desiredPerm = file.isFile ? filePerm : dirPerm;
        const stats = file.stats ?? await fs.stat(file.path);
        if ((stats.mode & 0o777) !== desiredPerm) {
            wrongPerms.push({...file, mode: stats.mode & 0o777, new_mode: desiredPerm });
        }
    }
    return wrongPerms;
}

export default checkPermissions;
