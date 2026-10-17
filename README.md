# Syncavro | Real-Time Sharing

Syncavro is a Manifest V3 Chrome extension that opens as a page-mounted drawer for broadcasting text and images through four-digit channel numbers. People using the same broadcast number receive the same live feed. The default broadcast is `0001`.

## Features

- Monica-style drawer attached to the current webpage
- `Ctrl+B` shortcut on Windows/Linux and `Command+B` on macOS
- Extension-toolbar button opens the same page drawer
- Selectable Dark, Light, and System themes
- True black dark background and true white light background
- Realtime multi-user text and image sharing
- Chunked long-text sharing with collapsed previews and on-demand Read more/Copy
- Message deletion and broadcast-scoped Delete all
- Firebase history pagination in 25-message pages
- Multiple four-digit broadcasts with recent-broadcast history
- Persistent IndexedDB upload queue with per-item Clear and Clear all
- Image drag-and-drop plus `Command+V`/`Ctrl+V` clipboard image paste
- Retry-safe delivery without suppressing intentional repeated messages
- Image downloads and a 10 MB upload limit
- Anonymous Firebase Authentication
- Realtime Database and Cloud Storage rules included in the repository
- No runtime or package dependencies

## Requirements

- Google Chrome 102 or newer.
- A Firebase project.
- Firebase Blaze billing for Cloud Storage. Firebase now requires the pay-as-you-go Blaze plan to provision and use Cloud Storage. Google Cloud's no-cost usage allowances can still apply, but you should configure billing budgets and alerts.
- Node.js only for the local packaging command. No packages are installed.

## React website

The repository now includes a mobile-first React application in [`web/`](web). It connects directly to the same Firebase backend as the Chrome extension, so website and extension users can join the same numbered broadcast and see the same messages.

The web application includes:

- Responsive iPhone 16/17-first layout, tested at a `402 × 874` CSS-pixel viewport
- Expanded desktop workspace for laptop use
- Live numbered broadcasts and recent-broadcast history
- Text and image sharing
- Chunked long text with collapsed previews and on-demand full-text loading
- Per-message deletion and broadcast-scoped Delete all
- Infinite-scroll history loaded in 25-message pages
- Persistent IndexedDB upload queue
- Background uploads, Retry, Clear, and Clear all
- Retry-safe delivery shared with the extension
- Image drag-and-drop, clipboard image paste, and file selection
- Text copying and image downloads
- Dark, Light, and System themes
- Editable Firebase connection settings
- Safe-area support for iPhone displays and reduced-motion accessibility

The website is a static Vite build. Render only serves the generated files; authentication, realtime data, and images go directly between the browser and Firebase. No Render server, database, paid instance, or secret is required.

### Run the React application locally

From the repository root:

```sh
cd web
npm install
npm run dev
```

Open the local URL printed by Vite. Create a production build with:

```sh
npm run build
```

The generated website is written to `web/dist`. Run the shared tests with:

```sh
npm test
```

### Deploy to Render free tier using the Blueprint

The root [`render.yaml`](render.yaml) contains the complete Render Static Site configuration. This is the recommended deployment method.

1. Push this repository to GitHub.
2. Sign in to [Render](https://dashboard.render.com/).
3. Select **New +** and then **Blueprint**.
4. Connect the GitHub account that owns the repository.
5. Select the `syncavro` repository.
6. Render detects `render.yaml`. Review the service named `syncavro`.
7. Select **Apply** or **Deploy Blueprint**.
8. Wait until the deployment status is **Live**.
9. Open the generated `https://YOUR-SERVICE-NAME.onrender.com` URL.
10. Send a test message in broadcast `0001`, then open the extension or website on another device using the same broadcast number.

The Blueprint uses these settings:

| Render setting | Value |
| --- | --- |
| Service type | Static Site |
| Root directory | `web` |
| Build command | `npm ci && npm run build` |
| Publish directory | `web/dist` through `staticPublishPath: ./dist` inside the root directory |
| SPA route | Every path rewrites to `/index.html` |

Render Static Sites are compatible with the free tier and do not need a continuously running web service. Firebase billing remains separate. Cloud Storage may still require the Firebase Blaze plan, as described below.

### Deploy manually on Render

Use this only if you do not want to deploy the Blueprint:

1. In Render, select **New + > Static Site**.
2. Connect and select the `syncavro` GitHub repository.
3. Set **Root Directory** to `web`.
4. Set **Build Command** to `npm ci && npm run build`.
5. Set **Publish Directory** to `dist`.
6. Add a rewrite rule with source `/*` and destination `/index.html`, using action **Rewrite**.
7. Select the free Static Site option and create the service.

### Firebase settings for the Render domain

The shared Firebase Web configuration is included in `web/src/config.js`, so the first deployment works without Render environment variables. Firebase Web API keys are client identifiers and must be protected by Authentication and Security Rules, not treated as server secrets.

After Render assigns the website URL:

1. Open Firebase Console for `syncavro-real-time-sharing`.
2. Open **Authentication > Settings > Authorized domains**.
3. Add only the hostname, such as `syncavro.onrender.com`, if it is not already accepted.
4. Confirm **Authentication > Sign-in method > Anonymous** remains enabled.
5. Deploy `database.rules.json` and `storage.rules` from this repository.
6. If the Firebase API key has HTTP-referrer restrictions in Google Cloud Console, add `https://YOUR-SERVICE-NAME.onrender.com/*` to the allowed websites.

To use a different Firebase project without changing source code, add any of these optional environment variables in Render before redeploying:

| Variable | Firebase value |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Authentication domain |
| `VITE_FIREBASE_DATABASE_URL` | Exact Realtime Database URL |
| `VITE_FIREBASE_PROJECT_ID` | Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket name |
| `VITE_FIREBASE_APP_ID` | Web App ID |

Vite embeds `VITE_` values into the public browser bundle at build time. Never enter a service-account JSON file, private key, Firebase CLI token, or refresh token in Render.

### Automatic Render updates

Render automatically rebuilds the Static Site when new commits reach the connected GitHub branch. Before pushing a website update, verify it locally:

```sh
npm run web:build
npm run web:test
```

If a deploy fails, open the Render deploy log and confirm that the root directory is `web`, `npm ci` found `web/package-lock.json`, and the publish directory is `dist`.

## Install directly from GitHub

Contributors do not need Node.js or Firebase configuration changes when using the committed build:

1. Download the repository ZIP from GitHub and extract it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the extracted repository's `dist` folder.

The committed `dist` folder contains the page drawer, icons, shared Firebase configuration, and runtime files. The project owner must deploy the Firebase rules once before distributing the extension.

## Included shared Firebase connection

The GitHub-ready build includes the shared Web configuration in `src/firebase-config.js`. The same file is copied into `dist/src/firebase-config.js`, so people who clone or download the repository can load `dist` without pasting the API key or App ID.

This file contains only Firebase's client-side Web configuration. Never put a service-account file, private key, Firebase CLI token, or refresh token in the repository.

If you want contributors to use a different Firebase project, edit `src/firebase-config.js`, deploy the rules to that project, and run `npm run build` again.

## 1. Create or select the Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Select the project you want to use. This repository currently points to `syncavro-real-time-sharing` in `.firebaserc`.
3. Open **Project settings** using the gear beside **Project Overview**.
4. Under **Your apps**, choose the Web icon `</>`.
5. Enter `Syncavro Chrome Extension` as the nickname.
6. Do not enable Firebase Hosting. It is not required for an unpacked Chrome extension.
7. Select **Register app**.
8. Copy the displayed values into `src/firebase-config.js` if you are replacing the included shared project.

The required values are:

```text
apiKey
authDomain
databaseURL
projectId
storageBucket
appId
```

The Firebase web API key is a project identifier, not an administrator secret. Authentication and the included Security Rules protect the data.

## 2. Enable Anonymous Authentication

1. In Firebase Console, open **Security > Authentication**.
2. Select **Get started** if Authentication has not been initialized.
3. Open **Sign-in method**.
4. Select **Anonymous**.
5. Enable it and save.

Every browser profile receives a Firebase user ID. Database and Storage requests without an authenticated Firebase user are denied by the included rules.

## 3. Create Realtime Database

1. Open **Databases & Storage > Realtime Database**.
2. Select **Create database**.
3. Choose a location near the expected users. The location cannot be changed later.
4. Choose **Locked mode**. The repository rules will replace the locked defaults.
5. Finish database creation.
6. Copy the exact database URL shown at the top of the Data page.

Database URLs vary by region:

```text
https://PROJECT_ID-default-rtdb.firebaseio.com
https://DATABASE_NAME.REGION.firebasedatabase.app
```

Do not assume the default URL shown in the Syncavro setup form is correct. Paste the exact URL from your Firebase console.

## 4. Create Cloud Storage

1. Upgrade the Firebase project to the **Blaze** plan if Firebase requests it.
2. Configure a Google Cloud billing budget and alert before continuing.
3. Open **Databases & Storage > Storage**.
4. Select **Get started**.
5. Choose a bucket location. The location cannot be changed later.
6. Finish bucket creation.
7. Copy the exact bucket name from Storage or the web app configuration.

New default buckets normally use:

```text
PROJECT_ID.firebasestorage.app
```

Older projects can use:

```text
PROJECT_ID.appspot.com
```

Syncavro accepts either bucket format.

## 5. Deploy the Security Rules

The repository contains:

- `database.rules.json` for Realtime Database
- `storage.rules` for image storage
- `firebase.json` with both rule targets
- `.firebaserc` with the current project alias

From the repository root, authenticate the Firebase CLI:

```sh
npx firebase-tools@latest login
```

Verify or select the correct project:

```sh
npx firebase-tools@latest projects:list
npx firebase-tools@latest use syncavro-real-time-sharing
```

Deploy both rule sets:

```sh
npx firebase-tools@latest deploy --only database,storage
```

Alternatively, deploy through Firebase Console:

1. Open **Realtime Database > Rules**.
2. Replace the editor contents with `database.rules.json` and select **Publish**.
3. Open **Storage > Rules**.
4. Replace the editor contents with `storage.rules` and select **Publish**.
5. Run `npm run smoke:firebase` locally to verify the authenticated Database read.

Do not leave Realtime Database in public test mode. A broadcast number is a routing key, not a password. The included rules require a Firebase-authenticated user and validate the four-digit broadcast path and message structure.

## 6. Build and load the extension

Build the `dist` directory:

```sh
npm run build
```

The build is dependency-free and works without `npm install`.

Load it into Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `dist` directory.
5. Pin Syncavro from Chrome's Extensions menu if you want toolbar access.
6. After future builds, return to `chrome://extensions` and select **Reload** on Syncavro.

## 7. Connect Syncavro to Firebase

1. Select the Syncavro toolbar icon or use the keyboard shortcut.
2. The page drawer connects with `dist/src/firebase-config.js` automatically.
3. Use the settings button only when you need to override the included project configuration on one browser.

The values are stored locally in `chrome.storage.local`. They are not uploaded anywhere except to the selected Firebase services as part of authenticated requests.

If the panel remains on the loading screen, reload the extension after confirming Anonymous Authentication is enabled and the database URL is exact. Network requests now time out and return to the connection screen with a specific error instead of loading indefinitely.

## Page drawer and keyboard shortcut

Clicking the Syncavro toolbar icon opens a drawer inside the current webpage, matching Monica's opening style instead of using Chrome's separate native Side Panel. The keyboard command is a true toggle: press it once to open the drawer and again to close it. `Escape` also closes it.

| Platform | Suggested shortcut |
| --- | --- |
| Windows/Linux | `Ctrl+B` |
| macOS | `Command+B` |

Chrome can refuse a suggested shortcut when Chrome, the operating system, or another extension already owns it. To assign or repair it:

1. Open `chrome://extensions/shortcuts`.
2. Find **Syncavro | Real-Time Sharing**.
3. Set **Open or close Syncavro on the current webpage** to the preferred key combination.

After upgrading or reloading Syncavro, Chrome may clear the old command assignment because the command changed from open-only to toggle. Visit the shortcuts page once and confirm the displayed key. An empty shortcut means Chrome rejected the suggestion because another browser, operating-system, or extension command owns it. Extensions cannot override that browser decision.

The drawer opens on the right and reduces the webpage width so it stays on the same page rather than covering important content. Chrome does not allow extensions to run on internal pages such as `chrome://extensions` or the Chrome Web Store.

## Themes

Use the selector in the top-right corner of the Syncavro drawer:

- **Dark** uses a true black main background.
- **Light** uses a true white main background.
- **System** follows the operating-system color preference when the panel opens.

The choice is stored locally and applies to the connection screen, broadcast feed, upload queue, menus, and composer.

## Broadcast behavior

- Broadcast numbers must contain exactly four digits.
- A new installation starts at broadcast `0001`.
- Opening a broadcast adds it to the recent list.
- Removing a recent number only removes the local shortcut. It does not delete Firebase data.
- Anyone with Firebase access who enters the same number sees that broadcast.

## Retry-safe delivery

Syncavro gives every send action a unique message ID and calculates a SHA-256 content hash for integrity metadata. Messages are stored at:

```text
broadcasts/{fourDigitNumber}/messages/{messageId}
```

An atomic conditional write makes retries of the same queued item safe. A later send gets a new message ID, so users can intentionally send identical text or the same image again.

Images are stored at:

```text
broadcasts/{fourDigitNumber}/{messageId}-{safeFileName}
```

## Upload queue, drag-and-drop, and paste

Text and images enter a local IndexedDB queue immediately. The composer becomes available for the next item while uploading continues. Queued or interrupted items survive closing the drawer and resume the next time it opens.

- Successful items leave the queue immediately and appear in the broadcast feed.
- Each queued, uploading, or failed item has **Clear**.
- **Clear all** cancels the active request and removes the complete local queue.
- Failed items retain **Retry** and **Clear** actions.
- Drag image files anywhere over the Syncavro drawer and release them on the drop overlay.
- Copy an image, focus the Syncavro drawer, and press `Command+V` on macOS or `Ctrl+V` on Windows/Linux.
- Pasted text goes into the message composer when it is not already focused.

## Long text, history paging, and deletion

Text input has no application-level character limit. Each new text message is split into chunks of up to 48,000 characters. The live feed stores and downloads only a 420-character preview plus metadata. The complete body is downloaded only when someone selects the chevron to expand it or uses Copy.

The newest 25 messages load when a broadcast opens. Scrolling to the top fetches the next earlier page while preserving the current scroll position. This avoids downloading an entire busy broadcast during startup.

Every message has a compact delete action. The delete-all action beside the broadcast selector removes only the currently selected four-digit broadcast. It does not alter any other broadcast number. Deploy the current `database.rules.json` and `storage.rules` before using deletion or chunked text.

## Firebase data and security model

The current rules provide a shared authenticated broadcast model:

- Unauthenticated reads and writes are denied.
- Broadcast IDs must be exactly four digits.
- Existing messages cannot be overwritten, but authenticated broadcast users can delete them.
- The message sender ID must match the authenticated Firebase user.
- Storage accepts authenticated image uploads only.
- Images larger than 10 MB are rejected by both the UI and Storage Rules.
- Authenticated broadcast users can delete stored images through the application.

Four-digit broadcast numbers are intentionally easy to share, but they are not private secrets. For confidential sharing, extend the design with invitations, per-broadcast membership records, and membership-based Security Rules.

## Troubleshooting

### Anonymous sign-in is not enabled

Enable **Security > Authentication > Sign-in method > Anonymous** in Firebase Console.

### Firebase denied access

Deploy `database.rules.json` and `storage.rules`, then confirm the extension is connected to the same Firebase project targeted by `.firebaserc`.

Verify the deployed backend without exposing tokens:

```sh
npm run smoke:firebase
```

Expected output:

```text
Anonymous Authentication: OK
Realtime Database authenticated read: OK
```

### Database cannot connect

Copy the exact URL from **Realtime Database > Data**. Regional databases use `REGION.firebasedatabase.app`, not always `firebaseio.com`.

### Storage bucket not found or unavailable

Confirm the project uses Blaze billing, Storage has been initialized, and the `storageBucket` value exactly matches the bucket shown in Firebase Console.

### Shortcut does not open the panel

Reload Syncavro on `chrome://extensions`, then refresh the webpage where you want to use it. Open `chrome://extensions/shortcuts` and assign **Open or close Syncavro on the current webpage** manually. Chrome and operating-system shortcuts take priority over extension suggestions, so `Command+B` or `Ctrl+B` can remain unavailable on some installations. The command does not run on `chrome://` pages or the Chrome Web Store.

### Changes do not appear

Run `npm run build`, open `chrome://extensions`, select **Reload** for Syncavro, and refresh the webpage.

## Development checks

```sh
npm test
npm run build
```

The tests cover stable integrity hashing, unique message IDs, and four-digit broadcast validation. The build copies only the extension runtime, rules, icons, and manifest into `dist`.
