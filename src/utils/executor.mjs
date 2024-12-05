import logger from '../utils/logger.mjs';
import {doHeader, userConfirm} from "./helpers.mjs";
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';
import scanDirectory from "../modules/scanner.mjs";
import configLoader from "../modules/configLoader.mjs";
import getCleanUpItems from "../modules/getCleanUpItems.mjs";

export async function postCleanup() {
    let success = true;
    let sizeAffected = 0;
    const config = configLoader;
    logger.start('Rescanning directory...');
    let scan = await scanDirectory(config.scanPath, config, 0);
    logger.succeed(`Directory rescanned.`);
    logger.start('Checking for items to cleanup...');
    const cleanupItems = await getCleanUpItems(scan.results, config.scanPath, config.recycleBinPath);
    logger.succeed(`Found ${cleanupItems.length} items requiring post-clean up.`);
    if (cleanupItems.length > 0) {
        logger.start('Cleaning up...');
        for (const item of cleanupItems) {
            const result = await doOperation(item);
            if (result) sizeAffected += item.size ?? 0;
        }
        logger.succeed(`Cleanup done. ${sizeAffected} bytes saved.`);
    }
    return {success, sizeAffected};
}

/**
 * Performs the specified file operation.
 * @param {object} item - The item to work on
 * @returns {Promise<{}>} - Resolves to true if the operation was successful, otherwise false.
 */
async function doOperation(item) {
    let success = false;
    let size = 0;

    try {
        if (item.hasOwnProperty('move_to')) {
            const destinationPath = item.move_to;

            // Create target directory if it does not exist
            await fs.mkdir(path.dirname(destinationPath), { recursive: true });

            // Move the file
            fsExtra.moveSync(item.path, destinationPath, { overwrite: true });
            success = true;
            size = item.size ?? 0;
        } else if (item.hasOwnProperty('change_mode')) {
            // Change file permissions
            await fs.chmod(item.path, item.fsChmodValue);
            success = true;
            size = item.size ?? 0;
        } else if (item.hasOwnProperty('action')) {
            // Change file permissions
            const result = await item.action(item);
            success = result.success;
            size = result.sizeAffected ?? (item.size ?? 0);
        }
    } catch (error) {
        logger.fail(`Failed to execute operation on ${item.path}:`, error);
    }

    return {success, size};
}

/**
 * Executes pending file operations based on user confirmation.
 * @param {object[{}]} operations - List of operations to perform.
 * @returns {Promise<void>}
 */
async function executeOperations(operations) {
    logger.succeed('Executing pending operations...');
    const answers = {};
    let yesAllActions = false;
    let sizeAffected = 0;
    for (const operation in operations) {
        if (operations.hasOwnProperty(operation) && operations[operation].length) {

            doHeader(operation);
            let proceed = false;
            if (yesAllActions) {
                console.log(`Continuing ${operation} actions without asking.`);
                proceed = true;
            } else if (answers[operation] && answers[operation] === 'c') {
                logger.fail(`Stop ${operation} actions`);
            } else {
                answers[operation] = await userConfirm(`Start ${operation} handling for ${operations[operation].length} items?`);

                if (['s'].includes(answers[operation])) {
                    console.log(`Items that will be handled:`);
                    operations[operation].forEach(item => {
                        console.log(item.path, item[operation]);
                    })
                    answers[operation] = await userConfirm(`Start ${operation} handling for these ${operations[operation].length} items?`);
                }

                proceed = ['y','a'].includes(answers[operation]);
                if (!proceed && ['n', 'c'].includes(answers[operation])) {
                    if (['c'].includes(answers[operation])) {
                        logger.fail(`Cancelled all remaining actions`);
                        break;
                    } else {
                        logger.warn(`Skipping ${operation} actions`);
                    }
                } else if (['a'].includes(answers[operation])) {
                    yesAllActions = true;
                }
            }

            if (proceed) {
                const actions = operations[operation];
                for (const item of actions) {
                    console.log(item);
                    if ((answers[operation] && answers[operation] === 'c')) {
                        logger.warn(`Not handling ${item.path} (${answers[operation]})`);
                    } else {
                        let yesAllItems = (answers[operation] && answers[operation] === 'a') || yesAllActions;
                        if (!yesAllItems) {
                            answers[operation] = await userConfirm(`Handle ${operation} for "${item.path}"?`, ['y', 'a', 'n', 'c']);
                        }
                        if (['y','a'].includes(answers[operation]) || yesAllItems) {

                            const result = await doOperation(item);

                            if (result.success) sizeAffected += result.size ?? 0;
                        } else if (['n', 'c'].includes(answers[operation])) {
                            logger.warn(`Not handling "${item.path}" (${answers[operation]})`);
                        }
                    }
                }
                logger.succeed(`All ${operation} actions done`);
            }

        }
    }

    doHeader();
    logger.succeed(`All actions done. ${sizeAffected} bytes saved.`);
}

export default executeOperations;
