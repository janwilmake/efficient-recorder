#!/usr/bin/env node

const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const AudioRecorder = require("node-audiorecorder");
const { program } = require("commander");
const { PassThrough } = require("stream");

// CLI configuration
program
  .requiredOption("--endpoint <endpoint>", "S3 endpoint")
  .requiredOption("--key <key>", "AWS access key")
  .requiredOption("--secret <secret>", "AWS secret key")
  .parse(process.argv);

const opts = program.opts();

// Initialize S3 client
const s3Client = new S3Client({
  endpoint: opts.endpoint,
  region: "WEUR",
  credentials: {
    accessKeyId: opts.key,
    secretAccessKey: opts.secret,
  },
  forcePathStyle: true,
});

class EfficientRecorder {
  constructor() {
    this.isRecording = false;
    this.currentStream = null;
    this.uploadStream = null;
    this.monitorStream = null;
    this.lowQualityRecorder = null;
    this.highQualityRecorder = null;
    this.silenceTimer = null;
    this.upload = null;
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
  }

  async start() {
    console.log("Starting efficient recorder...");
    this.startMonitoring();
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
    this.isRecording = true;

    // Create a new upload stream
    this.uploadStream = new PassThrough();
    const timestamp = new Date().toISOString().replace(/:/g, "-"); // Make filename safe
    const key = `recording-${timestamp}.wav`;

    // Create upload using Upload class from lib-storage
    this.upload = new Upload({
      client: s3Client,
      params: {
        Bucket: "recordings",
        Key: key,
        Body: this.uploadStream,
        ContentType: "audio/wav",
      },
      queueSize: 4,
      partSize: 1024 * 1024 * 5, // 5MB parts
    });

    // Start the upload but don't call .done() yet
    this.upload.on("httpUploadProgress", (progress) => {
      console.log(`Upload progress: ${progress.loaded} bytes`);
    });

    // Start high quality recording and get its stream
    this.highQualityRecorder.start();
    this.currentStream = this.highQualityRecorder.stream();

    // Pipe the recording stream to the upload stream
    this.currentStream.pipe(this.uploadStream);
  }

  async stopRecording() {
    if (!this.isRecording) return;

    console.log("Stopping recording...");
    this.isRecording = false;
    this.silenceTimer = null;

    if (this.currentStream) {
      this.currentStream.unpipe();
      this.highQualityRecorder.stop();
      this.currentStream = null;
    }

    if (this.uploadStream) {
      this.uploadStream.end();
      this.uploadStream = null;
    }

    if (this.upload) {
      try {
        // Now call .done() to complete the upload
        await this.upload.done();
        console.log("Upload completed successfully");
      } catch (err) {
        console.error("Error completing upload:", err);
      }
      this.upload = null;
    }
  }

  cleanup() {
    if (this.lowQualityRecorder) {
      this.lowQualityRecorder.stop();
    }
    if (this.highQualityRecorder) {
      this.highQualityRecorder.stop();
    }
  }
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\nGracefully shutting down...");
  if (recorder) {
    await recorder.stopRecording();
    recorder.cleanup();
  }
  process.exit(0);
});

// Start the recorder
const recorder = new EfficientRecorder();
recorder.start();
