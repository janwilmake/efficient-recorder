# IP Camera to S3 Uploader

Battery-efficient RTSP video capture and S3 upload utility optimized for macOS (Apple Silicon). Records IP camera feeds and automatically uploads segments to S3-compatible storage using hardware-accelerated encoding.

## Features

- Hardware-accelerated H.264 encoding using Apple Silicon's media engine (VideoToolbox)
- Efficient battery usage through hardware encoding
- Automatic upload to S3-compatible storage (AWS S3, Cloudflare R2, etc.)
- Configurable recording segments
- Auto-recovery from network interruptions
- Clean temporary file management

## Performance

- Uses Apple Silicon's hardware encoding for optimal battery life
- Minimal CPU overhead (~7-8% CPU usage)
- Minimal storage required: collects ±60GB in a month
- Zero GPU utilization
- Efficient memory management

## Requirements

- ffmpeg
- macOS running on Apple Silicon (M1/M2/M3)
- Node.js 16+
- IP Camera with RTSP support
- S3-compatible storage access

## Quick Start

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Configure your settings in `config`:

```javascript
{
  camera: {
    ip: "CAMERA_IP",
    username: "CAMERA_USERNAME",
    password: "CAMERA_PASSWORD"
  },
  r2: {
    endpoint: "S3_URL",
    accessKeyId: "S3_KEY",
    secretAccessKey: "S3_SECRET",
    bucket: "BUCKET_NAME"
  }
}
```

4. Run the uploader:

```bash
node index.js
```

## License

MIT
