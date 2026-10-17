const TOKEN_KEY = "syncavro.firebaseSession";
const PAGE_SIZE = 25;
const TEXT_CHUNK_SIZE = 48000;

export class FirebaseClient {
  constructor(config) {
    this.config = config;
    this.session = null;
    this.closeListener = null;
    this.messageState = {};
    this.emitMessages = null;
    this.hasMore = false;
  }

  async connect() {
    this.session = readJson(TOKEN_KEY);
    if (this.session?.refreshToken) {
      try { await this.refresh(); } catch { this.session = null; }
    }
    if (!this.session) await this.signInAnonymously();
    return this.session.localId;
  }

  async signInAnonymously() {
    const response = await fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    const data = await readResponse(response);
    this.session = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      localId: data.localId,
      expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(this.session));
  }

  async refresh() {
    const response = await fetchWithTimeout(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.session.refreshToken }),
    });
    const data = await readResponse(response);
    this.session = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      localId: data.user_id,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(this.session));
  }

  async token() {
    if (Date.now() > (this.session?.expiresAt || 0) - 60000) await this.refresh();
    return this.session.idToken;
  }

  databaseBase() {
    return this.config.databaseURL.replace(/\/$/, "");
  }

  async listen(broadcast, onMessages, onError) {
    this.closeStream();
    const state = {};
    this.messageState = state;
    let stopped = false;
    let retryTimer;
    let stream;
    const emit = () => onMessages(Object.values(state).sort((a, b) => a.createdAt - b.createdAt), { hasMore: this.hasMore });
    this.emitMessages = emit;
    const apply = (event) => {
      const packet = JSON.parse(event.data);
      if (packet.path === "/") {
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, packet.data || {});
      } else {
        const key = packet.path.split("/")[1];
        if (packet.data === null) delete state[key];
        else state[key] = packet.data;
      }
      emit();
    };
    const connectStream = async () => {
      if (stopped) return;
      try {
        const token = await this.token();
        const url = `${this.databaseBase()}/broadcasts/${broadcast}/messages.json?auth=${encodeURIComponent(token)}&orderBy=%22createdAt%22&limitToLast=${PAGE_SIZE}`;
        const initial = await readResponse(await fetchWithTimeout(url, { headers: { Accept: "application/json" } }));
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, initial || {});
        this.hasMore = Object.keys(initial || {}).length === PAGE_SIZE;
        emit();
        stream = new EventSource(url);
        stream.addEventListener("put", apply);
        stream.addEventListener("patch", apply);
        stream.addEventListener("cancel", (event) => {
          stopped = true;
          onError(parseFirebaseError(event.data));
          stream.close();
        });
        stream.onerror = () => {
          stream.close();
          if (!stopped) retryTimer = setTimeout(connectStream, 1500);
        };
      } catch (error) {
        onError(error);
        if (!stopped && !/permission|denied|unauthorized/i.test(error.message)) retryTimer = setTimeout(connectStream, 2500);
      }
    };
    await connectStream();
    this.closeListener = () => {
      stopped = true;
      clearTimeout(retryTimer);
      stream?.close();
    };
    return this.closeListener;
  }

  closeStream() {
    this.closeListener?.();
    this.closeListener = null;
    this.messageState = {};
    this.emitMessages = null;
    this.hasMore = false;
  }

  async loadOlder(broadcast) {
    const messages = Object.values(this.messageState);
    if (!messages.length || !this.hasMore) return { hasMore: false };
    const oldest = Math.min(...messages.map((message) => Number(message.createdAt) || Date.now()));
    const token = await this.token();
    const url = `${this.databaseBase()}/broadcasts/${broadcast}/messages.json?auth=${encodeURIComponent(token)}&orderBy=%22createdAt%22&endAt=${oldest - 1}&limitToLast=${PAGE_SIZE}`;
    const page = await readResponse(await fetchWithTimeout(url, { headers: { Accept: "application/json" } }));
    Object.assign(this.messageState, page || {});
    this.hasMore = Object.keys(page || {}).length === PAGE_SIZE;
    this.emitMessages?.();
    return { hasMore: this.hasMore };
  }

  async publish(item, onProgress = () => {}, signal) {
    const token = await this.token();
    const messageId = item.messageId || item.hash;
    const contentHash = item.contentHash || item.hash;
    let image = {};
    if (item.type === "image") image = await this.uploadImage(item, token, onProgress, signal);
    if (item.type === "text") await this.uploadTextBody(item, messageId, token, onProgress, signal);
    const payload = {
      id: messageId,
      hash: messageId,
      contentHash,
      type: item.type,
      senderId: this.session.localId,
      createdAt: Date.now(),
      ...(item.type === "text" ? { textPreview: item.text.slice(0, 420), textLength: item.text.length, chunked: true } : image),
    };
    const url = `${this.databaseBase()}/broadcasts/${item.broadcast}/messages/${messageId}.json?auth=${encodeURIComponent(token)}`;
    const response = await fetchWithTimeout(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": "null_etag" },
      body: JSON.stringify(payload),
      signal,
    });
    if (response.status === 412) return { duplicate: true };
    await readResponse(response);
    return { duplicate: false };
  }

  async uploadTextBody(item, messageId, token, onProgress, signal) {
    const total = Math.max(1, Math.ceil(item.text.length / TEXT_CHUNK_SIZE));
    for (let offset = 0, index = 0; offset < item.text.length; offset += TEXT_CHUNK_SIZE, index += 1) {
      const chunkKey = String(index).padStart(6, "0");
      const url = `${this.databaseBase()}/broadcasts/${item.broadcast}/messageBodies/${messageId}/chunks/${chunkKey}.json?auth=${encodeURIComponent(token)}`;
      await readResponse(await fetchWithTimeout(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.text.slice(offset, offset + TEXT_CHUNK_SIZE)), signal }, 30000));
      onProgress(Math.round(((index + 1) / total) * 90));
    }
  }

  async getText(broadcast, message) {
    if (typeof message.text === "string") return message.text;
    const token = await this.token();
    const url = `${this.databaseBase()}/broadcasts/${broadcast}/messageBodies/${message.id}.json?auth=${encodeURIComponent(token)}`;
    const body = await readResponse(await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 60000));
    return Object.keys(body?.chunks || {}).sort().map((key) => body.chunks[key]).join("");
  }

  async deleteMessage(broadcast, message) {
    const token = await this.token();
    if (message.storagePath) await this.deleteStorage(message.storagePath, token).catch(() => {});
    await Promise.all([this.deleteDatabasePath(`broadcasts/${broadcast}/messages/${message.id}`, token), this.deleteDatabasePath(`broadcasts/${broadcast}/messageBodies/${message.id}`, token)]);
  }

  async clearBroadcast(broadcast) {
    const token = await this.token();
    const url = `${this.databaseBase()}/broadcasts/${broadcast}/messages.json?auth=${encodeURIComponent(token)}`;
    const messages = await readResponse(await fetchWithTimeout(url, { headers: { Accept: "application/json" } }));
    await Promise.all(Object.values(messages || {}).filter((message) => message.storagePath).map((message) => this.deleteStorage(message.storagePath, token).catch(() => {})));
    await this.deleteDatabasePath(`broadcasts/${broadcast}`, token);
  }

  async deleteDatabasePath(path, token) {
    const url = `${this.databaseBase()}/${path}.json?auth=${encodeURIComponent(token)}`;
    await readResponse(await fetchWithTimeout(url, { method: "DELETE" }));
  }

  async deleteStorage(path, token) {
    const bucket = this.config.storageBucket.replace(/^gs:\/\//, "");
    const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}`;
    await readResponse(await fetchWithTimeout(url, { method: "DELETE", headers: { Authorization: `Firebase ${token}` } }, 30000));
  }

  async uploadImage(item, token, onProgress, signal) {
    onProgress(8);
    const messageId = item.messageId || item.hash;
    const contentHash = item.contentHash || item.hash;
    const path = `broadcasts/${item.broadcast}/${messageId}-${safeFileName(item.name)}`;
    const bucket = this.config.storageBucket.replace(/^gs:\/\//, "");
    const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`;
    const metadata = await readResponse(await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Firebase ${token}`, "Content-Type": item.mime, "X-Goog-Meta-hash": contentHash },
      body: item.blob,
      signal,
    }, 45000));
    onProgress(100);
    const downloadToken = metadata.downloadTokens?.split(",")[0];
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media${downloadToken ? `&token=${encodeURIComponent(downloadToken)}` : ""}`;
    return { url: publicUrl, storagePath: path, name: item.name, size: item.size, mime: item.mime };
  }
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `Firebase request failed (${response.status}).`);
  return data;
}

function parseFirebaseError(value) {
  try { return new Error(JSON.parse(value)); } catch { return new Error(value || "Firebase denied access."); }
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "image";
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}
