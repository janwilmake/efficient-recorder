i guess there's also a lot of merit in creating a least-friction way to creating video uploads. could be great for people that have stuff to say often, but don't want to do the effort of video editing and uploading, etc etc.

since this program can measure the db level 24/7, we can simply activate the video whenever you talk, and stop it 5 seconds after you stop talking.

Let's rewrite this cli so it:

- makes no screenshot or video screenshot
- when audio level goes above 50db, starts recording quality audio, record screen, and node-webcam.
- screen quality 5fps 720p
- video quality: 15fps 360p
- only upload if the video surpasses 15 seconds or longer
- stop recording if nothing surpassed 50db for over 5 seconds

Context:

- record-screen: https://raw.githubusercontent.com/blueimp/record-screen/refs/heads/master/README.md
- node-webcam: https://raw.githubusercontent.com/chuckfairy/node-webcam/refs/heads/master/README.md

https://claude.ai/chat/cf089139-e1f4-468b-aa59-582e983dca23s
