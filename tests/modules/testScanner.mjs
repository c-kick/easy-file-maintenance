
import scanDirectory from '../../src/modules/scanner.mjs';

const testConfig = {
    ignorePaths: ['/path/to/ignore']
};

(async () => {
    try {
        const results = await scanDirectory('/mnt/data', testConfig);
        console.log("Scan Results:", results);
    } catch (error) {
        console.error("Error during scanning:", error);
    }
})();
