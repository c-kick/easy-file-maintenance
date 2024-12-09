import logger from '../utils/logger.mjs';
import fs from 'fs/promises';
import path from 'path';
import exifParser from 'exif-parser';
import pLimit from "p-limit";
import {withConcurrency} from "../utils/helpers.mjs";

const FILE_LIMIT = pLimit(5); // Limit concurrency to 10

/**
 * Append a string to the filename while preserving its extension.
 * @param {string} fileName - The original filename.
 * @param {string} appendString - The string to append to the filename.
 * @returns {string} - The modified filename with the appended string.
 */
export function appendToFilename(fileName, appendString) {
  const ext = path.extname(fileName); // Extract the file extension
  const base = path.basename(fileName, ext); // Extract the filename without extension
  return `${base}${appendString}${ext}`; // Combine base, appended string, and extension
}

/**
 * Extracts potential dates from a file's metadata and name.
 * @param {Object} file - The file object with metadata.
 * @param {Date} dateThreshold - The date threshold for sanity checking.
 * @returns {Date|null} - The oldest valid date or null if none are valid.
 */
export async function extractOldestDate(file, dateThreshold) {
  const dates = [];

  // Step 1: Check EXIF data
  try {
    const buffer = await fs.readFile(file.path);
    const parser = exifParser.create(buffer);
    const exifData = parser.parse();
    if (exifData.tags.DateTimeOriginal) {
      dates.push(new Date(exifData.tags.DateTimeOriginal * 1000)); // Convert to milliseconds
    }
  } catch {
    // Ignore errors (e.g., non-image files or missing EXIF data)
  }

  // Step 2: Check the filename and path for dates
  const datePatterns = [
    /\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/g,    // YYYYMMDD or YYYY-MM-DD
    /\b(\d{2})[-/]?(\d{2})[-/]?(\d{4})\b/g,    // DDMMYYYY or DD-MM-YYYY
    /\b(\d{2})[-/]?(\d{2})[-/]?(\d{2})\b/g,    // DDMMYY or DD-MM-YY
    /\b(\d{10})\b/g                            // Epoch timestamp
  ];

  for (const pattern of datePatterns) {
    const matches = file.path.matchAll(pattern); // Match against the entire path and filename
    for (const match of matches) {
      try {
        const [fullMatch, part1, part2, part3] = match;
        let date;

        if (fullMatch.length === 10 && !isNaN(fullMatch)) {
          // Epoch timestamp
          date = new Date(Number(fullMatch) * 1000);
        } else if (part3 && part3.length === 4) {
          // DDMMYYYY or DD-MM-YYYY
          date = new Date(`${part3}-${part2}-${part1}`);
        } else if (part3 && part3.length === 2) {
          // DDMMYY or DD-MM-YY (adjust for year prefix)
          const fullYear = part3 < 50 ? `20${part3}` : `19${part3}`;
          date = new Date(`${fullYear}-${part2}-${part1}`);
        } else {
          // YYYYMMDD or YYYY-MM-DD
          date = new Date(`${part1}-${part2}-${part3}`);
        }

        if (!isNaN(date)) dates.push(date);
      } catch {
        // Ignore parsing errors
      }
    }
  }

  // Step 3: Check file creation or birth timestamp as a last resort
  if (file.createdTime) dates.push(new Date(Date.UTC(
    new Date(file.createdTime).getUTCFullYear(),
    new Date(file.createdTime).getUTCMonth(),
    new Date(file.createdTime).getUTCDate(),
    new Date(file.createdTime).getUTCHours(),
    new Date(file.createdTime).getUTCMinutes(),
    new Date(file.createdTime).getUTCSeconds()
  )));
  if (file.modifiedTime) dates.push(new Date(Date.UTC(
    new Date(file.modifiedTime).getUTCFullYear(),
    new Date(file.modifiedTime).getUTCMonth(),
    new Date(file.modifiedTime).getUTCDate(),
    new Date(file.modifiedTime).getUTCHours(),
    new Date(file.modifiedTime).getUTCMinutes(),
    new Date(file.modifiedTime).getUTCSeconds()
  )));

  // Step 4: Determine the oldest date
  const validDates = dates.filter(date => date > dateThreshold);
  if (validDates.length > 0) {
    return new Date(Math.min(...validDates.map(date => date.getTime())));
  }

  return null; // No valid dates found
}

/**
 * Reorganizes files into a structured directory hierarchy based on extracted dates.
 * @param {object} filesObject - Object containing file details from the scanner.
 * @param {string} targetStructure - The target directory structure (e.g., "/year/month/").
 * @param {Date} dateThreshold - The date threshold for sanity checking.
 * @param relPath
 */
async function getReorganizeItems(filesObject, targetStructure = '/{year}/{month}/', dateThreshold, relPath) {
  if (!dateThreshold) {
    dateThreshold = new Date('1995-01-01');
  }

  const files = Object.values(filesObject);
  let progress = 0;

  // Wrap each file task in a function
  const tasks = files.map(file => async () => {
    const oldestDate = await extractOldestDate(file, dateThreshold);
    progress += 1; // Increment progress after processing
    logger.text(`Scanning for dates in files... ${progress}/${files.length}`);

    if (!oldestDate || file.isDirectory || file.delete) {
      return null; // Skip files without a valid date, directories, or files to be deleted
    }

    const year = oldestDate.getFullYear();
    const month = String(oldestDate.getMonth() + 1).padStart(2, '0');
    const day = String(oldestDate.getDate()).padStart(2, '0');
    const targetDir = targetStructure
    .replace('{year}', year)
    .replace('{month}', month)
    .replace('{day}', day);

    const pathRef = path.basename(path.normalize(file.dir).replace(/\/$/, ''));
    const targetName = file.name.includes(pathRef)
      ? file.name
      : appendToFilename(file.name, ` - ${pathRef}`);
    const targetPath = path.join(relPath ?? '', path.join(targetDir, targetName));

    if (!file.path.includes(targetDir)) {
      return {...file, move_to: targetPath};
    }
    return null; // Skip if already in the correct directory
  });

  // Use withConcurrency to execute tasks with a limit
  const reorganize = await withConcurrency(FILE_LIMIT, tasks);

  // Filter out null results
  return reorganize.filter(item => item !== null);
}

export default getReorganizeItems;