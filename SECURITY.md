# Security

## Firebase client configuration

`src/firebase-config.js` intentionally contains the Firebase Web configuration used by the distributed extension. Firebase Web API keys identify the Firebase project and are not administrator credentials.

Do not add service-account JSON, private keys, OAuth client secrets, refresh tokens, billing credentials, or Firebase CLI login files to this repository.

Access is enforced by Firebase Anonymous Authentication together with `database.rules.json` and `storage.rules`. Deploy those rules before distributing the extension.

## Reporting a vulnerability

Open a private GitHub security advisory for vulnerabilities. Do not include active credentials, user data, or authentication tokens in a public issue.
