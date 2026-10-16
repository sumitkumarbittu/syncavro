import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firebaseConfig } from "./config.js";
import { FirebaseClient } from "./lib/firebase.js";
import { createMessageId, hashFile, hashText, normalizeText } from "./lib/hash.js";
import { queueDb } from "./lib/queue.js";

const CONFIG_KEY = "syncavro.firebaseConfig";
const RECENT_KEY = "syncavro.recentBroadcasts";
const THEME_KEY = "syncavro.theme";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function friendlyError(error) {
  const message = error?.message || "Could not connect to Firebase.";
  if (/OPERATION_NOT_ALLOWED/i.test(message)) return "Anonymous Authentication is not enabled in Firebase.";
  if (/permission|denied|unauthorized/i.test(message)) return "Firebase denied access. Deploy the included Database and Storage rules.";
  if (/abort/i.test(message)) return "The request timed out. Check the Firebase connection and try again.";
  return message.replaceAll("_", " ");
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function App() {
  const [status, setStatus] = useState("connecting");
  const [config, setConfig] = useState(() => ({ ...firebaseConfig, ...readJson(CONFIG_KEY, {}) }));
  const [uid, setUid] = useState("");
  const [broadcast, setBroadcast] = useState("0001");
  const [recent, setRecent] = useState(() => [...new Set(["0001", ...readJson(RECENT_KEY, [])])].slice(0, 8));
  const [messages, setMessages] = useState([]);
  const [queue, setQueue] = useState([]);
  const [feedError, setFeedError] = useState("");
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manualRoom, setManualRoom] = useState("0001");
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [notice, setNotice] = useState("");
  const [processing, setProcessing] = useState(false);
  const clientRef = useRef(null);
  const initialized = useRef(false);
  const activeUpload = useRef(null);
  const cancelled = useRef(new Set());
  const fileInput = useRef(null);
  const feedRef = useRef(null);

  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : theme;

  const toast = useCallback((message) => {
    setNotice(message);
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => setNotice(""), 2400);
  }, []);

  const refreshQueue = useCallback(async () => {
    const items = (await queueDb.all()).filter((item) => item.status !== "done").sort((a, b) => a.createdAt - b.createdAt);
    setQueue(items);
  }, []);

  const connect = useCallback(async (nextConfig) => {
    setStatus("connecting");
    setFeedError("");
    try {
      clientRef.current?.closeStream();
      const client = new FirebaseClient(nextConfig);
      const nextUid = await client.connect();
      clientRef.current = client;
      setUid(nextUid);
      setStatus("ready");
    } catch (error) {
      setFeedError(friendlyError(error));
      setStatus("setup");
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const items = await queueDb.all();
      await Promise.all(items.filter((item) => item.status === "uploading").map((item) => queueDb.put({ ...item, status: "queued", progress: 0 })));
      await refreshQueue();
      await connect(config);
    })();
    return () => clientRef.current?.closeStream();
  }, [config, connect, refreshQueue]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme, resolvedTheme]);

  useEffect(() => {
    if (status !== "ready" || !clientRef.current) return;
    setMessages([]);
    setFeedError("");
    const nextRecent = [broadcast, ...recent.filter((room) => room !== broadcast)].slice(0, 8);
    setRecent(nextRecent);
    localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent));
    let cleanup;
    clientRef.current.listen(broadcast, (next) => {
      setMessages(next);
      setFeedError("");
    }, (error) => setFeedError(friendlyError(error))).then((fn) => { cleanup = fn; });
    return () => cleanup?.();
    // recent is intentionally omitted to avoid reconnecting after history updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast, status]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const item = queue.find((entry) => entry.status === "queued");
    if (!item || processing || status !== "ready" || !clientRef.current) return;
    setProcessing(true);
    const controller = new AbortController();
    activeUpload.current = { id: item.id, controller };
    const uploading = { ...item, status: "uploading", progress: item.type === "text" ? 80 : 2, error: "" };
    (async () => {
      await queueDb.put(uploading);
      await refreshQueue();
      try {
        const result = await clientRef.current.publish(uploading, async (progress) => {
          if (cancelled.current.has(item.id)) return;
          await queueDb.put({ ...uploading, status: "uploading", progress });
          await refreshQueue();
        }, controller.signal);
        await queueDb.delete(item.id);
        toast(result.duplicate ? "Already shared" : "Shared successfully");
      } catch (error) {
        if (cancelled.current.has(item.id)) {
          cancelled.current.delete(item.id);
          await queueDb.delete(item.id);
        } else {
          await queueDb.put({ ...uploading, status: "error", progress: 0, error: friendlyError(error) });
        }
      } finally {
        activeUpload.current = null;
        setProcessing(false);
        await refreshQueue();
      }
    })();
  }, [queue, processing, refreshQueue, status, toast]);

  const enqueue = useCallback(async (item) => {
    const existing = (await queueDb.all()).find((entry) => entry.id === item.id && entry.status !== "error");
    if (existing) return toast("Already in your queue");
    await queueDb.put(item);
    await refreshQueue();
  }, [refreshQueue, toast]);

  const sendText = async () => {
    const text = normalizeText(draft);
    if (!text) return;
    setDraft("");
    const contentHash = await hashText(text);
    const messageId = createMessageId();
    await enqueue({ id: `${broadcast}:${messageId}`, messageId, contentHash, broadcast, type: "text", text, status: "queued", progress: 0, createdAt: Date.now() });
  };

  const addFiles = useCallback(async (files) => {
    for (const file of files) {
      if (!file?.type?.startsWith("image/")) { toast("Only image files can be shared"); continue; }
      const name = file.name || `pasted-image-${Date.now()}.${file.type.split("/")[1] || "png"}`;
      if (file.size > MAX_IMAGE_BYTES) { toast(`${name} is over 10 MB`); continue; }
      const contentHash = await hashFile(file);
      const messageId = createMessageId();
      await enqueue({ id: `${broadcast}:${messageId}`, messageId, contentHash, broadcast, type: "image", blob: file, name, mime: file.type, size: file.size, status: "queued", progress: 0, createdAt: Date.now() });
    }
    if (fileInput.current) fileInput.current.value = "";
  }, [broadcast, enqueue, toast]);

  const clearItem = async (id) => {
    if (activeUpload.current?.id === id) {
      cancelled.current.add(id);
      activeUpload.current.controller.abort();
    }
    await queueDb.delete(id);
    await refreshQueue();
  };

  const clearAll = async () => {
    if (activeUpload.current) {
      cancelled.current.add(activeUpload.current.id);
      activeUpload.current.controller.abort();
    }
    await queueDb.clear();
    await refreshQueue();
  };

  const retry = async (item) => {
    await queueDb.put({ ...item, status: "queued", progress: 0, error: "" });
    await refreshQueue();
  };

  const openRoom = (room) => {
    if (!/^\d{4}$/.test(room)) return;
    setBroadcast(room);
    setManualRoom(room);
    setMenuOpen(false);
  };

  const removeRecent = (room) => {
    const next = recent.filter((item) => item !== room);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const handlePaste = (event) => {
    const images = [...event.clipboardData.items].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
    if (images.length) {
      event.preventDefault();
      addFiles(images);
      toast(`${images.length} image${images.length > 1 ? "s" : ""} pasted`);
    }
  };

  if (status === "connecting") return <Loading theme={theme} setTheme={setTheme} />;
  if (status === "setup") return <Setup config={config} error={feedError} theme={theme} setTheme={setTheme} onConnect={(next) => {
    setConfig(next);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    connect(next);
  }} />;

  const pending = queue.filter((item) => ["queued", "uploading"].includes(item.status)).length;
  return (
    <div className="site" onPaste={handlePaste} onDragEnter={(event) => { if ([...(event.dataTransfer?.types || [])].includes("Files")) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}>
      <aside className="desktop-intro">
        <div className="hero-mark">S</div>
        <p className="eyebrow">REAL-TIME FIREBASE SHARING</p>
        <h1>Move anything.<br />Keep everyone in sync.</h1>
        <p>One focused place for quick text and image handoffs across your phone, laptop, and team.</p>
        <div className="hero-pills"><span>Live broadcasts</span><span>Duplicate-free</span><span>Private queue</span></div>
        <div className="hero-room"><i></i><span>Connected to broadcast</span><strong>#{broadcast}</strong></div>
      </aside>
      <main className="app-shell">
        <header className="app-header">
          <div className="brand"><div className="brand-mark">S<i /></div><div><strong>Syncavro</strong><small>REAL-TIME SHARING</small></div></div>
          <div className="header-actions"><ThemeSelect value={theme} onChange={setTheme} /><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Firebase settings">⚙</button></div>
        </header>
        <div className="picker-row">
          <button className="broadcast-trigger" onClick={() => setMenuOpen((value) => !value)}><span className="hash-box">#</span><span><small>Broadcast</small><strong>{broadcast}</strong></span><span className="presence"><i /> Live</span><span>⌄</span></button>
          {menuOpen && <BroadcastMenu broadcast={broadcast} recent={recent} manual={manualRoom} setManual={(value) => setManualRoom(value.replace(/\D/g, "").slice(0, 4))} openRoom={openRoom} removeRecent={removeRecent} close={() => setMenuOpen(false)} />}
        </div>
        <section className="feed" ref={feedRef}>
          {feedError ? <EmptyState error title="Couldn’t open this broadcast" text={feedError} /> : !messages.length ? <EmptyState title={`Broadcast #${broadcast} is ready`} text="Share text or an image. Anyone using this number will see it instantly." /> : messages.map((message) => <Message key={message.id} message={message} mine={message.senderId === uid} toast={toast} />)}
        </section>
        {!!queue.length && <QueueTray queue={queue} open={queueOpen} setOpen={setQueueOpen} clearItem={clearItem} clearAll={clearAll} retry={retry} />}
        <section className="composer">
          <div className="composer-box"><textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 5000))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendText(); } }} rows="1" placeholder={`Message broadcast #${broadcast}`} /><div className="composer-actions"><button className="attach" onClick={() => fileInput.current?.click()}>▧ <span>Image</span></button><input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={(event) => addFiles([...event.target.files])} /><span className="queue-count">{pending ? `${pending} queued` : "Ready"}</span><button className="send" disabled={!draft.trim()} onClick={sendText}>➤</button></div></div>
          <p className="privacy-note"><span /> Live in #{broadcast} · Images up to 10 MB</p>
        </section>
        {dragging && <div className="drop-zone" onDragLeave={() => setDragging(false)}><div><strong>Drop images to share</strong><span>Up to 10 MB each</span></div></div>}
        {notice && <div className="toast">✓ {notice}</div>}
      </main>
      {settingsOpen && <Settings config={config} onClose={() => setSettingsOpen(false)} onSave={(next) => {
        setConfig(next);
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
        setSettingsOpen(false);
        connect(next);
      }} />}
    </div>
  );
}

function ThemeSelect({ value, onChange }) {
  return <label className="theme-control"><span>{value === "light" ? "☀" : value === "system" ? "◐" : "●"}</span><select aria-label="Color theme" value={value} onChange={(event) => onChange(event.target.value)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>;
}

function Loading({ theme, setTheme }) {
  return <main className="loading"><div className="loading-top"><div className="brand-mark">S</div><ThemeSelect value={theme} onChange={setTheme} /></div><div className="pulse-logo">S</div><strong>Connecting securely</strong><span>Preparing your live broadcasts…</span></main>;
}

function Setup({ config, error, theme, setTheme, onConnect }) {
  const [form, setForm] = useState(config);
  return <main className="setup-shell"><section className="setup-card"><div className="setup-toolbar"><ThemeSelect value={theme} onChange={setTheme} /></div><div className="setup-mark">S<i /></div><p className="eyebrow">ONE-TIME CONNECTION</p><h1>Connect Syncavro</h1><p className="setup-copy">The shared Firebase project is prefilled. Change these values only when using another backend.</p><form onSubmit={(event) => { event.preventDefault(); onConnect(form); }}><div className="setup-fields">{[["apiKey","API key"],["authDomain","Auth domain"],["databaseURL","Realtime Database URL"],["projectId","Project ID"],["storageBucket","Storage bucket"],["appId","App ID"]].map(([key,label]) => <label key={key}><span>{label}</span><input required type={key === "apiKey" ? "password" : "text"} value={form[key] || ""} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>{error && <p className="error-banner">{error}</p>}<button className="primary" type="submit">Save & connect</button></form><p className="setup-hint">Enable Anonymous Authentication and deploy the included Firebase rules first.</p></section></main>;
}

function BroadcastMenu({ broadcast, recent, manual, setManual, openRoom, removeRecent, close }) {
  return <div className="broadcast-menu"><div className="menu-title"><span>Switch broadcast</span><button onClick={close}>×</button></div><div className="manual-row"><span>#</span><input inputMode="numeric" maxLength="4" value={manual} onChange={(event) => setManual(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") openRoom(manual); }} aria-label="Four digit broadcast number" /><button disabled={!/^\d{4}$/.test(manual)} onClick={() => openRoom(manual)}>✓</button></div><p className="menu-label">RECENT</p><div className="recent-list">{recent.map((room) => <div className={`recent-row ${room === broadcast ? "active" : ""}`} key={room}><button className="recent-open" onClick={() => openRoom(room)}><span># {room}</span>{room === broadcast && <em>Current</em>}</button>{room !== "0001" && <button className="recent-delete" onClick={() => removeRecent(room)} aria-label={`Remove ${room}`}>×</button>}</div>)}</div></div>;
}

function EmptyState({ title, text, error }) {
  return <div className={`state-card ${error ? "error-state" : ""}`}><div className="empty-orb">{error ? "!" : "✦"}</div><strong>{title}</strong><p>{text}</p></div>;
}

function Message({ message, mine, toast }) {
  const download = async () => {
    try {
      const blob = await fetch(message.url).then((response) => response.blob());
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = message.name || "syncavro-image"; anchor.click();
      URL.revokeObjectURL(url);
    } catch { window.open(message.url, "_blank", "noopener,noreferrer"); }
  };
  return <article className={`message ${mine ? "mine" : "theirs"}`}><div className="message-meta"><span className="avatar">●</span><span>{mine ? "You" : `Guest ${message.senderId?.slice(0, 4) || "user"}`}</span><time>{formatTime(message.createdAt)}</time></div>{message.type === "text" ? <div className="text-bubble"><p>{message.text}</p><button onClick={async () => { await navigator.clipboard.writeText(message.text); toast("Copied to clipboard"); }} title="Copy text">▣</button></div> : <div className="image-card"><img src={message.url} alt={message.name || "Shared image"} loading="lazy" /><div className="image-details"><span>▧</span><span><strong>{message.name || "Image"}</strong><small>{formatSize(message.size)}</small></span><button onClick={download} title="Download image">↓</button></div></div>}{mine && <span className="delivered">✓✓ Synced</span>}</article>;
}

function QueueTray({ queue, open, setOpen, clearItem, clearAll, retry }) {
  const failed = queue.filter((item) => item.status === "error").length;
  const active = queue.some((item) => item.status === "uploading");
  return <section className={`queue-tray ${open ? "expanded" : ""}`}><button className="queue-summary" onClick={() => setOpen(!open)}><span className="queue-icon">{failed ? "!" : active ? "↻" : "…"}</span><span><strong>{failed ? `${failed} upload${failed > 1 ? "s" : ""} need attention` : active ? "Uploading in background" : "Upload queue"}</strong><small>{queue.length} item{queue.length > 1 ? "s" : ""}</small></span><span>⌄</span></button>{open && <div className="queue-items">{queue.map((item) => <div className="queue-item" key={item.id}><div className="queue-thumb">{item.type === "image" ? "IMG" : "TXT"}</div><div className="queue-info"><strong>{item.type === "image" ? item.name : item.text.slice(0, 34)}</strong><small>{item.status === "error" ? item.error : item.status}</small><div className="progress"><i style={{ width: `${item.progress || 0}%` }} /></div></div><div className="queue-row-actions">{item.status === "error" && <button onClick={() => retry(item)}>Retry</button>}<button className="danger" onClick={() => clearItem(item.id)}>Clear</button></div></div>)}<button className="clear-all" onClick={clearAll}>Clear all</button></div>}</section>;
}

function Settings({ config, onClose, onSave }) {
  const [form, setForm] = useState(config);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal"><div className="modal-head"><div><p className="eyebrow">CONNECTION</p><h2>Firebase settings</h2></div><button onClick={onClose}>×</button></div><form onSubmit={(event) => { event.preventDefault(); onSave(form); }}>{Object.keys(firebaseConfig).map((key) => <label key={key}><span>{key}</span><input required type={key === "apiKey" ? "password" : "text"} value={form[key] || ""} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}<button className="primary" type="submit">Save & reconnect</button></form></section></div>;
}
