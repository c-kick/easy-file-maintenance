import path from "path";
import readline from 'readline';
import logger from '../utils/logger.mjs';
import fs from "fs/promises";
import crypto from "crypto";
import chalk from "chalk";

// Normalizes a given path, removing any trailing slashes and handling relative paths
export function normalizePath(thisPath) {
  // Convert the path to an absolute path and normalize it
  return path.normalize(path.resolve(thisPath)).replace(/\/+$/, '');
}

export function userConfirm(question, validAnswers = ['y', 'a', 'n', 'c', 's']) {
  logger.stopAndPersist({ symbol: '\x1b[35m?\x1b[0m', text: `\x1b[35m${question.toString()}\x1b[0m` });
  const answerGuide = [];

  validAnswers.forEach((answer) => {
    switch (answer) {
      case 'y':
        answerGuide.push(`(${chalk.green(answer)})es`);
        break;
      case 'a':
        answerGuide.push(`yes to (${chalk.green(answer)})ll`);
        break;
      case 'n':
        answerGuide.push(`(${chalk.red(answer)})o`);
        break;
      case 'c':
        answerGuide.push(`(${chalk.yellow(answer)})ancel`);
        break;
      case 's':
        answerGuide.push(`(${chalk.blue(answer)})how affected items first`);
        break;
      default:
        break;
    }
  })

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const promptUser = () => {
      rl.question(`${(logger.hasInstance() ? '' : `${question.toString()}\n`)}${answerGuide.join(', ').trim()}: `, (answer) => {
        const lowerCaseAnswer = answer.toLowerCase();

        if (validAnswers.includes(lowerCaseAnswer)) {
          rl.close();
          resolve(lowerCaseAnswer);
        } else {
          console.warn(`Invalid choice. Please enter ${validAnswers.length <= 1 ? validAnswers.join('') : `${validAnswers.slice(0, -1).join(', ')} or ${validAnswers.slice(-1)}`}.`);
          promptUser(); // Ask again if the answer is not valid
        }
      });
    };

    promptUser();
  });
}

export async function answerLoop(question, validAnswers = ['y', 'a', 'n', 'c', 's'], actions) {
  let validAnswer = false;
  let userAnswer;
  while (!validAnswer) {
    userAnswer = await userConfirm(question, validAnswers);

    if (actions[userAnswer]) {
      validAnswer = await actions[userAnswer]();
    }
  }
  return userAnswer;
}

/**
 * Rebase `targetPath` to start with `basePath` while retaining its unique parts.
 *
 * @param {string} basePath - The base path to use as the new prefix.
 * @param {string} targetPath - The target path to adjust.
 * @returns {string} The adjusted path.
 */
export function rebasePath(basePath, targetPath) {
  // Normalize and split paths
  const [baseSegments, targetSegments] = [basePath, targetPath].map(p => path.resolve(p).split(path.sep));

  // Find the first differing segment
  const uniquePart = targetSegments.slice(baseSegments.findIndex((seg, i) => seg !== targetSegments[i])).join(path.sep);

  // Construct and return the new path
  return path.join(basePath, uniquePart);
}

/**
 * Outputs a header to the console, with the message centered and padded with '-' characters.
 * If the message is not provided, it will output a dashed line of the specified length.
 * @param {string} [message=''] - The message to display (optional).
 * @param {number} [characters=50] - The total length of the output, including the message and padding.
 * @param echo
 */
export function doHeader(message = '', characters = 50, echo = true) {
  // Wrap message in spaces if provided
  const wrappedMessage = message ? ` ${message} ` : '';

  // Calculate the padding length on each side
  const remainingSpace = characters - wrappedMessage.length;
  if (remainingSpace < 0) {
    console.log(message); // If message is longer than available space, just print it.
    return;
  }

  const paddingLength = Math.floor(remainingSpace / 2);
  const padding = '-'.repeat(paddingLength);

  // Construct the final header
  const header = wrappedMessage
    ? padding + wrappedMessage + padding + (remainingSpace % 2 ? '-' : '')
    : '-'.repeat(characters);

  // Output the header to the console
  if (echo) { console.log(`\n${header}`) } else { return header }
}


/**
 * Hashes the first CHUNK_SIZE bytes of a file.
 * @param {string} filePath - Path to the file.
 * @param {number} chunkSize - Number of bytes to hash.
 * @returns {Promise<string>} - The hash of the file chunk.
 */
export async function hashFileChunk(filePath, chunkSize = 131072) {
  const fileHandle = await fs.open(filePath, 'r');
  const buffer = Buffer.alloc(chunkSize);
  try {
    await fileHandle.read(buffer, 0, chunkSize, 0);
    return crypto.createHash('md5').update(buffer).digest('hex').toString();
  } finally {
    await fileHandle.close();
  }
}

/**
 * Recursively calculates an MD5 hash for a directory and its contents.
 *
 * The function computes the hash by combining:
 * - Hashes of all files directly within the directory.
 * - Hashes of all subdirectories (recursively processed).
 *
 * @param {Object} dirEntry - The directory entry object containing information about the directory.
 * @param {Object} results - An object containing two Maps:
 *        @param {Map<string, Object>} results.files - A Map of file paths to file entry objects.
 *        @param {Map<string, Object>} results.directories - A Map of directory paths to directory entry objects.
 * @returns {Promise<string>} - A promise that resolves to the final MD5 hash of the directory.
 *
 * @example
 * const dirEntry = { path: '/photos/2023' };
 * const results = {
 *     files: new Map([
 *         ['/photos/2023/file1.jpg', { path: '/photos/2023/file1.jpg', dir: '/photos/2023' }],
 *         ['/photos/2023/file2.jpg', { path: '/photos/2023/file2.jpg', dir: '/photos/2023' }]
 *     ]),
 *     directories: new Map([
 *         ['/photos/2023/subdir', { path: '/photos/2023/subdir', dir: '/photos/2023' }]
 *     ])
 * };
 *
 * const hash = await calculateDirectoryHash(dirEntry, results);
 * console.log(hash); // Outputs a unique MD5 hash for the directory and its contents
 */
export async function calculateDirectoryHash(dirEntry, results) {
  const hash = crypto.createHash('md5');
  const childFiles = Array.from(results.files.values()).filter((file) => file.dir === dirEntry.path);
  const childDirs = Array.from(results.directories.values()).filter((subDir) => subDir.dir === dirEntry.path);

  for (const file of childFiles) {
    hash.update(await hashFileChunk(file.path));
  }
  for (const subDir of childDirs) {
    hash.update(await calculateDirectoryHash(subDir, results));
  }
  return hash.digest('hex');
}

/**
 * Filters an object of grouped items to include only groups with multiple entries.
 *
 * The function iterates over the keys of the input object and retains only those
 * groups (arrays) that contain more than one entry.
 *
 * @template T
 * @param {Object<string, T[]>} groupedItems - An object where keys are group identifiers
 *        and values are arrays of items.
 * @returns {Object<string, T[]>} - A new object containing only the groups with more than one entry.
 *
 * @example
 * const groupedItems = {
 *     group1: [1, 2],
 *     group2: [3],
 *     group3: [4, 5, 6]
 * };
 * const result = filterGroupsWithMultipleEntries(groupedItems);
 * console.log(result);
 * // Output:
 * // {
 * //   group1: [1, 2],
 * //   group3: [4, 5, 6]
 * // }
 */
export function filterGroupsWithMultipleEntries(groupedItems) {
  return Object.keys(groupedItems).reduce((filtered, key) => {
    if (groupedItems[key].length > 1) {
      filtered[key] = groupedItems[key];
    }
    return filtered;
  }, {});
}

/**
 * Identifies and retrieves sidecar files related to a given file based on naming patterns and size.
 *
 * A sidecar file is typically smaller than the main file and shares the same base name
 * (e.g., metadata or accompanying files for media content).
 *
 * @param {Object} file - The main file to find sidecar files for.
 * @param {Object<string, Object[]>} filesInThisDir - An object containing arrays of files grouped by directory paths.
 * @param {string[]} [extensions=['jpg', 'jpeg', 'mp4', 'avi']] - An optional list of file extensions that the main file must have
 *        to be considered for sidecar detection.
 * @returns {Object[]} - An array of sidecar files related to the main file.
 *
 * @example
 * const file = {
 *     baseName: 'example',
 *     extension: 'jpg',
 *     size: 2048,
 *     dir: '/photos'
 * };
 * const filesInThisDir = {
 *     '/photos': [
 *         { baseName: 'example', extension: 'jpg', size: 2048, dir: '/photos' },
 *         { baseName: 'example', extension: 'xml', size: 512, dir: '/photos' },
 *         { baseName: 'example_01', extension: 'jpg', size: 1024, dir: '/photos' }
 *     ]
 * };
 * const sidecars = getSideCarFiles(file, filesInThisDir);
 * console.log(sidecars); // Outputs: [{ baseName: 'example', extension: 'xml', size: 512, dir: '/photos' }]
 */
export function getSideCarFiles(file, filesInThisDir, extensions = ['jpg', 'jpeg', 'mp4', 'avi']) {
  const fileSet = getFilesetForFile(file.path, filesInThisDir);
  if (fileSet.length > 1) {
    //console.log(`${file.name} is part of a fileset`);
  } else {
    //console.log(`${file.name} is NOT part of a fileset`);
  }
  return fileSet ?? [];
}

/**
 * Converts a size in bytes to the most human-readable format (e.g., KB, MB, GB, etc.).
 *
 * @param {number} bytes - The size in bytes to convert.
 * @returns {string} A string representing the size in a human-readable format,
 *                   including the value and the appropriate unit.
 *
 * @example
 * formatBytes(500); // "500 Bytes"
 * formatBytes(1048576); // "1 MB"
 * formatBytes(5368709120); // "5 GB"
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  // Convert bytes to the appropriate size
  const value = bytes / Math.pow(1024, i);

  // Limit to 2 decimal places if the value is fractional
  const formattedValue = value % 1 === 0 ? value : value.toFixed(2);

  return `${formattedValue} ${sizes[i]}`;
}

/**
 * Splits a given file path into its constituent parts and returns an array of partial paths.
 *
 * The function splits the input file path by the '/' character and then constructs
 * partial paths by progressively joining the segments.
 *
 * @param {string} filePath - The file path to split and process.
 * @returns {string[]} An array of partial paths, each representing a progressively
 *                     longer segment of the original path.
 *
 * @example
 * const parts = pathSplitter('/home/user/documents/file.txt');
 * console.log(parts);
 * // Output: ['/home', '/home/user', '/home/user/documents']
 */
export function pathSplitter(filePath) {
  const parts = filePath.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

/**
 * Updates the statistics of directories within the given results object.
 *
 * This function processes the given file path, splits it into its constituent parts,
 * and updates the statistics (total size, file count, and intrinsic size) for each
 * directory in the path.
 *
 * @param {Object} results - The results object containing directory statistics.
 * @param {Map<string, Object>} results.directories - A Map of directory paths to their statistics.
 * @param {string} dir - The base directory path.
 * @param {string} fullPath - The full path of the file or directory being processed.
 * @param {Object} stats - The file system stats object for the file or directory.
 * @param {boolean} ignored - A flag indicating whether the file or directory should be ignored in size calculations.
 */
export function updateDirectoryStats(results, dir, fullPath, stats, ignored) {
  const splitPath = pathSplitter(path.relative(dir, fullPath));
  splitPath.forEach((subPath) => {
    const subDir = path.join(dir, subPath);
    if (!results.directories.get(subDir)) {
      results.directories.set(subDir, {
        totalSize: 0,
        fileCount: 0,
        intrinsicSize: 0,
        dirCount: 0,
      });
    }
    results.directories.get(subDir).totalSize += ignored ? 0 : stats.size;
    results.directories.get(subDir).fileCount++;
    if (path.dirname(fullPath) === subDir) {
      results.directories.get(subDir).intrinsicSize += ignored ? 0 : stats.size;
    }
    if (stats.isDirectory()) {
      results.directories.get(subDir).dirCount++;
    }
  });
}

/**
 * Matches a string against a given pattern.
 *
 * This function creates a regular expression from the provided pattern,
 * replacing wildcard characters (*) with a regex pattern that matches any character sequence.
 * It then tests the input string against this regex.
 *
 * @param {string} str - The string to be matched.
 * @param {string} pattern - The pattern to match against, where '*' is treated as a wildcard.
 * @returns {boolean} True if the string matches the pattern, false otherwise.
 *
 * @example
 * matchPattern('example.txt', '*.txt'); // returns true
 * matchPattern('example.txt', '*.jpg'); // returns false
 */
export function matchPattern(str, pattern) {
  const regex = new RegExp(
    '^' + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*').toLowerCase() + '$'
  );
  return regex.test(str.toLowerCase());
}

/**
 * Checks if the current user can change the ownership of a given file.
 *
 * This function retrieves the file statistics and compares the file's owner UID
 * with the current user's UID. It also checks if the current user has root privileges.
 *
 * @param {string} filePath - The path to the file to check.
 * @returns {Promise<boolean>} - A promise that resolves to `true` if the user can change ownership, `false` otherwise.
 */
export async function canChangeOwnership(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const userId = process.getuid(); // Current user's UID
    const groupId = process.getgid(); // Current user's GID

    // Check if the current user is the owner of the file
    if (stats.uid === userId) {
      return true; // Owner can always change ownership
    }

    // Alternatively, check if the user has root privileges (UID 0)
    if (userId === 0) {
      return true; // Root can always change ownership
    }

    return false; // Otherwise, can't change ownership
  } catch (err) {
    console.error('Error checking ownership permissions:', err);
    return false;
  }
}

export function detectFilesets(files) {
  const filesetMap = new Map();

  // Helper function to normalize a basename
  const normalizeBaseName = (baseName) => {
    // Remove version markers, language codes, or other common delimiters
    return baseName.replace(/(\.\d+|\.\w{2,3}|\[[^\]]+\]|-thumb)/g, "").trim();
  };

  // Iterate through the files map
  files.forEach((file, filePath) => {
    const { baseName } = file;
    const normalized = normalizeBaseName(baseName);

    // Group files by normalized basename
    if (!filesetMap.has(normalized)) {
      filesetMap.set(normalized, []);
    }
    filesetMap.get(normalized).push(filePath); // Store the full filePath for reference
  });

  // Extract filesets (groups with more than one file)
  const filesets = [];
  filesetMap.forEach((filePaths) => {
    if (filePaths.length > 1) {
      filesets.push(filePaths);
    }
  });

  return filesets;
}

export function getFilesetForFile(filePath, directoryFiles) {
  // Helper function to extract and normalize baseName
  const extractBaseName = (filePath) => {
    const fileName = filePath.split('/').pop(); // Get the file name from the full path
    const baseName = fileName.replace(/\.[^/.]+$/, ""); // Remove the extension
    // Normalize: remove markers like `.1`, language codes, or thumbnail markers
    return baseName.replace(/(\.\d+|\.\w{2,3}|\[[^\]]+\]|-thumb)/g, "").trim();
  };

  // Extract the target file's baseName
  const targetBaseName = extractBaseName(filePath);

  // Iterate over directory files to find files with a matching normalized baseName
  const fileset = Object.values(directoryFiles).filter((file) => {
    const currentBaseName = extractBaseName(file.path);
    return currentBaseName === targetBaseName;
  });

  return fileset.length > 1 ? fileset : []; // Return fileset if it contains more than one file
}