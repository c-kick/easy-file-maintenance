import logger from '../utils/logger.mjs';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';

const FILE_LIMIT = pLimit(5); // Limit file stats concurrency

const pathSplitter = (filePath) => {
  const parts = filePath.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
};

async function getFiles(dir, config) {
  const results = {directories: new Map(), files: new Map()};
  const queue = [{dir, depth: 0}];

  while (queue.length > 0) {
    const {dir: currentDir, depth} = queue.shift();
    const dirItems = await fs.readdir(currentDir, {withFileTypes: true});

    for (const dirItem of dirItems) {
      const res = path.resolve(currentDir, dirItem.name);
      let stats;
      try {
        stats = await fs.stat(res);
      } catch (error) {
        logger.fail(`Error accessing ${res}: ${error.message}`);
        continue;
      }
      if (config.ignoreDirectories.some(pattern => matchPattern(dirItem.name, pattern)) ||
        res.includes(config.recycleBinPath)) {
        logger.text(`Ignoring path: ${res}`);
      } else if (dirItem.isFile() && config.ignoreFiles.some(pattern => matchPattern(dirItem.name, pattern))) {
        logger.text(`Ignoring file: ${res}`);
      } else if (dirItem.isDirectory()) {
        logger.text(`Scanning directory: ${res}`);

        results.directories.set(res, {
          name: dirItem.name,
          baseName:     path.basename(dirItem.name, path.extname(res)),
          path: res,
          dir:          path.dirname(res),
          size:         stats.size,
          isFile:       false,
          isDirectory:  true,
          modifiedTime: stats.mtime,
          createdTime:  stats.ctime,
          stats,
          depth,
          fileCount: results.directories.get(res)?.fileCount ?? 0,
          intrinsicSize: results.directories.get(res)?.intrinsicSize ?? 0,
          totalSize: results.directories.get(res)?.totalSize ?? 0,
        });
        queue.push({dir: res, depth: depth + 1});
      } else {
        logger.text(`Scanning file: ${res}`);

        results.files.set(res, {
          name: dirItem.name,
          baseName: path.basename(dirItem.name, path.extname(res)),
          extension: dirItem.name.split('.').pop().toLowerCase(),
          path: res,
          dir: path.dirname(res),
          size: stats.size,
          isFile: true,
          isDirectory: false,
          delete: config.removeFiles.some(pattern => matchPattern(dirItem.name, pattern)),
          modifiedTime: stats.mtime,
          createdTime: stats.ctime,
          stats,
          depth
        });

        const splitPath = pathSplitter(path.relative(dir, res));
        splitPath.forEach((subPath, index) => {
          const subDir = path.join(dir, subPath);
          if (!results.directories.get(subDir)) {
            results.directories.set(subDir, {
              totalSize: 0,
              fileCount: 0,
              intrinsicSize: 0,
            });
          }
          results.directories.get(subDir).totalSize += stats.size;
          results.directories.get(subDir).fileCount++;
          if (path.dirname(res) === subDir) {
            results.directories.get(subDir).intrinsicSize += stats.size;
          }
        });
      }
    }
  }

  return results;
}

function matchPattern(str, pattern) {
  const regex = new RegExp(
    '^' + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*').toLowerCase() + '$'
  );
  return regex.test(str.toLowerCase());
}

async function scanDirectory(dirPath, config) {
  logger.text(`Starting scan on directory: ${dirPath}`);

  try {
    return await getFiles(dirPath, config);
  } catch (error) {
    logger.fail(`Error during scan: ${error.message}`);
    return null;
  }
}

export default scanDirectory;
