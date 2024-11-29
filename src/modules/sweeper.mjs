
import fs from 'fs-extra';

/**
 * Moves empty files and directories to the specified recycle bin.
 * @param {object[]} files - Array of file details from the scanner.
 * @param {string} recycleBin - Path to the recycle bin.
 * @returns {Promise<void>}
 */
async function sweepEmpty(files, recycleBin) {
    for (const file of files) {
        if (file.isEmpty) {
            const targetPath = `${recycleBin}/${file.path.replace(/^\//, '')}`;
            await fs.ensureDir(path.dirname(targetPath));
            await fs.move(file.path, targetPath, { overwrite: true });
        }
    }
}

export default sweepEmpty;
