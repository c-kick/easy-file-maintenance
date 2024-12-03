import logger from '../utils/logger.mjs';
import {doHeader, userConfirm} from "./helpers.mjs";


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
 * Executes pending file operations based on user confirmation.
 * @param {object[]} operations - List of operations to perform.
 * @returns {Promise<void>}
 */
async function executeOperations(operations) {
    logger.succeed('Executing pending operations...');
    const filteredOps = rearrangeOperations(operations);
    const answers = {};
    let yesAllActions = false;
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
                            answers[operation] = await userConfirm(`Continue handling ${item.path}?`, ['y', 'a', 'n', 'c']);
                        }
                        if (['y','a'].includes(answers[operation]) || yesAllItems) {
                            console.log(`Handling "${item.path}"`);
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
    logger.succeed('All actions done.');
}

export default executeOperations;
