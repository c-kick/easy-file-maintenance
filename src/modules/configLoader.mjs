
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

// Merge user config into default config
const mergeConfigs = (defaults, user) => {
    const merged = { ...defaults, ...user };

    // Validate and default specific arrays
    merged.ignoreDirectories = Array.isArray(merged.ignoreDirectories) ? merged.ignoreDirectories : [];
    merged.ignoreFiles = Array.isArray(merged.ignoreFiles) ? merged.ignoreFiles : [];

    return merged;
};

const mergedConfig = mergeConfigs(defaultConfig, userConfig);

export default mergedConfig;
