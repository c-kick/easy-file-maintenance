import fs from 'fs/promises';
import logger from "../utils/logger.mjs";

/**
 * Resolves user and group names from UID and GID.
 * @param {number} uid - User ID.
 * @param {number} gid - Group ID.
 * @returns {Promise<{user: string, group: string}>} - Object containing the resolved user and group names.
 */
async function resolveUserAndGroup(uid, gid) {
  let user = null;
  let group = null;

  try {
    const passwdFile = (await fs.readFile('/etc/passwd')).toString();
    user = passwdFile
    .split('\n')
    .find(line => line.split(':')[2] === uid.toString())
    ?.split(':')[0];

    const groupFile = (await fs.readFile('/etc/group')).toString();
    group = groupFile
    .split('\n')
    .find(line => line.split(':')[2] === gid.toString())
    ?.split(':')[0];
  } catch (error) {
    console.error('Error resolving user or group:', error.message);
  }

  return {user: user || `unknown (UID: ${uid})`, group: group || `unknown (GID: ${gid})`};
}

/**
 * Ensures file and directory ownership matches the specified user and group.
 * @param {object} items - Object containing both 'files' and 'directories' from the scanner.
 * @param {string} user - Desired owner username (e.g., 'admin').
 * @param {string} group - Desired owner group name (e.g., 'users').
 * @returns {Promise<object[]>} - Array of objects representing files/directories with incorrect ownership.
 */
async function getOwnershipFiles(items, user, group) {
  if (!user || !group) {
    throw new Error('Both user and group must be specified.');
  }

  const wrongOwnership = [];

  // Combine files and directories into a single Map
  const allEntries = new Map([...items.files, ...items.directories]);
  let progress = 0;

  // Resolve the expected user and group IDs
  const systemUser = (await fs.readFile('/etc/passwd'))
  .toString()
  .split('\n')
  .find(line => line.startsWith(`${user}:`))
  ?.split(':')[2];
  const systemGroup = (await fs.readFile('/etc/group'))
  .toString()
  .split('\n')
  .find(line => line.startsWith(`${group}:`))
  ?.split(':')[2];

  if (!systemUser || !systemGroup) {
    throw new Error(`User "${user}" or group "${group}" not found.`);
  }

  for (const [path, entry] of allEntries) {
    try {
      const stats = entry.stats ?? await fs.stat(entry.path);
      const uid = stats.uid;
      const gid = stats.gid;

      // Resolve current user and group names
      const {user: currentUser, group: currentGroup} = await resolveUserAndGroup(uid, gid);

      // Compare UID and GID
      if (uid.toString() !== systemUser || gid.toString() !== systemGroup) {
        wrongOwnership.push({
          ...entry,
          currentUid:    uid,
          currentGid:    gid,
          currentUser,
          currentGroup,
          expectedUser:  user,
          expectedGroup: group,
          expectedUid:   parseInt(systemUser, 10),
          expectedGid:   parseInt(systemGroup, 10),
        });
      }
      progress += 1; // Increment progress after processing
      logger.text(`Checking ownership... ${progress}/${allEntries.size}`);
    } catch (error) {
      console.error(`Failed to process entry ${entry.path}:`, error.message);
    }
  }

  return wrongOwnership;
}

export default getOwnershipFiles;
