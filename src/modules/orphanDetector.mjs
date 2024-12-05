import path from 'path';
import {rebasePath} from "../utils/helpers.mjs";

/**
 * Identifies orphan files based on the absence of associated files with the same name but different extensions.
 * @param {object} filesObject - Object containing file details from the scanner.
 * @param {string[]} extensions - List of extensions considered as orphan-prone.
 * @param {string} binPath - The path to the recycle bin.
 * @returns {Promise<object[]>} - Array of orphan files.
 */
async function getOrphanItems(filesObject, extensions, binPath) {
  // Convert filesObject to an array of file entries
  const files = Object.values(filesObject);
  const orphans = [];

  // Create a fileMap to group files by base name
  const fileMap = files.reduce((map, file) => {
    if (!file.isFile) return map; // Ignore directories
    const baseName = path.basename(file.path, path.extname(file.path));
    const dirPath = path.dirname(file.path);
    const mapKey = `${dirPath}/${baseName}`; // Unique key combining directory and base name
    (map[mapKey] = map[mapKey] || []).push(file);
    return map;
  }, {});

  for (const [baseName, group] of Object.entries(fileMap)) {
    // If the directory contains only one file, and it's orphan-prone, add it to orphans
    if (group.length === 1 && group[0].isAlone && extensions.includes(path.extname(group[0].path))) {
      orphans.push({...group[0], move_to: rebasePath(binPath, group[0].path)});
      continue;
    }

    // Check if the group contains a primary file (not an orphan-prone extension)
    const hasPrimaryFile = group.some(file => !extensions.includes(path.extname(file.path)));
    if (!hasPrimaryFile) {
        group.forEach(file => {
            orphans.push({...file, move_to: rebasePath(binPath, file.path)});
        })
    }
  }

  return orphans;
}

export default getOrphanItems;
