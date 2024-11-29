import {normalizePath} from "../src/utils/helpers.mjs";

export default {
  scanPath:             {
    default: "/path/to/scan",
    type:    "string",
    validate: normalizePath,
    required: true,
  },
  relativePath:         {
    default: "",
    type:    "string",
    validate: normalizePath,
  },
  recycleBinPath:       {
    default: "/path/to/recycle-bin",
    type:    "string",
    validate: normalizePath,
    required: true,
  },
  reorganizeTemplate:   {
    default:  "/{year}/{month}/",
    type:     "string",
    validate: (value) => /^\/(?:\{(year|month|day)\}\/?)+$/.test(value),
  },
  hashByteLimit:        {
    default: 2048,
    type:    "number",
  },
  debugLevel:           {
    default:  "info",
    type:     "string",
    validate: (value) => ["log", "info", "warn", "error"].includes(value),
  },
  actions:              {
    default: [
      "reorganize",
      "duplicates",
      "orphans",
      "permissions",
      "cleanup"
    ],
    type:    "object",
    required: true,
  },
  orphanFileExtensions: {
    default: [".aae", ".xml", ".ini"],
    type:    "object",
  },

  dateThreshold: {
    default: "",
    type:    "string",
  },

  // Directories to ignore
  ignoreDirectories: {
    default: [
      "@eaDir",  // Example: Exact match
      "@*"       // Example: Wildcard match (e.g., "@eaDir", "@something")
    ],
    type:    "object",
  },

  // Files to ignore
  ignoreFiles: {
    default: [
      //"Thumbs.db", // Example: Exact match
      "*.ini"      // Example: Wildcard match (e.g., "config.ini", "setup.ini")
    ],
    type:    "object",
  },

  // Files to always remove. Note: this will bypass anything defined in ignoreFiles!
  removeFiles: {
    default: [
      "*picasa.ini", // Example: Exact match
      "Thumbs.db",
      //"*.ini"      // Example: Wildcard match (e.g., "config.ini", "setup.ini")
    ],
    type:    "object",
  }
};

