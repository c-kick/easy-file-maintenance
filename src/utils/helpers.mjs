import path from "path";
import readline from 'readline';
import logger from '../utils/logger.mjs';
import fs from "fs/promises";
import crypto from "crypto";

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
        answerGuide.push('(y)es');
        break;
      case 'a':
        answerGuide.push('yes to (a)ll');
        break;
      case 'n':
        answerGuide.push('(n)o');
        break;
      case 'c':
        answerGuide.push('(c)ancel');
        break;
      case 's':
        answerGuide.push('(s)how affected items first');
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
 */
export function doHeader(message = '', characters = 50) {
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
  console.log(header);
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
  const basePattern = new RegExp(`^${file.baseName}(?![a-zA-Z0-9 \-])`);
  const sideCarFiles = [];
  if (extensions.includes(file.extension)) {
    for (const otherFile of filesInThisDir[file.dir].filter(otherFile => otherFile !== file)) {
      if (basePattern.test(otherFile.baseName) && file.size > otherFile.size) {
        sideCarFiles.push(otherFile);
      }
    }

  }
  return sideCarFiles;
}