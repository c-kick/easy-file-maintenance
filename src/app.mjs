#!/usr/bin/env node
import logger from './utils/logger.mjs';
import configLoader from './modules/configLoader.mjs';
import scanDirectory from './modules/scanner.mjs';
import getDuplicateItems from './modules/duplicateChecker.mjs';
import getOrphanItems from './modules/orphanDetector.mjs';
import getPermissionFiles from './modules/permissionChecker.mjs';
import getReorganizeItems from "./modules/reorganizer.mjs";
import getCleanUpItems from "./modules/getCleanUpItems.mjs";
import executeOperations, {postCleanup} from './utils/executor.mjs';

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
        const operations = {
            cleanup: [],
            duplicate: [],
            orphan: [],
            permissions: [],
            reorganize: []
        };
        const destructivePaths = new Set(); // Tracks paths marked for destructive actions

        //Destructive operations

        if (config.actions.includes('duplicates')) {
            logger.start('Checking for duplicate files...');
            const duplicates = await getDuplicateItems(scan.results.files, config.recycleBinPath, config.hashByteLimit);
            logger.succeed(`Found ${duplicates.length} duplicate groups.`);
            duplicates.forEach(group => {
                group.duplicates.forEach(item => {
                    destructivePaths.add(item.path); // Add to destructive paths
                    operations.duplicate.push({
                        path: item.path,
                        size: item.size,
                        original: group.original.path,
                        move_to: item.move_to
                    });
                });
            });
        }
        if (config.actions.includes('orphans')) {
            logger.start('Checking for orphan files...');
            const orphans = await getOrphanItems(scan.results.files, config.orphanFileExtensions, config.recycleBinPath);
            logger.succeed(`Found ${orphans.length} orphaned files.`);
            orphans.forEach(item => {
                destructivePaths.add(item.path); // Add to destructive paths
                operations.orphan.push({
                    path: item.path,
                    size: item.size,
                    move_to: item.move_to
                });
            });
        }
        if (config.actions.includes('cleanup')) {
            logger.start('Checking for items to cleanup...');
            const cleanupItems = await getCleanUpItems(scan.results, config.scanPath, config.recycleBinPath);
            logger.succeed(`Found ${cleanupItems.length} items requiring cleaning up.`);
            cleanupItems.forEach(item => {
                destructivePaths.add(item.path); // Add to destructive paths
                operations.cleanup.push({
                    path: item.path,
                    size: item.size,
                    move_to: item.move_to
                });
            });
        }

        //Non-Destructive operations

        if (config.actions.includes('reorganize')) {
            logger.start('Checking if reorganizing is possible...');
            const reorganizeTheseFiles = await getReorganizeItems(scan.results.files, config.reorganizeTemplate, config.dateThreshold, (config.relativePath || config.scanPath));
            logger.succeed(`Found ${reorganizeTheseFiles.length} items that can be reorganized.`);
            reorganizeTheseFiles.forEach(item => {
                if (!destructivePaths.has(item.path)) { // Skip if path is in destructivePaths
                    operations.reorganize.push({
                        path:    item.path,
                        move_to: item.move_to
                    });
                }
            });
        }

        if (config.actions.includes('permissions')) {
            logger.start('Checking permissions...');
            const wrongPermissions = await getPermissionFiles(scan.results, config.filePerm, config.dirPerm);
            logger.succeed(`Found ${wrongPermissions.length} items with wrong permissions.`);
            wrongPermissions.forEach(item => {
                if (!destructivePaths.has(item.path)) { // Skip if path is in destructivePaths
                    operations.permissions.push({
                        path: item.path,
                        mode: item.currentMode,
                        change_mode: item.desiredMode,
                        fsChmodValue: item.fsChmodValue
                    });
                }
            });
        }

        if (config.actions.includes('post-cleanup')) {
            operations.postcleanup = [{
                path: config.scanPath,
                action: postCleanup
            }];
        }

        // Confirm and Execute
        await executeOperations(operations);

    } catch (error) {
        logger.fail(`An error occurred: ${error.message}`).stop();
    }
})();
