# 🛠️ Easy File Maintenance
![Beta](https://img.shields.io/badge/status-beta-red)
![NodeJS Version](https://img.shields.io/badge/Node.js->%3D%2015.14.0-6DA55F?logo=node.js&logoColor=98F483&style=plastic)
![Synology](https://img.shields.io/badge/Made%20for-Synology%20DSM-4384F5.svg?labelColor=555&logo=synology&logoColor=white&style=plastic)

Easy File Maintenance is a Node.js project designed to help you manage and organize your files efficiently. It supports various actions such as cleanup, reorganization, duplicate detection, and more.

## Features

- **Pre-Cleanup**: Removes unwanted files & directories before processing.
  These can be empty files, or files you specifically configured to delete (i.e. using `removeFiles`)
- **Reorganize**: Organize files into a structured directory hierarchy based on extracted dates.
  Very useful for reorganizing photos. This uses a combination of EXIF data (if present) and other metadata to determine the 'oldest' date. You can specify a template for the directory structure in your config, inside `reorganizeTemplate`, which defaults to `/{year}/{month}/`
- **Duplicates**: Detect and handle duplicate files. 
  This works by grouping files by size, and then hashing the first 131072 bytes of each file to determine if they are identical. If files are found to be part of a file _set_ (i.e. a .JPG and a .AAE file, or an .MKV and a .NFO file, with the same filename), they are compared as sets.
- **Orphans**: Identify and manage orphaned files.
  Currently just finds files that are the only file inside a path.
- **Permissions**: Adjust file permissions. 
  Compares file/dir permissions to the configured file and dir permissions, and adjusts them accordingly.
- **Ownership**: Change file ownership. 
  Compares file/dir ownership to the configured owner user and group, and adjusts them accordingly.
- **Post-Cleanup**: Same is pre-cleanup, but post.

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
    recycleBinPath:    "/volume1/photos/#recycle",
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
    removeFiles:       [  //you can asterisks as a wildcard here
      "*.atf",
      "*.als",
      "*picasa.ini",
      "thumbs.db",
      "*SYNOFILE_*",
      "th__*"
    ],
    ignoreFiles:       [  //you can asterisks as a wildcard here
      "*.sh",
    ],
    ignoreDirectories: [  //you can asterisks as a wildcard here
      "@*",
    ]
  },
];
```
See the `defaults.mjs` file for more configuration options.

## Usage

Run the file maintenance tasks with the following command:

```sh
npm start
```
The script will then begin scanning the configured `scanPath` and ennumerate files and folders it finds inside, eventually detailing what can be processed.
Every defined action must be confirmed, and each individual file/directory operation inside these actions must be confirmed as well (there's an option to do a 'yes-to-all'). This is to provide maximum control, as the script may still wrongly assume duplicates, orphans, etc.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Acknowledgements

- [Node.js](https://nodejs.org/)
- [npm](https://www.npmjs.com/)
