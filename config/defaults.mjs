
export default {
    scanPath: "/path/to/scan", // The path to scan
    relativePath: "", // For reorganizing. Defaults to scanpath if not set
    recycleBinPath: "/path/to/recycle-bin", // Path for moved files
    reorganizeTemplate: "/{year}/{month}/",
    dateThreshold: "",
    hashByteLimit: 2048, // Number of bytes to hash for duplicates
    debugLevel: "info", // Debug level: log, info, warn, error
    orphanFileExtensions: [".aae", ".xml", ".ini"], // Extensions to consider for orphans
    actions: ["duplicates", "orphans", "permissions"], // Tests to run

    // Directories to ignore
    ignoreDirectories: [
        "@eaDir",  // Example: Exact match
        "@*"       // Example: Wildcard match (e.g., "@eaDir", "@something")
    ],

    // Files to ignore
    ignoreFiles: [
        //"Thumbs.db", // Example: Exact match
        "*.ini"      // Example: Wildcard match (e.g., "config.ini", "setup.ini")
    ],

    // Files to always remove. Note: this will bypass anything defined in ignoreFiles!
    removeFiles: [
        "*picasa.ini", // Example: Exact match
        "Thumbs.db",
        //"*.ini"      // Example: Wildcard match (e.g., "config.ini", "setup.ini")
    ]
};
