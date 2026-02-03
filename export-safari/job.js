const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();
// Define the path to the Safari history database
const historyDbPath = `${process.env.HOME}/Library/Safari/History.db`;

// Track whether it's the first run
let isFirstRun = true;

// Function to read SQLite databases
function readSqliteDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.warn(
          `Warning: Could not read SQLite database ${filePath}.`,
          err.message,
        );
        resolve(null);
        return;
      }

      db.all(
        "SELECT name FROM sqlite_master WHERE type='table'",
        (err, tables) => {
          if (err) {
            reject(err);
            return;
          }

          const data = {};
          let tablesProcessed = 0;

          tables.forEach((table) => {
            db.all(`SELECT * FROM ${table.name}`, (err, rows) => {
              if (err) {
                reject(err);
                return;
              }

              data[table.name] = rows;
              tablesProcessed++;

              if (tablesProcessed === tables.length) {
                db.close();
                resolve(data);
              }
            });
          });
        },
      );
    });
  });
}

// Function to convert CFAbsoluteTime (Apple timestamp) to Unix timestamp in milliseconds
function convertAppleTimeToUnixMillis(appleTime) {
  const appleEpoch = Date.UTC(2001, 0, 1, 0, 0, 0, 0); // January 1, 2001, 00:00:00 UTC in milliseconds
  return Math.round(appleEpoch + appleTime * 1000);
}

// Function to fetch Safari history and filter items based on the first run or last hour
async function fetchHistory(includeAllHistory) {
  const historyData = await readSqliteDatabase(historyDbPath);

  // Transform history_items into a mapped object { [id: string]: item }
  const historyItemsMap = {};
  if (historyData && historyData.history_items) {
    historyData.history_items.forEach((item) => {
      historyItemsMap[item.id] = item;
    });
  }

  // Prepare the data for JSON output
  const jsonData = [];

  // Enhance history_visits to include the URL and title from history_items and convert visit_time to Unix timestamp in milliseconds
  if (historyData && historyData.history_visits) {
    historyData.history_visits.forEach((visit) => {
      const historyItem = historyItemsMap[visit.history_item];
      if (historyItem) {
        jsonData.push({
          url: historyItem.url,
          visitedAt: convertAppleTimeToUnixMillis(visit.visit_time),
          nextVisitedAt: null, // Will be populated later
          title: visit.title || "",
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
    if (i > 0) {
      jsonData[i].nextVisitedAt = jsonData[i - 1]?.visitedAt;
      const duration = Math.floor(
        (jsonData[i].nextVisitedAt - jsonData[i].visitedAt) / 1000,
      );
      jsonData[i].duration = Math.min(duration, 300); // Cap duration at 300 seconds
    } else {
      jsonData[i].nextVisitedAt = null;
      jsonData[i].duration = null;
    }
  }

  // Filter items based on the first run or last hour
  if (!includeAllHistory) {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return jsonData.filter((item) => item.visitedAt >= oneHourAgo);
  }

  return jsonData; // Return all history on the first run
}

// Function to submit history data to the Cloudflare Worker endpoint
async function submitHistoryToEndpoint(history) {
  const domain = process.env.DOMAIN;
  if (!domain) {
    throw new Error("DOMAIN environment variable is not set.");
  }
  const dataString = JSON.stringify(history);
  console.log("going to submit", dataString.length);
  const response = await fetch(`${domain}/insert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: dataString,
  });

  if (!response.ok) {
    throw new Error(`Failed to submit history: ${await response.text()}`);
  }

  console.log("History submitted successfully:", await response.json());
}

// Main function to fetch and submit history
async function main() {
  try {
    console.log(
      isFirstRun
        ? "Fetching all history (first run)..."
        : "Fetching history from the last hour...",
    );
    const history = await fetchHistory(isFirstRun);
    console.log(`Found ${history.length} items to submit.`);

    if (history.length > 0) {
      await submitHistoryToEndpoint(history);
    } else {
      console.log("No new items to submit.");
    }

    // After the first run, set isFirstRun to false
    if (isFirstRun) {
      isFirstRun = false;
    }
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

// Run the main function and schedule it to run every hour
main().catch(console.error);
setInterval(main, 60 * 60 * 1000); // Run every hour
