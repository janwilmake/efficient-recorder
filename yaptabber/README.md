Yaptabber uploads your screen, video, and mic to your s3 whenever there's sound detected, with a minimum length of 10 seconds.

This is a proof of concept but could become a really useful tool I'd say, as it can be connected with any plugins using AI. Open to collaborate on this!

How to use:

1. `brew install ffmpeg`
2. `brew install sox`
3. `npx yaptabber --endpoint https://yours3endpoint.com --key S3_KEY --secret S3_SECRET --region S3_REGION`

Then go to https://yaptabber.com/admin (or use admin.html) and view your synced audio/video/screen recordings :D

~~ Happy Yapping!

# Ideas for improvement

- re-implement the client in Swift for maximum efficiency and reducing data over the line. It now costs more energy than safari or vscode which is terrible. After this, instead of sending just when I talk, send everything and process better on the backend.
- also collect browsing history as additional metadata
- also collect mouse position, clicks, keystrokes
- also collect the exact date time when the media starts/ends (but just use a single ID for the filename)
- in the backend, create a transcript for each audio. make this searchable in the layout
