Today I was inspired by this tweet after which I fell into this rabbit hole to create an efficient recorder for your Screen, System audio, and Mic.

[![](tweet.png)](https://x.com/RichardMCNgo/status/1875093600612261909)

After trying to implement this using Claude in Swift I completely failed (see folder `swift-version`) so I decided to create a simpler version (also using Claude) in Node.js

# Efficient Recorder

An intelligent audio recording CLI tool that automatically detects speech and streams high-quality audio to S3. It uses dual-mode recording with 8kHz monitoring and 44.1kHz high-quality recording to efficiently capture audio only when needed.

## Features

- **Intelligent Recording**: Monitors audio at 8kHz and only switches to high-quality 44.1kHz recording when speech is detected
- **Automatic Silence Detection**: Automatically stops recording after 2 seconds of silence
- **Direct S3 Streaming**: Streams audio directly to S3 as it's being recorded
- **Resource Efficient**: Uses low-quality monitoring most of the time to minimize resource usage
- **Easy to Use**: Simple CLI interface with minimal configuration needed

## Prerequisites

### Required Software

This package requires [SoX (Sound eXchange)](http://sox.sourceforge.net/) to be installed on your system.

#### Linux

```bash
sudo apt-get install sox libsox-fmt-all
```

#### macOS

```bash
brew install sox
```

#### Windows

Download and install SoX from [SourceForge](http://sourceforge.net/projects/sox/files/latest/download)

### S3 Configuration

You'll need:

- S3-compatible storage endpoint
- Access key
- Secret key
- A bucket named "recordings" (or modify the code to use a different bucket name)

## Installation

```bash
npm install -g efficient-recorder
```

## Usage

Run the recorder using npx:

```bash
npx efficient-recorder --endpoint YOUR_S3_ENDPOINT --key YOUR_ACCESS_KEY --secret YOUR_SECRET_KEY
```

### Command Line Options

- `--endpoint`: Your S3-compatible storage endpoint URL
- `--key`: Your AWS/S3 access key
- `--secret`: Your AWS/S3 secret key

## How It Works

1. **Monitoring Phase**

   - Continuously monitors audio input at 8kHz
   - Calculates real-time dB levels from audio samples
   - Uses minimal system resources during idle periods

2. **Detection & Recording**

   - When sound levels exceed 50dB, switches to high-quality recording mode
   - Records at 44.1kHz with stereo audio
   - Streams the recording directly to S3

3. **Intelligent Stop**

   - Monitors sound levels during recording
   - If levels drop below 50dB for 2 consecutive seconds, stops recording
   - Automatically finalizes the S3 upload

4. **File Management**
   - Creates a new file for each recording session
   - Files are named with timestamps (e.g., `recording-2025-01-04T12:34:56.789Z.wav`)
   - Stored in the specified S3 bucket

## Technical Details

### Audio Specifications

**Monitoring Mode**

- Sample Rate: 8kHz
- Channels: Mono
- Format: WAV (16-bit PCM)

**Recording Mode**

- Sample Rate: 44.1kHz
- Channels: Stereo
- Format: WAV (16-bit PCM)

### Dependencies

- `node-audiorecorder`: For audio capture and recording
- `@aws-sdk/client-s3`: For S3 streaming and uploads
- `commander`: For CLI argument parsing

## Troubleshooting

### Common Issues

1. **"Command not found: rec"**

   - Ensure SoX is installed correctly
   - Verify SoX is in your system PATH

2. **"Access Denied" when uploading**

   - Check your S3 credentials
   - Verify the bucket exists and you have write permissions

3. **No Audio Input**
   - Check your system's default input device
   - Verify microphone permissions

### Debug Mode

Add the `--debug` flag for verbose logging:

```bash
npx efficient-recorder --debug --endpoint YOUR_S3_ENDPOINT --key YOUR_ACCESS_KEY --secret YOUR_SECRET_KEY
```

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and feature requests, please [open an issue](https://github.com/yourusername/efficient-recorder/issues) on GitHub.
