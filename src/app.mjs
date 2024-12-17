#!/usr/bin/env node
import logger from './utils/logger.mjs';
import configLoader from './modules/configLoader.mjs';
import scanDirectory from './modules/scanner.mjs';
import getDuplicateItems from './modules/duplicateChecker.mjs';
import getOrphanItems from './modules/orphanDetector.mjs';
import getPermissionFiles from './modules/permissionChecker.mjs';
import getReorganizeItems from "./modules/reorganizer.mjs";
import getCleanUpItems from "./modules/getCleanUpItems.mjs";
import getOwnershipFiles from "./modules/ownershipChecker.mjs";
import {doHeader, formatBytes} from "./utils/helpers.mjs";
import executeOperations from "./utils/executor.mjs";


(async () => {
    logger.start('Loading configuration...');
    try {
        // Step 1: Load Configuration
        const config = configLoader;
        if (!config) {
            logger.fail('Configuration invalid, cannot continue.');
            process.exit(1);
        }
        // Add bin to paths to ignore
        config.ignoreDirectories = [
            config.recycleBinPath,
            ...config.ignoreDirectories
        ];
        logger.succeed('Configuration loaded.');
        console.log(config);

        // Scan Directory
        logger.succeed(`Start scan for "${config.scanPath}"`);
        logger.start('Scanning directory...');
        let scan = await scanDirectory(config.scanPath, config);
        logger.succeed(`Directory scanned. Found ${(scan.files.size + scan.directories.size)} items (${scan.files.size} files, in ${scan.directories.size} directories), totaling ${formatBytes(scan.size)}`);

        // Perform Checks based on `actions`
        const operations = {
            preCleanup: [],
            duplicate: [],
            orphan: [],
            permissions: [],
            ownership: [],
            reorganize: [],
            postCleanup: []
        };
        const destructivePaths = new Set(); // Tracks paths marked for destructive actions

        //Destructive operations (items can either be in of these actions or in non-destructive operations, but not both)

        if (config.actions.includes('duplicates')) {
            logger.start('Checking for duplicate files...');
            const duplicates = await getDuplicateItems(scan, config.recycleBinPath);
            logger.succeed(`Found ${duplicates.directories.length} directory duplicates and ${duplicates.files.length} file duplicates by hash, totaling ${formatBytes(duplicates.size)}.`);

            Object.values(duplicates).flat().forEach(dupe => {
                destructivePaths.add(dupe.path); // Add the file to destructive paths
                operations.duplicate.push({
                    path: dupe.path,
                    size: dupe.size,
                    original: dupe.duplicate_of,
                    sidecarFiles: dupe.sidecars ?? [],
                    move_to: dupe.move_to
                });
            })
        }

        if (config.actions.includes('orphans')) {
            logger.start('Checking for orphan files...');
            const orphans = await getOrphanItems(scan.files, config.orphanFileExtensions, config.recycleBinPath);
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

        if (config.actions.includes('pre-cleanup')) {
            logger.start('Checking for items to pre-clean...');
            const preCleanTheseItems = await getCleanUpItems(scan, config.scanPath, config.recycleBinPath);
            logger.succeed(`Found ${preCleanTheseItems.directories.length} directories and ${preCleanTheseItems.files.length} files that should be cleaned up first, totaling ${formatBytes(preCleanTheseItems.size)}.`);

            [
                ...Object.values(preCleanTheseItems.files),
                ...Object.values(preCleanTheseItems.directories)
            ].forEach(item => {
                destructivePaths.add(item.path); // Add to destructive paths
                operations.preCleanup.push({
                    depth: item.depth,
                    dir: item.dir,
                    path: item.path,
                    size: item.size,
                    move_to: item.move_to,
                    reason: item.reason
                });
            });
        }

        //Non-Destructive operations (items can be in multiple of these actions)

        if (config.actions.includes('reorganize')) {
            logger.start('Checking if reorganizing is possible...');
            const reorganizeTheseFiles = await getReorganizeItems(scan, config.reorganizeTemplate, config.dateThreshold, (config.relativePath || config.scanPath));
            logger.succeed(`Found ${reorganizeTheseFiles.files.length} items that can be reorganized.`);
            reorganizeTheseFiles.files.forEach(item => {
                if (!destructivePaths.has(item.path)) { // Skip if path is in destructivePaths
                    operations.reorganize.push({
                        path:    item.path,
                        move_to: item.move_to,
                        date_found:   item.date,
                    });
                }
            });
        }

        if (config.actions.includes('permissions')) {
            if (config.filePerm && config.dirPerm) {
                logger.start('Checking permissions...');
                const wrongPermissions = await getPermissionFiles(scan, config.filePerm, config.dirPerm);
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
                const wrongOwnership = await getOwnershipFiles(scan, config.owner_user, config.owner_group);
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

        // Do another cleanup last
        if (config.actions.includes('post-cleanup')) {
            doHeader('post-cleanup');
            logger.start('Checking for items to post-clean...');
            const postCleanTheseItems = await getCleanUpItems(scan, config.scanPath, config.recycleBinPath);
            logger.succeed(`Found ${postCleanTheseItems.directories.length} directories and ${postCleanTheseItems.files.length} files requiring cleaning up after running all actions.`);

            const allEntries = new Map([...postCleanTheseItems.files, ...postCleanTheseItems.directories]);
            allEntries.forEach(item => {
                destructivePaths.add(item.path); // Add to destructive paths
                operations.postCleanup.push({
                    depth: item.depth,
                    dir: item.dir,
                    path: item.path,
                    size: item.size,
                    move_to: item.move_to,
                    reason: item.reason
                });
            });
            console.log(operations.postCleanup);
        }

        // Confirm and Execute
        await executeOperations({postCleanup : operations.postCleanup});

    } catch (error) {
        logger.fail(`An error occurred: ${error.message}`).stop();
    }
})();
