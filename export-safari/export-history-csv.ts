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

// Function to escape a CSV field
function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    // Escape double quotes by doubling them
    field = field.replace(/"/g, '""');
    // Wrap the field in double quotes
    field = `"${field}"`;
  }
  return field;
}

// Function to write data to a CSV file
async function writeCsvFile(filePath: string, data: any[]): Promise<void> {
  try {
    const csvContent = data
      .map((row) => {
        const escapedTitle = escapeCsvField(row.title);
        const escapedUrl = escapeCsvField(row.url);
        return `${row.visitedAt},${escapedTitle},${escapedUrl}`;
      })
      .join("\n");

    const csvHeader = "visitedAt,title,url\n";
    await writeFile(filePath, csvHeader + csvContent);
    console.log(`Data written to ${filePath}`);
  } catch (error) {
    console.error(`Error writing to CSV file ${filePath}:`, error);
  }
}

// Function to convert CFAbsoluteTime (Apple timestamp) to Unix timestamp in milliseconds
function convertAppleTimeToUnixMillis(appleTime: number): number {
  const appleEpoch = Date.UTC(2001, 0, 1, 0, 0, 0, 0); // January 1, 2001, 00:00:00 UTC in milliseconds
  return Math.round(appleEpoch + appleTime * 1000);
}

// Main function to read the history database, transform the data, and write to a CSV file
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

  // Prepare the data for CSV output
  const csvData: { visitedAt: number; title: string; url: string }[] = [];

  // Enhance history_visits to include the URL and title from history_items and convert visit_time to Unix timestamp in milliseconds
  if (historyData.history_visits) {
    historyData.history_visits.forEach((visit: any) => {
      const historyItem = historyItemsMap[visit.history_item];
      if (historyItem) {
        csvData.push({
          visitedAt: convertAppleTimeToUnixMillis(visit.visit_time),
          title: visit.title || "",
          url: historyItem.url,
        });
      }
    });
  }

  // Write the transformed data to a CSV file
  await writeCsvFile("data/history.csv", csvData);
}

main().catch(console.error);
