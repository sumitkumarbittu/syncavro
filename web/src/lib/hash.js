export function normalizeText(value) {
  return value.trim().replace(/\r\n/g, "\n");
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashText(value) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeText(value))));
}

export async function hashFile(file) {
  return toHex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
}
