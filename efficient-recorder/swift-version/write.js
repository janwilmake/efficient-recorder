#!/usr/bin/env node
const fs = require("fs").promises;
const path = require("path");

function parseMarkdownFile(markdownContent) {
  const codeBlockRegex = /```(?:\w*)\n([\s\S]*?)```/g;
  const result = { files: {} };

  let match;
  while ((match = codeBlockRegex.exec(markdownContent)) !== null) {
    const codeBlock = match[1];
    const lines = codeBlock.trim().split("\n");

    if (lines[0].startsWith("// ")) {
      const path = lines[0].slice(3).trim();
      const content = lines.slice(1).join("\n");
      result.files[path] = { content };
    }
  }

  return result;
}

async function createDirectories(filePath) {
  const dirname = path.dirname(filePath);
  try {
    await fs.access(dirname);
  } catch {
    await fs.mkdir(dirname, { recursive: true });
  }
}

async function writeFiles(markdownContent, outputDir = "./output") {
  try {
    const parsed = parseMarkdownFile(markdownContent);
    await createDirectories(outputDir);

    const results = [];
    for (const [filePath, { content }] of Object.entries(parsed.files)) {
      const fullPath = path.join(outputDir, filePath);
      await createDirectories(fullPath);
      await fs.writeFile(fullPath, content);
      results.push(`Created file: ${fullPath}`);
    }

    return results;
  } catch (error) {
    throw new Error(`Error writing files: ${error.message}`);
  }
}

async function main() {
  const [, , inputFile] = process.argv;

  if (!inputFile) {
    console.error("Usage: node script.js <markdown-file>");
    process.exit(1);
  }

  try {
    const markdownContent = await fs.readFile(inputFile, "utf-8");
    const results = await writeFiles(markdownContent);
    results.forEach((result) => console.log(result));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
