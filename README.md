# Easy File Maintenance

Easy File Maintenance is a Node.js project designed to help you manage and organize your files efficiently. It supports various actions such as cleanup, reorganization, duplicate detection, and more.

## Features

- **Pre-Cleanup**: Removes unwanted files & directories before processing.
- **Reorganize**: Organize files into a structured directory hierarchy based on extracted dates.
- **Duplicates**: Detect and handle duplicate files.
- **Orphans**: Identify and manage orphaned files.
- **Permissions**: Adjust file permissions.
- **Ownership**: Change file ownership.
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
    removeFiles:       [
      "*.atf",
      "*.als",
      "*picasa.ini",
      "thumbs.db",
      "*SYNOFILE_*",
      "th__*"
    ],
    ignoreFiles:       [
      "*.sh",
    ],
    ignoreDirectories: [
      "@*",
    ]
  },
];
```

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
