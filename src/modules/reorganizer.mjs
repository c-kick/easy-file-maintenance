import logger from '../utils/logger.mjs';
import fs from 'fs/promises';
import path from 'path';
import exifParser from 'exif-parser';

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
async function extractOldestDate(file, dateThreshold) {
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

    // Step 2: Check file creation or birth timestamp
    if (file.createdTime) dates.push(new Date(file.createdTime));

    // Step 3: Extract dates from the filename
    const datePatterns = [
        /\\b(\\d{4})[-/]?(\\d{2})[-/]?(\\d{2})\\b/,  // YYYYMMDD or YYYY-MM-DD
        /\\b(\\d{2})[-/]?(\\d{2})[-/]?(\\d{4})\\b/,  // DDMMYYYY or DD-MM-YYYY
        /\\b(\\d{10})\\b/                           // Epoch timestamp
    ];
    for (const pattern of datePatterns) {
        const match = file.name.match(pattern);
        if (match) {
            try {
                const [fullMatch, part1, part2, part3] = match;
                let date;
                if (fullMatch.length === 10 && !isNaN(fullMatch)) {
                    // Epoch timestamp
                    date = new Date(Number(fullMatch) * 1000);
                } else if (part3 && part3.length === 4) {
                    // DDMMYYYY or DD-MM-YYYY
                    date = new Date(`${part3}-${part2}-${part1}`);
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

    // Step 4: Determine the oldest date
    const validDates = dates.filter(date => date > dateThreshold);
    if (validDates.length > 0) {
        return new Date(Math.min(...validDates.map(date => date.getTime())));
    }

    return null; // No valid dates found
}

/**
 * Reorganizes files into a structured directory hierarchy based on extracted dates.
 * @param {Array<Object>} files - Array of file objects to reorganize.
 * @param {string} targetStructure - The target directory structure (e.g., "/year/month/").
 * @param {Date} dateThreshold - The date threshold for sanity checking.
 * @param relPath
 */
async function reorganizeFiles(files, targetStructure = '/{year}/{month}/', dateThreshold, relPath) {
    if (!dateThreshold) { dateThreshold =  new Date('1995-01-01'); }

    let c = 0;
    const reorganize = [];
    for (const file of files) {
        logger.text(`Scanning for dates in files... ${c++}/${files.length}`);
        const oldestDate = await extractOldestDate(file, dateThreshold);
        if (!oldestDate || file.isDirectory) continue; // Skip files without a valid date, or directories

        const year = oldestDate.getFullYear();
        const month = String(oldestDate.getMonth() + 1).padStart(2, '0');
        const day = String(oldestDate.getDate()).padStart(2, '0'); // Use getDate() for the day of the month
        const targetDir = targetStructure
        .replace('{year}', year)
        .replace('{month}', month)
        .replace('{day}', day);

        const pathRef = path.basename(path.normalize(file.dir).replace(/\/$/, ''));
        let targetName = appendToFilename(file.name, ` - ${pathRef}`);
        const targetPath = path.join(targetDir, targetName);

        reorganize.push({...file, move_to: targetPath});
    }

    return reorganize;
}

export default reorganizeFiles;