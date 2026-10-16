export const firebaseConfig = Object.freeze({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyACgihpjOJbG_RUCoF_xQJDeASbOBKLeoU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "syncavro-real-time-sharing.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://syncavro-real-time-sharing-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "syncavro-real-time-sharing",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "syncavro-real-time-sharing.firebasestorage.app",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:965307795389:web:4e29233b7eddf2767874d4",
});
