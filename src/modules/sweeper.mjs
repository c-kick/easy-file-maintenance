/**
 * Moves empty files and directories to the specified recycle bin.
 * @param {object[]} items - Array of file details from the scanner.
 * @returns {Promise<Object[]>}
 */
async function sweeper(items) {
    return items
    .filter(item => (item.isEmpty || item.delete))
    .map(item => ({...item, reason: `${item.isEmpty ? 'is empty' : item.delete ? 'should always be deleted' : 'unknown'}`}));
}

export default sweeper;
