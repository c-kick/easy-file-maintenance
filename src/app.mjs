#!/usr/bin/env node
import logger from './utils/logger.mjs';
import configLoader from './modules/configLoader.mjs';
import scanDirectory from './modules/scanner.mjs';
import findDuplicates from './modules/duplicateChecker.mjs';
import findOrphans from './modules/orphanDetector.mjs';
import checkPermissions from './modules/permissionChecker.mjs';
import executeOperations from './modules/executor.mjs';
import fs from 'fs-extra';
import ora from 'ora';
import reorganizeFiles from "./modules/reorganizer.mjs";

const debugMode = true; // Enable debugging mode for development

(async () => {
    logger.start('Loading configuration...');
    try {
        // Step 1: Load Configuration
        const config = configLoader;
        logger.succeed('Configuration loaded.');

        // Step 2: Validate Paths (Skipped here for brevity but should include checks)

        // Step 3: Scan Directory
        logger.succeed(`Start scan for "${config.scanPath}"`);
        logger.start('Scanning directory...');
        const scanResults = await scanDirectory(config.scanPath, config, 0);
        let fileCount = 0, dirCount = 0;
        scanResults.forEach(item => {
            if (item.isFile) fileCount++;
            if (item.isDirectory) dirCount++;
        });
        logger.succeed(`Directory scanned. Found ${scanResults.length} items (${fileCount} files and ${dirCount} directories).`);

        // Step 4: Perform Checks based on `actions`
        const operations = [];

        if (config.actions.includes('duplicates')) {
            logger.start('Checking for duplicate files...');
            const duplicates = await findDuplicates(scanResults, config.hashByteLimit);
            logger.succeed(`Found ${duplicates.length} duplicate groups.`);
            duplicates.forEach(group => {
                console.log(`${group.original.path} has ${group.duplicates.length} duplicates`);
                (operations.remove = (operations.remove ?? [])).push(...(group.duplicates.map(duplicate => ({...duplicate,  duplicate: true, original: group.original.path}))));
            });
        }

        if (config.actions.includes('orphans')) {
            logger.start('Checking for orphan files...');
            const orphans = findOrphans(scanResults, config.orphanFileExtensions);
            logger.succeed(`Found ${orphans.length} orphaned files.`);
            orphans.forEach(orphan => {
                console.log(`Found orphan: ${orphan.path}`);
                (operations.remove = (operations.remove ?? [])).push({...orphan, orphan: true});
            });
        }

        if (config.actions.includes('permissions')) {
            logger.start('Checking permissions...');
            const wrongPermissions = await checkPermissions(scanResults, 0o664, 0o775);
            logger.succeed(`Permissions checked. Found ${wrongPermissions.length} items with wrong permissions.`);
            wrongPermissions.forEach(item => {
                //console.log(`Wrong permissions for ${item.isFile ? 'file' : 'directoy'}: ${item.path} (${item.mode.toString(8)}, desired: ${item.new_mode.toString(8)})`);
                (operations.chmod = (operations.chmod ?? [])).push({...item, change_permissions: true});
            });
        }

        if (config.actions.includes('reorganize')) {
            logger.start('Checking if reorganizing is needed...');
            const reorganizeTheseFiles = await reorganizeFiles(scanResults, config.reorganizeTemplate, config.dateThreshold, config.relativePath ?? config.scanPath);
            logger.succeed(`Permissions checked. Found ${reorganizeTheseFiles.length} items that can be reorganized.`);
            reorganizeTheseFiles.forEach(item => {
                console.log(`Should move ${item.path} to: "${item.move_to}"`);
                (operations.move = (operations.move ?? [])).push({...item, reorganize: true});
            });
        }



        // Step 5: Confirm and Execute
        logger.start('Executing pending actions...');
        await executeOperations(operations, async (operation) => {
            console.log(`[DEBUG] Pending action: ${operation.description}`);
            return 'y'; // Automatically confirm for debugging
        });
        logger.succeed('All actions executed.').stop();

    } catch (error) {
        logger.fail(`An error occurred: ${error.message}`).stop();
    }
})();
