/// <reference types="bun-types" />
import { Database } from "bun:sqlite";

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

// Function to convert CFAbsoluteTime (Apple timestamp) to Unix timestamp in milliseconds
function convertAppleTimeToUnixMillis(appleTime: number): number {
  const appleEpoch = Date.UTC(2001, 0, 1, 0, 0, 0, 0); // January 1, 2001, 00:00:00 UTC in milliseconds
  return Math.round(appleEpoch + appleTime * 1000);
}

// Main function to read the history database, transform the data, and return a JSON object
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

  // Prepare the data for JSON output
  const jsonData: {
    url: string;
    visitedAt: number;
    nextVisitedAt: number | null;
    title: string;
    datetime: string;
    duration: number | null;
  }[] = [];

  // Enhance history_visits to include the URL and title from history_items and convert visit_time to Unix timestamp in milliseconds
  if (historyData.history_visits) {
    historyData.history_visits.forEach((visit: any) => {
      const historyItem = historyItemsMap[visit.history_item];
      if (historyItem) {
        jsonData.push({
          url: historyItem.url,
          visitedAt: convertAppleTimeToUnixMillis(visit.visit_time),
          nextVisitedAt: null, // Will be populated later
          title: historyItem.title || "",
          datetime: new Date(
            convertAppleTimeToUnixMillis(visit.visit_time),
          ).toISOString(),
          duration: null, // Will be populated later
        });
      }
    });
  }

  // Sort the data by visitedAt in reverse chronological order
  jsonData.sort((a, b) => b.visitedAt - a.visitedAt);

  // Calculate nextVisitedAt and duration
  for (let i = 0; i < jsonData.length; i++) {
    if (i < jsonData.length - 1) {
      jsonData[i].nextVisitedAt = jsonData[i + 1].visitedAt;
      const duration = Math.floor(
        (jsonData[i].visitedAt - jsonData[i].nextVisitedAt) / 1000,
      );
      jsonData[i].duration = Math.min(duration, 300); // Cap duration at 300 seconds
    } else {
      jsonData[i].nextVisitedAt = null;
      jsonData[i].duration = null;
    }
  }

  // Return the JSON data
  return jsonData;
}

// Run the main function and log the result
main()
  .then((result) => {
    console.log(JSON.stringify(result.slice(0, 100), null, 2));
  })
  .catch(console.error);
