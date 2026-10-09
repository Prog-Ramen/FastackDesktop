# Fastack

A context-switching menubar task manager. Tasks live in a stack, sorted by overdue → no-date → today → upcoming with priority (1–100) as the tiebreaker. Pop the top task when you finish it. Clock in / clock out per task. Rich markdown notes (tables, charts, UML) via Toast UI Editor.

Fastack stores your stack in your own cloud — **GitHub**, **Dropbox**, or **Google Drive** — or fully local on disk if you don't want to sign in. Everything is optionally encrypted with a password you set. The desktop app is Electron.

![Fastack main view](https://raw.githubusercontent.com/ssajnani/FastackDesktop/master/demo/fastack_main.PNG)

## Install

Grab the latest installer for your platform from the [Releases page](https://github.com/ssajnani/FastackDesktop/releases):

- **macOS**: `Fastack-<version>.dmg` (universal, x64 + arm64) or `Fastack-<version>-mac.zip`
- **Windows**: `Fastack Setup <version>.exe` (NSIS installer)
- **Linux**: `Fastack-<version>.AppImage` or `.deb`

The installers are unsigned in v1. On macOS the first launch will show a Gatekeeper warning — right-click the app in Finder → **Open** → **Open**. On Windows you may need to click "More info → Run anyway" in SmartScreen.

## First-run flow

1. Launch Fastack — a menubar icon appears (top-right on macOS, bottom-right on Windows/Linux). Click it to open the popup.
2. Choose a backend: **GitHub**, **Dropbox**, **Google**, or **Local** (no login).
3. OAuth in a browser window (Google/GitHub) or via an external browser + paste-code flow (Dropbox). Local skips this step entirely.
4. First-time users pick a repo/folder name (created for you). Returning users are dropped straight into their stack.
5. Add your first task. Set duration, priority, optional dates, and markdown notes.

Data storage layout (per backend):

| Backend | Path |
|---|---|
| GitHub | `<repo>/<year>/<month>/<day>` (private repo recommended) |
| Dropbox | `/Fastack-<name>/<year>/<month>/<day>` |
| Google Drive | `Fastack-<name>/<year>/<month>/<day>` (Drive folders) |
| Local | `<userData>/fastack-local/local/<year>/<month>/<day>` |

Started in Local mode and later want to sync to the cloud? Open **Settings** → **Push local stack to cloud**, type a repo/folder name, pick a target. Fastack authenticates with the target, uploads every snapshot from your local history to the equivalent path, and switches you over.

## Shortcuts

All navigation is keyboard-first. Defaults (customize on the Settings page):

| Action | Shortcut |
|---|---|
| Open/close popup | `Alt+Z` |
| New task | `Alt+N` |
| Edit task | `Alt+E` |
| Clock in | `Alt+C` |
| Clock out | `Alt+V` |
| Pop top task | `Alt+P` |
| Scroll stack up/down | `Alt+↑` / `Alt+↓` |
| Settings | `Alt+S` |
| Logout | `Alt+L` |

## Development

Requires **Node 18+** and npm 8+.

```bash
git clone git@github.com:ssajnani/FastackDesktop.git
cd FastackDesktop
npm install --no-audit
npm run dev        # runs electron with devtools open
```

`npm start` runs without auto-opening devtools (production-ish). Set `FASTACK_DEV=1` when you want devtools always. Set `FASTACK_LOCAL=1` to skip the login screen entirely and drop straight into Local mode — useful for fast UI iteration.

### Building installers

```bash
npm run pack        # unpacked .app for smoke-testing (no installer)
npm run dist:mac    # .dmg + .zip in ./release
npm run dist:win    # NSIS .exe in ./release (needs Wine on macOS)
npm run dist:linux  # AppImage + .deb in ./release
npm run dist        # current platform default
```

All artifacts land in `./release/`. See the `build` block in `package.json` for icon paths, target arches, and installer options.

## Architecture

- `main.js` — Electron main process. Tray icon + single BrowserWindow, hides on blur, positions relative to tray.
- `home.html` + `loginGithub.js` — landing screen with three backend buttons. Runs OAuth (PKCE for Google, standard flow for GitHub, external browser + code paste for Dropbox), then hands the access token to the platform-specific backend helper.
- `helper/github_functions.js` / `dropbox_functions.js` / `gdrive_functions.js` — the three interchangeable backends. Each exports the same surface: `makeRepo`, `getContent`, `listFiles`, `checkFastackRepoExists`, `checkFileExists`, `createUpdateFile`.
- `helper/prestack_functions.js` — walks the year/month/day tree to load the latest stack snapshot from whichever backend is active.
- `helper/stack_functions.js` — pure stack ops (sort, HTML render, countdown timer for clock-in).
- `helper/crypto_helper.js` — AES-256-CTR + PBKDF2 password-based encryption for stored stacks.
- `stack/*.html` + matching `stack/*.js` — the actual UI screens (task list, create/edit task, settings, backend-specific "name your repo" flow).

## Contributing / feedback

File issues or PRs on [GitHub](https://github.com/ssajnani/FastackDesktop). MIT-licensed — see [LICENSE](./LICENSE).
