create a node.js program that records audio in 8khz to detect if the mic is above 50db, and switches to 44.1khz otherwise. this way it can efficiently record mic audio but only when im talking. it streams the recording to s3 using the s3 uses the s3 api provided. it should be able to be ran as a cli using npx efficient-recorder --endpoint ENDPOINT --key KEY --secret SECRET

https://raw.githubusercontent.com/aws/aws-sdk-js-v3/refs/heads/main/README.md
https://raw.githubusercontent.com/RedKenrok/node-audiorecorder/refs/heads/master/README.md

<!--maybe better: https://raw.githubusercontent.com/serenadeai/speech-recorder/refs/heads/master/README.md -->
