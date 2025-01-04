const sqlite3 = require("sqlite3").verbose();
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const SAFARI_HISTORY_PATH = path.join(
  os.homedir(),
  "Library/Safari/History.db",
);
const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

async function getRecentHistory() {
  try {
    // Create a temporary copy of the database
    const tempDBPath = path.join(
      os.tmpdir(),
      `safari_history_temp_${Date.now()}.db`,
    );
    await fs.copyFile(SAFARI_HISTORY_PATH, tempDBPath);

    const db = new sqlite3.Database(tempDBPath);

    // Safari uses a different timestamp format (macOS time)
    // Convert our current timestamp to Safari's format
    const tenMinutesAgo = Date.now() / 1000 - 10 * 60;

    return new Promise((resolve, reject) => {
      // Let's first debug what timestamps look like
      db.all(
        `
                SELECT 
                    history_items.url,
                    history_visits.visit_time,
                    history_items.title
                FROM history_items 
                JOIN history_visits 
                ON history_items.id = history_visits.history_item
                ORDER BY history_visits.visit_time DESC
                LIMIT 5
            `,
        [],
        async (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          // Clean up temp file
          db.close(async () => {
            try {
              await fs.unlink(tempDBPath);
            } catch (e) {
              console.error("Error cleaning up temp file:", e);
            }

            const processedRows = rows.map((row) => ({
              url: row.url,
              title: row.title,
              visit_time: new Date(row.visit_time * 1000).toISOString(),
              raw_timestamp: row.visit_time, // Adding this for debugging
            }));

            resolve(processedRows);
          });
        },
      );
    });
  } catch (error) {
    throw new Error(`Failed to read Safari history: ${error.message}`);
  }
}

async function checkHistory() {
  try {
    console.log(`\nChecking history at ${new Date().toISOString()}`);
    const history = await getRecentHistory();

    if (history.length > 0) {
      console.log(`Found ${history.length} most recent entries:`);
      history.forEach((item) => {
        console.log(`${item.visit_time} - ${item.title || "No title"}`);
        console.log(`URL: ${item.url}`);
        console.log(`Raw timestamp: ${item.raw_timestamp}`);
        console.log("---");
      });

      // For debugging, let's also log the current timestamp
      console.log(`Current timestamp: ${Date.now() / 1000}`);
    } else {
      console.log("No history entries found");
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

async function main() {
  console.log("Starting Safari history monitor (DEBUG MODE)...");

  // Run immediately on start
  await checkHistory();

  // Then set up interval
  setInterval(checkHistory, CHECK_INTERVAL);
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  process.exit(0);
});

// Run the script
main().catch(console.error);
