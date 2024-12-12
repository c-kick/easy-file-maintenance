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
 * @param {boolean} evalFullPath - Whether to process filenames only, or the full path
 * @returns {Object} - The oldest valid date or null if none are valid, and the source of the date
 */
export async function extractOldestDate(file, dateThreshold, evalFullPath = true) {
  const dates = [];

  // Step 1: Check EXIF data
  try {
    const buffer = await fs.readFile(file.path);
    const parser = exifParser.create(buffer);
    const exifData = parser.parse();
    if (exifData.tags.DateTimeOriginal) {
      dates.push({
        date: new Date(exifData.tags.DateTimeOriginal * 1000), // Convert to milliseconds
        source: 'exif'
      });
    }
  } catch {
    // Ignore errors (e.g., non-image files or missing EXIF data)
  }

  // Step 2: Check the filename and path for dates
  const datePatterns = [
    /\b(\d{4})([-\s]?)(\d{2})([-\s]?)(\d{2})\b/g,    // YYYYMMDD or YYYY-MM-DD
    /\b(\d{2})([-\s]?)(\d{2})([-\s]?)(\d{4})\b/g,    // DDMMYYYY or DD-MM-YYYY
    /\b(\d{10})\b/g                                  // Epoch timestamp
  ];

  const targetString = evalFullPath ? file.path : file.name;

  for (const pattern of datePatterns) {
    const matches = targetString.matchAll(pattern); // Match against the full path or filename
    for (const match of matches) {
      const [fullMatch, part1, , part2, , part3] = match; // Ignore separators
      let date;

      // Handle epoch timestamps
      if (pattern === /\b(\d{10})\b/g) {
        const epoch = Number(fullMatch);
        if (epoch >= 0) { // Basic sanity check for epoch
          date = new Date(epoch * 1000);
          if (!isNaN(date)) {
            dates.push({ date, source: evalFullPath ? 'path (epoch)' : 'filename (epoch)' });
          }
        }
        continue;
      }

      // Parse year, month, day based on position
      const year = part1.length === 4 ? part1 : part3; // Look for 4-digit year
      const isStartYear = part1.length === 4;
      const month = isStartYear ? part2 : part2; // `part2` is always month candidate
      const day = isStartYear ? part3 : part1;   // Determine day based on year position

      // Validate ranges
      if (
        year >= 1900 && year <= 2099 && // Valid year range
        month >= 1 && month <= 12 &&    // Valid month range
        day >= 1 && day <= 31           // Valid day range
      ) {
        // Construct date
        date = new Date(`${year}-${month}-${day}`);
        if (!isNaN(date)) { // Ensure the date is valid
          dates.push({ date, source: evalFullPath ? 'path' : 'filename' });
        }
      }
    }
  }

  // Step 3: Check file creation or birth timestamps as a last resort
  const timestampSources = [
    { key: 'birthtime', source: 'timestamps (birthtime)' },
    { key: 'ctime', source: 'timestamps (ctime)' },
    { key: 'createdTime', source: 'timestamps (createdTime)' },
    { key: 'modifiedTime', source: 'timestamps (modifiedTime)' }
  ];

  timestampSources.forEach(({ key, source }) => {
    if (file.stats?.[key] || file[key]) {
      dates.push({
        date: new Date(file.stats?.[key] || file[key]),
        source
      });
    }
  });

  // Step 4: Determine the oldest date
  const validDates = dates.filter(entry => entry.date > dateThreshold);
  if (validDates.length > 0) {
    return validDates.reduce((a, b) => (a.date < b.date ? a : b));
  }

  return { date: null, source: null, dates }; // No valid dates found
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

    if (!oldestDate.date || file.isDirectory || file.delete) {
      return null; // Skip files without a valid date, directories, or files to be deleted
    }

    const year = oldestDate.date.getFullYear();
    const month = String(oldestDate.date.getMonth() + 1).padStart(2, '0');
    const day = String(oldestDate.date.getDate()).padStart(2, '0');
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
      return {...file, move_to: targetPath, date: oldestDate};
    }
    return null; // Skip if already in the correct directory
  });

  // Use withConcurrency to execute tasks with a limit
  const reorganize = await withConcurrency(FILE_LIMIT, tasks);

  // Filter out null results
  return reorganize.filter(item => item !== null);
}

export default getReorganizeItems;