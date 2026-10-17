import { FirebaseRest } from "./firebase-rest.js";
import { firebaseConfig } from "./firebase-config.js";
import { createMessageId, hashFile, hashText, normalizeText } from "./lib/hash.js";
import { getLocal, removeLocal, setLocal } from "./lib/local-store.js";
import { queueDb } from "./lib/queue-db.js";

const root = document.querySelector("#root");
const CONFIG_KEY = "firebaseConfig";
const RECENT_KEY = "recentBroadcasts";
const THEME_KEY = "themePreference";
const defaults = firebaseConfig;

const state = {
  client: null,
  uid: "",
  broadcast: "0001",
  recent: ["0001"],
  messages: [],
  queue: [],
  processing: false,
  queueOpen: false,
  feedError: "",
  hasMore: false,
  loadingOlder: false,
  theme: "dark",
  activeUpload: null,
  cancelledUploads: new Set(),
};

boot();

async function boot() {
  state.theme = await getLocal(THEME_KEY, "dark");
  applyTheme(state.theme);
  state.recent = Array.from(new Set(["0001", ...(await getLocal(RECENT_KEY, []))])).slice(0, 8);
  state.queue = (await queueDb.all()).sort((a, b) => a.createdAt - b.createdAt);
  for (const item of state.queue.filter((entry) => entry.status === "done")) await queueDb.delete(item.id);
  for (const item of state.queue.filter((entry) => entry.status === "uploading")) {
    await queueDb.put({ ...item, status: "queued", progress: 0 });
  }
  const config = await getLocal(CONFIG_KEY, firebaseConfig);
  await connect({ ...firebaseConfig, ...config });
}

function renderSetup(saved = {}, error = "") {
  const config = { ...defaults, ...saved };
  root.innerHTML = `
    <main class="setup-shell"><section class="setup-card">
      <div class="setup-toolbar">${themeSelect()}</div>
      <div class="setup-mark"><span class="setup-cloud">☁</span><span class="live-dot"></span></div>
      <p class="eyebrow">ONE-TIME CONNECTION</p><h1>Connect Syncavro</h1>
      <p class="setup-copy">The shared GitHub configuration is prefilled. Update it only when connecting to another Firebase project.</p>
      <form id="setup-form"><div class="setup-fields">
        ${setupField("apiKey", "API key", config.apiKey, "password")}
        ${setupField("authDomain", "Auth domain", config.authDomain)}
        ${setupField("databaseURL", "Realtime Database URL", config.databaseURL, "text", true)}
        ${setupField("projectId", "Project ID", config.projectId)}
        ${setupField("storageBucket", "Storage bucket", config.storageBucket, "text", true)}
        ${setupField("appId", "App ID", config.appId)}
      </div>${error ? `<p class="error-banner">${escapeHtml(error)}</p>` : ""}
      <button class="primary full" type="submit">✓ &nbsp; Save & connect</button></form>
      <p class="setup-hint">Enable Anonymous sign-in, Realtime Database, and Storage in Firebase before connecting.</p>
    </section></main>`;
  bindThemeSelect();
  document.querySelector("#setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Connecting…";
    const next = Object.fromEntries(new FormData(event.currentTarget));
    await setLocal(CONFIG_KEY, next);
    await connect(next);
  });
}

function setupField(name, label, value, type = "text", wide = false) {
  return `<label class="${wide ? "wide" : ""}"><span>${label}</span><div class="field-wrap"><input required name="${name}" type="${type}" value="${escapeHtml(value || "")}" spellcheck="false" placeholder="${label}" /></div></label>`;
}

async function connect(config) {
  try {
    state.client?.closeStream();
    state.client = new FirebaseRest(config);
    state.uid = await state.client.connect();
    renderApp();
    await joinBroadcast(state.broadcast);
    processQueue();
  } catch (error) {
    renderSetup(config, friendlyError(error));
  }
}

function renderApp() {
  root.innerHTML = `
    <main class="app-shell">
      <header class="app-header"><div class="brand"><div class="brand-mark">☁<i></i></div><div><strong>Syncavro</strong><small>REAL-TIME SHARING</small></div></div><div class="header-actions">${themeSelect()}<button class="header-button" id="settings" title="Firebase settings">⚙</button></div></header>
      <div class="picker-row"><div class="broadcast-picker">
        <button class="broadcast-trigger" id="broadcast-trigger"><span class="hash-box">#</span><span><small>Broadcast</small><strong id="broadcast-label">0001</strong></span><span class="presence"><i></i> Live</span><span class="chevron">⌄</span></button>
        <div class="broadcast-menu" id="broadcast-menu" hidden></div>
      </div><button class="room-clear" id="room-clear" title="Delete all messages in this broadcast" aria-label="Delete all messages in this broadcast">⌫</button></div>
      <section class="feed" id="feed"></section>
      <div class="drop-zone" id="drop-zone" hidden><div><strong>Drop images to share</strong><span>Up to 10 MB each</span></div></div>
      <section id="queue-slot"></section>
      <section class="composer"><div class="composer-box"><textarea id="draft" rows="1" placeholder="Message broadcast #0001"></textarea><div class="composer-actions"><button class="attach" id="attach">▧ <span>Image</span></button><input id="files" hidden type="file" accept="image/*" multiple><span class="queue-count" id="queue-count">Ready</span><button class="send" id="send" disabled>➤</button></div></div><p class="privacy-note"><span></span> Live in #<b id="privacy-room">0001</b> · Long text loads on demand</p></section>
      <div id="toast-slot"></div>
    </main>`;
  bindAppEvents();
  renderFeed();
  renderQueue();
}

function bindAppEvents() {
  bindThemeSelect();
  const draft = document.querySelector("#draft");
  const send = document.querySelector("#send");
  draft.addEventListener("input", () => { send.disabled = !draft.value.trim(); });
  draft.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendText(); }
  });
  send.addEventListener("click", sendText);
  document.querySelector("#attach").addEventListener("click", () => document.querySelector("#files").click());
  document.querySelector("#files").addEventListener("change", (event) => addFiles([...event.target.files]));
  bindDropAndPaste();
  document.querySelector("#broadcast-trigger").addEventListener("click", toggleBroadcastMenu);
  document.querySelector("#room-clear").addEventListener("click", clearCurrentBroadcast);
  document.querySelector("#feed").addEventListener("scroll", async (event) => {
    if (event.currentTarget.scrollTop < 90) await loadOlderMessages();
  });
  document.querySelector("#settings").addEventListener("click", async () => {
    state.client.closeStream();
    const config = await getLocal(CONFIG_KEY, {});
    await removeLocal(CONFIG_KEY);
    renderSetup(config);
  });
}

function bindDropAndPaste() {
  const shell = document.querySelector(".app-shell");
  const dropZone = document.querySelector("#drop-zone");
  let dragDepth = 0;
  shell.addEventListener("dragenter", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropZone.hidden = false;
  });
  shell.addEventListener("dragover", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  shell.addEventListener("dragleave", (event) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.hidden = true;
  });
  shell.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropZone.hidden = true;
    addFiles([...event.dataTransfer.files]);
  });
  shell.addEventListener("paste", (event) => {
    const images = [...event.clipboardData.items]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (images.length) {
      event.preventDefault();
      addFiles(images);
      toast(`${images.length} image${images.length > 1 ? "s" : ""} pasted`);
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    const draft = document.querySelector("#draft");
    if (text && document.activeElement !== draft) {
      event.preventDefault();
      draft.value = `${draft.value}${text}`;
      draft.dispatchEvent(new Event("input"));
      draft.focus();
    }
  });
}

function hasDraggedFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

function themeSelect() {
  return `<label class="theme-control" title="Color theme"><span class="theme-icon">${state.theme === "light" ? "☀" : state.theme === "system" ? "◐" : "●"}</span><select id="theme-select" aria-label="Color theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option><option value="system" ${state.theme === "system" ? "selected" : ""}>System</option></select></label>`;
}

function bindThemeSelect() {
  document.querySelector("#theme-select")?.addEventListener("change", async (event) => {
    state.theme = event.target.value;
    await setLocal(THEME_KEY, state.theme);
    applyTheme(state.theme);
    const icon = document.querySelector(".theme-icon");
    if (icon) icon.textContent = state.theme === "light" ? "☀" : state.theme === "system" ? "◐" : "●";
  });
}

function applyTheme(preference) {
  const resolved = preference === "system"
    ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

async function joinBroadcast(number) {
  if (!/^\d{4}$/.test(number)) return;
  state.broadcast = number;
  state.feedError = "";
  state.messages = [];
  state.hasMore = false;
  state.recent = [number, ...state.recent.filter((item) => item !== number)].slice(0, 8);
  await setLocal(RECENT_KEY, state.recent);
  updateRoomLabels();
  renderFeed();
  await state.client.listen(number, (messages, meta = {}) => {
    state.messages = messages;
    state.hasMore = Boolean(meta.hasMore);
    state.feedError = "";
    renderFeed();
  }, (error) => {
    state.feedError = friendlyError(error);
    renderFeed();
  });
}

async function loadOlderMessages() {
  if (state.loadingOlder || !state.hasMore || !state.messages.length) return;
  const feed = document.querySelector("#feed");
  state.loadingOlder = true;
  const previousHeight = feed.scrollHeight;
  try {
    const result = await state.client.loadOlder(state.broadcast);
    state.hasMore = result.hasMore;
    requestAnimationFrame(() => { feed.scrollTop += feed.scrollHeight - previousHeight; });
  } catch (error) {
    toast(friendlyError(error));
  } finally {
    state.loadingOlder = false;
  }
}

async function clearCurrentBroadcast() {
  if (!state.messages.length) return toast("This broadcast is already empty");
  if (!confirm(`Delete every message in broadcast #${state.broadcast}? Other broadcasts will not be changed.`)) return;
  try {
    await state.client.clearBroadcast(state.broadcast);
    state.messages = [];
    state.hasMore = false;
    renderFeed();
    toast(`Broadcast #${state.broadcast} cleared`);
  } catch (error) { toast(friendlyError(error)); }
}

function updateRoomLabels() {
  document.querySelector("#broadcast-label").textContent = state.broadcast;
  document.querySelector("#privacy-room").textContent = state.broadcast;
  document.querySelector("#draft").placeholder = `Message broadcast #${state.broadcast}`;
}

function toggleBroadcastMenu() {
  const menu = document.querySelector("#broadcast-menu");
  menu.hidden = !menu.hidden;
  if (menu.hidden) return;
  menu.innerHTML = `<div class="menu-title"><span>Switch broadcast</span><button id="close-menu">×</button></div><div class="manual-row"><span>#</span><input id="manual-room" inputmode="numeric" maxlength="4" value="${state.broadcast}" aria-label="Four digit broadcast number"><button class="join-button" id="join-room">✓</button></div><p class="menu-label">RECENT</p><div class="recent-list">${state.recent.map((number) => `<div class="recent-row ${number === state.broadcast ? "active" : ""}"><button class="recent-open" data-room="${number}"><span>#</span><span>${number}</span>${number === state.broadcast ? "<em>Current</em>" : ""}</button>${number !== "0001" ? `<button class="recent-delete" data-delete="${number}">⌫</button>` : ""}</div>`).join("")}</div>`;
  menu.querySelector("#close-menu").onclick = () => { menu.hidden = true; };
  const manual = menu.querySelector("#manual-room");
  manual.oninput = () => { manual.value = manual.value.replace(/\D/g, "").slice(0, 4); };
  const openManual = () => { if (/^\d{4}$/.test(manual.value)) { menu.hidden = true; joinBroadcast(manual.value); } };
  menu.querySelector("#join-room").onclick = openManual;
  manual.onkeydown = (event) => { if (event.key === "Enter") openManual(); };
  menu.querySelectorAll("[data-room]").forEach((button) => button.onclick = () => { menu.hidden = true; joinBroadcast(button.dataset.room); });
  menu.querySelectorAll("[data-delete]").forEach((button) => button.onclick = async () => {
    state.recent = state.recent.filter((number) => number !== button.dataset.delete);
    await setLocal(RECENT_KEY, state.recent);
    toggleBroadcastMenu(); toggleBroadcastMenu();
  });
}

async function sendText() {
  const input = document.querySelector("#draft");
  const text = normalizeText(input.value);
  if (!text) return;
  input.value = "";
  document.querySelector("#send").disabled = true;
  const contentHash = await hashText(text);
  const messageId = createMessageId();
  await enqueue({ id: `${state.broadcast}:${messageId}`, messageId, contentHash, broadcast: state.broadcast, type: "text", text, status: "queued", progress: 0, createdAt: Date.now() });
}

async function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) { toast("Only image files can be shared"); continue; }
    const name = file.name || `pasted-image-${Date.now()}.${file.type.split("/")[1] || "png"}`;
    if (file.size > 10 * 1024 * 1024) { toast(`${name} is over 10 MB`); continue; }
    const contentHash = await hashFile(file);
    const messageId = createMessageId();
    await enqueue({ id: `${state.broadcast}:${messageId}`, messageId, contentHash, broadcast: state.broadcast, type: "image", blob: file, name, mime: file.type, size: file.size, status: "queued", progress: 0, createdAt: Date.now() });
  }
  document.querySelector("#files").value = "";
}

async function enqueue(item) {
  const existing = (await queueDb.all()).find((entry) => entry.id === item.id && entry.status !== "error");
  if (existing) return toast("Already in your queue");
  await queueDb.put(item);
  await refreshQueue();
  processQueue();
}

async function processQueue() {
  if (state.processing || !state.client) return;
  const item = state.queue.find((entry) => entry.status === "queued");
  if (!item) return;
  state.processing = true;
  const controller = new AbortController();
  state.activeUpload = { id: item.id, controller };
  const uploading = { ...item, status: "uploading", progress: item.type === "text" ? 80 : 2, error: "" };
  await queueDb.put(uploading);
  await refreshQueue();
  try {
    const result = await state.client.publish(uploading, async (progress) => {
      if (state.cancelledUploads.has(item.id)) return;
      await queueDb.put({ ...uploading, status: "uploading", progress });
      await refreshQueue();
    }, controller.signal);
    await queueDb.delete(item.id);
    toast(result.duplicate ? "Already shared" : "Shared successfully");
  } catch (error) {
    if (state.cancelledUploads.has(item.id)) {
      state.cancelledUploads.delete(item.id);
      await queueDb.delete(item.id);
    } else {
      await queueDb.put({ ...uploading, status: "error", progress: 0, error: friendlyError(error) });
    }
  }
  state.activeUpload = null;
  state.processing = false;
  await refreshQueue();
  processQueue();
}

async function refreshQueue() {
  state.queue = (await queueDb.all()).sort((a, b) => a.createdAt - b.createdAt);
  renderQueue();
}

function renderQueue() {
  const slot = document.querySelector("#queue-slot");
  if (!slot) return;
  const pending = state.queue.filter((item) => ["queued", "uploading"].includes(item.status)).length;
  document.querySelector("#queue-count").textContent = pending ? `${pending} queued` : "Ready";
  const visibleQueue = state.queue.filter((item) => item.status !== "done");
  if (!visibleQueue.length) { slot.innerHTML = ""; return; }
  const failed = visibleQueue.filter((item) => item.status === "error").length;
  const active = visibleQueue.some((item) => item.status === "uploading");
  slot.innerHTML = `<section class="queue-tray ${state.queueOpen ? "expanded" : ""}"><button class="queue-summary" id="queue-toggle"><span class="queue-icon">${failed ? "!" : active ? "↻" : "…"}</span><span><strong>${failed ? `${failed} upload${failed > 1 ? "s" : ""} need attention` : active ? "Uploading in background" : "Upload queue"}</strong><small>${visibleQueue.length} item${visibleQueue.length > 1 ? "s" : ""}</small></span><span>⌄</span></button>${state.queueOpen ? `<div class="queue-items">${visibleQueue.map(queueRow).join("")}<button class="clear-queue" id="clear-all">Clear all</button></div>` : ""}</section>`;
  slot.querySelector("#queue-toggle").onclick = () => { state.queueOpen = !state.queueOpen; renderQueue(); };
  slot.querySelectorAll("[data-retry]").forEach((button) => button.onclick = async () => {
    const item = state.queue.find((entry) => entry.id === button.dataset.retry);
    await queueDb.put({ ...item, status: "queued", error: "", progress: 0 });
    await refreshQueue(); processQueue();
  });
  slot.querySelectorAll("[data-clear]").forEach((button) => button.onclick = () => clearQueueItem(button.dataset.clear));
  slot.querySelector("#clear-all")?.addEventListener("click", clearAllQueue);
}

function queueRow(item) {
  const title = item.type === "image" ? item.name : item.text.slice(0, 34);
  return `<div class="queue-item"><div class="queue-thumb"><span>${item.type === "image" ? "IMG" : "TXT"}</span></div><div class="queue-info"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(item.status === "error" ? item.error : item.status)}</small><div class="progress"><i style="width:${item.progress || 0}%"></i></div></div><div class="queue-row-actions">${item.status === "error" ? `<button class="queue-action" data-retry="${item.id}">Retry</button>` : ""}<button class="queue-action clear" data-clear="${item.id}">Clear</button></div></div>`;
}

async function clearQueueItem(id) {
  if (state.activeUpload?.id === id) {
    state.cancelledUploads.add(id);
    state.activeUpload.controller.abort();
  }
  await queueDb.delete(id);
  await refreshQueue();
}

async function clearAllQueue() {
  if (state.activeUpload) {
    state.cancelledUploads.add(state.activeUpload.id);
    state.activeUpload.controller.abort();
  }
  await queueDb.clear();
  await refreshQueue();
}

function renderFeed() {
  const feed = document.querySelector("#feed");
  if (!feed) return;
  if (state.feedError) {
    feed.innerHTML = `<div class="state-card error-state"><span class="state-icon">!</span><strong>Couldn’t open this broadcast</strong><p>${escapeHtml(state.feedError)}</p></div>`;
    return;
  }
  if (!state.messages.length) {
    feed.innerHTML = `<div class="state-card"><div class="empty-orb">✦</div><strong>Broadcast #${state.broadcast} is ready</strong><p>Share text or an image. Anyone using this number will see it instantly.</p></div>`;
    return;
  }
  const shouldStickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100 && !state.loadingOlder;
  feed.innerHTML = state.loadingOlder ? `<div class="history-loader">Loading earlier messages…</div>` : "";
  for (const message of state.messages) feed.append(messageElement(message));
  if (shouldStickToBottom) requestAnimationFrame(() => feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" }));
}

function messageElement(message) {
  const mine = message.senderId === state.uid;
  const article = document.createElement("article");
  article.className = `message ${mine ? "mine" : "theirs"}`;
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<span class="avatar">●</span><span>${mine ? "You" : `Guest ${escapeHtml(message.senderId.slice(0, 4))}`}</span><time>${formatTime(message.createdAt)}</time><button class="message-delete" title="Delete message" aria-label="Delete message">⌫</button>`;
  meta.querySelector(".message-delete").onclick = async () => {
    if (!confirm("Delete this message?")) return;
    try { await state.client.deleteMessage(state.broadcast, message); toast("Message deleted"); }
    catch (error) { toast(friendlyError(error)); }
  };
  article.append(meta);
  if (message.type === "text") {
    const bubble = document.createElement("div");
    bubble.className = "text-bubble";
    const text = document.createElement("p");
    const preview = message.textPreview ?? message.text ?? "";
    text.textContent = preview;
    text.className = "message-text collapsed";
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copy = document.createElement("button");
    copy.textContent = "▣";
    copy.title = "Copy text";
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(await state.client.getText(state.broadcast, message)); toast("Copied to clipboard"); }
      catch (error) { toast(friendlyError(error)); }
    };
    actions.append(copy);
    if ((message.textLength || message.text?.length || 0) > 420) {
      const expand = document.createElement("button");
      expand.textContent = "⌄"; expand.title = "Read full message";
      expand.onclick = async () => {
        if (text.dataset.expanded === "true") {
          text.textContent = preview; text.dataset.expanded = "false"; text.classList.add("collapsed"); expand.textContent = "⌄"; return;
        }
        expand.disabled = true;
        try { text.textContent = await state.client.getText(state.broadcast, message); text.dataset.expanded = "true"; text.classList.remove("collapsed"); expand.textContent = "⌃"; }
        catch (error) { toast(friendlyError(error)); }
        finally { expand.disabled = false; }
      };
      actions.append(expand);
    }
    bubble.append(text, actions); article.append(bubble);
  } else {
    const card = document.createElement("div");
    card.className = "image-card";
    const image = new Image();
    image.src = message.url; image.alt = message.name || "Shared image"; image.loading = "lazy";
    const details = document.createElement("div");
    details.className = "image-details";
    details.innerHTML = `<span>▧</span><span><strong>${escapeHtml(message.name || "Image")}</strong><small>${formatSize(message.size)}</small></span>`;
    const download = document.createElement("button");
    download.textContent = "↓"; download.title = "Download image";
    download.onclick = () => chrome.downloads.download({ url: message.url, filename: `Syncavro/${message.name || "image"}`, saveAs: true });
    details.append(download); card.append(image, details); article.append(card);
  }
  if (mine) {
    const synced = document.createElement("span");
    synced.className = "delivered"; synced.textContent = "✓✓ Synced"; article.append(synced);
  }
  return article;
}

function toast(message) {
  const slot = document.querySelector("#toast-slot");
  if (!slot) return;
  slot.innerHTML = `<div class="toast">× ${escapeHtml(message)}</div>`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { if (slot) slot.innerHTML = ""; }, 2200);
}

function friendlyError(error) {
  const message = error?.message || String(error);
  if (/OPERATION_NOT_ALLOWED/i.test(message)) return "Anonymous sign-in is not enabled in Firebase Authentication.";
  if (/permission|unauthorized|denied/i.test(message)) return "Firebase denied access. Deploy the included database and storage rules.";
  if (/bucket.*not found|404/i.test(message)) return "Cloud Storage has not been created for this Firebase project.";
  if (/network|fetch|aborted/i.test(message)) return "Firebase did not respond in time. Check the project configuration and your connection.";
  return message.replace(/^Firebase:\s*/i, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
