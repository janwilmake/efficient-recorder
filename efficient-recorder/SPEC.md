Create a node.js program that records:

- audio in 8khz to detect if the mic is above 50db, and switches to 44.1khz otherwise. this way it can efficiently record mic audio but only when im talking.
- screen recording at 5fps and 1440\*900 (configurable) and 16bit RGB
- it streams the recording to s3 using the s3 uses the s3 api provided.
- it should be able to be ran as a cli using npx efficient-recorder --endpoint ENDPOINT --key KEY --secret SECRET
