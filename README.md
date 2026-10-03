# Private Context Engine

Private Context Engine is a local-first desktop context application. It derives bounded structured context from authorized desktop, browser connector, and selected-folder metadata, then supports memory, personalization, goals, recommendations, and user-controlled workflows.

## Privacy and security

The application does not collect passwords, credentials, tokens, cookies, clipboard data, screenshots, keystrokes, audio, video, private messages, page contents, file contents, unrestricted URLs, or raw filesystem paths for external AI context. The renderer has no Node.js or filesystem access. Level 2 actions always pass through main-process validation, permission checks, explicit approval, execution, and audit.

No shell execution, browser automation, arbitrary process execution, arbitrary filesystem access, autonomous action loop, cloud telemetry, or automatic model download is supported.

## Release status

Current release version: `0.1.0`  
Architecture phase: Phase 24 — Final Release Validation  
Mode: local-first / privacy-preserving

No production neural inference runtime is bundled. Local-neural status remains unavailable unless a compatible validated in-process runtime is supplied; deterministic local embeddings are the truthful fallback.

## Development

```text
npm install
npm run typecheck
npm run build
npm test
npm run recovery
npm run performance
npm run release-check
```

`npm run release-check` verifies the compiled main/preload/renderer release files and checks that the browser extension has no forbidden broad permissions.

## Packaging

The repository provides a validated production build through `npm run build` and Windows NSIS packaging configuration through `npm run package:win`. The Windows CI workflow uses Node 22 because the retained `node-gyp@13.1.0` override requires Node >=22.22.2. The Windows package command was attempted in this Linux environment but is blocked while rebuilding the native `active-win` module for Windows. No `.exe` artifact is claimed. Electron launch validation depends on host system libraries.

## Data

Application data is stored under Electron `userData` in SQLite. Migrations are transactional where required and integrity-checked at startup. The control center supports explicit JSON export, validated import preview, structured backup, lifecycle counts, retention, deletion, and recovery visibility.

Exports and backups exclude secrets, pairing token hashes, model binaries, executable paths, raw file/browser contents, full prompts/responses, and protected audit/security state. Import is bounded, checksum-validated, conflict-aware, and transactional.

## Browser extension

The optional Manifest V3 connector is in `browser-extension/`. Pairing, authentication, revocation, payload validation, size limits, rate limiting, and disabled-state behavior are enforced. Store installation and real browser compatibility are not claimed without a browser test environment.

## Optional external LLM

External LLM use is disabled by default and requires explicit configuration. Only minimized structured context may cross that boundary. LLM output is untrusted and cannot approve actions, change permissions, or execute tools.

## Known limitations

- No production neural inference runtime is bundled.
- Electron launch in the current validation environment is blocked by missing `libnss3.so`.
- Browser validation is static/local unless a Chromium environment is available.
- `npm audit` currently reports 11 vulnerabilities (1 moderate, 10 high, 0 critical) after verified dependency overrides; see `ARCHITECTURE.md` for the package paths, override experiments, and compatibility risks.
- Windows NSIS packaging is configured via `npm run package:win`; local Linux packaging is blocked by the native `active-win` cross-build path. Use `.github/workflows/package-windows.yml` on a Windows runner with Node 22.

## Maintenance validation

The latest maintenance pass preserved the existing privacy, security, IPC, DTO, database, permission, approval, and audit boundaries. It removed confirmed unused locals/imports, batched plan-step loading to avoid one query per plan, enabled TypeScript unused-code checks, and added TypeScript-aware ESLint plus Prettier configuration. No hot-path performance improvement is claimed; the synthetic performance measurements vary between runs.

## Current context suggestions

The default view includes a local-only `Right now` section that connects current context to existing memories, preferences, projects, technologies, semantic matches, and prior recommendations. It never searches the internet or adds an observation source. Empty states explain whether the app is still learning, recommendations are disabled, or no local relationship was found.
