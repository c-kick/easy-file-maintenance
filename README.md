# 🛠️ Easy File Maintenance
![Beta](https://img.shields.io/badge/status-beta-red)
![NodeJS Version](https://img.shields.io/badge/Node.js->%3D%2015.14.0-6DA55F?logo=node.js&logoColor=98F483&style=plastic)
![Synology](https://img.shields.io/badge/Made%20for-Synology%20DSM-4384F5.svg?labelColor=555&logo=synology&logoColor=white&style=plastic)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?logoColor=white&style=plastic)](https://github.com/c-kick/easy-file-maintenance/blob/main/LICENSE)

Easy File Maintenance is a Node.js project designed to (re)organize and declutter files on a server efficiently. It supports various actions such as cleanup, reorganization, duplicate detection, and more.

It was born out of a frustration with (non)existing tools that didn't quite meet the demand I had. I wanted a simple and efficient way to correct permissions, ownership, clean up empty files & directories, rename photos into new folder structures, remove unnecessary files, etc. Using my knowledge of NodeJS, and my own Synology fileserver as a testbed, I began building this do-it-all application. It might not be for you, but it works a treat on my system and helps me keep things organized and clean.

## Features

- **Pre-Cleanup**: Removes unwanted files & directories before processing.
  These can be empty files, or files you specifically configured to delete (i.e. using `removeFiles`)
- **Reorganize**: Organize files into a structured directory hierarchy based on extracted dates.
  Very useful for reorganizing photos. This uses a combination of EXIF data (if present) and other metadata to determine the 'oldest' date. You can specify a template for the directory structure in your config, inside `reorganizeTemplate`, which defaults to `/{year}/{month}/`
- **Duplicates**: Detect and handle duplicate files. 
  This works by grouping files by size, and then hashing the first 131072 bytes of each file to determine if they are identical. If files are found to be part of a file _set_ (i.e. a .JPG and a .AAE file, or an .MKV, an .SRT and a .NFO file, all with the same filename), they are compared as sets.
- **Orphans**: Identify and manage orphaned files.
  Currently just finds files that are the only file inside a path.
- **Permissions**: Adjust file permissions. 
  Compares file/dir permissions to the configured file and dir permissions, and adjusts them accordingly.
- **Ownership**: Change file ownership. 
  Compares file/dir ownership to the configured owner user and group, and adjusts them accordingly.
- **Post-Cleanup**: Same is pre-cleanup, but run at post, so any empty directories created by the pervious actions can be cleaned up.

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/yourusername/easy-file-maintenance.git
    ```
2. Navigate to the project directory:
    ```sh
    cd easy-file-maintenance
    ```
3. Install the dependencies:
    ```sh
    npm install
    ```

## Configuration

Edit the `config/user-config.mjs` file to set up your file maintenance tasks. Here is an example configuration (assuming a Synology-like folder setup):

```javascript
export default [
  {
    scanPath:          "/volume1/photos/photos-to-sort-out/",
    relativePath:      "/volume1/photos",
    recycleBinPath:    "/volume1/photos/#recycle", //this is the path where 'deleted' items will be moved to. This is a safe-guard; nothing is ever actually deleted.
    owner_user:        "Admin",
    owner_group:       "users",
    actions:           [
      "pre-cleanup",
      "reorganize",
      "duplicates",
      "orphans",
      "permissions",
      "ownership",
      "post-cleanup"
    ],
    removeFiles:       [
      "*.atf",  //note: you can use asterisks as wildcards (i.e. "*.atf" removes any file with the extension 'sh')
      "*.als",
      "*picasa.ini",
      "thumbs.db",
      "*SYNOFILE_*",
      "th__*"
    ],
    ignoreFiles:       [
      "*.sh",  //note: you can use asterisks as wildcards (i.e. "*.sh" ignores any file with the extension 'sh')
    ],
    ignoreDirectories: [
      "@*",  //note: you can use asterisks as wildcards (i.e. "@*" ignores any directory whos name starts with an '@')
    ],
    reorganizeTemplate:"/{year}/{month}/{day}/{filename}.{extension}",
    //note: if you do funny stuff to the filename, e.g. adding the 
    //day to it, it will keep adding the day to the filename on each run
    //so be careful with that. It cannot be prevented, as the filename 
    //*is* changing, so the move is not omitted.
  },
  //you can add another (or as many as you like, actually) configuration,
  //for a different path here. Useful if you want different
  //organizing/cleanup rules for different folders
];
```
See the `defaults.mjs` file for more configurable options.

## Usage

Run the file maintenance tasks with the following command:

```sh
npm start
```
- The script will then begin scanning the configured `scanPath` and ennumerate files and folders it finds inside, eventually detailing what can be processed.
- Every defined action must be confirmed, and each individual file/directory operation inside these actions must be confirmed as well (there's an option to do a 'yes-to-all'). This is to provide maximum control, as the script may still wrongly assume duplicates, orphans, etc.
- Also, nothing is ever _actually_ deleted, but moved to the configured `recycleBinPath`, retaining any directory structure (e.g. `/volume1/photo/my/path/to/file.jpg` will be moved to `/volume1/photo/#recycle/my/path/to/file.jpg`, when using the above example configuration).

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Acknowledgements

- [Node.js](https://nodejs.org/)
- [npm](https://www.npmjs.com/)
