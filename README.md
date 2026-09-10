# Cadence — web app (phone + desktop)

The same tracker as the Mac app, as a website you install to your phone's home
screen. It opens full-screen with no browser bars, works offline once loaded, and
— with sync switched on — shares one dataset with the Mac app.

Everything is static: HTML, CSS and vanilla JS. No build step, no framework.

| File | Purpose |
|---|---|
| `index.html` | shell |
| `app.js` | all the logic and the six views |
| `sync.js` | reads/writes the shared private Gist |
| `styles.css` | responsive — sidebar on desktop, bottom tabs on phone |
| `sw.js` | service worker: instant open + offline |
| `manifest.webmanifest` | home-screen name, icons, standalone display |
| `icons/` | app icons |

## Sync

Sync uses one **private GitHub Gist** as the shared source of truth. On each
device you paste a GitHub token with the `gist` scope once (Settings → Sync); the
app then reads the Gist when it opens and writes it when you make a change.
Conflicts resolve last-write-wins by the store's `updatedAt` timestamp, which is
fine for one person editing one device at a time.

## Deploy

See [`DEPLOY.md`](DEPLOY.md) — publish to GitHub Pages, then add to your phone's
home screen.
