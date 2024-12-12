import {normalizePath} from "../src/utils/helpers.mjs";

export default {
  owner_user: {
    type:    "string",
    required: 'permissions'
  },
  owner_group: {
    type:    "string",
    required: 'permissions'
  },
  filePerm: {
    default: '664', //664 allows owner & group to read and modify, but unauthorized users only read.
    type:    "string",
  },
  dirPerm: {
    default: '775', //775 allows owner & group to read, modify, traverse, but unauthorized users only read.
    type:    "string",
  },
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
    default: 131072,
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
      "ownership",
      //"cleanup",
      "post-cleanup"
    ],
    type:    "object",
    required: true,
  },
  dupeSetExtensions: {
    default: ['jpg', 'jpeg', 'mp4', 'avi'],
    type:    "object",
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
      //...Array.from({ length: 2024 - 2000 + 1 }, (_, i) => (2000 + i).toString()) //example that ignores all directories named /2000 up to /2024.
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

