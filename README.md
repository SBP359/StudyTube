# StudyTube

![StudyTube icon](icons/icon128.png)

Turn YouTube into a focused learning space with an educational feed, blurred off-topic thumbnails, and study sprints.

## Features

- Redirect the YouTube homepage to an educational video feed.
- Blur videos that are not on your approved learning list.
- Approve channels and playlists, and switch study topics from the popup.
- Track focus sprints, streaks, and XP.
- Hide comments, live chat, and end-screen recommendations with Study Theater.

## Install in Firefox

1. Download [`studytube-firefox.xpi`](studytube-firefox.xpi) from this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select the downloaded XPI.

Temporary add-ons are removed when Firefox restarts. A permanent installation requires Mozilla signing.

## Install in Chrome

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select this project folder (the one containing `manifest.json`).

## Run tests

```bash
node tests/policy.test.js
```

## Links

- [GitHub repository](https://github.com/SBP359/StudyTube)
- [Report an issue](https://github.com/SBP359/StudyTube/issues)
- Made with ❤️ by [sbp359](https://github.com/SBP359)
