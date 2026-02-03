#!/usr/bin/env node

const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const AudioRecorder = require("node-audiorecorder");
const { program } = require("commander");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

// CLI configuration
program
  .requiredOption("--endpoint <endpoint>", "S3 endpoint")
  .requiredOption("--region <region>", "S3 region")
  .requiredOption("--key <key>", "AWS access key")
  .requiredOption("--secret <secret>", "AWS secret key")
  .option("--temp-dir <dir>", "Temporary directory for recordings", "/tmp")
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

class VoiceActivatedRecorder {
  constructor() {
    this.isRecording = false;
    this.recordingStartTime = null;
    this.silenceTimer = null;
    this.maxDurationTimer = null; // New timer for max duration
    this.audioRecorder = null;
    this.screenFFmpeg = null;
    this.webcamFFmpeg = null;
    this.currentRecordingPath = null;
    this.deviceIndexes = null;
    this.MAX_DURATION = 600000; // 10 minutes in milliseconds
  }

  async setupRecorder() {
    // Get available capture devices
    await this.detectDevices();

    // Audio recorder for detection
    this.audioRecorder = new AudioRecorder(
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

  async detectDevices() {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-f",
        "avfoundation",
        "-list_devices",
        "true",
        "-i",
        "",
      ]);

      let deviceOutput = "";
      ffmpeg.stderr.on("data", (data) => {
        deviceOutput += data.toString();
      });

      ffmpeg.on("close", (code) => {
        console.log("Raw device list:", deviceOutput);

        // Split into video and audio devices sections
        const sections = deviceOutput.split("AVFoundation video devices:");
        if (sections.length > 1) {
          const videoSection = sections[1].split(
            "AVFoundation audio devices:",
          )[0];

          // Find webcam and screen capture devices
          const devices = videoSection.match(/\[\d+\]\s+([^\n]+)/g);

          if (devices) {
            // Log found devices
            console.log("Found video devices:", devices);

            // Usually, FaceTime HD Camera or similar is webcam (0)
            // Capture screen is usually "Capture screen" (1)
            this.deviceIndexes = {
              webcam: "0", // Default to first video device
              screen: "1", // Default to second video device
            };

            // Try to find specific devices by name
            devices.forEach((device, index) => {
              const lower = device.toLowerCase();
              if (lower.includes("facetime") || lower.includes("camera")) {
                this.deviceIndexes.webcam = String(index);
              } else if (
                lower.includes("screen") ||
                lower.includes("display")
              ) {
                this.deviceIndexes.screen = String(index);
              }
            });

            console.log("Selected devices:", this.deviceIndexes);
            resolve();
          } else {
            reject(new Error("No video devices found in the device list"));
          }
        } else {
          reject(new Error("Could not parse AVFoundation device list"));
        }
      });

      ffmpeg.on("error", (err) => {
        reject(new Error(`Failed to list devices: ${err.message}`));
      });
    });
  }

  async start() {
    console.log("Starting voice-activated recorder...");
    await this.setupRecorder();
    this.startAudioMonitoring();
  }

  startAudioMonitoring() {
    this.audioRecorder.start();
    const audioStream = this.audioRecorder.stream();

    audioStream.on("data", (chunk) => {
      const samples = new Int16Array(chunk.buffer);
      const rms = Math.sqrt(
        Array.from(samples).reduce((sum, value) => sum + value * value, 0) /
          samples.length,
      );
      const db = 20 * Math.log10(rms);
      // console.log({ db });
      if (db > 50 && !this.isRecording) {
        this.startRecording();
      } else if (db <= 50 && this.isRecording) {
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this.stopRecording();
          }, 5000); // 5 second silence threshold
        }
      } else if (db > 50 && this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    });
  }

  async startRecording() {
    if (this.isRecording) return;

    console.log("Voice detected - Starting recording...");
    this.isRecording = true;
    this.recordingStartTime = Date.now();
    this.currentRecordingPath = path.join(
      opts.tempDir,
      `recording-${Date.now()}`,
    );
    await fs.mkdir(this.currentRecordingPath, { recursive: true });

    // Start screen recording
    const screenOutputPath = path.join(this.currentRecordingPath, "screen.mp4");
    this.screenFFmpeg = spawn("ffmpeg", [
      "-f",
      "avfoundation",
      "-framerate",
      "5",
      "-i",
      `${this.deviceIndexes.screen}:none`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-s",
      "1280x720",
      "-y",
      screenOutputPath,
    ]);

    // Start webcam recording with higher framerate
    const webcamOutputPath = path.join(this.currentRecordingPath, "webcam.mp4");
    this.webcamFFmpeg = spawn("ffmpeg", [
      "-f",
      "avfoundation",
      "-framerate",
      "30",
      "-i",
      `${this.deviceIndexes.webcam}:none`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-s",
      "640x360",
      "-y",
      webcamOutputPath,
    ]);

    // Start audio recording
    const audioOutputPath = path.join(this.currentRecordingPath, "audio.wav");
    this.audioFFmpeg = spawn("ffmpeg", [
      "-f",
      "avfoundation",
      "-i",
      "none:0",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "44100",
      "-y",
      audioOutputPath,
    ]);

    // Set up max duration timer
    this.maxDurationTimer = setTimeout(async () => {
      console.log(
        "Maximum duration reached (10 minutes) - Splitting recording",
      );
      const currentPath = this.currentRecordingPath; // Store current path
      await this.stopRecording(true); // True indicates we want to continue recording
      if (this.isVoiceActive()) {
        // Check if we should start a new recording
        this.startRecording();
      }
    }, this.MAX_DURATION);

    // Log any FFmpeg errors
    const handleFFmpegError = (name, data) => {
      // console.log(`${name} FFmpeg error:`, data.toString());
    };

    this.screenFFmpeg.stderr.on("data", (data) =>
      handleFFmpegError("Screen", data),
    );
    this.webcamFFmpeg.stderr.on("data", (data) =>
      handleFFmpegError("Webcam", data),
    );
    this.audioFFmpeg.stderr.on("data", (data) =>
      handleFFmpegError("Audio", data),
    );
  }

  async stopRecording(continueRecording = false) {
    if (!this.isRecording) return;

    const duration = (Date.now() - this.recordingStartTime) / 1000;
    console.log("Stopping recording... Duration:", duration, "seconds");

    // Clear the max duration timer
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    if (duration < 15 && !continueRecording) {
      console.log("Recording too short, discarding...");
      this.cleanup();
      return;
    }

    console.log("Stopping processes");

    const stopProcess = async (process, name) => {
      if (!process) return;

      return new Promise((resolve) => {
        const forceKillTimeout = setTimeout(() => {
          console.log(`Force killing ${name} process after timeout...`);
          try {
            process.kill("SIGKILL");
          } catch (error) {
            console.error(`Error force killing ${name}:`, error);
          }
          resolve();
        }, 10000);

        try {
          console.log(`Attempting graceful shutdown of ${name}...`);
          process.stdin.write("q");
        } catch (error) {
          console.log(
            `Error sending quit command to ${name}, trying SIGTERM:`,
            error,
          );
          try {
            process.kill("SIGTERM");
          } catch (termError) {
            console.error(`Error sending SIGTERM to ${name}:`, termError);
          }
        }

        process.on("close", (code) => {
          clearTimeout(forceKillTimeout);
          console.log(`${name} process closed with code ${code}`);
          resolve();
        });
      });
    };

    try {
      await Promise.all([
        stopProcess(this.screenFFmpeg, "screen"),
        stopProcess(this.webcamFFmpeg, "webcam"),
        stopProcess(this.audioFFmpeg, "audio"),
      ]);

      console.log("All processes stopped, waiting before upload...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const files = await fs.readdir(this.currentRecordingPath);
      console.log("Files ready for upload:", files);

      const timestamp = new Date().toISOString();
      await this.uploadDirectory(this.currentRecordingPath, timestamp);
      console.log("Upload completed successfully");
    } catch (error) {
      console.error("Error during stop/upload process:", error);
    } finally {
      if (!continueRecording) {
        this.cleanup();
      } else {
        // Partial cleanup - reset recording-specific variables but keep the recorder running
        this.isRecording = false;
        this.recordingStartTime = null;
        this.screenFFmpeg = null;
        this.webcamFFmpeg = null;
        this.audioFFmpeg = null;
        if (this.currentRecordingPath) {
          fs.rm(this.currentRecordingPath, {
            recursive: true,
            force: true,
          }).catch((error) =>
            console.error("Error cleaning up directory:", error),
          );
          this.currentRecordingPath = null;
        }
      }
    }
  }

  async uploadDirectory(directory, timestamp) {
    const files = await fs.readdir(directory);
    console.log("Uploading files:", files);

    const uploads = files.map(async (file) => {
      const filePath = path.join(directory, file);
      const fileContent = await fs.readFile(filePath);
      const key = `recording-${timestamp}-${file}`;

      // Determine content type based on file extension
      let contentType = "video/mp4";
      if (file.endsWith(".wav")) {
        contentType = "audio/wav";
      }

      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: "yaptabber",
          Key: key,
          Body: fileContent,
          ContentType: contentType,
        },
        queueSize: 4,
        partSize: 1024 * 1024 * 5,
      });

      try {
        await upload.done();
        console.log(`Successfully uploaded ${file}`);
      } catch (error) {
        console.error(`Error uploading ${file}:`, error);
        throw error;
      }
    });

    await Promise.all(uploads);
  }

  cleanup() {
    this.isRecording = false;
    this.recordingStartTime = null;
    this.silenceTimer = null;

    const killProcess = (process, name) => {
      if (process) {
        try {
          process.kill("SIGKILL");
          console.log(`Killed ${name} process`);
        } catch (error) {
          console.error(`Error killing ${name} process:`, error);
        }
      }
    };

    killProcess(this.screenFFmpeg, "screen");
    killProcess(this.webcamFFmpeg, "webcam");
    killProcess(this.audioFFmpeg, "audio");

    this.screenFFmpeg = null;
    this.webcamFFmpeg = null;
    this.audioFFmpeg = null;

    if (this.currentRecordingPath) {
      fs.rm(this.currentRecordingPath, { recursive: true, force: true }).catch(
        (error) => console.error("Error cleaning up directory:", error),
      );
      this.currentRecordingPath = null;
    }
  }

  async stopRecording() {
    if (!this.isRecording) return;

    const duration = (Date.now() - this.recordingStartTime) / 1000;
    console.log("Stopping recording... Duration:", duration, "seconds");

    // Only process if recording is longer than 15 seconds
    if (duration < 15) {
      console.log("Recording too short, discarding...");
      this.cleanup();
      return;
    }

    console.log("Stopping processes");

    const stopProcess = async (process, name) => {
      if (!process) return;

      return new Promise((resolve) => {
        // Set a timeout to force kill if graceful shutdown fails
        const forceKillTimeout = setTimeout(() => {
          console.log(`Force killing ${name} process...`);
          process.kill("SIGKILL");
          resolve();
        }, 5000); // 5 second timeout

        // Try graceful shutdown first
        try {
          process.stdin.write("q");
        } catch (error) {
          console.log(`Error sending quit command to ${name}:`, error);
          // If writing to stdin fails, try SIGTERM
          process.kill("SIGTERM");
        }

        // Listen for process exit
        process.on("close", () => {
          clearTimeout(forceKillTimeout);
          console.log(`${name} process closed successfully`);
          resolve();
        });
      });
    };

    try {
      // Stop both processes concurrently
      await Promise.all([
        stopProcess(this.screenFFmpeg, "screen"),
        stopProcess(this.webcamFFmpeg, "webcam"),
      ]);

      console.log("All processes stopped successfully");

      // Upload to S3
      const timestamp = new Date().toISOString();
      await this.uploadDirectory(this.currentRecordingPath, timestamp);
      console.log("Upload completed successfully");
    } catch (error) {
      console.error("Error during stop/upload process:", error);
    } finally {
      this.cleanup();
    }
  }

  async uploadDirectory(directory, timestamp) {
    const files = await fs.readdir(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);
      const fileContent = await fs.readFile(filePath);
      const key = `recording-${timestamp}-${file}`;

      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: "yaptabber",
          Key: key,
          Body: fileContent,
          ContentType: "video/mp4",
        },
        queueSize: 4,
        partSize: 1024 * 1024 * 5,
      });

      await upload.done();
    }
  }

  cleanup() {
    this.isRecording = false;
    this.recordingStartTime = null;
    this.silenceTimer = null;

    if (this.screenFFmpeg) {
      this.screenFFmpeg.kill();
      this.screenFFmpeg = null;
    }

    if (this.webcamFFmpeg) {
      this.webcamFFmpeg.kill();
      this.webcamFFmpeg = null;
    }

    if (this.currentRecordingPath) {
      fs.rm(this.currentRecordingPath, { recursive: true, force: true }).catch(
        console.error,
      );
      this.currentRecordingPath = null;
    }
  }

  async shutdown() {
    if (this.isRecording) {
      await this.stopRecording();
    }
    if (this.audioRecorder) {
      this.audioRecorder.stop();
    }
  }

  isVoiceActive() {
    // Helper method to check if voice is still active
    // This can be enhanced based on your actual voice detection logic
    return !this.silenceTimer;
  }
}

// Start the recorder
const recorder = new VoiceActivatedRecorder();
recorder.start().catch((error) => {
  console.error("Failed to start recorder:", error);
  process.exit(1);
});

// Handle cleanup on exit
process.on("SIGINT", async () => {
  console.log("Cleaning up...");
  await recorder.shutdown();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  await recorder.shutdown();
  process.exit(1);
});

process.on("unhandledRejection", async (error) => {
  console.error("Unhandled rejection:", error);
  await recorder.shutdown();
  process.exit(1);
});
