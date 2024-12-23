import logger from '../utils/logger.mjs';
import fs from 'fs/promises';
import path from 'path';
import exifParser from 'exif-parser';
import pLimit from "p-limit";
import {normalizePath} from "../utils/helpers.mjs";

const FILE_LIMIT = pLimit(10); // Limit concurrency
const SUPPORTED_EXIF_EXTENSIONS = new Set([
  "jpg",    // JPEG image
  "jpeg",   // Alternate extension for JPEG
  "tif",    // TIFF image
  "tiff",   // Alternate extension for TIFF
  "png",    // PNG image (limited EXIF support)
  "webp",   // WEBP image (limited EXIF support)
  "heif",   // High Efficiency Image Format
  "heic",   // High Efficiency Image Coding
  "dng",    // Digital Negative (RAW)
  "arw",    // Sony Alpha RAW
  "cr2",    // Canon RAW 2
  "cr3",    // Canon RAW 3
  "nef",    // Nikon RAW
  "nrw",    // Nikon RAW (Coolpix)
  "orf",    // Olympus RAW
  "raf",    // Fujifilm RAW
  "rw2",    // Panasonic RAW
  "raw",    // Generic RAW
  "rwl",    // Leica RAW
  "sr2",    // Sony RAW 2
  "srw",    // Samsung RAW
  "3fr",    // Hasselblad RAW
  "ari",    // ARRI RAW
  "bay",    // Casio RAW
  "cap",    // Phase One RAW
  "iiq",    // Phase One RAW
  "eip",    // Phase One Enhanced Image Package
  "erf",    // Epson RAW
  "fff",    // Imacon/Hasselblad RAW
  "mef",    // Mamiya RAW
  "mos",    // Leaf RAW
  "mrw",    // Minolta RAW
  "pef",    // Pentax RAW
  "x3f"     // Sigma RAW (Foveon)
]);

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
  let fh;

  // Step 1: Check for EXIF data
  if (SUPPORTED_EXIF_EXTENSIONS.has(file.extension.toLowerCase())) {
    try {
      fh = await fs.open(file.path, 'r');
      const buffer = Buffer.alloc(64 * 1024); // 64KB buffer
      await fh.read(buffer, 0, buffer.length, 0);
      const parser = exifParser.create(buffer);
      const exifData = parser.parse();
      if (exifData && exifData.tags.DateTimeOriginal) {
        dates.push({
          date: new Date(exifData.tags.DateTimeOriginal * 1000), // Convert to milliseconds
          source: 'exif'
        });
      }
    } catch {
      // Ignore errors (e.g., non-image files or missing EXIF data)
    } finally {
      if (fh) {
        await fh.close();
      }
    }
  }

  // Step 2: Check the filename and path for dates
  const datePatterns = [
    /(\d{4})([-\s]?)(\d{2})([-\s]?)(\d{2})/g,    // YYYYMMDD or YYYY-MM-DD
    /(\d{2})([-\s]?)(\d{2})([-\s]?)(\d{4})/g,    // DDMMYYYY or DD-MM-YYYY
    /(\d{10})/g                                  // Epoch timestamp
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

  if (!dates.length) {
    // Step 3: Check file creation or birth timestamps as a last resort
    const timestampSources = [
      //{ key: 'birthtime', source: 'timestamps (birthtime)' },
      //{ key: 'ctime', source: 'timestamps (ctime)' },
      { key: 'mtime', source: 'timestamps (mtime)' }
    ];

    timestampSources.forEach(({ key, source }) => {
      if (file.stats?.[key] || file[key]) {
        dates.push({
          date: new Date(file.stats?.[key] || file[key]),
          source
        });
      }
    });

  }

  // Step 4: Determine the oldest date
  const validDates = dates.filter(entry => entry.date > dateThreshold);
  if (validDates.length > 0) {
    return validDates.reduce((a, b) => (a.date < b.date ? a : b));
  }

  return { date: null, source: null, dates }; // No valid dates found
}


/**
 * Reorganizes files into a structured directory hierarchy based on extracted dates.
 * @param {object} items - Object containing file details from the scanner.
 * @param {string} targetStructure - The target directory structure (e.g., "/year/month/").
 * @param {Date} dateThreshold - The date threshold for sanity checking.
 * @param relPath
 */
async function getReorganizeItems(items, targetStructure = '/{year}/{month}/', dateThreshold = new Date('1995-01-01'), relPath) {
  let progress = 0;
  const processFiles = async (files) => {
    const tasks = Array.from(files, ([value, file]) => {
      return FILE_LIMIT(async () => {

        progress += 1; // Increment progress after processing
        logger.text(`Scanning for dates in files... ${progress}/${files.size}`);

        // Simulate async operation, e.g., reading file contents
        const oldestDate = await extractOldestDate(file, dateThreshold);

        if (!oldestDate.date || file.isDirectory || file.delete) {
          return null; // Skip files without a valid date, directories, files to be deleted, or ignored files
        }

        const year = oldestDate.date.getUTCFullYear();
        const month = String(oldestDate.date.getUTCMonth() + 1).padStart(2, '0'); // Months are zero-indexed
        const day = String(oldestDate.date.getUTCDate()).padStart(2, '0');

        const targetDir = path.join(relPath, targetStructure
        .replace('{year}', year)
        .replace('{month}', month)
        .replace('{day}', day));

        const pathRef = normalizePath(file.dir).replace(relPath, '').replace(/[\\/]/g, '_');
        const targetName = file.name.includes(pathRef)
          ? file.name
          : appendToFilename(file.name, `_${pathRef}`);

        if (normalizePath(targetDir) !== normalizePath(file.dir)) {
          return {
            path: file.path,
            move_to: path.join(targetDir, targetName),
            date: oldestDate
          };
        }

        return null; // Skip if already in the correct directory

      });
    });

    // Wait for all tasks to complete
    return await Promise.all(tasks);
  };

  const processedFiles = await processFiles(items.files);

  return ({ ...items, files: processedFiles.filter(item => item !== null) })
}

export default getReorganizeItems;