#!/usr/bin/env node

const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const AudioRecorder = require("node-audiorecorder");
const screenshot = require("screenshot-desktop");
const NodeWebcam = require("node-webcam");
const { program } = require("commander");
const { PassThrough } = require("stream");

// CLI configuration
program
  .requiredOption("--endpoint <endpoint>", "S3 endpoint")
  .requiredOption("--region <region>", "S3 region")
  .requiredOption("--key <key>", "AWS access key")
  .requiredOption("--secret <secret>", "AWS secret key")
  .option(
    "--screenshot-interval <interval>",
    "Screenshot interval in ms",
    "1000",
  )
  .option(
    "--webcam-interval <interval>",
    "Webcam capture interval in ms",
    "1000",
  )
  .option("--enable-screenshot", "Enable screenshot capture", false)
  .option("--enable-webcam", "Enable webcam capture", false)
  .option("--webcam-device <device>", "Webcam device name")
  .option("--image-quality <quality>", "Image quality (1-100)", "80")
  .parse(process.argv);

const opts = program.opts();

// Initialize S3 client
const s3Client = new S3Client({
  endpoint: opts.endpoint,
  region: opts.region,
  credentials: {
    accessKeyId: opts.key,
    secretAccessKey: opts.secret,
  },
  forcePathStyle: true,
});

// Initialize webcam
const webcamOptions = {
  width: 1280,
  height: 720,
  quality: parseInt(opts.imageQuality),
  delay: 0,
  saveShots: false,
  output: "buffer",
  device: opts.webcamDevice,
  callbackReturn: "buffer",
  verbose: false,
};

class EfficientRecorder {
  constructor() {
    this.isRecording = false;
    this.currentStream = null;
    this.monitorStream = null;
    this.lowQualityRecorder = null;
    this.highQualityRecorder = null;
    this.silenceTimer = null;
    this.recordingChunks = [];
    this.screenshotInterval = null;
    this.webcamInterval = null;
    this.webcam = null;
    this.uploadQueue = [];
    this.isUploading = false;
    this.setupRecorders();
  }

  setupRecorders() {
    // Low quality recorder for detection (8kHz)
    this.lowQualityRecorder = new AudioRecorder(
      {
        program: "rec",
        rate: 8000,
        channels: 1,
        silence: 0,
        thresholdStart: 0.5,
        thresholdStop: 0.5,
        keepSilence: true,
      },
      console,
    );

    // High quality recorder for actual recording (44.1kHz)
    this.highQualityRecorder = new AudioRecorder(
      {
        program: "rec",
        rate: 44100,
        channels: 2,
        silence: 0,
        thresholdStart: 0,
        thresholdStop: 0,
        keepSilence: true,
      },
      console,
    );

    // Setup webcam if enabled
    if (opts.enableWebcam) {
      this.webcam = NodeWebcam.create(webcamOptions);
      // Promisify the capture method
      this.captureWebcam = () => {
        return new Promise((resolve, reject) => {
          this.webcam.capture("", (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
      };
    }
  }

  async start() {
    console.log("Starting efficient recorder...");
    this.startMonitoring();

    if (opts.enableScreenshot) {
      this.startScreenshotCapture();
    }

    if (opts.enableWebcam) {
      this.startWebcamCapture();
    }

    // Start the upload processor
    this.processUploadQueue();
  }

  startWebcamCapture() {
    const interval = parseInt(opts.webcamInterval);
    console.log(`Starting webcam capture with interval: ${interval}ms`);

    this.webcamInterval = setInterval(async () => {
      try {
        const imageBuffer = await this.captureWebcam();
        this.queueUpload(imageBuffer, "webcam");
      } catch (error) {
        console.error("Error capturing webcam:", error);
      }
    }, interval);
  }

  startScreenshotCapture() {
    const interval = parseInt(opts.screenshotInterval);
    console.log(`Starting screenshot capture with interval: ${interval}ms`);

    this.screenshotInterval = setInterval(async () => {
      try {
        const screenshotBuffer = await screenshot({ format: "png" });
        this.queueUpload(screenshotBuffer, "screenshot");
      } catch (error) {
        console.error("Error capturing screenshot:", error);
      }
    }, interval);
  }

  queueUpload(buffer, type) {
    this.uploadQueue.push({
      buffer,
      type,
      timestamp: new Date().toISOString(),
    });
  }

  async processUploadQueue() {
    while (true) {
      if (this.uploadQueue.length > 0 && !this.isUploading) {
        this.isUploading = true;
        const item = this.uploadQueue.shift();
        try {
          await this.uploadImage(item.buffer, item.type, item.timestamp);
        } catch (error) {
          console.error(`Error processing upload for ${item.type}:`, error);
        }
        this.isUploading = false;
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay to prevent CPU hogging
    }
  }

  async uploadImage(buffer, type, timestamp) {
    try {
      const key = `${type}-${timestamp}.png`;

      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: "recordings",
          Key: key,
          Body: buffer,
          ContentType: type === "webcam" ? "image/jpeg" : "image/png",
        },
        queueSize: 4,
        partSize: 1024 * 1024 * 5, // 5MB parts
      });

      const result = await upload.done();
      console.log(`${type} upload completed:`, result.Key);
    } catch (error) {
      console.error(`Error uploading ${type}:`, error);
    }
  }

  startMonitoring() {
    // Start the low quality recorder and get its stream
    this.lowQualityRecorder.start();
    this.monitorStream = this.lowQualityRecorder.stream();

    // Process the monitor stream
    this.monitorStream.on("data", (chunk) => {
      // Convert Buffer to Int16Array for proper audio sample reading
      const samples = new Int16Array(chunk.buffer);

      // Calculate RMS of the audio buffer to estimate dB level
      const rms = Math.sqrt(
        Array.from(samples).reduce((sum, value) => sum + value * value, 0) /
          samples.length,
      );
      const db = 20 * Math.log10(rms);

      if (db > 50 && !this.isRecording) {
        this.startRecording();
      } else if (db <= 50 && this.isRecording) {
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this.stopRecording();
          }, 2000);
        }
      } else if (db > 50 && this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    });

    this.monitorStream.on("error", (error) => {
      console.error("Error in monitoring stream:", error);
    });
  }

  startRecording() {
    if (this.isRecording) return;

    console.log("Starting high-quality recording...");
    this.startTime = Date.now();
    this.isRecording = true;
    this.recordingChunks = [];

    // Start high quality recording and get its stream
    this.highQualityRecorder.start();
    this.currentStream = this.highQualityRecorder.stream();

    // Collect chunks of audio data
    this.currentStream.on("data", (chunk) => {
      this.recordingChunks.push(chunk);
    });

    // Handle any errors in the recording stream
    this.currentStream.on("error", (err) => {
      console.error("Error in recording stream:", err);
    });
  }

  async stopRecording() {
    if (!this.isRecording) return;

    const duration = (Date.now() - this.startTime) / 1000;
    console.log("Stopping recording... Duration:", duration, "seconds");

    this.isRecording = false;
    this.silenceTimer = null;

    // Stop the recorder
    this.highQualityRecorder.stop();

    // Wait a bit for any final chunks
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      // Combine all chunks into a single buffer
      const completeBuffer = Buffer.concat(this.recordingChunks);
      console.log(`Total recording size: ${completeBuffer.length} bytes`);

      // Create and start the upload
      const timestamp = new Date().toISOString();
      const key = `recording-${timestamp}.wav`;

      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: "recordings",
          Key: key,
          Body: completeBuffer,
          ContentType: "audio/wav",
        },
        queueSize: 4,
        partSize: 1024 * 1024 * 5, // 5MB parts
      });

      const result = await upload.done();
      console.log("Audio upload completed successfully:", result.Key);

      // Clean up
      this.currentStream = null;
      this.recordingChunks = [];
    } catch (err) {
      console.error("Error completing audio upload:", err);
      throw err;
    }
  }

  async cleanup() {
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval);
    }
    if (this.webcamInterval) {
      clearInterval(this.webcamInterval);
      if (this.webcam) {
        this.webcam.clear();
      }
    }
    if (this.isRecording) {
      await this.stopRecording();
    }
    if (this.lowQualityRecorder) {
      this.lowQualityRecorder.stop();
    }

    // Wait for any pending uploads to complete
    while (this.uploadQueue.length > 0 || this.isUploading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// Start the recorder
const recorder = new EfficientRecorder();
recorder.start();

// Handle cleanup on exit
process.on("SIGINT", async () => {
  console.log("Cleaning up...");
  await recorder.cleanup();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  await recorder.cleanup();
  process.exit(1);
});

process.on("unhandledRejection", async (error) => {
  console.error("Unhandled rejection:", error);
  await recorder.cleanup();
  process.exit(1);
});
