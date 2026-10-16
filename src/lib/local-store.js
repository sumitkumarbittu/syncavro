const chromeStore = globalThis.chrome?.storage?.local;

export async function getLocal(key, fallback = null) {
  if (chromeStore) {
    const result = await chromeStore.get(key);
    return result[key] ?? fallback;
  }
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : fallback;
}

export async function setLocal(key, value) {
  if (chromeStore) return chromeStore.set({ [key]: value });
  localStorage.setItem(key, JSON.stringify(value));
}

export async function removeLocal(key) {
  if (chromeStore) return chromeStore.remove(key);
  localStorage.removeItem(key);
}
