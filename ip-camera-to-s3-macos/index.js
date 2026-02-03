const ffmpeg = require("fluent-ffmpeg");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Configuration
const config = {
  frameRate: 4,
  resolution: "640x480",
  tempDir: path.join(os.tmpdir(), "tapo-stream"),
  camera: {
    ip: "",
    port: 554,
    stream: "stream2", //lower quality stream. stream1 is high
    username: "",
    password: "",
  },
  r2: {
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    region: "",
  },
  recordingDuration: 60, // Duration of each segment in seconds
  outputFormat: "mp4",
};

// Initialize S3 client for R2
const s3Client = new S3Client({
  region: config.r2.region,
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

// Ensure temp directory exists
if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir, { recursive: true });
}

// Function to generate RTSP URL
function getRTSPUrl() {
  return `rtsp://${config.camera.username}:${config.camera.password}@${config.camera.ip}:${config.camera.port}/${config.camera.stream}`;
}

// Function to upload file to R2
async function uploadToR2(filePath, key) {
  try {
    const fileStream = fs.createReadStream(filePath);
    const fileStats = fs.statSync(filePath);

    const command = new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: fileStream,
      ContentType: "video/mp4",
      ContentLength: fileStats.size,
    });

    const response = await s3Client.send(command);
    console.log(`Successfully uploaded segment: ${key}`);

    // Clean up temporary file
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting temporary file:", err);
    });

    return response;
  } catch (error) {
    console.error("Error uploading to R2:", error);
    throw error;
  }
}

// Function to process RTSP stream
function processStream() {
  const rtspUrl = getRTSPUrl();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputKey = `tapo/${timestamp}.${config.outputFormat}`;
  const tempFilePath = path.join(
    config.tempDir,
    `${timestamp}.${config.outputFormat}`,
  );

  // Set up FFmpeg command
  ffmpeg(rtspUrl)
    .inputOptions([
      "-rtsp_transport tcp",
      "-re",
      "-hwaccel videotoolbox", // Enable hardware acceleration for input
    ])
    .outputOptions([
      "-c:v h264_videotoolbox", // Use Apple Silicon hardware encoding
      "-b:v 2000k",
      "-bufsize 2000k",
      "-crf 28", // Higher CRF value for smaller file size
      "-r",
      config.frameRate,
      "-s",
      config.resolution,
      "-movflags +faststart",
      "-t",
      config.recordingDuration,
      "-f",
      config.outputFormat,
      "-tune zerolatency",
      "-profile:v baseline",
      "-level 3.0",
      "-maxrate 1000k",
      "-bufsize 2000k",
    ])
    .on("start", () => {
      console.log("Started streaming from camera");
    })
    .on("end", () => {
      console.log("Finished recording segment");
      // Upload the completed segment
      uploadToR2(tempFilePath, outputKey)
        .then(() => {
          // Start the next segment
          setTimeout(processStream, 1000);
        })
        .catch((err) => {
          console.error("Error in upload process:", err);
          setTimeout(processStream, 5000);
        });
    })
    .on("error", (err) => {
      console.error("Error processing stream:", err);
      // Attempt to restart on error
      setTimeout(processStream, 5000);
    })
    .save(tempFilePath);
}

// Clean up any existing temporary files
function cleanupTempFiles() {
  fs.readdir(config.tempDir, (err, files) => {
    if (err) {
      console.error("Error reading temp directory:", err);
      return;
    }
    files.forEach((file) => {
      const filePath = path.join(config.tempDir, file);
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", filePath, err);
      });
    });
  });
}

// Start the process
async function main() {
  try {
    console.log("Starting RTSP to R2 upload service...");
    // Clean up any leftover temporary files
    cleanupTempFiles();
    // Start processing the stream
    processStream();
  } catch (error) {
    console.error("Error in main process:", error);
    process.exit(1);
  }
}

// Handle cleanup on exit
process.on("SIGINT", () => {
  console.log("Cleaning up and exiting...");
  cleanupTempFiles();
  process.exit();
});

main();
