/// <reference types="bun-types" />
import { Database } from "bun:sqlite";
import { writeFile } from "fs/promises";

// Define the path to the history database
const historyDbPath = `${process.env.HOME}/Library/Safari/History.db`;

// Function to read SQLite databases
function readSqliteDatabase(filePath: string): any {
  try {
    const db = new Database(filePath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    const data: { [key: string]: any } = {};

    tables.forEach((table: { name: string }) => {
      data[table.name] = db.prepare(`SELECT * FROM ${table.name}`).all();
    });

    db.close();
    return data;
  } catch (error) {
    console.warn(
      `Warning: Could not read SQLite database ${filePath}.`,
      error.message,
    );
    return null;
  }
}

// Function to write data to a JSON file
async function writeJsonFile(filePath: string, data: any): Promise<void> {
  try {
    await writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`Data written to ${filePath}`);
  } catch (error) {
    console.error(`Error writing to JSON file ${filePath}:`, error);
  }
}

// Function to convert CFAbsoluteTime (Apple timestamp) to Unix timestamp in milliseconds
function convertAppleTimeToUnixMillis(appleTime: number): number {
  const appleEpoch = Date.UTC(2001, 0, 1, 0, 0, 0, 0); // January 1, 2001, 00:00:00 UTC in milliseconds
  return Math.round(appleEpoch + appleTime * 1000);
}

// Main function to read the history database, transform the data, and write to a JSON file
async function main() {
  // Read the history database
  const historyData = readSqliteDatabase(historyDbPath);

  // Transform history_items into a mapped object { [id: string]: item }
  const historyItemsMap: { [id: string]: any } = {};
  if (historyData.history_items) {
    historyData.history_items.forEach((item: any) => {
      historyItemsMap[item.id] = item;
    });
  }

  // Enhance history_visits to include the URL from history_items and convert visit_time to Unix timestamp in milliseconds
  if (historyData.history_visits) {
    historyData.history_visits = historyData.history_visits.map(
      (visit: any) => {
        const historyItem = historyItemsMap[visit.history_item];
        return {
          ...visit,
          url: historyItem ? historyItem.url : null, // Add the URL from history_items
          visit_time: convertAppleTimeToUnixMillis(visit.visit_time), // Convert visit_time to Unix timestamp in milliseconds
        };
      },
    );
  }

  // Replace the original history_items with the mapped version
  historyData.history_items = historyItemsMap;

  // Log the transformed data structure to the console
  console.log(
    "Transformed History Data Structure:",
    Object.keys(historyData).map((key) => {
      const size = JSON.stringify(historyData[key]).length;
      const first = Array.isArray(historyData[key])
        ? historyData[key].slice(0, 3)
        : Object.keys(historyData[key])
            .slice(0, 3)
            .reduce((acc, k) => {
              acc[k] = historyData[key][k];
              return acc;
            }, {} as { [key: string]: any });
      return { key, first, size };
    }),
  );

  // Write the transformed data to a JSON file
  await writeJsonFile("data/history-formatted.json", historyData);
}

main().catch(console.error);
