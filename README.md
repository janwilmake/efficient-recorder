Today I was inspired by this tweet after which I fell into this rabbit hole to create an efficient recorder for your Screen, System audio, and Mic.

[![](tweet.png)](https://x.com/RichardMCNgo/status/1875093600612261909)

After trying to implement this using Claude in Swift I completely failed (see folder [swift-version](swift-version)) so I decided to create a simpler version (also using Claude) in Node.js

# Efficient Recorder

An intelligent, multi-modal recording CLI tool that automatically captures and streams audio, screenshots, and webcam video to S3. Uses advanced detection and efficient resource management to capture multimedia content.

## Features

- **Intelligent Audio Recording**:

  - Monitors audio at 8kHz with automatic speech detection
  - Switches to high-quality 44.1kHz recording when speech is detected
  - Automatically stops recording after 2 seconds of silence
  - Direct streaming to S3

- **Automated Screenshot Capture**:

  - Configurable screenshot interval
  - Immediate upload of screenshots to S3
  - Low-overhead screen capture

- **Webcam Video Capture**:

  - Configurable webcam capture interval
  - Direct upload of webcam images to S3
  - Supports custom webcam device selection

- **Efficient Resource Management**:
  - Minimal system resource usage during idle periods
  - Intelligent detection and recording mechanisms
  - Concurrent upload processing

## Prerequisites

### Required Software

This package requires:

- [SoX (Sound eXchange)](http://sox.sourceforge.net/) for audio recording

  - Linux: `sudo apt-get install sox libsox-fmt-all`
  - MacOS: `brew install sox`
  - Windows: Download from [SourceForge](http://sourceforge.net/projects/sox/files/latest/download)

- Webcam capture tools
  - Ubuntu: `sudo apt-get install fswebcam`
  - Arch Linux: `sudo pamac build fswebcam`
  - MacOS: `brew install imagesnap`
  - Windows: Standalone exe included in node-webcam

### S3 Configuration

You'll need:

- S3-compatible storage endpoint
- Access key
- Secret key
- A bucket named "recordings" (or modify the code to use a different bucket name)

## Usage

Run the recorder using npx:

```bash
npx efficient-recorder \
  --endpoint YOUR_S3_ENDPOINT \
  --key YOUR_ACCESS_KEY \
  --secret YOUR_SECRET_KEY \
  --enable-screenshot \
  --screenshot-interval 5000 \
  --enable-webcam \
  --webcam-interval 3000 \
  --image-quality 80
```

### Command Line Options

- `--endpoint`: Your S3-compatible storage endpoint URL
- `--key`: Your AWS/S3 access key
- `--secret`: Your AWS/S3 secret key
- `--enable-screenshot`: Enable screenshot capture
- `--screenshot-interval`: Interval between screenshots (ms)
- `--enable-webcam`: Enable webcam capture
- `--webcam-interval`: Interval between webcam captures (ms)
- `--webcam-device`: Specify webcam device (optional)
- `--image-quality`: Image quality for webcam/screenshots (1-100)

## How It Works

1. **Audio Monitoring**

   - Continuous low-quality audio monitoring
   - Switches to high-quality recording when speech is detected
   - Automatic recording start and stop based on sound levels

2. **Screenshot Capture**

   - Captures screenshots at specified intervals
   - Immediate upload to S3
   - Configurable capture frequency

3. **Webcam Capture**

   - Captures webcam images at specified intervals
   - Supports multiple webcam devices
   - Immediate upload to S3

4. **Efficient Upload**
   - Queued upload processing
   - Concurrent uploads with multi-part support
   - Minimal system resource overhead

### Multimedia Specifications

**Audio**

- Monitoring: 8kHz, Mono
- Recording: 44.1kHz, Stereo
- Format: WAV (16-bit PCM)

**Screenshots**

- Captured at system screen resolution
- Uploaded as PNG

**Webcam**

- Resolution: 1280x720
- Format: JPEG
- Configurable quality

## Troubleshooting

1. **"Command not found: rec"**

   - Ensure SoX is installed correctly
   - Verify SoX is in your system PATH

2. **S3 Upload Issues**

   - Check S3 credentials
   - Verify bucket exists and write permissions are granted

3. **No Audio/Video Input**
   - Check system input devices
   - Verify microphone and webcam permissions

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please submit a Pull Request.

## Support

For issues and feature requests, please [open an issue](https://github.com/janwilmake/efficient-recorder/issues) on GitHub.
