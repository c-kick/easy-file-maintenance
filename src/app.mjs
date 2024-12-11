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
import getOwnershipFiles from "./modules/ownershipChecker.mjs";
import {doHeader} from "./utils/helpers.mjs";

(async () => {
    logger.start('Loading configuration...');
    try {
        // Step 1: Load Configuration
        const config = configLoader;
        if (!config) {
            logger.fail('Configuration invalid, cannot continue.');
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
            ownership: [],
            reorganize: []
        };
        const destructivePaths = new Set(); // Tracks paths marked for destructive actions

        //Destructive operations (items can either be in of these actions or in non-destructive operations, but not both)

        if (config.actions.includes('duplicates')) {
            logger.start('Checking for duplicate files...');
            const duplicates = await getDuplicateItems(scan.results.files, config.recycleBinPath, config.dupeSetExtensions, config.hashByteLimit);
            logger.succeed(`Found a total of ${Object.values(duplicates).reduce((acc, arr) => acc + arr.length, 0)} duplicates for ${Object.entries(duplicates).length} items after hashing.`);

            //console.log(newDuplicates);
            for (const duplicate in duplicates) {
                const dupes = duplicates[duplicate];
                console.group(`${duplicate} has ${dupes.length} duplicates:`)
                dupes.forEach(dupe => {
                    console.log(`${dupe.path}${dupe.isInFileset ? ' (part of a duplicate fileset)' : ''}`);
                    console.log(`Should move to: ${dupe.move_to}`)
                    destructivePaths.add(dupe.path); // Add to destructive paths
                    operations.duplicate.push({
                        path: dupe.path,
                        size: dupe.size,
                        original: duplicate,
                        move_to: dupe.move_to
                    });
                })
                console.groupEnd();
            }
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

        //Non-Destructive operations (items can be in multiple of these actions)

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
            if (config.filePerm && config.dirPerm) {
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
            } else {
                logger.warn('Skipping permission checks due to missing config values (filePerm & dirPerm).')
            }
        }

        if (config.actions.includes('ownership')) {
            if (config.owner_user && config.owner_group) {
                logger.start('Checking ownership...');
                const wrongOwnership = await getOwnershipFiles(scan.results, config.owner_user, config.owner_group);
                logger.succeed(`Found ${wrongOwnership.length} items with wrong ownership.`);
                wrongOwnership.forEach(item => {
                    if (!destructivePaths.has(item.path)) { // Skip if path is in destructivePaths
                        operations.ownership.push({
                            path: item.path,
                            owner: item.currentUser,
                            group: item.currentGroup,
                            new_owner: item.expectedUser,
                            new_group: item.expectedGroup,
                            new_owner_id: item.expectedUid,
                            new_group_id: item.expectedGid,
                        });
                    }
                });
            } else {
                logger.warn('Skipping ownership checks due to missing config values (owner_user & owner_group).')
            }
        }

        // Confirm and Execute
        await executeOperations(operations);

        // Do cleanup last
        if (config.actions.includes('post-cleanup')) {
            doHeader('post-cleanup');
            await postCleanup();
        }

    } catch (error) {
        logger.fail(`An error occurred: ${error.message}`).stop();
    }
})();
