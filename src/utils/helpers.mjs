import path from "path";
import readline from 'readline';
import logger from '../utils/logger.mjs';

// Normalizes a given path, removing any trailing slashes and handling relative paths
export function normalizePath(thisPath) {
  // Convert the path to an absolute path and normalize it
  return path.normalize(path.resolve(thisPath)).replace(/\/+$/, '');
}

export function userConfirm(operation) {
  logger.stop();
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const promptUser = () => {
      rl.question(`${operation.description ?? operation.toString()}\n(y)es, yes to (a)ll, (n)o, (c)ancel: `, (answer) => {
        const validAnswers = ['y', 'a', 'n', 'c'];
        const lowerCaseAnswer = answer.toLowerCase();

        if (validAnswers.includes(lowerCaseAnswer)) {
          rl.close();
          resolve(lowerCaseAnswer);
        } else {
          console.warn('Invalid choice. Please enter y, a, n, or c.');
          promptUser(); // Ask again if the answer is not valid
        }
      });
    };

    promptUser();
  });
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