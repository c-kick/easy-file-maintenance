import path from "path";
import readline from 'readline';
import logger from '../utils/logger.mjs';

// Normalizes a given path, removing any trailing slashes and handling relative paths
export function normalizePath(thisPath) {
  // Convert the path to an absolute path and normalize it
  return path.normalize(path.resolve(thisPath)).replace(/\/+$/, '');
}

export function userConfirm(question, validAnswers = ['y', 'a', 'n', 'c', 's']) {
  logger.stopAndPersist({ symbol: '\x1b[35m?\x1b[0m', text: `\x1b[35m${question.toString()}\x1b[0m` });
  const answerGuide = validAnswers.length === 4 ?'(y)es, yes to (a)ll, (n)o, or (c)ancel' : '(y)es, yes to (a)ll, (n)o, (c)ancel, or (s)how affected items first';
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const promptUser = () => {
      rl.question(`${(logger.hasInstance() ? '' : `${question.toString()}\n`)}${answerGuide}: `, (answer) => {
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
