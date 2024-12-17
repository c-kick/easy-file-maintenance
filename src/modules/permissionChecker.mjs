import fs from 'fs/promises';
import logger from "../utils/logger.mjs";

/**
 * Parses the permission value to a format suitable for fs.chmod().
 * @param {string | number} permission - The permission value (e.g., '664', 664, '0o664').
 * @returns {number} - The permission value as an octal number.
 */
function parsePermission(permission) {
    if (typeof permission === 'number') {
        return parseInt(permission.toString(), 8);
    } else if (typeof permission === 'string') {
        // Convert the string to a number using base 8 if it's not already in octal format
        if (permission.startsWith('0o')) {
            return parseInt(permission, 8);
        } else {
            return parseInt(permission, 8);
        }
    } else {
        throw new Error('Invalid permission type. Must be a string or number.');
    }
}

/**
 * Extracts and normalizes the file mode from fs.stat, formatted as a string.
 * @param {number} mode - Mode from fs.stat.
 * @returns {string} - Normalized mode as a string (e.g., '0777').
 */
function getNormalizedModeAsString(mode) {
    return '0' + (mode & 0o777).toString(8);
}

/**
 * Normalizes and validates permission values.
 * Converts valid string or number representations to octal strings.
 * @param {string|number} perm - Permission value to normalize.
 * @returns {string} - Normalized permission value as a string (e.g., '0777').
 * @throws {Error} - If the permission value is invalid.
 */
function normalizePermissionAsString(perm) {
    let numericValue;

    if (typeof perm === 'number') {
        if (perm >= 0 && perm <= 777) {
            numericValue = parseInt(perm.toString(), 8);
        }
    } else if (typeof perm === 'string') {
        const parsed = parseInt(perm, 8);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 0o777) {
            numericValue = parsed;
        }
    }

    if (numericValue === undefined) {
        throw new Error(`Invalid permission value: ${perm}`);
    }

    return '0' + numericValue.toString(8); // Return as octal string
}

/**
 * Ensures file and directory permissions match the specified CHMOD values.
 * @param {object} items - Object containing both 'files' and 'directories' from the scanner.
 * @param {string|number} filePerm - Desired file permissions (default: '664').
 * @param {string|number} dirPerm - Desired directory permissions (default: '775').
 * @returns {Promise<object[]>} - Array of objects representing files/directories with incorrect permissions.
 */
async function getPermissionFiles(items, filePerm = '664', dirPerm = '774') {
    const wrongPerms = [];

    // Normalize desired permissions to strings
    const normalizedFilePerm = normalizePermissionAsString(filePerm);
    const normalizedDirPerm = normalizePermissionAsString(dirPerm);

    // Combine files and directories into a single Map
    const allEntries = new Map([...items.files, ...items.directories]);
    let progress = 0;

    for (const [path, entry] of allEntries) {
        // Determine desired permission based on entry type
        const desiredMode = entry.isFile ? normalizedFilePerm : normalizedDirPerm;

        // Get stats and normalize mode as a string
        const stats = entry.stats ?? await fs.stat(entry.path);
        const currentMode = getNormalizedModeAsString(stats.mode);

        // Compare and collect incorrect permissions
        if (currentMode !== desiredMode) {
            wrongPerms.push({
                ...entry,
                currentMode, // Current permissions as string
                desiredMode, // Desired permissions as string (for fs.chmod)
                fsChmodValue: parsePermission(desiredMode),
            });
        }
        progress += 1; // Increment progress after processing
        logger.text(`Checking permissions... ${progress}/${allEntries.size}`);
    }

    return wrongPerms;
}

export default getPermissionFiles;
