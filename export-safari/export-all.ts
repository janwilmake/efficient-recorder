// script to see all kind of data your safari stores and export it as JSON.
// good for experimentation of new features

/// <reference types="bun-types" />
import { Database } from "bun:sqlite";
import { readFile, writeFile } from "fs/promises";
import { parseBuffer } from "bplist-parser";

// Define the paths to the files
const paths = {
  bookmarks: `${process.env.HOME}/Library/Safari/Bookmarks.plist`,
  history: `${process.env.HOME}/Library/Safari/History.db`,
  readingList: `${process.env.HOME}/Library/Safari/ReadingListArchives`,
  topSites: `${process.env.HOME}/Library/Safari/TopSites.plist`,
  autoFillCorrections: `${process.env.HOME}/Library/Safari/AutoFillCorrections.db`,
  cloudAutoFillCorrections: `${process.env.HOME}/Library/Safari/CloudAutoFillCorrections.db`,
  formValues: `${process.env.HOME}/Library/Safari/Form Values`,
};

// Function to read and parse plist files (supports binary and XML)
async function readPlistFile(filePath: string): Promise<any> {
  try {
    const fileContent = await readFile(filePath);
    return parseBuffer(fileContent);
  } catch (error) {
    console.warn(
      `Warning: Could not read plist file ${filePath}.`,
      error.message,
    );
    return null;
  }
}

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

// Function to read directory contents
async function readDirectory(directoryPath: string): Promise<any> {
  try {
    const files = await Bun.$`ls ${directoryPath}`.text();
    return files.split("\n").filter(Boolean);
  } catch (error) {
    console.warn(
      `Warning: Could not read directory ${directoryPath}.`,
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

// Main function to read all files and write to individual JSON files
async function main() {
  // Read and write each file to a separate JSON file
  const bookmarksData = await readPlistFile(paths.bookmarks);
  await writeJsonFile("data/bookmarks.json", bookmarksData);

  const historyData = readSqliteDatabase(paths.history);
  await writeJsonFile("data/history.json", historyData);

  const readingListData = await readDirectory(paths.readingList);
  await writeJsonFile("data/readingList.json", readingListData);

  const topSitesData = await readPlistFile(paths.topSites);
  await writeJsonFile("data/topSites.json", topSitesData);

  const autoFillCorrectionsData = readSqliteDatabase(paths.autoFillCorrections);
  await writeJsonFile("data/autoFillCorrections.json", autoFillCorrectionsData);

  const cloudAutoFillCorrectionsData = readSqliteDatabase(
    paths.cloudAutoFillCorrections,
  );
  await writeJsonFile(
    "data/cloudAutoFillCorrections.json",
    cloudAutoFillCorrectionsData,
  );

  const formValuesData = await readDirectory(paths.formValues);
  await writeJsonFile("data/formValues.json", formValuesData);
}

main().catch(console.error);
