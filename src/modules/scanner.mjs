import logger from '../utils/logger.mjs';
import fs from 'fs/promises';
import path from 'path';
import {formatBytes, matchPattern, updateDirectoryStats} from "../utils/helpers.mjs";

function createItem(name, stats, fullPath, depth) {
  return {
    depth,
    path:         fullPath,
    dir:          path.dirname(fullPath),
    name,
    baseName:     path.basename(name, path.extname(fullPath)),
    isFile:       false,
    isDirectory:  false,
    stats
  }
}

async function getFiles(dir, config) {
  const results = {directories: new Map(), files: new Map(), counters: {dir: 0, file: 0, size: 0, filesignored: 0, dirsignored: 0}};
  const queue = [{dir, depth: 0}];

  while (queue.length > 0) {
    // Get next directory to process from queue
    const {dir: currentDir, depth} = queue.shift();

    // Start scanning directory
    const dirItems = await fs.readdir(currentDir, {withFileTypes: true});

    // Process each item found in directory
    for (const dirItem of dirItems) {
      const fullPath = path.resolve(currentDir, dirItem.name);
      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch (error) {
        logger.fail(`Error accessing ${fullPath}: ${error.message}`);
        continue;
      }

      // Nothing is ignored by default
      let ignored = false;

      if (dirItem.isDirectory()) {
        // Update directory counter
        results.counters.dir++;

        // Check if dir should be ignored
        ignored = config.ignoreDirectories.some(pattern => matchPattern(dirItem.name, pattern)) || fullPath.includes(config.recycleBinPath);

        // Update ignored counter
        results.counters.dirsignored += ignored ? 1 : 0;

        // Don't traverse directory further if it is ignored
        if (ignored) continue;

        // Add directory to results, if not ignored
        results.directories.set(fullPath, {
          ...createItem(dirItem.name, stats, fullPath, depth),
          isDirectory:  true,
          fileCount: results.directories.get(fullPath)?.fileCount ?? 0,
          dirCount: results.directories.get(fullPath)?.dirCount ?? 0,
          intrinsicSize: results.directories.get(fullPath)?.intrinsicSize ?? 0,
          totalSize: results.directories.get(fullPath)?.totalSize ?? 0,
        });

        queue.push({dir: fullPath, depth: depth + 1});
      } else {
        // Update file and size counters
        results.counters.file++;
        results.counters.size += stats.size;

        // Check if file should be ignored
        ignored = config.ignoreFiles.some(pattern => matchPattern(dirItem.name, pattern));

        // Update ignored counter
        results.counters.filesignored += ignored ? 1 : 0;

        // Add file to results
        results.files.set(fullPath, {
          ...createItem(dirItem.name, stats, fullPath, depth),
          isFile: true,
          extension: dirItem.name.split('.').pop(),
          delete: config.removeFiles.some(pattern => matchPattern(dirItem.name, pattern)),
          ignored,
        });
      }

      // Update directory stats (file count, intrinsic size, total size)
      updateDirectoryStats(results, dir, fullPath, stats, ignored);

      logger.text(`Found ${results.counters.file} files (${results.counters.filesignored} ignored) in ${results.counters.dir} directories (${results.counters.dirsignored} ignored), totalling ${formatBytes(results.counters.size)}.`);

    }
  }

  logger.succeed();
  return results;
}

async function scanDirectory(dirPath, config) {
  logger.start(`Scanning directory ${dirPath}...`);
  try {
    return await getFiles(dirPath, config);
  } catch (error) {
    logger.fail(`Error during scan: ${error.message}`);
    return null;
  }
}

export default scanDirectory;
