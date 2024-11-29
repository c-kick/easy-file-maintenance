import logger from '../utils/logger.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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
    console.warn("No user-config.mjs file found. Proceeding with defaults only.");
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
        const { default: defaultValue, type, validate, required } = defaults[key];
        const userValue = user[key] !== undefined ? user[key] : defaultValue;

        // Type check
        if (user[key] === undefined && required) {
            logger.fail();
            console.error(`Error validating config: ${key} is a required setting!`);
            return false;
        }
        if (typeof userValue !== type) {
            const msg = `"${typeof userValue}" is an invalid type for "${key}". Expected "${type}".`;
            if ((typeof defaultValue === type)) {
                console.warn(`${msg} Falling back to default: `, defaultValue);
                merged[key] = defaultValue;
            } else {
                logger.fail();
                console.error(`Error validating config: ${msg} Default value ("${defaultValue}") is also invalid, or missing!`);
                return false;
            }
        } else if (validate && !validate(userValue)) {
            const msg = `"${userValue}" is invalid for "${key}".`;
            // Validation check
            if (validate(defaultValue)) {
                console.warn(`${msg} Falling back to default: `, defaultValue);
                merged[key] = defaultValue;
            } else {
                logger.fail();
                console.error(`Error validating config: ${msg} Default value (${defaultValue}) also invalid, or missing!`);
                return false;
            }
        } else {
            merged[key] = userValue;
        }
    }
    logger.succeed('Validated configuration.');

    return merged;
};

const mergedConfig = validateAndMergeConfigs(defaultConfig, userConfig);

export default mergedConfig;
