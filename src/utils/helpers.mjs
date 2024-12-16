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
export async function hashFileChunk(filePath, chunkSize = 262144) {
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
 * Generates an MD5 hash for a given string.
 * @param {string} string - The input string to hash.
 * @returns {string} - The MD5 hash of the input string.
 */
export function hashString(string) {
  return crypto.createHash('md5').update(string).digest('hex').toString();
}

/**
 * Executes an array of asynchronous tasks with a concurrency limit.
 *
 * @param {import('p-limit').Limit} limit - A concurrency limit instance from the `p-limit` library.
 * @param {Array<() => Promise<any>>} tasks - An array of asynchronous tasks, where each task is a function that returns a Promise.
 * @returns {Promise<Array<any>>} - A Promise that resolves to an array of results from the tasks, maintaining the order of the input tasks.
 *
 * @example
 * import pLimit from 'p-limit';
 *
 * const limit = pLimit(5); // Allow up to 5 concurrent tasks
 * const tasks = [
 *   async () => await fetchData(1),
 *   async () => await fetchData(2),
 *   async () => await fetchData(3),
 * ];
 *
 * const results = await withConcurrency(limit, tasks);
 * console.log(results);
 */
export async function withConcurrency(limit, tasks) {
  return Promise.all(tasks.map(task => limit(() => task())));
}