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
import {doHeader} from "./utils/helpers.mjs";
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
        logger.succeed('Configuration loaded.');
        console.log(config);

        // Scan Directory
        logger.succeed(`Start scan for "${config.scanPath}"`);
        logger.start('Scanning directory...');
        let scan = await scanDirectory(config.scanPath, config);
        let rescan = false;
        logger.succeed(`Directory scanned. Found ${(scan.files.size + scan.directories.size)} items (${scan.files.size} files, in ${scan.directories.size} directories).`);

        // Perform Checks based on `actions`
        const operations = {
            precleanup: [],
            duplicate: [],
            orphan: [],
            permissions: [],
            ownership: [],
            reorganize: [],
            postcleanup: []
        };
        const destructivePaths = new Set(); // Tracks paths marked for destructive actions

        //Destructive operations (items can either be in of these actions or in non-destructive operations, but not both)

        if (config.actions.includes('duplicates')) {
            logger.start('Checking for duplicate files...');
            const duplicates = await getDuplicateItems(scan.files, config.recycleBinPath, config.dupeSetExtensions, config.hashByteLimit);
            logger.succeed(`Found a total of ${Object.values(duplicates).reduce((acc, arr) => acc + arr.length, 0)} duplicates for ${Object.entries(duplicates).length} items after hashing.`);

            //console.log(newDuplicates);
            for (const duplicate in duplicates) {
                const dupes = await duplicates[duplicate];
                //console.group(`${duplicate} has ${dupes.length} duplicates:`)
                dupes.forEach(dupe => {
                    //console.log(`${dupe.path}${dupe.isInFileset ? ' (part of a duplicate fileset)' : ''}`);
                    //console.log(`Should move to: ${dupe.move_to}`)
                    destructivePaths.add(dupe.path); // Add to destructive paths
                    operations.duplicate.push({
                        path: dupe.path,
                        size: dupe.size,
                        original: duplicate,
                        move_to: dupe.move_to
                    });
                })
                //console.groupEnd();*/
            }
            rescan = true;
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
            rescan = true;
        }

        if (config.actions.includes('pre-cleanup')) {
            logger.start('Checking for items to pre-clean...');
            const preCleanTheseItems = await getCleanUpItems(scan, config.scanPath, config.recycleBinPath);
            logger.succeed(`Found ${preCleanTheseItems.directories.length} directories and ${preCleanTheseItems.files.length} files requiring cleaning up before running other actions.`);

            [
                ...Object.values(preCleanTheseItems.files),
                ...Object.values(preCleanTheseItems.directories)
            ].forEach(item => {
                destructivePaths.add(item.path); // Add to destructive paths
                operations.precleanup.push({
                    depth: item.depth,
                    dir: item.dir,
                    path: item.path,
                    size: item.size,
                    move_to: item.move_to,
                    reason: item.reason
                });
            });
            console.log(operations.precleanup);
            rescan = true;
        }

        //Non-Destructive operations (items can be in multiple of these actions)

        if (config.actions.includes('reorganize')) {
            logger.start('Checking if reorganizing is possible...');
            const reorganizeTheseFiles = await getReorganizeItems(scan, config.reorganizeTemplate, config.dateThreshold, (config.relativePath || config.scanPath));
            logger.succeed(`Found ${reorganizeTheseFiles.length} items that can be reorganized.`);
            reorganizeTheseFiles.files.forEach(item => {
                if (!destructivePaths.has(item.path)) { // Skip if path is in destructivePaths
                    operations.reorganize.push({
                        path:    item.path,
                        move_to: item.move_to,
                        date_found:   item.date,
                    });
                }
            });
            rescan = true;
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
            rescan = true;
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
            rescan = true;
        }

        // Confirm and Execute
        await executeOperations(operations);

        // Do another cleanup last
        if (config.actions.includes('post-cleanup')) {
            doHeader('post-cleanup');
            logger.start('Checking for items to post-clean...');
            const postCleanTheseItems = await getCleanUpItems(scan, config.scanPath, config.recycleBinPath);
            logger.succeed(`Found ${postCleanTheseItems.directories.length} directories and ${postCleanTheseItems.files.length} files requiring cleaning up after running all actions.`);

            [
                ...Object.values(postCleanTheseItems.files),
                ...Object.values(postCleanTheseItems.directories)
            ].forEach(item => {
                destructivePaths.add(item.path); // Add to destructive paths
                operations.postcleanup.push({
                    depth: item.depth,
                    dir: item.dir,
                    path: item.path,
                    size: item.size,
                    move_to: item.move_to,
                    reason: item.reason
                });
            });
            console.log(operations.postcleanup);
        }

        // Confirm and Execute
        await executeOperations({postcleanup : operations.postcleanup});

    } catch (error) {
        logger.fail(`An error occurred: ${error.message}`).stop();
    }
})();
