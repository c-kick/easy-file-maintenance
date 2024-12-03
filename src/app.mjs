#!/usr/bin/env node
import logger from './utils/logger.mjs';
import configLoader from './modules/configLoader.mjs';
import scanDirectory from './modules/scanner.mjs';
import findDuplicates from './modules/duplicateChecker.mjs';
import findOrphans from './modules/orphanDetector.mjs';
import checkPermissions from './modules/permissionChecker.mjs';
import executeOperations from './utils/executor.mjs';
import reorganizeFiles from "./modules/reorganizer.mjs";
import sweeper from "./modules/sweeper.mjs";

const debugMode = true; // Enable debugging mode for development

(async () => {
    logger.start('Loading configuration...');
    try {
        // Step 1: Load Configuration
        const config = configLoader;
        if (!config) {
            logger.fail();
            console.error('Configuration invalid, cannot continue.');
            process.exit(1);
        }
        logger.succeed('Configuration loaded.');

        // Scan Directory
        logger.succeed(`Start scan for "${config.scanPath}"`);
        logger.start('Scanning directory...');
        let scan = await scanDirectory(config.scanPath, config, 0);
        logger.succeed(`Directory scanned. Found ${(scan.fileCount + scan.dirCount)} items (${scan.fileCount} files, in ${scan.dirCount} directories).`);

        // Perform Checks based on `actions`
        const operations = [];

        //console.log(scan.results.files)
        if (config.actions.includes('duplicates')) {
            logger.start('Checking for duplicate files...');
            const duplicates = await findDuplicates(scan.results.files, config.hashByteLimit);
            logger.succeed(`Found ${duplicates.length} duplicate groups.`);
            duplicates.forEach(group => {
                group.duplicates.forEach(item => (operations[item.path] ??= {}).duplicate = { original: group.original.path })
            });
        }

        if (config.actions.includes('orphans')) {
            logger.start('Checking for orphan files...');
            const orphans = await findOrphans(scan.results.files, config.orphanFileExtensions, config.recycleBinPath);
            logger.succeed(`Found ${orphans.length} orphaned files.`);
            orphans.forEach(item => (operations[item.path] ??= {}).orphan = { move_to: item.move_to });
        }

        if (config.actions.includes('permissions')) {
            logger.start('Checking permissions...');
            const wrongPermissions = await checkPermissions(scan.results, 0o664, 0o775);
            logger.succeed(`Found ${wrongPermissions.length} items with wrong permissions.`);
            wrongPermissions.forEach(item => (operations[item.path] ??= {}).permissions = { mode: item.mode, new_mode: item.new_mode });
        }

        if (config.actions.includes('reorganize')) {
            logger.start('Checking if reorganizing is possible...');
            const reorganizeTheseFiles = await reorganizeFiles(scan.results.files, config.reorganizeTemplate, config.dateThreshold, config.relativePath ?? config.scanPath);
            logger.succeed(`Found ${reorganizeTheseFiles.length} items that can be reorganized.`);
            reorganizeTheseFiles.forEach(item => (operations[item.path] ??= {}).reorganize = { move_to: item.move_to });
        }

        if (config.actions.includes('cleanup')) {
            logger.start('Checking for items to cleanup...');
            scan = await scanDirectory(config.scanPath, config);
            const cleanupItems = await sweeper(scan.results, config.scanPath, config.recycleBinPath);
            logger.succeed(`Found ${cleanupItems.length} items requiring cleaning up.`);
            cleanupItems.forEach(item => (operations[item.path] ??= {}).cleanup = { move_to: item.move_to });
        }

        // Confirm and Execute
        await executeOperations(operations);

    } catch (error) {
        logger.fail(`An error occurred: ${error.message}`).stop();
    }
})();
