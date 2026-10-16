export function normalizeText(value) {
  return value.trim().replace(/\r\n/g, "\n");
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashText(value) {
  const bytes = new TextEncoder().encode(normalizeText(value));
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function hashFile(file) {
  return toHex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
}

export function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "image";
}
