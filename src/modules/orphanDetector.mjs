
/**
 * Identifies orphan files based on the absence of associated files with the same name but different extensions.
 * @param {object[]} files - Array of file details from the scanner.
 * @param {string[]} extensions - List of extensions considered as orphan-prone.
 * @returns {object[]} - Array of orphan files.
 */
function findOrphans(files, extensions) {
    const fileMap = files.reduce((map, file) => {
        if (!file.isFile) return map;
        const baseName = file.path.replace(/\.[^/.]+$/, '');
        (map[baseName] = map[baseName] || []).push(file);
        return map;
    }, {});

    const orphans = [];
    for (const [baseName, group] of Object.entries(fileMap)) {
        const hasPrimaryFile = group.some(file => !extensions.includes(file.path.split('.').pop()));
        if (!hasPrimaryFile) {
            orphans.push(...group);
        }
    }

    return orphans;
}

export default findOrphans;
