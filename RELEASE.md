# Fastack release checklist

## Validation

```sh
npm test
npm run pack
```

`npm run pack` creates an unpacked application under `release/`. Public macOS
distribution still requires a valid Developer ID Application certificate,
code signing, and notarization.

## Live storage smoke test

The regular suite mocks provider APIs and is safe to run anywhere. For a real
round-trip check, provide short-lived test credentials through environment
variables and run `npm run test:integrations:live`.

Required variables:

- `FASTACK_GITHUB_TOKEN`, `FASTACK_GITHUB_USER`, `FASTACK_GITHUB_REPO`
- `FASTACK_DROPBOX_TOKEN`, `FASTACK_DROPBOX_REPO`
- `FASTACK_GOOGLE_TOKEN`, `FASTACK_GOOGLE_REPO`

The command writes `_fastack_healthcheck.json` to each configured repository or
folder, reads it back, and verifies its JSON content. It never logs tokens.

## Activity tracking and privacy

Tracking runs only during a clocked-in task. Every five seconds Fastack stores:

- a timestamp;
- whether the operating system reports 30 seconds or more of idle time;
- a coarse activity category: writing, reading, browsing, idle, or other.

Scrolling is counted only while the Fastack popup receives wheel events. If the
user explicitly enables Keyboard Activity Tracking, the native hook counts
global key-down events. It does not store key values or typed text. Fastack does
not collect window titles, application names, clipboard data, mouse positions,
or screenshots for productivity analytics.

Sessions contain the task name, start/end timestamps, and category samples.
They are synced to the selected backend under `activity/<year>/<month>/<day>`.
A matching local cache is retained so Productivity reports open immediately.
