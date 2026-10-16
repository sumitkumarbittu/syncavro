const DB_NAME = "syncavro-web-queue";
const STORE_NAME = "uploads";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export const queueDb = {
  all: () => run("readonly", (store) => store.getAll()),
  put: (item) => run("readwrite", (store) => store.put(item)),
  delete: (id) => run("readwrite", (store) => store.delete(id)),
  clear: () => run("readwrite", (store) => store.clear()),
};
