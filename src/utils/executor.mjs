import logger from '../utils/logger.mjs';
import {userConfirm} from "./helpers.mjs";
/**
 * Executes pending file operations based on user confirmation.
 * @param {object[]} operations - List of operations to perform.
 * @returns {Promise<void>}
 */
async function executeOperations(operations) {
    const answers = {};
    for (const operation in operations) {
        if (operations.hasOwnProperty(operation)) {

            let proceed = false;
            if (answers[operation] && answers[operation] === 'a') {
                console.log(`Continue ${operation} actions without asking.`);
            } else if (answers[operation] && answers[operation] === 'c') {
                console.log(`Stop ${operation} actions`);
            } else {
                answers[operation] = await userConfirm(`Continue handling ${operation} actions?`);
                proceed = ['y','a'].includes(answers[operation]);
                if (!proceed && ['n', 'c'].includes(answers[operation])) {
                    console.log(`Skipping ${operation} actions`);
                }
            }

            if (proceed) {
                const actions = operations[operation];
                console.log(`Proceed with ${operation} actions`);
                for (const item of actions) {
                    if ((answers[operation] && answers[operation] === 'c')) {
                        console.warn(`Not handling ${item.name} (${answers[operation]})`);
                    } else {
                        let proceedAll = (answers[operation] && answers[operation] === 'a');
                        if (!proceedAll) {
                            answers[operation] = await userConfirm(`Continue handling ${item.name}?`);
                        }
                        if (['y','a'].includes(answers[operation]) || proceedAll) {
                            console.log(`Handling ${item.name}`);
                        } else if (['n', 'c'].includes(answers[operation])) {
                            console.warn(`Not handling ${item.name} (${answers[operation]})`);
                        }
                    }
                }
            }

        }
    }
}

export default executeOperations;
