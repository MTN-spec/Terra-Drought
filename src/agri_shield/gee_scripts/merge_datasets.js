const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rootDir = "c:\\Users\\MTN\\OneDrive\\Desktop\\MTN\\External Projects\\Privy  - Agricultural Drought\\Datasets - GEE\\Datasets";

const categories = {
    'NDVI': 'NDVI 2000 - 2025',
    'VCI': 'VCI 2000 - 2025',
    'TCI': 'TCI 2000 - 2025',
    'VHI': 'VHI 2000 - 2025',
    'SPI1': 'SPI 1 2000 - 2025',
    'SPI3': 'SPI 3 - 2000 - 2025'
};

async function readCsv(filePath, categoryName) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    let headers = [];
    const data = {};

    for await (const line of rl) {
        if (!line.trim()) continue;
        const columns = line.split(',');

        if (isHeader) {
            headers = columns;
            isHeader = false;
        } else {
            let rowDict = {};
            let dateVal = null;

            for (let i = 0; i < headers.length; i++) {
                const header = headers[i].trim();
                const val = columns[i].trim();

                if (header === 'Date') {
                    dateVal = val;
                } else if (header !== 'Year' && header !== 'Month' && header !== 'system:index' && header !== '.geo') {
                    rowDict[header] = val;
                }
            }
            if (dateVal) {
                data[dateVal] = rowDict;
            }
        }
    }
    return data;
}

async function mergeDatasets() {
    console.log("Starting dataset merge...");
    const masterData = {}; // Key: Date "YYYY-MM"
    const allExpectedHeaders = new Set();

    // Read all category folders
    for (const [catName, folderName] of Object.entries(categories)) {
        const folderPath = path.join(rootDir, folderName);
        if (fs.existsSync(folderPath)) {
            const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.csv'));
            if (files.length > 0) {
                const filePath = path.join(folderPath, files[0]);
                console.log(`Found ${catName}: ${files[0]}`);

                const catData = await readCsv(filePath, catName);

                for (const [date, rowData] of Object.entries(catData)) {
                    if (!masterData[date]) {
                        masterData[date] = {};
                    }
                    // Merge properties
                    for (const [key, val] of Object.entries(rowData)) {
                        masterData[date][key] = val;
                        allExpectedHeaders.add(key);
                    }
                }
            } else {
                console.log(`No CSV found for ${catName} in ${folderName}`);
            }
        } else {
            console.log(`Folder not found: ${folderPath}`);
        }
    }

    // Sort Dates chronologically
    const sortedDates = Object.keys(masterData).sort();

    if (sortedDates.length === 0) {
        console.log("No data found to merge.");
        return;
    }

    const headersArray = Array.from(allExpectedHeaders);
    const finalHeaders = ['Date', 'Year', 'Month', ...headersArray];

    let csvContent = finalHeaders.join(',') + '\n';

    for (const date of sortedDates) {
        const [year, month] = date.split('-');

        let row = [`"${date}"`, year, month];

        for (const col of headersArray) {
            const val = masterData[date][col];
            row.push(val !== undefined ? val : ''); // Empty string for missing values
        }

        csvContent += row.join(',') + '\n';
    }

    const outputPath = "c:\\Users\\MTN\\OneDrive\\Desktop\\MTN\\External Projects\\Privy  - Agricultural Drought\\Binga_Unified_ML_Database_2000_2025.csv";
    fs.writeFileSync(outputPath, csvContent);

    console.log(`\nSuccess! Consolidated ${sortedDates.length} months of data into a single master database.`);
    console.log(`Saved to: ${outputPath}`);
}

mergeDatasets().catch(console.error);
