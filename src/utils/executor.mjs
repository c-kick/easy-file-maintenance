import logger from '../utils/logger.mjs';
import {doHeader, userConfirm} from "./helpers.mjs";
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';

function preProcessOps(operations, action) {
    return Object.entries(operations).reduce((acc, [key, value]) => {
        if (value[action]) {
            acc.actionItems[key] = value;
        } else {
            acc.filteredItems[key] = value;
        }
        return acc;
    }, { actionItems: {}, filteredItems: {} });
}

function rearrangeOperations(operations) {
    const rearranged = {
        cleanup: [],
        duplicate: [],
        orphan: [],
        permissions: [],
        reorganize: []
    };

    const remaining = { ...operations };

    // Step 1: Filter items with 'cleanup' property and add to 'cleanup' group
    for (const [key, value] of Object.entries(remaining)) {
        if (value.cleanup) {
            rearranged.cleanup.push({ path: key, ...value });
            delete remaining[key];
        }
    }

    // Step 2: Filter items with 'duplicate' property and add to 'duplicate' group
    for (const [key, value] of Object.entries(remaining)) {
        if (value.duplicate) {
            rearranged.duplicate.push({ path: key, ...value });
            delete remaining[key];
        }
    }

    // Step 3: Filter items with 'orphan' property and add to 'orphan' group
    for (const [key, value] of Object.entries(remaining)) {
        if (value.orphan) {
            rearranged.orphan.push({ path: key, ...value });
            delete remaining[key];
        }
    }

    // Step 4: For the remaining items, add them to 'permissions', 'reorganize', etc., if they have the respective properties
    for (const [key, value] of Object.entries(remaining)) {
        if (value.permissions) {
            rearranged.permissions.push({ path: key, ...value });
        }
        if (value.reorganize) {
            rearranged.reorganize.push({ path: key, ...value });
        }
    }

    return rearranged;
}

/**
 * Parses the permission value to a format suitable for fs.chmod().
 * @param {string | number} permission - The permission value (e.g., '664', 664, '0o664').
 * @returns {number} - The permission value as an octal number.
 */
function parsePermission(permission) {
    if (typeof permission === 'number') {
        return parseInt(permission.toString(), 8);
    } else if (typeof permission === 'string') {
        // Convert the string to a number using base 8 if it's not already in octal format
        if (permission.startsWith('0o')) {
            return parseInt(permission, 8);
        } else {
            return parseInt(permission, 8);
        }
    } else {
        throw new Error('Invalid permission type. Must be a string or number.');
    }
}

/**
 * Performs the specified file operation.
 * @param {string} filePath - Path to the file to operate on.
 * @param {object} operation - Operation details. Can include 'move_to' or 'chmod'.
 * @returns {Promise<boolean>} - Resolves to true if the operation was successful, otherwise false.
 */
async function doOperation(filePath, operation) {
    let success = false;

    try {
        if (operation.hasOwnProperty('move_to')) {
            const destinationPath = operation.move_to;

            // Create target directory if it does not exist
            await fs.mkdir(path.dirname(destinationPath), { recursive: true });

            // Move the file
            fsExtra.moveSync(filePath, destinationPath, { overwrite: true });
            success = true;
            console.log(`Moved: ${filePath}\n To: ${destinationPath}`);
        } else if (operation.hasOwnProperty('chmod')) {
            const permissions = parsePermission(operation.chmod);

            // Change file permissions
            await fs.chmod(filePath, permissions);
            success = true;
            console.log(`Changed permissions for: ${filePath} to ${operation.chmod}`);
        }
    } catch (error) {
        console.error(`Failed to execute operation on ${filePath}:`, error);
    }

    return success;
}

/**
 * Executes pending file operations based on user confirmation.
 * @param {object[]} operations - List of operations to perform.
 * @returns {Promise<void>}
 */
async function executeOperations(operations) {
    logger.succeed('Executing pending operations...');
    const filteredOps = rearrangeOperations(operations);
    const answers = {};
    let yesAllActions = false;
    let bytesHandled = 0;
    for (const operation in filteredOps) {
        if (filteredOps.hasOwnProperty(operation) && filteredOps[operation].length) {

            doHeader(operation);
            let proceed = false;
            if (yesAllActions) {
                console.log(`Continuing ${operation} actions without asking.`);
                proceed = true;
            } else if (answers[operation] && answers[operation] === 'c') {
                logger.fail(`Stop ${operation} actions`);
            } else {
                answers[operation] = await userConfirm(`Start ${operation} handling for ${filteredOps[operation].length} items?`);

                if (['s'].includes(answers[operation])) {
                    console.log(`Items that will be handled:`);
                    filteredOps[operation].forEach(item => {
                        console.log(item.path, item[operation]);
                    })
                    answers[operation] = await userConfirm(`Start ${operation} handling for these ${filteredOps[operation].length} items?`);
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
                const actions = filteredOps[operation];
                for (const item of actions) {
                    if ((answers[operation] && answers[operation] === 'c')) {
                        logger.warn(`Not handling ${item.path} (${answers[operation]})`);
                    } else {
                        let yesAllItems = (answers[operation] && answers[operation] === 'a') || yesAllActions;
                        if (!yesAllItems) {
                            answers[operation] = await userConfirm(`Handle ${operation} for "${item.path}"?`, ['y', 'a', 'n', 'c']);
                        }
                        if (['y','a'].includes(answers[operation]) || yesAllItems) {
                            const result = await doOperation(item.path, item[operation]);
                            if (result) bytesHandled += item[operation].size ?? 0;
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
    logger.succeed(`All actions done. ${bytesHandled} bytes saved.`);
}

export default executeOperations;
