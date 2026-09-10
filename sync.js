/* Cadence sync — one private GitHub Gist as the shared source of truth.
 *
 * The web app and the Mac app both read and write the same JSON file in the
 * Gist. Conflicts are resolved last-write-wins by the store's `updatedAt`
 * timestamp, which is fine for a single person who edits one device at a time.
 */
window.Sync = (() => {
  "use strict";

  const CFG_KEY = "cadence.sync";
  const FILE = "cadence-data.json";
  const API = "https://api.github.com";

  let cfg = { token: "", gistId: "" };
  let busy = false;
  let pendingPush = null;      // latest store awaiting a push
  const api = {
    onRemote: () => {},        // (store) => void   — remote copy that is newer
    onStatus: () => {},        // (state, text) => void
  };

  function loadCfg() {
    try { cfg = { token: "", gistId: "", ...(JSON.parse(localStorage.getItem(CFG_KEY)) || {}) }; }
    catch { cfg = { token: "", gistId: "" }; }
  }
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  const enabled = () => !!(cfg.token && cfg.gistId);

  function status(state, text) { api.onStatus(state, text); }
  function idle() {
    if (!cfg.token) status("", "local only");
    else if (!cfg.gistId) status("busy", "connecting…");
    else status("ok", "synced");
  }

  function headers() {
    return {
      "Authorization": "Bearer " + cfg.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
  }

  async function ghFetch(path, opts) {
    const res = await fetch(API + path, { ...opts, headers: { ...headers(), ...(opts && opts.headers) } });
    if (res.status === 401) throw new Error("token rejected (needs 'gist' scope)");
    if (res.status === 404) throw new Error("gist not found");
    if (res.status === 403) throw new Error("GitHub rate limit — try again shortly");
    if (!res.ok) throw new Error("GitHub error " + res.status);
    return res;
  }

  async function readRemote() {
    const res = await ghFetch("/gists/" + cfg.gistId);
    const gist = await res.json();
    const f = gist.files && gist.files[FILE];
    if (!f) return null;
    let content = f.content;
    if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
    try { return JSON.parse(content); } catch { return null; }
  }

  async function writeRemote(store) {
    const body = JSON.stringify({ files: { [FILE]: { content: JSON.stringify(store, null, 2) } } });
    await ghFetch("/gists/" + cfg.gistId, { method: "PATCH", body });
  }

  async function createGist(store) {
    const body = JSON.stringify({
      description: "Cadence — routine & shopping data (synced across your devices)",
      public: false,
      files: { [FILE]: { content: JSON.stringify(store, null, 2) } },
    });
    const res = await ghFetch("/gists", { method: "POST", body });
    const gist = await res.json();
    return gist.id;
  }

  // -- public

  function init() { loadCfg(); idle(); }

  function config() { return { token: cfg.token, gistId: cfg.gistId }; }

  async function connect(token, gistId, localStore) {
    if (!token) throw new Error("paste a token first");
    cfg = { token, gistId: gistId || "" };
    status("busy", "connecting…");
    let created = false, pulled = false;
    try {
      if (!cfg.gistId) {
        cfg.gistId = await createGist(localStore);
        created = true;
      } else {
        const remote = await readRemote();
        if (remote && (remote.updatedAt || 0) > (localStore.updatedAt || 0)) {
          api.onRemote(remote);
          pulled = true;
        } else {
          await writeRemote(localStore);
        }
      }
      saveCfg();
      idle();
      return { gistId: cfg.gistId, created, pulled };
    } catch (e) {
      status("err", "sync error");
      throw e;
    }
  }

  function disconnect() { cfg = { token: "", gistId: "" }; localStorage.removeItem(CFG_KEY); idle(); }

  async function pull() {
    if (!enabled() || busy) return;
    busy = true; status("busy", "syncing…");
    try {
      const remote = await readRemote();
      if (remote) api.onRemote(remote);
      idle();
    } catch (e) {
      status(e.message && /network|fetch/i.test(e.message) ? "busy" : "err", navigator.onLine ? "sync error" : "offline");
    } finally {
      busy = false;
      if (pendingPush) { const s = pendingPush; pendingPush = null; push(s); }
    }
  }

  async function push(store) {
    if (!enabled()) return;
    if (busy) { pendingPush = store; return; }
    busy = true; status("busy", "syncing…");
    try {
      const remote = await readRemote();
      if (remote && (remote.updatedAt || 0) > (store.updatedAt || 0)) {
        // Someone else got there first — take theirs rather than clobber it.
        api.onRemote(remote);
      } else {
        await writeRemote(store);
      }
      idle();
    } catch (e) {
      pendingPush = store;                       // retry on next online / foreground
      status("busy", navigator.onLine ? "sync pending" : "offline");
    } finally {
      busy = false;
    }
  }

  return {
    init, config, connect, disconnect, pull, push,
    set onRemote(fn) { api.onRemote = fn; },
    set onStatus(fn) { api.onStatus = fn; },
    get onRemote() { return api.onRemote; },
  };
})();
