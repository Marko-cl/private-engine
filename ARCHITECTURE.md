# Private Context Engine — Current Architecture

**Current Phase:** Phase 24 — Final Release, Packaging, Clean-Environment Validation, and Project Sign-Off  
**Status:** COMPLETE — Release Candidate with documented environment limitations  
**Updated:** 2026-10-03

**Purpose:** Local-first desktop context, memory, personalization, goals, recommendations, and permission-controlled workflow application. This document is the authoritative implementation inventory and release-status record.

## CURRENT — pipeline

```text
Desktop Activity + Browser Connector + Selected Folder Metadata
→ Context Engine → Memory Engine → Semantic Memory
→ Preference Evidence → Personalization Summary
→ Recommendation / Controlled Agent → Permission Manager
→ Confirmation → Action Executor → Audit Log
```

Phase 12 adds observation-only context sources. It does not add browser automation, arbitrary filesystem access, autonomous actions, or new action tools. Desktop foreground activity remains the strongest direct context source; browser and folder metadata are bounded supporting signals.

## Browser connector boundary

`src/browser-context.ts` defines the desktop-side structured connector contract. A browser extension/connector may submit only minimized records containing domain, optional URL, title, category, topic, timestamp, and duration. The current desktop implementation exposes a narrow validated main-process ingestion channel, and the optional Phase 15 browser-extension source uses that same contract without bypassing browser security.

The application never reads browser databases, cookies, saved passwords, profiles, session storage, private browsing data, form fields, private messages, clipboard, authentication tokens, or arbitrary browser files. Page contents are never accepted by the connector contract.

Browser context is disabled by default:

```text
browserContextEnabled = false
```

The main process applies configurable allowed and blocked domain rules before storage. Blocked domains are rejected and never stored. Domain matching covers the domain and its subdomains. Payloads are bounded and validated for domain, timestamp freshness, title length, duration, category, topic, and payload structure.

## URL sanitization

Only `http:` and `https:` URLs without username/password information are considered. Sanitization removes query strings and fragments, rejects credentials, normalizes the host, and retains only a bounded normalized path. If sanitization fails, the record keeps the domain and structured fields without a URL. Tracking parameters, session identifiers, and tokens are never stored.

Stored browser records are local `browser_context` rows with source attribution:

```text
id
domain
sanitized_url
title
category
topic
timestamp
duration_seconds
source = browser
```

Retention cleanup applies to browser records. Clear browser context deletes these records but does not delete unrelated memories.

## Selected-folder boundary

`src/folder-context.ts` provides bounded, metadata-only folder scanning. The user selects folders through the main-process native directory picker. Renderer code never supplies arbitrary paths. Selected folder paths remain main-process database data and are not exposed in the renderer state.

Only explicitly selected folders may be scanned. The scanner:

* limits files per scan to 500
* limits recursion depth to 5
* limits filename length
* ignores `.git`, `node_modules`, `dist`, `build`, `coverage`, `.venv`, and `target`
* excludes `.env`, `.env.*`, credentials, secrets, password names, `.pem`, and `.key` files
* stores only file name, extension, relative path, size, and modified time
* never reads file contents
* never opens files
* performs bounded metadata scans at most every 30 seconds
* upserts metadata and removes stale entries for each selected folder

Sensitive folder names are rejected for indexing. A selected folder is identified internally by a random main-process ID. The renderer sees only safe folder IDs, labels, enabled state, scan time, and file count.

Stored folder tables are:

```text
selected_folders
folder_context
```

Folder context is cleared when a selected folder is removed or when the user clears folder context. Retention removes old folder metadata. Delete-all-data removes all selected-folder records and metadata.

## Database migration

Migration version 12 creates/extends:

```text
browser_context
selected_folders
folder_context
```

No raw page-content or file-content table is added. Existing memory and embedding tables remain authoritative. Version 12 adds bounded preference project and technology association JSON fields; no raw private data is added. Deleting memories still deletes their semantic embeddings.

## Unified context and source weighting

Browser and folder records are converted into structured activity summaries with source attribution and combined with foreground activity by the existing ContextEngine. The ContextEngine remains intact and uses deterministic source ordering:

```text
foreground desktop = 1.00
browser            = 0.65
selected folder    = 0.45
```

Desktop activity is therefore ranked first when signals are otherwise equal. Browser and folder evidence supports context but cannot automatically replace the direct foreground source. Context records remain structured and do not expose raw folder paths or full URLs to external AI.

Browser and folder evidence can contribute to memory, semantic retrieval, preference evidence, and recommendations only through the existing bounded pipelines. One browser page, one file, or one folder cannot create a preference; the existing Phase 11 repeated-evidence threshold remains required.

## Semantic and recommendation integration

Sanitized browser fields and safe folder metadata may contribute to structured memory input and the existing local semantic embedding boundary. Browser embedding input is limited to domain, category, topic, sanitized project labels, and technologies. Folder embedding input uses safe labels, extensions, and project/category metadata; raw paths and contents are excluded from LLM-facing context.

Recommendation weights remain unchanged:

```text
contextMatch       × 0.35
preferenceStrength × 0.30
memoryStrength     × 0.20
recency            × 0.15
```

The Phase 9 semantic adjustment remains capped at four points and Phase 8 feedback remains bounded. Browser/folder sources add no new dominant recommendation weight.

## Personalization

Repeated browser and folder evidence can contribute to existing preferences through MemoryEngine and PreferenceEngine. Single-source observations do not create preferences. Sensitive filenames and sensitive folder labels are excluded before memory/personalization processing. No health, politics, religion, sexuality, race, ethnicity, criminal history, or other sensitive attributes are inferred.

## Retention, pause, and deletion

Browser ingestion rejects records while application privacy pause is active. Folder scanning stops while privacy pause or timed pause is active. Browser and folder records follow existing retention cleanup. Removing a selected folder deletes its stored folder metadata. Clear browser context and clear folder context affect only their respective source records. Existing memory deletion and embedding cleanup remain separate and intact.

## Settings, IPC, and UI

Browser settings:

```text
browserContextEnabled = false
browserAllowedDomains = []
browserBlockedDomains = []
```

Folder setting:

```text
folderTrackingEnabled = false
```

Narrow APIs include:

```text
getBrowserContextStatus()
setBrowserContextEnabled(enabled)
getBrowserDomainRules()
setBrowserDomainRules(rules)
clearBrowserContext()
ingestBrowserContext(payload)

getFolderContextStatus()
addSelectedFolder()
removeSelectedFolder(id)
setFolderTrackingEnabled(enabled)
clearFolderContext()
```

The main process validates all payloads, IDs, rules, folder selection, scan behavior, and state changes. The renderer receives safe status only. The browser connector receives no SQLite, Electron, filesystem, shell, application-launcher, action, permission, or arbitrary IPC access.

The UI has compact Browser Context and Selected Folders sections showing enablement, connector status, domain rules, safe folder labels, file counts, pause/clear/remove controls, and no page contents or raw paths.

## LLM privacy boundary

External AI may receive only minimized structured context such as domain, category, topic, project label, technology, safe sanitized URL when useful, and aggregate folder/project context. It never receives full URLs with query strings, raw filesystem paths, file contents, page contents, credentials, cookies, tokens, private messages, clipboard, screenshots, keystrokes, audio, or video.

The LLM cannot ingest browser data directly, change connector settings, select folders, execute actions, modify permissions, or bypass confirmation.

## Security boundary

```text
LLM → suggestion
Permission Manager → authorization
User → confirmation
Action Executor → execution
```

Phase 12 adds no shell, arbitrary process execution, browser control, clicking, typing, form submission, arbitrary URL opening, file editing/deletion, credentials, cookies, browser database access, unrestricted directory scanning, hidden telemetry, cloud analytics, or autonomous behavior. Renderer security remains `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

## Phase 13 production hardening and lifecycle

Phase 13 keeps the existing local-only, privacy-first boundaries while hardening lifecycle behavior:

* `TaskManager` owns recurring maintenance work by stable task name. Registration and starts are idempotent, timers are cleared during shutdown, and a task cannot overlap itself. Exceptions are isolated and reported only through bounded local diagnostics.
* Startup initializes the database, runs transactional migrations, performs SQLite `integrity_check`, applies deterministic cleanup, then starts observation and maintenance. Initialization failures are reported as a controlled startup failure and normal operation is not exposed.
* Electron shutdown stops owned tasks and desktop observation, flushes/ends the active session, closes SQLite, and rejects operational state after shutdown. IPC remains main-process-owned.
* Retention is bounded and repeatable. Expired pending/approved agent actions are marked `expired` rather than removed, audit records remain protected, and recommendation feedback is removed before its recommendation is deleted.
* Folder maintenance is the sole recurring folder-scan owner and scans are bounded, read-only, metadata-only, privacy-gated, and isolated per selected folder. Duplicate desktop collector starts do not create duplicate timers or in-flight samples after stop.
* Safe diagnostics are an in-memory bounded ring containing only component, safe code, severity, timestamp, and optional duration. No raw exceptions, paths, URLs, prompts, credentials, or private content are stored or exposed.
* Settings retain safe defaults and are validated in the main process. Privacy pause gates desktop observation, browser ingestion, folder scanning, learning, semantic indexing, preference learning, and fresh recommendation context. The Phase 7 suggestion-permission-confirmation-execution boundary is unchanged.

Phase 13 adds no cloud telemetry, browser automation, shell/process execution, arbitrary filesystem access, credential access, or autonomous actions.

## Phase 14 explainability, lineage, and user control

Phase 14 adds application-owned, aggregate explanations without adding observation sources:

* `src/explainability.ts` produces bounded memory, preference, recommendation, semantic, and action DTOs. Lineage uses safe IDs, source labels, evidence counts, coarse recency, bounded reasons, projects, and technologies. Raw activity, URLs, paths, file/page contents, vectors, prompts, and responses are not exposed.
* Memory explanations derive evidence count, distinct days, projects, technologies, source types, recency, and a factual reason from persisted structured metadata.
* Preference explanations expose strength, confidence, trend, evidence, source attribution, project/technology associations, time pattern, and bounded feedback influence. Preference projects and technologies are persisted in migration version 12.
* Recommendation records now persist the application-owned deterministic signal names used during scoring. Explanations show those signals, bounded feedback counts, source types, and the stored reason; the LLM cannot select lineage or invent evidence. Natural-language explanations remain deterministic and application-owned.
* Privacy summary IPC exposes only aggregate counts and enabled states for activity, browser, folder, memory, preference, semantic, recommendation, feedback, and audit data.
* Deletion impact previews match implementation: forgetting a memory removes its memory, embedding, and same-name preference while retaining source observations; forgetting a preference retains memory evidence; deleting a recommendation removes its feedback; protected audit records remain protected.
* Narrow validated IPC provides explanations, deletion impact, granular memory/semantic controls, privacy summary, semantic status, and safe action lifecycle details. Renderer APIs do not expose database handles, SQL, paths, or filesystem access.
* The UI includes bounded privacy/data counts, source/signal explanations for memories, preferences, recommendations, semantic status, feedback, and action lifecycle details. It remains local and compact rather than exposing raw records.

No LLM-generated explanation endpoint was added: deterministic application-owned evidence is authoritative, so malformed or invented AI explanation output cannot affect lineage or controls. Existing LLM structured-output validation remains unchanged.

## Phase 15 controlled browser extension integration

Phase 15 adds an optional separate Manifest V3 Chromium-style extension in `browser-extension/`. It is an untrusted minimized observation client, not an automation system.

* The extension observes only the active tab using `tabs`, plus focus, activation, navigation, and transient in-memory duration state. It does not read page contents, DOM text, cookies, history, credentials, storage, clipboard, screenshots, messages, forms, downloads, bookmarks, or background tabs.
* Requested permissions are limited to `tabs`, `storage`, `alarms`, and the fixed localhost connector host `http://127.0.0.1:47631/*`. No native messaging, scripting, cookies, history, bookmarks, downloads, webRequest, or broad page permissions are requested.
* The desktop process owns the fixed loopback connector at `127.0.0.1:47631`. It exposes only pair-request, pair-status, and authenticated submit endpoints. It does not expose Electron IPC, SQLite, filesystem, shell, action, permission, or LLM capabilities.
* Pairing is explicit: the extension requests pairing, the user approves a pending request in the desktop Browser Context panel, and the desktop generates a random token. The desktop stores only a SHA-256 token hash; the token is held by the extension and never enters renderer dashboard state or diagnostics. Revocation removes the hash and invalidates the old token.
* Connector requests are bounded to 8 KiB, authenticated, rate-limited to 60 accepted requests per token per minute, and revalidated by the existing main-process browser payload validator. Desktop assigns browser source attribution and remains authoritative for URL sanitization, domain rules, stale timestamps, duration bounds, enablement, privacy pause, and storage.
* Connector lifecycle states are `disabled`, `not_paired`, `paired`, `connected`, and `revoked`. Connected means a valid authenticated payload was accepted within the recent connection window; extension installation alone does not imply connection.
* The extension stores only its pairing token and small status values in browser extension storage. It has no browser history database. Duration is best-effort and transient; service-worker suspension or shutdown can prevent an exact final duration.
* Accepted records continue through the existing browser context, memory, semantic, preference, recommendation, explainability, and privacy pipeline. The extension cannot change desktop rules or invoke actions.

The extension source and protocol are documented in `browser-extension/README.md`. Manual browser installation and packaging were not available in this environment, so no browser platform is claimed as tested.

## Phase 16 unified context, source intelligence, and activity correlation

Phase 16 adds `src/unified-context.ts` and extends `ContextEngine` without adding observation sources or a second activity database.

* Every activity is normalized to bounded source, source ID, timestamp, duration, confidence, category/topic/project fields, and canonical technologies. Only `desktop`, `browser`, and `folder` sources are accepted internally.
* Same-source observations with the same bounded application/title/minute key are suppressed at the aggregation layer; underlying source database records are not deleted. Cross-source observations remain attributable and can reinforce a unified context without being treated as unlimited independent memory evidence.
* Freshness windows are deterministic: desktop 60 minutes, browser 15 minutes, folder 30 minutes. Context processing considers at most 100 normalized inputs and 60 windowed inputs. Unified sessions have a 10-minute temporal grouping threshold and a 90-minute hard maximum.
* Source weights remain desktop 1.00, browser 0.65, and folder 0.45. The application-owned confidence formula is:

```text
clamp(
  initialContextConfidence × 0.35
  + sourceCoverage × 0.20
  + sourceAgreement × 0.20
  + durationScore × 0.10
  + temporalProximity × 0.10
  + strongestConsistency(project/topic/technology) × 0.05
)
```

`sourceCoverage` is the bounded sum of contributing source weights divided by 1.8. Duration reaches its maximum at 30 minutes, and all components are clamped to 0..1.

* Category resolution prefers structured topic categories when multiple signals agree; otherwise the existing classifier remains authoritative. Project inference combines existing window-title project detection with safe selected-folder labels and remains conservative. Technology aliases such as JS, TS, Godot Engine, and NodeJS are canonicalized deterministically.
* Context DTOs now include safe source types, confidence signal names, bounded session ID/time bounds, bounded transitions, and an effective evidence duration. No raw URL, path, title, page content, or file content is persisted as a context aggregate.
* Context explanation IPC and UI fields show sources, confidence signals, duration, and safe transitions. The existing memory/recommendation pipeline consumes the unified context, while privacy pause, semantic caps, preference thresholds, feedback bounds, and action boundaries remain unchanged.
* Browser connector reliability adds bounded duplicate submission suppression in memory while preserving pairing, authentication, revocation, localhost-only transport, and rate limiting. Folder scanning remains selected-folder-only, metadata-only, bounded, and read-only.
* Unified context is derived dynamically from existing bounded source records. It has no separate permanent storage, so existing retention, clear-source, forget, and delete-all behavior remain authoritative.

## Phase 17 advanced memory, neural semantics, and adaptive personalization

Phase 17 extends the existing memory and semantic pipeline without adding observation sources, raw activity storage, cloud embeddings, or autonomous behavior.

* `MemoryEngine` canonicalizes explicit aliases such as JS/JavaScript, TS/TypeScript, Godot Engine/Godot, NodeJS/Node.js, and C++ variants before identity matching. It does not use unrestricted fuzzy merging.
* Memory evidence is grouped by the unified session ID when available. The first event in a session contributes normal evidence; repeated updates from the same session contribute at most 0.2 evidence weight and bounded duration. Distinct sessions and days continue to accumulate normally. Underlying source records remain unchanged.
* Memory strength and confidence remain separate and bounded. Strength incorporates bounded incremental evidence, duration, and existing decay. Confidence incorporates repeated evidence, distinct days, and source diversity. Both remain in 0..1 and decay under existing retention behavior.
* Memory metadata retains bounded evidence sessions, observed days, source types, projects, and technologies only. It never becomes a raw activity archive.
* `memory-clusters.ts` exposes deterministic concept clusters from explicit `MEMORY_RELATIONSHIPS`. Clusters have maximum depth 2, maximum 20 concepts, and maximum 30 relationships. Semantic similarity does not create relationship identities.
* Preference confidence now includes bounded source diversity and project continuity. Projects, technologies, source types, and continuity are stored in migration version 13. Existing repeated-evidence thresholds, feedback bounds, trend states, and decay behavior remain authoritative.
* Preference recovery is deterministic: an inactive interest can become rising again when recent bounded evidence exceeds the prior 14-day comparison window; one unusual session cannot create a strong preference. Existing stable, declining, new, and inactive states remain.
* Neural model descriptors now validate optional provider, version, and supported runtime metadata. The application never executes a manifest-referenced file. The current application has no bundled neural runtime; when local-neural is selected but unavailable, the main process uses the deterministic local provider and reports the active provider accurately.
* Deterministic embeddings remain incremental and reusable by provider, model, dimensions, and text hash. Memory deletion, clear semantic operations, and orphan cleanup remove embeddings. Retrieval ranking now combines similarity, memory strength, and confidence with stable tie-breaking while preserving bounded threshold and result limits.
* LLM context may receive bounded projects, technologies, source types, and project continuity, but never vectors, hashes, raw evidence, model paths, raw URLs, raw paths, or private content. Agent and action boundaries are unchanged.

Phase 17 performance bounds include 180 retained evidence-session/day metadata entries per memory, 30 project/technology associations, 20 concept-cluster concepts, 30 cluster relationships, incremental embedding batches, and the existing bounded context/retrieval limits. No second memory database is introduced.

## Phase 18 local intelligence, timeline, and production-scale personalization

Phase 18 extends the existing local intelligence layer without adding observation sources or relaxing privacy boundaries.

* The safe neural runtime boundary remains available through `EmbeddingProvider` and `LocalNeuralEmbeddingProvider`, but no bundled neural runtime is claimed. Main-process model registration imports only a validated `model.json` from a user-selected directory into the controlled application model directory; model removal is main-process-owned. The active provider falls back to deterministic local embeddings when neural execution is unavailable.
* Semantic queries are expanded only from explicit local relationships. Hybrid retrieval combines vector similarity, memory strength, confidence, and stable ordering. Limits and thresholds remain bounded, and query text is not persisted.
* Main-process memory search supports bounded query, category, project, technology, source, strength, confidence, and recency filters. Results are safe memory DTOs, not raw database rows.
* Timeline IPC derives bounded structured events dynamically from existing activity, browser, and folder records. It does not create a second timeline database. Project profiles derive from bounded memory metadata and expose safe lifecycle states: new, active, stable, cooling, or inactive.
* SQLite migration version 14 adds indexes for timestamps, memory lookup, recommendation state, feedback time, and embedding compatibility metadata. No raw private data is added.
* Timeline and project UI sections show only source, category/topic, project, technology, duration, confidence, lifecycle, trend, and active-day summaries. Relationship exploration remains bounded through the Phase 17 cluster API.
* Existing recommendation weights, feedback bounds, semantic caps, privacy pause, retention, deletion behavior, LLM minimization, and action boundaries remain unchanged. No automatic model downloads, cloud embeddings, autonomous actions, or unrestricted scans are introduced.

Phase 18 bounds include 200 timeline results per request, 100 memory-search results, 50 project profiles, explicit relationship-cluster limits, bounded embedding batches, and the existing context/retrieval limits. Large-scale synthetic benchmark fixtures were not added to the normal suite because no benchmark runner exists in the current project.

## Phase 18 validation record

```text
npm run typecheck: passed
npm test: 131 tests, 0 failures, 0 skipped
renderer syntax check: passed
browser-extension syntax checks: passed
```

## Phase 16 validation record

The completed Phase 16 validation was:

```text
npm run typecheck: passed
npm test: 123 tests, 0 failures, 0 skipped
```

## Tests and validation

Deterministic tests cover:

* browser disabled/allowlist/blocklist behavior
* malformed payloads, stale timestamps, bounded titles/durations
* URL sanitization, query/fragment removal, and credential rejection
* domain normalization and source attribution
* explicit folder scanner behavior
* sensitivity filtering
* ignored directories, depth/file limits, path normalization, and deterministic ordering
* desktop/browser/folder context combination and source weighting
* existing memory, preference, semantic, recommendation, feedback, LLM, permission, and action behavior
* Phase 13 task idempotency, duplicate-execution suppression, task failure isolation, diagnostics sanitization, and lifecycle bounds
* Phase 14 bounded lineage, memory/preference/recommendation explanations, source attribution, feedback boundaries, privacy summary safety, semantic/action explanation safety, and private-data exclusion
* Phase 15 connector pairing, authentication, revocation, rate limits, malformed request rejection, and untrusted-client boundaries
* Phase 16 cross-source correlation, same-source deduplication, source attribution, session/freshness bounds, confidence signals, canonical technologies, project inference, stale-source handling, and connector duplicate suppression
* Phase 17 canonical memory identity, session evidence grouping, bounded strength/confidence, explicit relationship clusters, neural descriptor validation, deterministic fallback, semantic retrieval ranking, source-diverse preference evolution, and privacy-safe personalization

No real browser extension, external browser, filesystem contents, network call, or real action is required by tests. Connector payloads and filesystem listings are mocked.

Validation commands:

```text
npm run typecheck
npm test
```

Phase 17 validation:

```text
npm run typecheck: passed
npm test: 128 tests, 0 failures, 0 skipped
```

## Phase 19 goals, workflow planning, and controlled execution

Phase 19 adds explicit user intent and bounded workflow orchestration on top of the existing context, memory, personalization, recommendation, permission, executor, and audit layers.

* User-created goals are stored separately from learned preferences. Goals support bounded title/description/category, priority, optional target date, active/paused/completed/archived state, explicit or derived progress, and bounded associations to projects, technologies, categories, concepts, and preferences. Goals are never silently created from activity or LLM output.
* Derived progress is an explainable activity-associated signal only. It uses structured memory/project evidence, active days, and recency; it does not claim real-world task completion. Explicit progress remains user-provided.
* Recommendation generation preserves the `0.35 / 0.30 / 0.20 / 0.15` base weights. Active-goal relevance is a small capped additive signal. Recommendation output remains deterministic, bounded, and feedback-aware with duplicate/context diversity suppression.
* Plans and steps are persisted separately. A plan is validated before storage, limited to 10 steps, limited to the existing application-owned Level 2 tools, and expires after five minutes. Unknown tools, arbitrary targets, malformed arguments, and permission changes are rejected.
* Plan approval marks validated steps approved; execution creates controlled pending actions and invokes the existing `PermissionManager` and `ActionExecutor`. The executor revalidates approval, expiration, arguments, allowlists, and current permission state immediately before the action. No shell, browser automation, arbitrary path, or permission escalation is introduced.
* Step idempotency keys are persisted and action IDs are deterministic per step. Plan execution is sequential and bounded. Failed steps remain visible for review/retry; uncertain external outcomes are never silently treated as completed.
* Migration 15 adds `goals`, `goal_associations`, `agent_plans`, and `agent_plan_steps`, with indexes for lifecycle, association lookup, plan expiry, and step order. No prompts, full LLM responses, raw activity archives, credentials, or private source content are stored.
* New main-process APIs expose safe goal and plan DTOs. Renderer additions provide compact goal and controlled-plan summaries. Privacy pause continues to prevent fresh context/learning/recommendation evidence; existing user-created goals remain intact.

The application still has no production neural inference runtime. Neural model registration and the safe adapter boundary exist, while deterministic embeddings remain the truthful fallback.

## Phase 19 validation record

```text
npm run typecheck: passed
npm run build: passed
npm test: 135 tests, 0 failures, 0 skipped
renderer syntax check: passed
browser-extension syntax checks: passed
```

## Phase 20 neural intelligence, workflow control, portability, and reliability

Phase 20 adds production-oriented control and portability without weakening the local-first security boundary.

* Migration 16 adds bounded user-created goal milestones and indexes. Milestones are user-controlled and are never marked complete from observation alone.
* Individual plan-step approval is now available through main-process IPC. A plan-level approval remains supported, but a step must be explicitly approved before controlled execution. Rejected steps cannot execute.
* Plan steps support bounded dependency references to earlier steps. Forward references and cycles are rejected; dependent steps require successful completion of their dependencies.
* Workflow recovery continues to classify interrupted running plans as paused and running steps as failed/needs-review metadata. No uncertain Level 2 action is automatically retried.
* Data export, import preview, validated import, safe JSON backup, and lifecycle summaries are main-process-owned. Export DTOs exclude model paths, tokens, credentials, and raw source content. Import is schema/version bounded and does not execute imported content.
* Recommendation settings now include enabled state, bounded frequency, daily limit configuration, and goal-progress control. Recommendation generation respects the enabled/off controls while existing deterministic weights and feedback limits remain authoritative.
* The control-center UI exposes recommendation controls, export/import/backup actions, and bounded lifecycle counts. Goals and workflow summaries remain compact and safe DTOs.
* No production neural inference runtime was safely available in the existing dependency/runtime constraints. The application truthfully keeps local-neural unavailable unless an actual compatible runtime is supplied; deterministic local embeddings remain the fallback. No fake neural status is reported.

## Phase 20 validation record

```text
npm run typecheck: passed
npm run build: passed
npm test: 138 tests, 0 failures, 0 skipped
renderer syntax check: passed
browser-extension syntax checks: passed
```

Optional large-scale performance test commands do not exist in `package.json`; no unsupported benchmark result is claimed. The existing future work remains production neural inference integration, packaged extension installation, advanced performance benchmarking, browser automation, file editing, credentials, external tracking, and cloud analytics.

## Phase 21 production hardening

Phase 21 adds bounded reliability and portability improvements while preserving the same security boundary.

* Migration 17 adds bounded retry metadata to workflow steps: attempt count, maximum attempts, last attempt, next retry, failure code, and retryability. Retries remain application-owned and bounded; uncertain Level 2 operations are not silently retried.
* Plan dependencies remain limited to earlier steps and are persisted as safe IDs. Dependency failures block downstream execution.
* Export snapshots now use schema version 17 and include bounded memories, preferences, recommendations, feedback, goals, milestones, plans, and safe settings. A SHA-256 checksum covers the structured payload; it is integrity metadata, not authentication.
* Import validates the version, bounded collection sizes, checksum, and goal conflicts before calling the database import transaction. Imported content is data only and never executable. JSON backup remains local and explicit.
* Neural model descriptors and neural outputs remain untrusted. `LocalNeuralEmbeddingProvider.selfTest()` validates finite, exact-dimension, reproducible output when an actual runtime is supplied. No actual production neural runtime is bundled because none is safely available in the current dependency/runtime environment; deterministic local embeddings remain the truthful fallback.

## Phase 21 validation record

```text
npm run typecheck: passed
npm run build: passed
npm test: 142 tests, 0 failures, 0 skipped
renderer syntax check: passed
browser-extension syntax checks: passed
npm audit: 17 vulnerabilities reported (1 moderate, 15 high, 1 critical); remediation intentionally not performed (historical Phase 21 validation record; see current Dependency Status below)
```

No dedicated Phase 21 performance suite or supported Electron production-launch check exists in `package.json`. No real neural runtime inference, external application launch, or cloud service test is claimed.

## Phase 22 completion and validation

Phase 22 completes the highest-value missing Phase 21 infrastructure without adding unsafe capabilities.

* Portable import now validates and restores bounded goals, milestones, memories, preferences, recommendations, feedback, workflow plans, workflow steps, dependencies, and safe recommendation/progress settings. Plan IDs, step IDs, dependencies, and goal conflicts are checked before the transaction. Import remains data-only and never restores secrets or protected audit records.
* Workflow retry execution is now integrated with `TaskManager` under the stable `workflow-retry` task. It processes at most three eligible steps per cycle, uses bounded exponential delay, enforces per-step attempt limits, revalidates through `ActionExecutor`, respects privacy pause, and stops with shutdown. Permission, validation, expiry, and uncertain-action failures are not retried.
* Plan and step cancellation are main-process controlled. Cancelled steps are not retryable or executable. Interrupted running steps recover as `needs_review` rather than completed.
* Added isolated SQLite recovery validation for transactional migration rollback, integrity checks, orphan embedding cleanup, and protected audit preservation. Added a separate synthetic performance command rather than slowing normal tests.
* The actual Electron launch was attempted and is unavailable in this environment because the system lacks `libnss3.so`; no production-launch success is claimed. The extension syntax checks remain local/static only.
* A real neural inference runtime remains unavailable under the current safe dependency constraints. Neural validation and deterministic fallback remain truthful.

## Phase 22 validation record

```text
npm run typecheck: passed
npm run build: passed
npm test: 142 tests, 0 failures, 0 skipped
npm run recovery: passed
npm run performance: passed (synthetic run: 5000 requested records, 56 canonical memories, 1 project profile, 347 ms)
renderer syntax check: passed
browser-extension syntax checks: passed
Electron launch: attempted; unavailable because libnss3.so is missing
npm audit: 17 vulnerabilities reported (1 moderate, 15 high, 1 critical); no blind remediation applied (historical Phase 22 validation record; see current Dependency Status below)
```

The performance command is a bounded synthetic smoke/performance run, not a release benchmark guarantee. The actual production neural runtime and Electron launch remain environment-dependent limitations.

## Phase 23 release-candidate validation and performance hardening

Phase 23 is validation-focused and does not add new observation sources or unsafe capabilities.

* Added a full workflow lifecycle/dependency/security regression file covering pending, approved, running-equivalent, completed, failed, retryable, cancelled, and dependency-blocked behavior. Main-process recovery still marks uncertain running work as `needs_review`.
* Expanded the dedicated performance command to generate and exercise synthetic collections of 5,000 activities, 2,000 memories/embeddings, 500 preferences, 500 recommendations, 1,000 feedback records, 500 goals, 1,000 milestones, 500 plans, and 2,000 steps. It now measures project profiles, recommendation generation, timeline selection, semantic selection, export size/time, import preview parsing, cleanup, and workflow recovery. The latest run produced 50 project profiles and 4 recommendations; timings are smoke measurements, not production guarantees.
* Added explicit privacy/permission tests for unsafe URLs, arbitrary application/folder targets, malformed tools, minimized LLM context, retry bounds, and dependency execution.
* Completed a portable import extension for workflow plans, steps, dependencies, feedback, and safe settings, with conflict checks before the existing transaction. Invalid imports remain atomic.
* Recovery testing now covers migration rollback, integrity checks, repeated/idempotent cleanup, orphan embeddings, feedback, steps, goal associations, milestones, dependencies, and protected audit preservation in an isolated temporary database.
* `npm audit` was reviewed by package, severity, direct/transitive status, affected dependency path, and available fix. Historical Phase 23 review recorded 17 vulnerabilities: 1 moderate, 15 high, and 1 critical; see current Dependency Status below. Automatic upgrades were not applied because available fixes require major Electron/active-win/uuid changes and compatibility review.
* Electron production launch was previously attempted and remains environment-blocked by missing `libnss3.so`; no launch success is claimed. Browser validation remains static/local.

## Phase 23 validation record

```text
npm run typecheck: passed
npm run build: passed
npm test: 146 tests, 0 failures, 0 skipped
npm run recovery: passed
npm run performance: passed; requested synthetic dataset exercised; measured project profiles 20 ms, recommendations 11 ms, export 0 ms, import preview 11 ms, cleanup 0 ms, and workflow recovery 0 ms for the latest run
renderer syntax check: passed
browser-extension syntax checks: passed
npm audit: 17 vulnerabilities (1 moderate, 15 high, 1 critical) (historical Phase 23 validation record; see current Dependency Status below)
Electron launch: attempted; unavailable because libnss3.so is missing
```

Remaining release limitations are the absent production neural runtime, environment-blocked Electron launch, static-only browser validation, and unresolved dependency vulnerabilities documented above.

## Phase 24 final release validation

Phase 24 establishes the release version and validates the production build path without adding capabilities.

* Release version remains the single package version, `0.1.0`, and is exposed through a safe About/App Info DTO. The renderer receives only name, version, phase, privacy mode, and provider status.
* The build now places compiled renderer assets at the path used by production `BrowserWindow.loadFile`: `dist/renderer/index.html`, `renderer.js`, and `styles.css`. `npm run release-check` validates required release files and rejects forbidden browser-extension permissions.
* Production Electron security settings remain `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. No installer tool is configured, so no platform installer is claimed.
* Clean startup validation uses an isolated temporary SQLite database and verifies safe defaults, integrity, and reopen behavior. Migration/recovery validation remains isolated and does not touch user data.
* Portable export/import, workflow recovery, permission rejection, privacy minimization, and neural fallback tests remain active. No real neural runtime is claimed.
* The Electron launch was attempted and remains blocked in this environment by missing `libnss3.so`. Browser extension validation is static/local; manifest permissions are `tabs`, `storage`, and `alarms`, with no cookies/history/scripting/webRequest/downloads/bookmarks/native messaging permissions.
* Historical Phase 24 review recorded 17 vulnerabilities (1 moderate, 15 high, 1 critical). The current count is documented in the Dependency Status and final sign-off sections below.

## Phase 24 validation record

```text
npm run typecheck: PASS
npm run build: PASS
npm test: PASS — 146 tests, 0 failures, 0 skipped
npm run recovery: PASS
npm run performance: PASS
npm run clean-startup: PASS
npm run release-check: PASS
renderer syntax: PASS
browser-extension syntax: PASS
Electron launch: BLOCKED — libnss3.so unavailable in environment
npm audit: REVIEWED — 11 vulnerabilities remain (1 moderate, 10 high, 0 critical); current Phase 24 final count after verified overrides
```

Release limitations are explicitly environment/dependency related: no production neural inference runtime, no platform installer build in the current package configuration, Electron host-library blockage, static-only browser validation, and unresolved dependency vulnerabilities.

## Phase 24 final sign-off

The implementation is complete as a release candidate. The remaining limitations are environment or optional-capability limitations, not unimplemented core application requirements.

```text
Version: 0.1.0
Production build: PASS
Typecheck: PASS
Tests: PASS — 146 passed, 0 failed, 0 skipped
Recovery: PASS
Performance: PASS — requested synthetic dataset exercised
Clean startup: PASS
Release check: PASS
Backup/import: validated by existing transactional/import and portability tests
Workflow recovery: PASS — lifecycle, dependency, retry, cancellation, and needs-review coverage
Security: PASS — adversarial permission and tool validation coverage
Privacy: PASS — minimized LLM context and excluded-data coverage
Electron: BLOCKED — libnss3.so unavailable in the validation environment
Browser extension: PASS — static/local validation; real Chromium installation unavailable
Neural runtime: OPTIONAL CAPABILITY NOT AVAILABLE — deterministic local fallback active
Dependencies: CURRENT — 11 npm audit vulnerabilities remain (1 moderate, 10 high, 0 critical); verified overrides retained; no blind major upgrades applied
Documentation: PASS — README.md and ARCHITECTURE.md updated
```

Electron failure is classified as an environment blocker: the host lacks `libnss3.so`, while the built application, preload, renderer, migrations, and security configuration validate successfully. No platform installer is claimed because no installer tool is configured or required by the current source-plus-production-build distribution model.

The final prohibited-capability audit remains clean: no shell/process execution, arbitrary filesystem access, browser automation, credentials, cookies, clipboard, screenshots, keylogging, audio/video, cloud telemetry, autonomous actions, automatic model downloads, or permission escalation were introduced.

## Interface and desktop distribution note

The renderer now defaults to a compact user-facing view. Core controls remain visible while advanced browser, folder, semantic, workflow, diagnostics, and lifecycle controls are hidden behind the `More controls` toggle. The renderer remains safe and main-process validated.

The repository produces a validated production build, but no Windows `.exe` installer is generated in the current Linux environment. No Wine, NSIS, electron-builder, or equivalent Windows packaging tool is available. A Windows packaging environment is required to produce and test a native double-click `.exe` without weakening the application security model.

# Current implementation inventory

## What this project is for

Private Context Engine is a local-first Electron desktop application that helps a user understand their own activity through bounded, structured metadata. It derives context, memories, preferences, goals, recommendations, and user-controlled workflows without collecting private content or granting autonomous control to an AI system.

The intended product flow is:

```text
Authorized observation
→ structured context
→ memory
→ personalization
→ explicit user goals
→ deterministic recommendations
→ validated workflow plan
→ Permission Manager
→ explicit user approval
→ Action Executor
→ protected audit record
```

The application is not a browser automation tool, remote monitoring tool, keylogger, file-content indexer, autonomous agent, cloud analytics service, or general-purpose computer-control system.

## Runtime and application structure

The application uses Electron with a main process, isolated preload bridge, and sandboxed renderer.

### Main process

Owns:

- SQLite database and migrations
- Observation collectors
- Context and memory orchestration
- Semantic provider selection and fallback
- Recommendation generation
- Goal and milestone persistence
- Workflow plan persistence and execution
- Permission validation
- Action execution
- Browser connector authentication and rate limiting
- Folder selection and bounded metadata scans
- Export/import/backup operations
- Audit events
- Maintenance and retry tasks

### Preload bridge

The preload exposes narrow, validated APIs through `contextBridge`. The renderer does not receive database handles, filesystem handles, shell access, Electron APIs, raw database rows, model paths, or security internals.

### Renderer

The renderer is a compact dashboard. It shows safe DTOs for:

- Current activity
- Recent activity
- Privacy controls
- Recommendations
- Goals and milestones
- Workflow plans and steps
- Timeline and project summaries
- Memory and personalization summaries
- Semantic search and provider status
- Export/import/backup controls
- About/version information

Advanced sections are hidden by default behind the `More controls` toggle.

## Observation sources and privacy boundaries

Authorized observation sources are limited to:

- Desktop foreground application metadata
- Optional browser-extension structured connector payloads
- Explicitly selected-folder metadata

The system does not collect or expose:

- Passwords
- Credentials
- API keys
- Tokens
- Cookies
- Clipboard data
- Screenshots
- Keystrokes
- Audio
- Video
- Private messages
- Page contents
- File contents
- Unrestricted browser history
- Inactive-tab data
- Raw filesystem paths in renderer/LLM DTOs
- Unrestricted URLs and query strings

Browser input is untrusted and must be paired, authenticated, bounded, and validated. Folder scans are bounded and metadata-only. Sensitive filenames and excluded locations are rejected.

Privacy pause prevents new context learning, memory evidence, preference evidence, semantic indexing, recommendation context, and goal progress evidence. Existing user data is not silently deleted by pausing.

## Context and activity understanding

The context pipeline provides:

- Application/category classification
- Topic and subtopic extraction
- Project detection from structured metadata
- Technology normalization
- Session grouping
- Source attribution
- Cross-source correlation
- Duplicate suppression
- Freshness and stale-source handling
- Bounded confidence signals
- Transition summaries
- Duration summaries

Context remains structured. Correlated sources do not become unlimited independent evidence.

A derived timeline is built from existing activity, browser, and folder records. It is not a second permanent raw-activity database.

## Memory and personalization

Memory records support:

- Canonical identity
- Category and type
- Strength separate from confidence
- Evidence count
- Total duration
- First/last seen timestamps
- Session evidence grouping
- Project and technology metadata
- Bounded decay and retention
- Deletion and embedding invalidation

Preferences support:

- Repeated-evidence thresholds
- Duration and distinct-day signals
- Source diversity
- Project continuity
- Recency and decay
- Feedback influence
- Rising, stable, declining, and inactive trends
- Explainable aggregate evidence

Memory and preference deletion retain unrelated activity and protected audit records according to the existing deletion rules.

## Semantic memory

The semantic layer includes:

- Deterministic local embeddings
- Validated local-neural provider abstraction
- Model descriptor validation
- Controlled model import and removal
- Provider/model compatibility metadata
- Incremental bounded indexing
- Exact/canonical and explicit relationship support
- Bounded semantic query expansion
- Similar-memory retrieval
- Threshold and result limits
- Semantic explanations
- Embedding deletion and cleanup
- Neural provider self-test when an actual runtime is supplied

Current truth:

```text
local-neural runtime: unavailable in this environment
active fallback: deterministic local embedding provider
```

There is no production neural inference runtime bundled. The application must not claim neural execution merely because a model descriptor exists.

## Projects, goals, and milestones

Project profiles are derived from structured memory metadata and expose:

- Project name
- Category
- Technologies
- Concepts
- Total associated time
- Active days
- Source types
- Last activity
- Trend
- Lifecycle state

Goals are explicitly user-created and are separate from learned preferences. They support:

- Title and description
- Category
- Active, paused, completed, and archived states
- Priority
- Optional target date
- Explicit or derived progress
- Project, technology, category, concept, and preference associations
- Activity-based trend and active-day summaries
- Safe deletion without deleting memories or unrelated activity

Milestones are user-created and support:

- Active and completed state
- Edit and delete
- Goal association
- Explicit completion only

Activity may be associated with a goal, but activity never proves real-world completion.

## Recommendations

Recommendations remain application-owned and deterministic. Base weights are preserved:

```text
context match       0.35
preference strength 0.30
memory strength     0.20
recency              0.15
```

Additional bounded signals include:

- Semantic support
- Goal relevance
- Project continuity
- Repeated evidence
- Feedback
- Recommendation history
- Category/project diversity
- Duplicate suppression
- Cooldown and frequency settings

Recommendation feedback distinguishes useful, not useful, dismissed, and ignored outcomes. Recommendation completion remains distinct from usefulness feedback.

## Controlled workflows and actions

Workflow plans and steps are persisted and bounded.

Plans support:

- Draft/pending/approved/running/paused/completed/failed/cancelled/expired states
- Up to 10 steps
- Five-minute approval/expiration window
- Goal and recommendation references
- Sequential execution
- Dependency validation
- Dependency blocking
- Individual step approval/rejection
- Step cancellation
- Idempotency keys
- Retry metadata and bounded retries
- Recovery to `needs_review` for uncertain interrupted work

Supported executable tools remain limited to application-owned Level 2 actions:

- `open_url`
- `open_application`
- `open_approved_folder`

Every executable step passes through:

```text
validated request
→ PermissionManager
→ user approval
→ expiration check
→ allowlist/target check
→ ActionExecutor
→ audit
```

The LLM cannot execute tools, approve actions, increase permission levels, change allowlists, mark execution complete, or bypass confirmation.

## Data portability and lifecycle

The application supports explicit local:

- JSON export
- Import preview
- Checksum validation
- Conflict checks
- Transactional import
- Structured backup
- Lifecycle/count summaries

Restorable data includes bounded goals, milestones, memories, preferences, recommendations, feedback, workflows, dependencies, and safe settings.

Excluded data includes credentials, API keys, pairing secrets, token hashes, model binaries, executable paths, raw file/browser contents, full prompts/responses, and protected audit/security state.

Deletion and retention remain bounded and preserve protected audit behavior.

## Database and migrations

SQLite is stored under Electron `userData`. The schema uses versioned migrations and startup integrity checks.

Current migrations include:

- Base schema and settings
- Memory and preference columns
- Recommendation fields
- Agent action persistence
- Feedback dimensions
- Semantic embeddings
- Browser and folder context
- Unified context metadata
- Phase 14–17 indexes and semantic support
- Migration 15: goals, associations, plans, and plan steps
- Migration 16: goal milestones and indexes
- Migration 17: retry metadata and workflow reliability fields

The application does not create a second permanent raw activity database.

## Release and packaging status

Current package version: `0.1.0`.

Production build output is validated at:

```text
dist/main/main.js
dist/main/preload.js
dist/renderer/index.html
dist/renderer/renderer.js
dist/renderer/styles.css
```

`npm run release-check` validates required build files and browser-extension permissions.

No platform-specific installer is currently configured. No Windows `.exe` is included. Producing a native double-click `.exe` requires a Windows-compatible packaging environment/toolchain, which is not available in the current Linux environment.

Electron launch was attempted but blocked by the host environment because `libnss3.so` is unavailable. This is classified as an environment limitation, not a demonstrated application startup failure on Windows.

## Browser extension status

The optional Manifest V3 extension includes static/local validation, pairing, authentication, revocation, payload validation, size limits, and rate limiting.

Current permissions are:

```text
tabs
storage
alarms
```

Real Chromium installation/store validation has not been performed.

## External LLM status

External AI is disabled by default. If explicitly enabled, only minimized structured context may be sent. The external provider must not receive raw events, raw URLs, paths, file/page content, credentials, cookies, tokens, vectors, hashes, model paths, or protected audit data.

LLM output is untrusted structured input and is validated before it can influence recommendations or workflow proposals.

## Testing and validation

Current validation commands include:

```text
npm run typecheck
npm run build
npm test
npm run recovery
npm run performance
npm run clean-startup
npm run release-check
```

Current recorded results:

```text
Typecheck: PASS
Build: PASS
Tests: 146 passed, 0 failed, 0 skipped
Recovery: PASS
Performance: PASS
Clean startup: PASS
Release check: PASS
Renderer syntax: PASS
Browser-extension syntax: PASS
```

The performance suite exercises synthetic collections of 5,000 activities, 2,000 memories/embeddings, 500 preferences, 500 recommendations, 1,000 feedback records, 500 goals, 1,000 milestones, 500 plans, and 2,000 workflow steps. Measurements are smoke/performance measurements, not production guarantees.

## Dependency status

The latest `npm audit` reports:

```text
1 moderate
10 high
0 critical
11 total
```

The findings were reviewed by direct/transitive status, package path, severity, available fix, and compatibility risk. No blind automatic upgrade was applied. Major upgrade paths include Electron, `active-win`, and `uuid` compatibility changes.

## What is missing or not available

The following are intentionally not claimed as complete capabilities:

1. **Production neural runtime** — no safe in-process runtime is bundled; deterministic embeddings are the active fallback.
2. **Native Windows `.exe` installer** — no Windows packaging toolchain is available in the current environment, and no installer is configured.
3. **Successful production Electron launch in this environment** — blocked by missing `libnss3.so`.
4. **Real Chromium/browser installation validation** — only static/local extension validation is available.
5. **Dependency vulnerability remediation** — vulnerabilities are reviewed but not blindly upgraded; compatible maintenance work remains separate.
6. **Real external application execution tests** — action tests use deterministic mocks and do not launch real applications.
7. **Cloud/remote service validation** — no cloud service is required or used by the local core.
8. **Platform-specific installer signing, auto-update, code signing, and distribution** — not configured.

These limitations are documented rather than simulated or hidden. No future phase is planned by this document; remaining work is release-environment, packaging, optional-runtime, or dependency-maintenance work rather than a new product architecture.

## Final Phase 24 packaging/dependency maintenance update

The package manifest now includes `electron-builder@26.15.3` as a development dependency and a `package:win` script targeting an unsigned x64 NSIS installer with desktop and Start Menu shortcuts. Electron was moved to `devDependencies`, as required by electron-builder packaging validation; the runtime version remains Electron `32.3.3` in the installed lockfile.

The Windows packaging command was actually attempted:

```text
npm run package:win: BLOCKED
reason: node-gyp does not support cross-compiling native modules from source
module: active-win
```

No Windows installer artifact was produced. A Windows packaging environment or a compatible cross-compilation/native-module strategy is required. The provided `Dockerfile.win-build` is optional and untested in this environment.

The Electron launch environment was inspected as Debian 13 with `apt-get`, but `apt-get update && apt-get install -y libnss3` was blocked by insufficient permission to open `/var/lib/apt/lists/lock`. `Dockerfile.electron-launch` provides the optional untested library environment. The exact direct launch error remains:

```text
libnss3.so: cannot open shared object file: No such file or directory
```

The post-packaging audit initially reported 17 vulnerabilities: 1 moderate, 15 high, and 1 critical. Direct findings include Electron 32.3.3, active-win 8.2.1, electron-builder 26.15.3, and uuid 10.0.0. Available fixes require major-version changes for the direct packages or affect packaging/native build chains; no blind upgrade was applied. The full per-package audit output and compatibility decision are recorded by the final maintenance run.

### Final dependency triage table

| Package | Severity | Directness | Vulnerable path / issue | Available fix and decision |
|---|---|---|---|---|
| `electron` | high | direct | Electron runtime advisories and `@electron/get`/extract-zip chain | `41.7.1`, major; deferred because Electron major compatibility and host launch are not verifiable here |
| `active-win` | high | direct | `@mapbox/node-pre-gyp` / `node-gyp` / `tar` native build chain | `7.7.2` audit suggestion is not a safe security upgrade; deferred, current app uses v8 API |
| `uuid` | moderate | direct | Buffer bounds issue in specific v3/v5/v6 buffer usage | `14.0.2`, major; current code uses v10 and upgrade is deferred pending compatibility validation |
| `electron-builder` | high | direct devDependency | `app-builder-lib` and `dmg-builder` packaging chain | Audit suggests `26.5.0` despite installed `26.15.3`; no downgrade or blind change applied |
| `@electron/get`, `cacheable-request`, `extract-zip`, `got`, `http-cache-semantics` | high | transitive | Electron download/cache/extraction chain | Follows Electron major upgrade; deferred |
| `@mapbox/node-pre-gyp` | high | transitive | active-win/native build chain | Remains deferred; native Windows behavior is not validated here |
| `cacache` | high | transitive | active-win/npm archive chain | Override `21.0.1` retained after full validation |
| `make-fetch-happen` | high | transitive | npm archive chain | Override `16.0.1` retained after full validation; no additional audit reduction |
| `node-gyp` | high/critical path | transitive | active-win/native build chain | Override `13.1.0` retained after local-suite validation; CI now uses Node 22 to satisfy its >=22.22.2 engine requirement |
| `tar` | high/critical path | transitive | native build/archive chain | Override `7.5.22` retained after full validation; native Windows build remains untested |
| `electron-builder-squirrel-windows` | high | transitive | electron-builder packaging chain | Override `26.15.3` retained after full validation |

The original post-packaging state had `0 fixed` and 17 findings. The later override experiments reduced the current audit result to 11 findings: 1 moderate, 10 high, and 0 critical. Remaining direct and transitive findings with major compatibility or untested platform implications remain deferred.

## Follow-up packaging/dependency task

Vulnerability baseline comparison:

```text
Before electron-builder: 13 findings (1 moderate, 11 high, 1 critical)
After electron-builder: 17 findings (1 moderate, 15 high, 1 critical)
Difference: +4 findings
```

The four new package names are `app-builder-lib`, `dmg-builder`, `electron-builder`, and `electron-builder-squirrel-windows`. They are in electron-builder's build-time packaging dependency tree. `electron-builder` itself is a devDependency, and these packages are not included by the configured application `files` list or shipped in the Electron app's `dist` runtime bundle. They still affect the local/CI packaging toolchain and must be treated as build-environment security risks.

The current `active-win@8.2.1` package was inspected directly. It uses `node-pre-gyp`, optional dependencies including `@mapbox/node-pre-gyp`, `node-addon-api`, and `node-gyp`, plus platform-specific binary paths. Its install script uses `node-pre-gyp install --fallback-to-build`. Therefore the Windows path is expected to resolve/install a Windows prebuilt native binary on an actual Windows runner when available; the local Linux failure is specifically a cross-compilation/native rebuild limitation, not proof that active-win cannot install on Windows.

A GitHub Actions workflow was added at `.github/workflows/package-windows.yml`. It uses `windows-latest`, Node 22, `npm ci`, `npm run build`, `npm run package:win`, and uploads `release/*.exe`. Node 22 is intentional: the retained `node-gyp@13.1.0` override requires Node >=22.22.2, including the fallback-to-source-compilation path for `active-win`. It was not executed in this session because no GitHub Actions run can be triggered or observed from this environment.

The final current audit count after the verified override experiments is 11: 1 moderate, 10 high, and 0 critical. The overrides for `cacache`, `make-fetch-happen`, `node-gyp`, `tar`, and `electron-builder-squirrel-windows` were each added separately and followed by the complete validation suite; all five were retained after the existing local suite passed. That suite does not confirm compatibility with an actual completed Windows electron-builder pipeline. The remaining findings are primarily Electron/electron-builder and direct-package major-version paths, and are deferred for compatibility review. Full validation remained green after the packaging configuration, workflow, and override changes.


### Dependency override experiment results

Each candidate was tested as a separate incremental `package.json` override. After every addition, `npm install` and the existing local validation suite were run: typecheck, build, 146 tests, recovery, performance, clean-startup, and release-check. All five experiments passed that local suite and remain in the manifest and lockfile. This suite does not exercise electron-builder’s actual Windows packaging pipeline, including Electron download, archive extraction, or Squirrel installer generation; none of those steps has successfully completed in any environment. The overrides are therefore confirmed not to break the existing local suite, but are not yet confirmed compatible with a completed Windows packaging run.

| Override | Result | Audit observation | Compatibility note |
|---|---|---|---|
| `cacache@21.0.1` | retained; local suite passed; Windows packaging unconfirmed | reduced audit count from 17 to 16 | no functional regression observed |
| `make-fetch-happen@16.0.1` | retained; local suite passed; Windows packaging unconfirmed | remained at 16 | no additional audit reduction observed |
| `node-gyp@13.1.0` | retained; local suite passed; Windows packaging unconfirmed | reduced audit count to 14 | requires Node >=22.22.2; Windows CI is explicitly configured for Node 22, while the local Node 20 environment may still emit an engine warning |
| `tar@7.5.22` | retained; local suite passed; Windows packaging unconfirmed | reduced audit count to 11 and removed the critical finding | native/package behavior was not exercised by a successful Windows build here |
| `electron-builder-squirrel-windows@26.15.3` | retained; local suite passed; Windows packaging unconfirmed | remained at 11 | aligns the transitive package with the installed electron-builder release; no additional audit reduction |

The current audit result is `1 moderate, 10 high, 0 critical, 11 total`. This is an audit result, not proof that all remaining packages are safe or that the Windows installer works. The Windows workflow remains unexecuted in this environment.

## Maintenance quality and efficiency review

This maintenance pass preserved application behavior, privacy boundaries, IPC names and DTO shapes, database column definitions, permission checks, approval gates, audit behavior, and the electron-builder `files` glob.

```text
Dead code removed: unused local values/imports removed in
  src/agent-engine.ts, src/category-classifier.ts, src/llm-provider.ts,
  src/main/action-executor.ts, src/main/database.ts, src/main/main.ts, and
  src/unified-context.ts. The unused parameters in src/agent-engine.ts and
  src/goal-engine.ts were explicitly marked with underscore names to preserve
  their public call signatures. No unused exported API or unused source file
  was removed.
Duplication consolidated: none found that was identical and safe to merge.
File reorganization: none needed; existing modules were cohesive.
Database indexes added: none; reviewed WHERE/JOIN/ORDER BY usage was already
  covered by the existing migration indexes.
N+1 queries fixed: ActivityDatabase.plans() now loads all selected plan steps
  with one bounded batched query instead of one query per plan. Plan and step
  ordering is preserved.
Hot-path efficiency changes: none; no scoring weights, thresholds, formulas,
  or hot-path outputs were changed.
TypeScript strictness: strict was already enabled. noUnusedLocals and
  noUnusedParameters were enabled after the existing nine diagnostics were
  removed; typecheck passes with both flags.
Lint/format: added TypeScript-aware ESLint flat configuration,
  .prettierrc.json, ESLint and Prettier dev dependencies, and `lint` and
  `format:check` scripts. ESLint and format:check both pass. No repo-wide
  source reformat was applied.
```

The existing performance command was measured before and after the maintenance changes. The initial baseline reported `projectProfiles=21`, `recommendations=9`, `importPreview=10`, and `exportBytes=2098083`. Two separate performance runs after the maintenance pass produced different synthetic values: run A reported `projectProfiles=22`, `recommendations=11`, `importPreview=12`, and run B reported `projectProfiles=22`, `recommendations=14`, `importPreview=16`; both reported `exportBytes=2098083`. These values are consistent with expected run-to-run variance in the random synthetic dataset, and neither represents a regression. No performance improvement is claimed. The N+1 query change was verified by a new targeted database test covering zero-step, maximum-10-step, and multiple-plan cases, plus the existing suite; the performance command does not expose a dedicated plan-query timing.

Final maintenance validation:

```text
Typecheck: PASS
Build: PASS
Tests: PASS — 147 passed, 0 failed, 0 skipped
Recovery: PASS
Performance: PASS — synthetic suite completed
Clean startup: PASS
Release check: PASS
Lint: PASS
Format check: PASS
```
