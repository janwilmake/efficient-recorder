> NB: this isnt' functinal yet AT ALL. just tried to write swift using claude but it didn't know enough about it to get it to work

I want a macOS program that takes 1 screenshot every second and also records a separate system audio and mic audio. the screenshot doesn't need to be processed locally. the recording must be paused if db level is below 50. it must be as energy efficient as possible locally. it must stream both audio streams separately to a cloudflare r2 bucket, and it must upload the screenshots to there too (can use multipart upload).

To use this, you need to:

1. Create an R2 Bucket at Cloudflare and find your S3 API URL
2. Create an API Key with read/write access ([instructions](https://developers.cloudflare.com/r2/api/s3/tokens/))
3. When running the program, provide the S3 API URL, Access Key ID, and Secret Access Key

As a follow up when I want to work on this again, I'd need to get this to work as an installable DMG MacOS application in which a user would just enter their S3 server details (would be compatible with [MinIO](https://github.com/minio/minio)) and it would start recording, always uploading whenever there's an internet connection.
