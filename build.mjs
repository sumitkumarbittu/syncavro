import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of ["manifest.json", "sidepanel.html", "background.js", "content-drawer.js", "database.rules.json", "storage.rules", "firebase.json", ".firebaserc"]) {
  await cp(file, `dist/${file}`);
}
await mkdir("dist/src/lib", { recursive: true });
await mkdir("dist/public/icons", { recursive: true });
for (const file of ["styles.css", "vanilla-app.js", "firebase-rest.js", "firebase-config.js"]) await cp(`src/${file}`, `dist/src/${file}`);
for (const file of ["hash.js", "local-store.js", "queue-db.js"]) await cp(`src/lib/${file}`, `dist/src/lib/${file}`);
await cp("public/icons", "dist/public/icons", { recursive: true });
console.log("Syncavro built in dist/");
