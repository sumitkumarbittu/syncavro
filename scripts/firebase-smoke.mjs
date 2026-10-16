import { firebaseConfig } from "../src/firebase-config.js";

const authResponse = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  },
);
const auth = await authResponse.json();
if (!authResponse.ok) {
  console.error(`Authentication failed: ${auth?.error?.message || authResponse.status}`);
  process.exit(1);
}
console.log("Anonymous Authentication: OK");

const databaseResponse = await fetch(
  `${firebaseConfig.databaseURL.replace(/\/$/, "")}/broadcasts/0001/messages.json?auth=${encodeURIComponent(auth.idToken)}&orderBy=%22createdAt%22&limitToLast=1`,
);
if (!databaseResponse.ok) {
  const error = await databaseResponse.json().catch(() => ({}));
  console.error(`Realtime Database failed: ${error?.error || databaseResponse.status}`);
  process.exit(1);
}
console.log("Realtime Database authenticated read: OK");
