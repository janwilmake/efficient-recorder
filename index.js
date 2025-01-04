#!/usr/bin/env node

const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const AudioRecorder = require("node-audiorecorder");
const { program } = require("commander");
const { PassThrough } = require("stream");

// CLI configuration
program
  .requiredOption("--endpoint <endpoint>", "S3 endpoint")
  .requiredOption("--region <region>", "S3 region")
  .requiredOption("--key <key>", "AWS access key")
  .requiredOption("--secret <secret>", "AWS secret key")
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

class EfficientRecorder {
  constructor() {
    this.isRecording = false;
    this.currentStream = null;
    this.monitorStream = null;
    this.lowQualityRecorder = null;
    this.highQualityRecorder = null;
    this.silenceTimer = null;
    this.recordingChunks = []; // Buffer to store audio chunks
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
    this.startTime = Date.now();
    this.isRecording = true;
    this.recordingChunks = []; // Reset chunks array

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
      console.log("Upload completed successfully:", result.Key);

      // Clean up
      this.currentStream = null;
      this.recordingChunks = [];
    } catch (err) {
      console.error("Error completing upload:", err);
      throw err;
    }
  }
}

// Start the recorder
const recorder = new EfficientRecorder();
recorder.start();
