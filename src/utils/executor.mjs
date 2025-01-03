import logger from '../utils/logger.mjs';
import {answerLoop, canChangeOwnership, doHeader, userConfirm} from "./helpers.mjs";
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';
import configLoader from "../modules/configLoader.mjs";
import chalk from 'chalk';

const config = configLoader;

/**
 * Performs the specified file operation.
 * @param {object} item - The item to work on
 * @returns {Promise<{}>} - Resolves to true if the operation was successful, otherwise false.
 */
async function doOperation(item) {
    let success = false;
    let size = 0;

    try {
        if (item.hasOwnProperty('move_to') && item.move_to !== undefined) {
            // Create target directory if it does not exist
            await fs.mkdir(path.dirname(item.move_to), { recursive: true });

            // Move the file
            fsExtra.moveSync(item.path, item.move_to, { overwrite: true });
            size = item.size ?? 0;
            success = true;
        } else if (item.hasOwnProperty('change_mode') && item.change_mode !== undefined) {
            // Change file permissions
            await fs.chmod(item.path, item.fsChmodValue);
            success = true;
            size = item.size ?? 0;
        } else if (item.hasOwnProperty('new_owner_id') && item.hasOwnProperty('new_group_id') && item.new_group_id !== undefined && item.new_owner_id !== undefined) {
            // Change ownership
            await fs.chown(item.path, item.new_owner_id, item.new_group_id);
            success = true;
        } else if (item.hasOwnProperty('action') && item.action !== undefined) {
            // Change file permissions
            const result = await item.action(item);
            success = result.success;
            size = result.sizeAffected ?? (item.size ?? 0);
        }
    } catch (error) {
        logger.fail(`Failed to execute operation on ${item.path}:`, error);
        console.error(error);
    }

    return {success, size};
}

/**
 * Executes pending file operations based on user confirmation.
 * @param {object[{}]} operations - List of operations to perform.
 * @returns {Promise<void>}
 */
async function executeOperationsOLD(operations) {
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
                const answer = await answerLoop(`Start ${operation} handling for ${operations[operation].length} items?`, ['y', 'n', 'c', 's'],
                  {
                      'y': async () => {
                          return true;
                      },
                      'n': async () => {
                          logger.warn(`Skipping ${operation} actions`);
                          return true;
                      },
                      'c': async () => {
                          logger.fail(`Cancelled all remaining actions`);
                          return true;
                      },
                      's': async () => {
                          console.log(operations[operation]);
                          return false;
                      }
                  });
                if (answer === 'c') {
                    proceed = false;
                    break;
                } else {
                    proceed = answer === 'y';
                }
            }

            if (proceed) {
                const actions = operations[operation];
                for (const item of actions) {
                    console.log(item);
                    if ((answers[operation] && answers[operation] === 'c')) {
                        logger.warn(`Not handling ${item.path} (User cancelled)`);
                        break;
                    } else {
                        logger.indent();
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


async function executeOperations(operations) {
    logger.succeed('Executing pending operations...');
    const answers = {};
    let yesAllActions = false;
    let sizeAffected = 0;

    for (const operation in operations) {
        if (!operations.hasOwnProperty(operation) || !operations[operation].length) continue;

        doHeader(`${chalk.blue('Operation:')} ${operation}`);
        let proceed = yesAllActions || await getProceedAnswer(operation, operations, answers);
        if (!proceed) continue;

        for (const item of operations[operation]) {
            const permissions = await canChangeOwnership(item.path);
            if (answers[operation] === 'c') {
                logger.warn(`Not handling ${item.path} (User cancelled)`);
                break;
            }

            let yesAllItems = answers[operation] === 'a' || yesAllActions;
            if (!yesAllItems) {
                console.log(`${chalk.green(item.stats.isFile() ? 'File:' : 'Directory:')} "${item.path}"`);
                if (!permissions) {
                    logger.warn(`Warning: current user has insufficient rights to modify this file, operation might fail!`);
                }
                answers[operation] = await userConfirm(
                  `Handle this ${item.stats.isFile() ? 'file' : 'directory'}?`,
                  ['y', 'a', 'n', 'c']
                );
            }

            if (['y', 'a'].includes(answers[operation]) || yesAllItems) {
                const result = await doOperation(item);
                if (result.success) sizeAffected += result.size ?? 0;
            } else if (['n', 'c'].includes(answers[operation])) {
                logger.warn(`Not handling "${item.path}" (${answers[operation]})`);
            }
        }
        logger.succeed(`All ${operation} actions done`);
    }

    doHeader();
    logger.succeed(`All actions done. ${sizeAffected} bytes saved.`);
}

async function getProceedAnswer(operation, operations, answers) {
    if (answers[operation] === 'c') {
        logger.fail(`Stop ${operation} actions`);
        return false;
    }

    console.log(`${chalk.green('Items:')} ${operations[operation].length}`);
    const answer = await answerLoop(
      `Start handling these items?`,
      ['y', 'n', 'c', 's'],
      {
          'y': async () => true,
          'n': async () => {
              logger.warn(`Skipping ${operation} actions`);
              return true;
          },
          'c': async () => {
              logger.fail(`Cancelled all remaining actions`);
              return true;
          },
          's': async () => {
              console.log(operations[operation]);
              return false;
          }
      }
    );

    return answer === 'y';
}

export default executeOperations;
