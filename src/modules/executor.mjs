
/**
 * Executes pending file operations based on user confirmation.
 * @param {object[]} operations - List of operations to perform.
 * @param {function} confirm - Function to handle user confirmation (yes/no/all/skip/quit).
 * @returns {Promise<void>}
 */
async function executeOperations(operations, confirm) {
    for (const operation of operations) {
        const userChoice = await confirm(operation);
        if (userChoice === 'y' || userChoice === 'a') {
            await operation.action();
            if (userChoice === 'a') break; // Apply to all
        } else if (userChoice === 'q') {
            break; // Quit immediately
        }
    }
}

export default executeOperations;
