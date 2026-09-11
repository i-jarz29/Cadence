/* Cadence — routine + shopping tracker (vanilla JS, no build step).
 *
 * State lives in localStorage and, when a GitHub token is configured, syncs
 * through a private Gist so the phone and the Mac app share one dataset.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- constants

  const CATEGORIES = [
    { id: "sleep", name: "Sleep",     color: "var(--cat-sleep)" },
    { id: "wake",  name: "Wake up",   color: "var(--cat-wake)"  },
    { id: "meal",  name: "Meal",      color: "var(--cat-meal)"  },
    { id: "class", name: "Class",     color: "var(--cat-class)" },
    { id: "gym",   name: "Gym",       color: "var(--cat-gym)"   },
    { id: "mma",   name: "MMA",       color: "var(--cat-mma)"   },
    { id: "zap",   name: "Zap work",  color: "var(--cat-zap)"   },
    { id: "prep",  name: "Meal prep", color: "var(--cat-prep)"  },
    { id: "study", name: "Study",     color: "var(--cat-study)" },
    { id: "other", name: "Other",     color: "var(--cat-other)" },
  ];
  const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  const AISLES = [
    ["produce", "Produce"], ["bakery", "Bakery"], ["meat", "Meat & fish"],
    ["dairy", "Dairy & eggs"], ["frozen", "Frozen"], ["cupboard", "Cupboard"],
    ["drinks", "Drinks"], ["household", "Household"], ["other", "Other"],
  ];
  const AISLE_NAME = Object.fromEntries(AISLES);
  const aisleOrder = (id) => { const i = AISLES.findIndex((a) => a[0] === id); return i < 0 ? 99 : i; };

  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const TRACKED = ["sleep", "wake", "meal", "class", "gym", "mma", "zap", "prep", "study"];

  const DEFAULT_SETTINGS = {
    dayStartHour: 6, dayEndHour: 24, nudgeLeadMin: 15,
    driftThresholdMin: 15, notificationsEnabled: false, currencySymbol: "£",
  };

  // ---------------------------------------------------------------- utilities

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
    return n;
  };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n) => String(n).padStart(2, "0");
  const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => toKey(new Date());
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
  const jsWeekday = (k) => fromKey(k).getDay();
  const mondayOf = (k) => { const d = fromKey(k); const s = (d.getDay() + 6) % 7; d.setDate(d.getDate() - s); return toKey(d); };
  const minutesNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  const fromMin = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  const spanMin = (a, b) => { if (a === b) return 0; const d = ((toMin(b) - toMin(a)) % 1440 + 1440) % 1440; return d === 0 ? 1440 : d; };
  const fmtDur = (mins) => { const m = Math.max(0, Math.round(mins)); if (m < 60) return `${m}m`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; };
  const fmtRange = (a, b) => `${a}–${b}`;

  const humanDate = (k) => {
    const t = todayKey();
    if (k === t) return "Today";
    if (k === addDays(t, -1)) return "Yesterday";
    if (k === addDays(t, 1)) return "Tomorrow";
    return fromKey(k).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  };
  const longDate = (k) => fromKey(k).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const shortDate = (k) => fromKey(k).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const catName = (id) => (CAT[id] || CAT.other).name;
  const catColor = (id) => (CAT[id] || CAT.other).color;
  const parseAmount = (s) => { const v = parseFloat(String(s).trim().replace(",", ".")); return Number.isFinite(v) ? v : null; };
  const trimNum = (d) => (d === Math.round(d) ? String(d) : String(d));
  const money = (v) => data.settings.currencySymbol + (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);

  // ---------------------------------------------------------------- data layer

  const LS_KEY = "cadence.store.v1";
  let data = null;
  let saveTimer = null;

  const deviceId = (() => {
    let id = localStorage.getItem("cadence.deviceId");
    if (!id) { id = uid(); localStorage.setItem("cadence.deviceId", id); }
    return id;
  })();

  function blankStore() {
    return {
      version: 2, updatedAt: 0, updatedBy: deviceId,
      settings: { ...DEFAULT_SETTINGS },
      template: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, []])),
      days: {}, shopping: {},
    };
  }

  function normalize(s) {
    s = s && typeof s === "object" ? s : {};
    s.version = s.version || 2;
    s.updatedAt = s.updatedAt || 0;
    s.updatedBy = s.updatedBy || deviceId;
    s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    s.template = s.template || {};
    for (let d = 0; d < 7; d++) s.template[d] = s.template[d] || [];
    s.days = s.days || {};
    s.shopping = s.shopping || {};
    return s;
  }

  function loadLocal() {
    try { return normalize(JSON.parse(localStorage.getItem(LS_KEY))); }
    catch { return blankStore(); }
  }

  function persistLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
  }

  function touch() {
    data.updatedAt = Date.now();
    data.updatedBy = deviceId;
    persistLocal();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Sync.push(data), 900);
  }

  // remote copy arrived (from sync.js)
  Sync.onRemote = (remote) => {
    remote = normalize(remote);
    if ((remote.updatedAt || 0) > (data.updatedAt || 0)) {
      data = remote;
      persistLocal();
      render();
      toast("Synced");
    }
  };
  Sync.onStatus = (state, text) => {
    const p = $("#syncPill");
    p.className = "sync-pill" + (state ? " " + state : "");
    p.textContent = text;
  };

  // ---------------------------------------------------------------- reminders
  // "Remind me in X" — a one-off nudge on top of a planned block, separate from
  // the template's own nudge time. Lives only on this device (not synced):
  // it's tied to a moment on this phone or this Mac, not to the shared plan.

  const REM_KEY = "cadence.reminders";
  let reminders = [];
  try { const a = JSON.parse(localStorage.getItem(REM_KEY)); if (Array.isArray(a)) reminders = a; } catch {}
  const saveReminders = () => { try { localStorage.setItem(REM_KEY, JSON.stringify(reminders)); } catch {} };
  const reminderFor = (blockId) => reminders.find((r) => r.blockId === blockId) || null;
  const clearReminder = (id) => { reminders = reminders.filter((r) => r.id !== id); saveReminders(); };

  async function ensureNotifyPermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  }

  async function setReminder(block, minutes) {
    const granted = await ensureNotifyPermission();
    if (!granted) toast("Allow notifications to be reminded");
    reminders = reminders.filter((r) => r.blockId !== block.id);
    reminders.push({ id: uid(), blockId: block.id, label: block.label || catName(block.category),
      category: block.category, fireAt: Date.now() + minutes * 60000 });
    saveReminders();
    toast(`Reminder set for ${fmtDur(minutes)}`);
  }

  function checkReminders() {
    if (!reminders.length) return;
    const now = Date.now();
    const due = reminders.filter((r) => r.fireAt <= now);
    if (!due.length) return;
    reminders = reminders.filter((r) => r.fireAt > now);
    saveReminders();
    for (const r of due) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(r.label, { body: "You asked to be reminded about this.", tag: "cadence-rem-" + r.id });
      } else {
        toast(`Reminder: ${r.label}`);
      }
    }
    if (app.view === "today") render();
  }

  function openReminderSheet(block) {
    const existing = reminderFor(block.id);
    let unit = "min";
    const amountI = el("input", { type: "text", inputmode: "numeric", placeholder: "e.g. 20" });
    const segMin = el("button", { class: "active", onclick: () => { unit = "min"; segMin.classList.add("active"); segHr.classList.remove("active"); } }, "Minutes");
    const segHr = el("button", { onclick: () => { unit = "hr"; segHr.classList.add("active"); segMin.classList.remove("active"); } }, "Hours");
    const go = async (mins) => { await setReminder(block, mins); closeSheet(); render(); };
    const chips = el("div", { class: "rem-chips" },
      ...[10, 20, 30, 60, 120].map((m) => el("button", { class: "chip", onclick: () => go(m) }, m < 60 ? `${m}m` : `${m / 60}h`)));

    const customBtn = el("button", { class: "btn primary", onclick: () => {
      const n = parseAmount(amountI.value);
      if (!n || n <= 0) { toast("Enter how many " + (unit === "hr" ? "hours" : "minutes")); return; }
      go(Math.round(unit === "hr" ? n * 60 : n));
    } }, "Set reminder");

    const cancelBtn = existing
      ? el("button", { class: "btn ghost small", onclick: () => { clearReminder(existing.id); closeSheet(); render(); toast("Reminder cancelled"); } }, "Cancel reminder")
      : el("span");

    const body = el("div", {},
      el("h2", {}, "Remind me — " + (block.label || catName(block.category))),
      existing ? el("p", { class: "s-help", style: "margin:-6px 0 12px" },
        `Already set for ${new Date(existing.fireAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Setting a new one replaces it.`) : null,
      el("div", { class: "field" }, el("label", {}, "Quick pick"), chips),
      el("div", { class: "field" }, el("label", {}, "Or an exact amount"),
        el("div", { style: "display:flex;gap:8px" }, amountI, el("div", { class: "seg" }, segMin, segHr))),
      el("div", { class: "sheet-actions" },
        cancelBtn,
        el("div", { class: "right" }, el("button", { class: "btn", onclick: closeSheet }, "Close"), customBtn)));
    showSheet(body);
  }

  // ---------------------------------------------------------------- day model

  function getDay(key, seed = true) {
    let day = data.days[key];
    if (!day) { day = { planned: [], actual: [], note: "", templateApplied: false }; data.days[key] = day; }
    if (seed && !day.templateApplied) {
      const tmpl = data.template[jsWeekday(key)] || [];
      if (tmpl.length || key <= todayKey()) {
        day.planned = tmpl.map((t) => ({ id: uid(), category: t.category, label: t.label, start: t.start, end: t.end, seeded: true }));
        day.templateApplied = true;
        persistLocal();
      }
    }
    return day;
  }
  const byStart = (list) => [...list].sort((a, b) => toMin(a.start) - toMin(b.start));

  function reconcile(day, dateKey) {
    const threshold = data.settings.driftThresholdMin;
    const planned = byStart(day.planned), actual = byStart(day.actual);
    const used = new Set(), rows = [];
    const norm = (b) => `${b.category}::${(b.label || "").trim().toLowerCase()}`;
    for (const p of planned) {
      const m = actual.find((a) => !used.has(a.id) && norm(a) === norm(p));
      if (m) {
        used.add(m.id);
        let delta = toMin(m.start) - toMin(p.start);
        if (delta > 720) delta -= 1440; else if (delta < -720) delta += 1440;
        let status = "on";
        if (delta > threshold) status = "late"; else if (delta < -threshold) status = "early";
        rows.push({ kind: "matched", planned: p, actual: m, delta, status });
      } else {
        const past = dateKey < todayKey() || (dateKey === todayKey() && toMin(p.start) < minutesNow());
        rows.push({ kind: "planned-only", planned: p, missed: past });
      }
    }
    for (const a of actual) if (!used.has(a.id)) rows.push({ kind: "actual-only", actual: a });
    const counts = {
      onPlan: rows.filter((r) => r.kind === "matched" && r.status === "on").length,
      drifted: rows.filter((r) => r.kind === "matched" && r.status !== "on").length,
      missed: rows.filter((r) => r.kind === "planned-only" && r.missed).length,
      extra: rows.filter((r) => r.kind === "actual-only").length,
    };
    return { rows, counts };
  }

  const hasCat = (key, cat) => { const d = data.days[key]; return !!(d && d.actual.some((b) => b.category === cat)); };

  function streakFor(cat) {
    let cur = 0, cursor = todayKey();
    if (!hasCat(cursor, cat)) cursor = addDays(cursor, -1);
    while (hasCat(cursor, cat)) { cur++; cursor = addDays(cursor, -1); }
    let longest = 0, run = 0;
    const keys = Object.keys(data.days).sort();
    if (keys.length) {
      let d = keys[0]; const last = todayKey();
      while (d <= last) { if (hasCat(d, cat)) { run++; longest = Math.max(longest, run); } else run = 0; d = addDays(d, 1); }
    }
    const within = (n) => { let c = 0; for (let i = 0; i < n; i++) if (hasCat(addDays(todayKey(), -i), cat)) c++; return c; };
    return { current: cur, longest, last7: within(7), last30: within(30) };
  }

  // ---------------------------------------------------------------- shopping model

  function shoppingList(mondayKey) {
    let list = data.shopping[mondayKey];
    if (!list) { list = { items: [], rolledOver: false }; data.shopping[mondayKey] = list; }
    if (!list.rolledOver) {
      if (mondayKey >= mondayOf(todayKey())) {
        const prev = data.shopping[addDays(mondayKey, -7)];
        if (prev) {
          const carry = prev.items.filter((i) => !i.bought).map((i) => ({
            id: uid(), name: i.name, aisle: i.aisle, qty: i.qty, price: i.price, bought: false, carried: true,
          }));
          list.items = carry.concat(list.items);
        }
      }
      list.rolledOver = true;
      persistLocal();
    }
    return list;
  }
  const lineTotal = (it) => (Number(it.qty) || 0) * (Number(it.price) || 0);
  function shoppingTotals(list) {
    const t = { total: 0, basket: 0, count: 0, boughtCount: 0 };
    for (const it of list.items) {
      t.total += lineTotal(it); t.count++;
      if (it.bought) { t.basket += lineTotal(it); t.boughtCount++; }
    }
    return t;
  }
  function spendHistory(anchor, weeks) {
    const out = [];
    for (let i = 0; i < weeks; i++) {
      const k = addDays(anchor, -7 * i);
      const l = data.shopping[k];
      if (l && l.items.length) out.push({ key: k, total: l.items.reduce((s, it) => s + lineTotal(it), 0) });
    }
    return out.reverse();
  }

  // ---------------------------------------------------------------- router

  const app = { view: "today", date: todayKey(), weekAnchor: mondayOf(todayKey()), weekMode: "both", shopAnchor: mondayOf(todayKey()) };

  function setView(v) {
    app.view = v;
    for (const b of document.querySelectorAll(".nav-item")) b.classList.toggle("active", b.dataset.view === v);
    render();
  }

  function render() {
    const main = $("#main");
    main.scrollTop = 0;
    main.innerHTML = "";
    ({ today: viewToday, week: viewWeek, shopping: viewShopping, streaks: viewStreaks, template: viewTemplate, settings: viewSettings }[app.view] || viewToday)(main);
  }

  const svg = (d, extra) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    n.setAttribute("viewBox", "0 0 24 24"); n.setAttribute("fill", "none");
    n.setAttribute("stroke", "currentColor"); n.setAttribute("stroke-width", "2");
    n.setAttribute("stroke-linecap", "round"); n.setAttribute("stroke-linejoin", "round");
    n.innerHTML = d; if (extra) n.setAttribute("style", extra);
    return n;
  };
  const CHECK = '<path d="M20 6 9 17l-5-5"/>';
  const BELL = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>';

  function head(parent, title, sub, right) {
    parent.append(el("div", { class: "view-head" },
      el("div", {}, el("h1", {}, title), sub && el("div", { class: "sub" }, sub)),
      right,
    ));
  }
  // compact ‹ label › control
  const stepNav = (onPrev, onHome, onNext, midLabel) =>
    el("div", { class: "stepper" },
      el("button", { onclick: onPrev, "aria-label": "Previous" }, svg('<path d="M15 18 9 12l6-6"/>')),
      el("button", { class: "mid", onclick: onHome }, midLabel),
      el("button", { onclick: onNext, "aria-label": "Next" }, svg('<path d="m9 18 6-6-6-6"/>')));
  const catStyle = (id) => `--cat: ${catColor(id)}`;

  // ---------------------------------------------------------------- view: today

  function viewToday(root) {
    const key = app.date, day = getDay(key);
    const { rows, counts } = reconcile(day, key);
    const view = el("div", { class: "view" });
    head(view, humanDate(key), longDate(key),
      stepNav(() => { app.date = addDays(key, -1); render(); },
              () => { app.date = todayKey(); render(); },
              () => { app.date = addDays(key, 1); render(); }, "Today"));

    const d = counts;
    view.append(el("div", { class: "drift" },
      el("span", { class: "on" }, el("b", {}, String(d.onPlan)), "on plan"),
      el("span", { class: "off" }, el("b", {}, String(d.drifted)), "drifted"),
      el("span", { class: "miss" }, el("b", {}, String(d.missed)), "skipped"),
      el("span", {}, el("b", {}, String(d.extra)), "unplanned")));

    view.append(el("div", { class: "columns" },
      todayCol("Planned", "planned", day, rows, key),
      todayCol("Actual", "actual", day, rows, key)));

    const ta = el("textarea", { placeholder: "How did the day actually go?", onchange: (e) => { day.note = e.target.value; touch(); } });
    ta.value = day.note || "";
    view.append(el("div", { class: "day-note" }, el("label", {}, "Day note"), ta));
    root.append(view);
  }

  function todayCol(title, kind, day, rows, key) {
    const items = byStart(day[kind]);
    return el("div", { class: "card" },
      el("div", { class: "card-head" },
        el("h2", {}, title),
        kind === "planned" && el("button", { class: "btn ghost small", onclick: () => reseedDay(key) }, "Reset")),
      el("div", { class: "card-body" },
        items.length ? items.map((b) => blockRow(b, kind, rows, key))
          : el("div", { class: "empty" }, kind === "planned" ? "Nothing planned yet." : "Log sessions as the day goes.")),
      el("div", { class: "card-foot" },
        el("button", { onclick: () => openBlockSheet({ mode: kind, dateKey: key }) },
          kind === "planned" ? "Add block" : "Log a session")));
  }

  function blockRow(b, kind, rows, key) {
    let tag = null;
    const rMatch = kind === "planned" ? rows.find((r) => r.planned && r.planned.id === b.id) : rows.find((r) => r.actual && r.actual.id === b.id);
    if (kind === "planned" && rMatch) {
      if (rMatch.kind === "matched") {
        tag = rMatch.status === "on" ? el("span", { class: "tag on" }, "on plan")
          : el("span", { class: "tag " + rMatch.status }, `${rMatch.delta > 0 ? "+" : "−"}${fmtDur(Math.abs(rMatch.delta))}`);
      } else if (rMatch.kind === "planned-only" && rMatch.missed) tag = el("span", { class: "tag miss" }, "skipped");
    } else if (kind === "actual" && rMatch && rMatch.kind === "actual-only") {
      tag = el("span", { class: "tag extra" }, "unplanned");
    }
    const showDone = kind === "planned" && (!rMatch || rMatch.kind === "planned-only");
    const rem = kind === "planned" ? reminderFor(b.id) : null;
    if (rem) {
      const mins = Math.max(0, Math.round((rem.fireAt - Date.now()) / 60000));
      tag = el("span", { class: "tag rem" }, `⏰ ${mins < 1 ? "<1m" : fmtDur(mins)}`);
    }
    return el("div", { class: "block", style: catStyle(b.category),
      onclick: (e) => { if (!e.target.closest(".b-done") && !e.target.closest(".b-bell")) openBlockSheet({ mode: kind, dateKey: key, block: b }); } },
      el("div", { class: "b-main" },
        el("div", { class: "b-title" }, el("span", { class: "b-label" }, b.label || catName(b.category)), tag),
        el("div", { class: "b-meta" },
          el("span", { class: "mono" }, fmtRange(b.start, b.end)),
          el("span", { class: "dot" }), catName(b.category),
          el("span", { class: "dot" }), fmtDur(spanMin(b.start, b.end)))),
      kind === "planned" && el("button", { class: "b-bell" + (rem ? " active" : ""), title: rem ? "Change reminder" : "Remind me later", onclick: () => openReminderSheet(b) }, svg(BELL)),
      showDone && el("button", { class: "b-done", title: "Done now", onclick: () => markDone(b, key) }, svg(CHECK)));
  }

  function markDone(planned, key) {
    const day = getDay(key), now = minutesNow(), dur = spanMin(planned.start, planned.end);
    const start = key === todayKey() ? fromMin(Math.max(0, now - Math.min(dur, now))) : planned.start;
    const end = key === todayKey() ? fromMin(now) : planned.end;
    day.actual.push({ id: uid(), category: planned.category, label: planned.label, start, end });
    touch(); render();
  }
  function removeBlock(kind, key, id) { const day = getDay(key); day[kind] = day[kind].filter((b) => b.id !== id); touch(); render(); }
  function reseedDay(key) {
    const day = getDay(key, false); const wd = jsWeekday(key);
    day.planned = (data.template[wd] || []).map((t) => ({ id: uid(), category: t.category, label: t.label, start: t.start, end: t.end, seeded: true }));
    day.templateApplied = true; touch(); render();
    toast(`Reset to the ${WD_LONG[wd]} template`);
  }

  // ---------------------------------------------------------------- view: week

  function viewWeek(root) {
    const anchor = app.weekAnchor;
    const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
    days.forEach((k) => getDay(k));
    const view = el("div", { class: "view" });
    head(view, "Week", `${shortDate(anchor)} – ${shortDate(addDays(anchor, 6))}`,
      stepNav(() => { app.weekAnchor = addDays(anchor, -7); render(); },
              () => { app.weekAnchor = mondayOf(todayKey()); render(); },
              () => { app.weekAnchor = addDays(anchor, 7); render(); }, "This week"));

    const modeBtn = (m, l) => el("button", { class: app.weekMode === m ? "active" : "", onclick: () => { app.weekMode = m; render(); } }, l);
    view.append(el("div", { class: "seg" }, modeBtn("planned", "Planned"), modeBtn("actual", "Actual"), modeBtn("both", "Both")));

    view.append(isPhone() ? weekList(days) : weekGrid(days));
    root.append(view);
  }

  function weekList(days) {
    const wrap = el("div", { class: "weeklist" });
    for (const k of days) {
      const day = data.days[k] || { planned: [], actual: [] };
      const isToday = k === todayKey();
      const body = el("div", { class: "wday-body" });
      const rowsToShow = [];
      if (app.weekMode !== "actual") day.planned.forEach((b) => rowsToShow.push(["plan", b]));
      if (app.weekMode !== "planned") day.actual.forEach((b) => rowsToShow.push(["act", b]));
      rowsToShow.sort((a, b) => toMin(a[1].start) - toMin(b[1].start));
      if (!rowsToShow.length) body.append(el("div", { class: "empty", style: "padding:8px" }, "Nothing"));
      for (const [t, b] of rowsToShow) {
        body.append(el("div", { class: "mini " + (t === "plan" ? "plan" : ""), style: catStyle(b.category), onclick: () => { app.date = k; setView("today"); } },
          el("span", { class: "mt" }, b.start), el("span", { class: "mn" }, b.label || catName(b.category))));
      }
      wrap.append(el("div", { class: "wday" },
        el("div", { class: "wday-head" + (isToday ? " today" : ""), onclick: () => { app.date = k; setView("today"); } },
          el("b", {}, WD[jsWeekday(k)]), isToday && el("span", { style: "color:var(--accent);font-size:11px" }, "today"),
          el("span", { class: "wd-date" }, shortDate(k))),
        body));
    }
    return wrap;
  }

  function weekGrid(days) {
    const startH = data.settings.dayStartHour, endH = data.settings.dayEndHour;
    const span = (endH - startH) * 60, PXH = 40, height = (endH - startH) * PXH;
    const yFor = (min) => ((Math.max(startH * 60, Math.min(endH * 60, min)) - startH * 60) / span) * height;
    const grid = el("div", { class: "grid" });
    grid.append(el("div", { class: "corner" }));
    days.forEach((k) => {
      const d = fromKey(k), t = k === todayKey();
      grid.append(el("div", { class: "colhead" + (t ? " today" : "") }, el("b", {}, WD[d.getDay()]), el("span", {}, shortDate(k))));
    });
    const hours = el("div", { class: "hours", style: `height:${height}px` });
    for (let h = startH; h <= endH; h++) hours.append(el("div", { class: "hour-label", style: `top:${yFor(h * 60)}px` }, h === 24 ? "24" : pad(h)));
    grid.append(hours);
    const both = app.weekMode === "both";
    days.forEach((k) => {
      const day = data.days[k], t = k === todayKey();
      const lane = el("div", { class: "lane" + (t ? " today" : ""), style: `height:${height}px` });
      for (let h = startH + 1; h < endH; h++) lane.append(el("div", { class: "hour-line", style: `top:${yFor(h * 60)}px` }));
      const draw = (b, kind) => {
        const endM = toMin(b.end) <= toMin(b.start) ? endH * 60 : toMin(b.end);
        const top = yFor(toMin(b.start)), h = Math.max(13, yFor(endM) - top);
        lane.append(el("div", { class: `evt ${kind}` + (both ? " split" : ""), style: `top:${top}px;height:${h}px;--cat:${catColor(b.category)}`,
          onclick: () => { app.date = k; setView("today"); } }, el("div", { class: "et" }, b.start), el("div", {}, b.label || catName(b.category))));
      };
      if (day && app.weekMode !== "actual") day.planned.forEach((b) => draw(b, "planned"));
      if (day && app.weekMode !== "planned") day.actual.forEach((b) => draw(b, "actual"));
      if (t && minutesNow() >= startH * 60 && minutesNow() <= endH * 60) lane.append(el("div", { class: "nowline", style: `top:${yFor(minutesNow())}px` }));
      grid.append(lane);
    });
    return el("div", { class: "grid-wrap" }, grid);
  }

  // ---------------------------------------------------------------- view: streaks

  function viewStreaks(root) {
    const view = el("div", { class: "view" });
    head(view, "Streaks", "Consecutive days with a logged session, counting back from today");
    const cards = el("div", { class: "cards-grid" });
    for (const cat of TRACKED) {
      const s = streakFor(cat), c = CAT[cat];
      cards.append(el("div", { class: "streak", style: `--cat:${c.color}` },
        el("div", { class: "s-top" }, el("span", { class: "cat-dot" }), el("h3", {}, c.name)),
        el("div", { class: "s-num" }, String(s.current), el("small", {}, s.current === 1 ? " day" : " days")),
        el("div", { class: "s-stats" },
          el("div", {}, el("b", {}, String(s.longest)), "best"),
          el("div", {}, el("b", {}, String(s.last7)), "7d"),
          el("div", {}, el("b", {}, String(s.last30)), "30d")),
        dotStrip(cat)));
    }
    view.append(cards);
    root.append(view);
  }
  function dotStrip(cat) {
    const s = el("div", { class: "dotstrip", style: `--cat:${CAT[cat].color}` });
    for (let i = 29; i >= 0; i--) {
      const k = addDays(todayKey(), -i);
      s.append(el("i", { class: (hasCat(k, cat) ? "hit" : "") + (i === 0 ? " today" : ""), title: k }));
    }
    return s;
  }

  // ---------------------------------------------------------------- view: template

  function viewTemplate(root) {
    const view = el("div", { class: "view" });
    head(view, "Template", "Your default week — new days start from this.",
      el("button", { class: "btn", onclick: applyTemplateForward }, "Apply forward"));
    const phone = isPhone();
    const grid = el("div", { class: "tmpl" });
    for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
      const items = byStart(data.template[wd] || []);
      if (phone && !items.length) {
        grid.append(el("div", { class: "tcol slim" },
          el("h3", {}, WD_LONG[wd]),
          el("button", { class: "tadd", onclick: () => openTemplateSheet(wd, null) }, "＋ Add")));
        continue;
      }
      grid.append(el("div", { class: "tcol" },
        el("h3", {}, phone ? WD_LONG[wd] : WD[wd]),
        el("div", { class: "tbody" },
          items.length ? items.map((t) => el("div", { class: "titem", style: catStyle(t.category), onclick: (e) => { if (!e.target.closest(".tx")) openTemplateSheet(wd, t); } },
            el("div", { class: "tt" }, el("span", {}, t.label || catName(t.category)),
              el("button", { class: "tx", onclick: () => { data.template[wd] = data.template[wd].filter((x) => x.id !== t.id); touch(); render(); } }, "✕")),
            el("div", { class: "tm mono" }, fmtRange(t.start, t.end))))
            : el("div", { class: "empty", style: "padding:8px 4px" }, "—")),
        el("button", { class: "tadd", onclick: () => openTemplateSheet(wd, null) }, "Add")));
    }
    view.append(grid);
    root.append(view);
  }
  function applyTemplateForward() {
    const horizon = addDays(mondayOf(todayKey()), 13);
    let k = todayKey(), touched = 0;
    while (k <= horizon) {
      const ex = data.days[k];
      const handEdited = ex && ex.planned.length && !ex.planned.every((b) => b.seeded);
      if (!handEdited) {
        const wd = jsWeekday(k), day = getDay(k, false);
        day.planned = (data.template[wd] || []).map((t) => ({ id: uid(), category: t.category, label: t.label, start: t.start, end: t.end, seeded: true }));
        day.templateApplied = true; touched++;
      }
      k = addDays(k, 1);
    }
    touch(); render();
    toast(`Applied to ${touched} day${touched === 1 ? "" : "s"} — hand-edited days left alone`);
  }

  // ---------------------------------------------------------------- view: shopping

  function viewShopping(root) {
    const anchor = app.shopAnchor;
    const list = shoppingList(anchor);
    const totals = shoppingTotals(list);
    const view = el("div", { class: "view" });
    head(view, "Shopping", `${shortDate(anchor)} – ${shortDate(addDays(anchor, 6))}`,
      stepNav(() => { app.shopAnchor = addDays(anchor, -7); render(); },
              () => { app.shopAnchor = mondayOf(todayKey()); render(); },
              () => { app.shopAnchor = addDays(anchor, 7); render(); }, "This week"));

    view.append(shopAddBar(anchor));

    const wrap = el("div", { class: "shop-wrap" });
    const listEl = el("div", { class: "shop-list" });
    if (!list.items.length) {
      listEl.append(el("div", { class: "empty" }, "Nothing on the list yet."));
    } else {
      const aisles = [...new Set(list.items.map((i) => i.aisle))].sort((a, b) => aisleOrder(a) - aisleOrder(b));
      for (const ai of aisles) {
        const items = list.items.filter((i) => i.aisle === ai)
          .sort((a, b) => (a.bought - b.bought) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        const sub = items.reduce((s, it) => s + lineTotal(it), 0);
        listEl.append(el("div", { class: "aisle-h" }, AISLE_NAME[ai] || "Other", el("span", { class: "sub" }, money(sub))));
        items.forEach((it) => listEl.append(shopRow(it, anchor)));
      }
    }
    wrap.append(listEl, shopRail(anchor, totals));
    view.append(wrap);
    root.append(view);
  }

  function shopAddBar(key) {
    const name = el("input", { type: "text", class: "name", placeholder: "Add an item…", enterkeyhint: "done" });
    const aisle = el("select", {}, AISLES.map(([id, n]) => el("option", { value: id }, n)));
    const price = el("input", { type: "text", class: "price", inputmode: "decimal", placeholder: "0.00" });
    const submit = () => {
      const n = name.value.trim();
      if (!n) return;
      const p = parseAmount(price.value);
      shoppingList(key).items.push({ id: uid(), name: n, aisle: aisle.value, qty: 1, price: p && p > 0 ? p : 0, bought: false });
      touch(); render();
      setTimeout(() => $(".shop-add input.name")?.focus(), 0);
    };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    price.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    return el("div", { class: "shop-add" }, name, aisle,
      el("span", { class: "pfx" }, data.settings.currencySymbol), price,
      el("button", { class: "btn primary small", onclick: submit }, "Add"));
  }

  function shopRow(it, key) {
    return el("div", { class: "srow" + (it.bought ? " bought" : ""), onclick: (e) => { if (!e.target.closest(".scheck")) openItemSheet(it, key); } },
      el("button", { class: "scheck", "aria-label": "Bought", onclick: () => {
        const l = shoppingList(key), i = l.items.findIndex((x) => x.id === it.id);
        if (i >= 0) { l.items[i].bought = !l.items[i].bought; l.items[i].carried = false; touch(); render(); }
      } }, svg(CHECK)),
      el("div", { class: "sname" }, it.name || "Item",
        (it.carried && !it.bought) && el("span", { class: "tag carried" }, "last wk")),
      (Number(it.qty) || 1) !== 1 && el("span", { class: "sqty" }, "×" + trimNum(it.qty)),
      el("span", { class: "sline" }, money(lineTotal(it))));
  }

  function openItemSheet(it, key) {
    const editing = !!it;
    const draft = it ? { ...it } : { id: uid(), name: "", aisle: "other", qty: 1, price: 0, bought: false };
    const nameI = el("input", { type: "text", value: draft.name, placeholder: "Item name" });
    const aisleS = el("select", {}, AISLES.map(([id, n]) => el("option", { value: id, selected: id === draft.aisle }, n)));
    const qtyI = el("input", { type: "text", inputmode: "decimal", value: trimNum(draft.qty) });
    const priceI = el("input", { type: "text", inputmode: "decimal", value: draft.price ? Number(draft.price).toFixed(2) : "", placeholder: "0.00" });
    const save = () => {
      const l = shoppingList(key);
      const clean = { id: draft.id, name: nameI.value.trim() || "Item", aisle: aisleS.value,
        qty: Math.max(0, parseAmount(qtyI.value) || 1), price: Math.max(0, parseAmount(priceI.value) || 0),
        bought: draft.bought, carried: draft.carried };
      const i = l.items.findIndex((x) => x.id === draft.id);
      if (i >= 0) l.items[i] = clean; else l.items.push(clean);
      touch(); closeSheet(); render();
    };
    showSheet(el("div", {},
      el("h2", {}, editing ? "Edit item" : "Add item"),
      el("div", { class: "field" }, el("label", {}, "Name"), nameI),
      el("div", { class: "field" }, el("label", {}, "Aisle"), aisleS),
      el("div", { class: "field" }, el("div", { class: "times" },
        el("div", {}, el("label", {}, "Quantity"), qtyI),
        el("div", {}, el("label", {}, "Unit price " + data.settings.currencySymbol), priceI))),
      el("div", { class: "sheet-actions" },
        editing ? el("button", { class: "btn ghost small", onclick: () => { const l = shoppingList(key); l.items = l.items.filter((x) => x.id !== draft.id); touch(); closeSheet(); render(); } }, "Delete") : el("span"),
        el("div", { class: "right" },
          el("button", { class: "btn", onclick: closeSheet }, "Cancel"),
          el("button", { class: "btn primary", onclick: save }, editing ? "Save" : "Add")))));
  }

  function shopRail(key, t) {
    const hist = spendHistory(key, 8);
    const maxV = Math.max(...hist.map((w) => w.total), 0.01);
    const pct = t.total > 0 ? Math.min(100, (t.basket / t.total) * 100) : 0;
    return el("div", { class: "rail" },
      el("div", { class: "rail-card" },
        el("h3", {}, "This week"),
        el("div", { class: "rail-total mono" }, money(t.total), el("small", {}, "list total")),
        el("div", { class: "rail-stats" },
          el("div", {}, el("b", { class: "mono" }, money(t.basket)), "in basket"),
          el("div", {}, el("b", {}, `${t.boughtCount}/${t.count}`), "ticked off")),
        el("div", { class: "rail-bar" }, el("i", { style: `width:${pct}%` }))),
      el("div", { class: "rail-card" },
        el("h3", {}, "Recent weeks"),
        hist.length ? hist.map((w) => el("div", { class: "hrow" },
          el("div", { class: "hr-t" },
            el("span", { class: w.key === key ? "cur" : "" }, weekLabel(w.key)),
            el("b", {}, money(w.total))),
          el("div", { class: "hbar" + (w.key === key ? " cur" : ""), style: `width:${Math.max(3, (w.total / maxV) * 100)}%` })))
          : el("div", { class: "empty", style: "padding:4px 0;text-align:left" }, "No past weeks yet.")));
  }
  const weekLabel = (k) => k === mondayOf(todayKey()) ? "This week" : k === addDays(mondayOf(todayKey()), -7) ? "Last week" : "w/c " + shortDate(k);

  // ---------------------------------------------------------------- view: settings

  function viewSettings(root) {
    const s = data.settings;
    const view = el("div", { class: "view" });
    head(view, "Settings");

    const numRow = (label, help, key, min, max, step, suffix) => {
      const set = (v) => { v = Math.max(min, Math.min(max, v)); s[key] = v; mid.textContent = v + suffix; touch(); if (key.startsWith("day")) render(); };
      const mid = el("div", { class: "mid" }, s[key] + suffix);
      return el("div", { class: "set-row" },
        el("div", {}, el("div", { class: "s-label" }, label), el("div", { class: "s-help" }, help)),
        el("div", { class: "stepper" },
          el("button", { onclick: () => set(s[key] - step), "aria-label": "less" }, "−"),
          mid,
          el("button", { onclick: () => set(s[key] + step), "aria-label": "more" }, "+")));
    };
    const block = el("div", { class: "set-card" },
      numRow("Day starts", "First hour on the week grid.", "dayStartHour", 0, 12, 1, ":00"),
      numRow("Day ends", "Last hour on the week grid.", "dayEndHour", 13, 24, 1, ":00"),
      numRow("Drift tolerance", "How far a start can slip before Today flags it.", "driftThresholdMin", 0, 120, 5, "m"),
      numRow("Nudge lead time", "How long before a block a notification fires.", "nudgeLeadMin", 0, 120, 5, "m"),
      el("div", { class: "set-row" },
        el("div", {}, el("div", { class: "s-label" }, "Desktop nudges"), el("div", { class: "s-help" }, "Notify before planned blocks while Cadence is open.")),
        toggle(s.notificationsEnabled, async (on) => {
          if (on && "Notification" in window && Notification.permission !== "granted") {
            if (await Notification.requestPermission() !== "granted") { toast("Permission denied"); render(); return; }
          }
          s.notificationsEnabled = on; touch();
        })),
      el("div", { class: "set-row" },
        el("div", {}, el("div", { class: "s-label" }, "Currency symbol"), el("div", { class: "s-help" }, "Shown against every price on the Shopping list.")),
        el("input", { type: "text", value: s.currencySymbol, onchange: (e) => { s.currencySymbol = e.target.value.slice(0, 3) || "£"; e.target.value = s.currencySymbol; touch(); render(); } })));
    view.append(block);

    view.append(syncBox());

    view.append(el("div", { class: "settings-actions" },
      el("button", { class: "btn", onclick: exportData }, "Export backup"),
      el("button", { class: "btn", onclick: importData }, "Import backup")));
    root.append(view);
  }
  function toggle(on, onChange) {
    const input = el("input", { type: "checkbox", onchange: (e) => onChange(e.target.checked) });
    input.checked = !!on;
    return el("label", { class: "switch" }, input, el("span", { class: "track" }));
  }

  function syncBox() {
    const cfg = Sync.config();
    const box = el("div", { class: "sync-card" });
    box.append(el("h2", {}, "Sync across devices"));
    box.append(el("p", { html: 'Paste a GitHub token with <b>gist</b> scope — Cadence keeps one private Gist that this device and the Mac app both read and write. <a href="https://github.com/settings/tokens/new?scopes=gist&description=Cadence%20sync" target="_blank" rel="noopener">Create a token →</a>' }));
    const token = el("input", { type: "password", placeholder: "ghp_…", value: cfg.token || "" });
    const gid = el("input", { type: "text", placeholder: "leave blank to create one", value: cfg.gistId || "" });
    const status = el("div", { class: "sync-msg" });
    box.append(el("div", { class: "field" }, el("label", {}, "GitHub token"), token));
    box.append(el("div", { class: "field" }, el("label", {}, "Gist id"), gid));
    box.append(el("div", { class: "settings-actions" },
      el("button", { class: "btn primary", onclick: async () => {
        status.textContent = "Connecting…";
        try {
          const res = await Sync.connect(token.value.trim(), gid.value.trim(), data);
          gid.value = res.gistId;
          status.textContent = res.created ? "Created a new private Gist and pushed this device's data." :
            (res.pulled ? "Connected — pulled the newer copy from the Gist." : "Connected — pushed this device's data to the Gist.");
          render();
        } catch (e) { status.textContent = "Failed: " + e.message; }
      } }, "Connect"),
      cfg.token && el("button", { class: "btn danger", onclick: () => { Sync.disconnect(); toast("Sync turned off on this device"); render(); } }, "Turn off sync"),
      el("button", { class: "btn", onclick: async () => { status.textContent = "Syncing…"; try { await Sync.pull(); status.textContent = "Up to date."; } catch (e) { status.textContent = "Failed: " + e.message; } } }, "Sync now")));
    box.append(status);
    return box;
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `cadence-backup-${todayKey()}.json` });
    document.body.append(a); a.click(); a.remove();
  }
  function importData() {
    const inp = el("input", { type: "file", accept: "application/json,.json" });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const parsed = normalize(JSON.parse(await f.text()));
        if (!confirm("Replace all data on this device with the imported file?")) return;
        parsed.updatedAt = Date.now(); parsed.updatedBy = deviceId;
        data = parsed; persistLocal(); Sync.push(data); render(); toast("Imported");
      } catch { toast("That file didn't look like a Cadence backup"); }
    };
    inp.click();
  }

  // ---------------------------------------------------------------- block sheet

  function openBlockSheet({ mode, dateKey, block }) {
    const editing = !!block;
    const draft = block ? { ...block } : { id: uid(), category: "meal", label: "", start: defaultStart(), end: fromMin(toMin(defaultStart()) + 60) };
    const catGrid = el("div", { class: "catgrid" });
    const paint = () => { for (const o of catGrid.children) o.classList.toggle("sel", o.dataset.cat === draft.category); };
    for (const c of CATEGORIES) catGrid.append(el("button", { class: "catopt", "data-cat": c.id, style: `--cat:${c.color}`,
      onclick: () => { draft.category = c.id; if (!labelI.value) labelI.placeholder = c.name; paint(); } }, el("span", { class: "cat-dot" }), c.name));
    const labelI = el("input", { type: "text", value: draft.label, placeholder: CAT[draft.category].name, oninput: (e) => draft.label = e.target.value });
    const startI = el("input", { type: "time", value: draft.start, oninput: (e) => draft.start = e.target.value });
    const endI = el("input", { type: "time", value: draft.end, oninput: (e) => draft.end = e.target.value });
    const body = el("div", {},
      el("h2", {}, (editing ? "Edit " : "Add ") + (mode === "planned" ? "planned block" : "logged session")),
      el("div", { class: "field" }, el("label", {}, "Category"), catGrid),
      el("div", { class: "field" }, el("label", {}, "Label"), labelI),
      el("div", { class: "field" }, el("div", { class: "times" },
        el("div", {}, el("label", {}, "Start"), startI), el("div", {}, el("label", {}, "End"), endI))),
      el("div", { class: "sheet-actions" },
        editing ? el("button", { class: "btn ghost small", onclick: () => { removeBlock(mode, dateKey, draft.id); closeSheet(); } }, "Delete") : el("span"),
        el("div", { class: "right" },
          el("button", { class: "btn", onclick: closeSheet }, "Cancel"),
          el("button", { class: "btn primary", onclick: () => {
            if (draft.start === draft.end) { toast("Start and end can't match"); return; }
            const day = getDay(dateKey), list = day[mode];
            const clean = { id: draft.id, category: draft.category, label: draft.label.trim(), start: draft.start, end: draft.end };
            const i = list.findIndex((b) => b.id === draft.id);
            if (i >= 0) list[i] = clean; else list.push(clean);
            touch(); closeSheet(); render();
          } }, editing ? "Save" : "Add"))));
    paint();
    showSheet(body);
  }
  const defaultStart = () => fromMin(Math.round(minutesNow() / 15) * 15);

  function openTemplateSheet(wd, item) {
    const editing = !!item;
    const draft = item ? { ...item } : { id: uid(), category: "class", label: "", start: "09:00", end: "10:00" };
    const catGrid = el("div", { class: "catgrid" });
    const paint = () => { for (const o of catGrid.children) o.classList.toggle("sel", o.dataset.cat === draft.category); };
    for (const c of CATEGORIES) catGrid.append(el("button", { class: "catopt", "data-cat": c.id, style: `--cat:${c.color}`,
      onclick: () => { draft.category = c.id; paint(); } }, el("span", { class: "cat-dot" }), c.name));
    const labelI = el("input", { type: "text", value: draft.label, placeholder: CAT[draft.category].name, oninput: (e) => draft.label = e.target.value });
    const startI = el("input", { type: "time", value: draft.start, oninput: (e) => draft.start = e.target.value });
    const endI = el("input", { type: "time", value: draft.end, oninput: (e) => draft.end = e.target.value });
    const body = el("div", {},
      el("h2", {}, `${editing ? "Edit" : "Add"} · ${WD_LONG[wd]}`),
      el("div", { class: "field" }, el("label", {}, "Category"), catGrid),
      el("div", { class: "field" }, el("label", {}, "Label"), labelI),
      el("div", { class: "field" }, el("div", { class: "times" },
        el("div", {}, el("label", {}, "Start"), startI), el("div", {}, el("label", {}, "End"), endI))),
      el("div", { class: "sheet-actions" }, el("span"),
        el("div", { class: "right" },
          el("button", { class: "btn", onclick: closeSheet }, "Cancel"),
          el("button", { class: "btn primary", onclick: () => {
            if (draft.start === draft.end) { toast("Start and end can't match"); return; }
            const clean = { id: draft.id, category: draft.category, label: draft.label.trim(), start: draft.start, end: draft.end };
            const list = data.template[wd]; const i = list.findIndex((x) => x.id === draft.id);
            if (i >= 0) list[i] = clean; else list.push(clean);
            touch(); closeSheet(); render();
          } }, editing ? "Save" : "Add"))));
    paint();
    showSheet(body);
  }

  function showSheet(node) { const s = $("#sheet"); s.innerHTML = ""; s.append(node); $("#scrim").hidden = false; }
  function closeSheet() { $("#scrim").hidden = true; $("#sheet").innerHTML = ""; }
  $("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  // ---------------------------------------------------------------- toast

  let toastTimer = null;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400); }

  // ---------------------------------------------------------------- nudges + ticks

  const notified = new Set();
  function checkNudges() {
    if (!data || !data.settings.notificationsEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const day = data.days[todayKey()]; if (!day) return;
    const now = minutesNow(), lead = data.settings.nudgeLeadMin;
    for (const b of day.planned) {
      const start = toMin(b.start);
      if (now >= start - lead && now < start && !notified.has(b.id)) {
        notified.add(b.id);
        new Notification(`${b.label || catName(b.category)} in ${start - now} min`, { body: `${fmtRange(b.start, b.end)} · ${catName(b.category)}`, tag: `cadence-${b.id}` });
      }
    }
  }
  setInterval(() => { checkNudges(); checkReminders(); }, 20000);
  let lastDay = todayKey();
  setInterval(() => {
    if (!$("#scrim").hidden) return;
    const rolled = todayKey() !== lastDay; lastDay = todayKey();
    if (rolled && app.view === "today") app.date = todayKey();
    if (app.view === "week" || (app.view === "today" && app.date === todayKey())) render();
  }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { Sync.pull().catch(() => {}); checkNudges(); checkReminders(); } });
  window.addEventListener("online", () => Sync.push(data).catch(() => {}));

  // ---------------------------------------------------------------- boot

  $("#nav").addEventListener("click", (e) => { const b = e.target.closest(".nav-item"); if (b) setView(b.dataset.view); });
  window.addEventListener("resize", () => { if (app.view === "week") render(); });

  data = loadLocal();
  Sync.init();
  setView("today");
  Sync.pull().catch(() => {});
  checkReminders();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
