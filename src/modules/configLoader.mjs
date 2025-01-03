import logger from '../utils/logger.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

// Dynamically load the user and default configurations
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to configuration files
const userConfigPath = path.resolve(__dirname, '../../config/user-config.mjs');
const defaultConfigPath = path.resolve(__dirname, '../../config/defaults.mjs');

// Load user and default configs
let userConfig = {};
let defaultConfig = {};

try {
    userConfig = (await import(userConfigPath)).default;
} catch (e) {
    console.error("No user-config.mjs file found, or file invalid!");
    process.exit(1);
} finally {
    // Ensure userConfig is an array
    if (!Array.isArray(userConfig)) {
        console.error("user-config.mjs must export an array of configuration objects!");
        process.exit(1);
    }
}


try {
    defaultConfig = (await import(defaultConfigPath)).default;
} catch (e) {
    console.error("Failed to load defaults.mjs. Ensure the default configuration exists.");
    throw e;
}

// Validate and merge user config into default config
const validateAndMergeConfigs = (defaults, user) => {
    logger.start('Validate configuration...');
    const merged = {};

    for (const key in defaults) {
        const { default: defaultValue, type, validate } = defaults[key];
        const userValue = user[key] !== undefined ? user[key] : defaultValue;
        let required = defaults[key].required;
        let forAction = '';

        if (typeof required === 'string') {
            //if required is specified as dependent on an action, check if that action has been requested to eval required
            forAction = required;
            required = user['actions'].includes(required);
        }
        const emptyButNotReq = (typeof userValue == "undefined") && !required;

        // Type check
        if (user[key] === undefined && required) {
            logger.fail(`Error validating config: '${key}' is a required setting${forAction ? ` for action '${forAction}'` : ''}!`);
            return false;
        }

        if (typeof userValue !== type && !emptyButNotReq) {
            const msg = `"${typeof userValue}" is an invalid type for "${key}". Expected "${type}".`;
            if ((typeof defaultValue === type)) {
                console.warn(`${msg} Falling back to default: `, defaultValue);
                merged[key] = defaultValue;
            } else {
                logger.fail(`Error validating config: ${msg} Default value ("${defaultValue}") is also invalid, or missing!`);
                return false;
            }
        } else if (validate && !validate(userValue) && !emptyButNotReq) {
            const msg = `"${userValue}" for "${key}" failed validation.`;
            // Validation check
            if (validate(defaultValue)) {
                logger.warn(`${msg} Falling back to default:`);
                logger.warn(defaultValue);
                merged[key] = defaultValue;
            } else {
                logger.fail(`Error validating config: ${msg} Default value (${defaultValue}) also invalid, or missing!`);
                return false;
            }
        } else if (!emptyButNotReq) {
            merged[key] = userValue;
        }
    }

    return merged;
};
// Iterate and validate each configuration entry
let handledCount = 0;
const mergedConfigs = userConfig.map(userConfigEntry => {
    const validatedConfig = validateAndMergeConfigs(defaultConfig, userConfigEntry);
    handledCount++;
    logger.succeed(`Validated configuration (${handledCount}/${userConfig.length}).`);
    return validatedConfig;
});

export default mergedConfigs;
