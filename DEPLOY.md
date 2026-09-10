# Getting Cadence onto your phone

Three parts: **publish the site**, **add it to your home screen**, **turn on sync**.
About ten minutes, once.

The git repo in this folder is already set up and committed, with the remote
pointed at `https://github.com/i-jarz29/cadence.git`.

---

## 1 · Publish to GitHub Pages

**a. Make the repo.** Go to <https://github.com/new>:

- Repository name: **`cadence`**
- **Public** (the code is public; your data is not — it lives in a private Gist)
- Do **not** add a README, .gitignore or licence
- Click **Create repository**

**b. Push.** In a terminal:

```bash
cd "/Users/iwo/Desktop/Jarvis Demo/Cadence/web"
git push -u origin main
```

If git asks for a password, paste a personal access token with the `repo` scope
(<https://github.com/settings/tokens/new?scopes=repo&description=git%20push>) — not
your GitHub password.

**c. Turn on Pages.** In the new repo: **Settings** → **Pages** (left sidebar) →
under *Build and deployment*, set **Source: Deploy from a branch**, **Branch:
`main` / `/ (root)`**, then **Save**.

Wait about a minute. Your app is now live at:

> **https://i-jarz29.github.io/cadence/**

---

## 2 · Add it to your home screen

On the **phone**, open that URL in **Safari** (it must be Safari for the install
to work — not Chrome):

1. Tap the **Share** button (the square with an arrow)
2. Scroll down, tap **Add to Home Screen**
3. Tap **Add**

You now have a **Cadence** icon. Open it — it runs full-screen, no browser bars,
and works even with no signal once it has loaded once.

On the **Mac**, you can also add it to the Dock: open the URL in Safari or
Chrome, then in Chrome use ⋮ → *Cast, save and share* → *Create shortcut* (tick
"Open as window"), or in Safari the *Share* → *Add to Dock*.

---

## 3 · Turn on sync (so the phone and the Mac share one list)

**a. Make a sync token.** Open
<https://github.com/settings/tokens/new?scopes=gist&description=Cadence%20sync>.
It's pre-filled: expiration up to you (90 days is fine, you can regenerate),
**only the `gist` box ticked**. Click **Generate token** and copy it (starts
`ghp_…`).

**b. On the phone:** open Cadence → **Settings** → *Sync across devices* → paste
the token into **GitHub token**, leave **Gist id** blank → **Connect**. It
creates a private Gist and shows its id.

**c. On the Mac app:** **Settings** → *Sync across devices* → paste the **same
token**, and this time paste the **Gist id** from step b → **Connect**.

That's it. Both now read and write the same data. The phone pulls the latest when
you open it and pushes when you change something; the Mac does the same when it
becomes the active window. The little status under the sidebar / by the token
field says `synced`, `syncing…`, `offline` or `sync error`.

If you ever want to stop: **Turn off sync** on that device removes the token from
it (the Gist and the other device are untouched). Deleting the Gist on GitHub
wipes the shared copy — each device keeps its own local copy.

---

## Updating the app later

Change a file, then:

```bash
cd "/Users/iwo/Desktop/Jarvis Demo/Cadence/web"
git commit -am "tweak"
git push
```

Bump `CACHE` in `sw.js` whenever you change `index.html`, `app.js`, `styles.css`
or `sync.js`, so installed devices pick the new version up on next open.
