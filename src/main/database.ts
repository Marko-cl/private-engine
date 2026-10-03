import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ActivitySummary, AgentActionStatus, AgentResponse, AgentPlan, Goal, BrowserContextRecord, CurrentContext, DetectedProject, FeedbackRecord, FeedbackSummary, FeedbackValue, MemoryRecord, PendingAgentAction, PreferenceRecord, Recommendation } from '../shared/contracts';
import { actionFeedbackAllowed, aggregateFeedback } from '../feedback-engine';
import { MemoryEmbedding, SemanticMemoryStore } from '../semantic-memory-engine';
import { FolderFileEntry, SelectedFolder } from '../folder-context';

function safeParseRequest(value: string, toolName: string, sourceContext: string, reason: string) { try { return JSON.parse(value) as PendingAgentAction['request']; } catch { return { toolName, arguments: {}, requiresConfirmation: true, sourceContext, reason, status: 'pending' as const }; } }
function parseVector(value: string): number[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) && parsed.every(item => typeof item === 'number' && Number.isFinite(item)) ? parsed : []; } catch { return []; } }
function safeParseJson(value: unknown) { if (!value || typeof value !== 'string') return undefined; try { return JSON.parse(value); } catch { return undefined; } }

export class ActivityDatabase {
  private db: Database.Database;
  constructor() {
    const file = path.join(app.getPath('userData'), 'context-engine.sqlite');
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    const integrity = this.db.pragma('integrity_check', { simple: true }) as unknown; if (integrity !== 'ok') throw new Error('database_integrity_failed');
    this.recoverInterruptedPlans();
  }
  private migrate() { this.db.transaction(() => this.migrateUnsafe())(); }
  private migrateUnsafe() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, total_seconds INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, application TEXT NOT NULL, title TEXT, started_at TEXT NOT NULL, ended_at TEXT, duration_seconds INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'foreground');
      CREATE TABLE IF NOT EXISTS browser_context (id TEXT PRIMARY KEY, domain TEXT NOT NULL, sanitized_url TEXT, title TEXT, category TEXT, topic TEXT, timestamp TEXT NOT NULL, duration_seconds INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'browser');
      CREATE TABLE IF NOT EXISTS selected_folders (id TEXT PRIMARY KEY, label TEXT NOT NULL, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_scan_at TEXT, file_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS folder_context (id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, relative_path TEXT NOT NULL, name TEXT NOT NULL, extension TEXT, size INTEGER NOT NULL DEFAULT 0, modified_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'folder', UNIQUE(folder_id,relative_path));
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, activity_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS websites (id TEXT PRIMARY KEY, domain TEXT, url TEXT, first_seen TEXT, last_seen TEXT);
      CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, category TEXT, first_seen TEXT, last_seen TEXT, evidence_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, parent_id TEXT);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, confidence REAL NOT NULL DEFAULT 0, first_seen TEXT, last_seen TEXT, total_seconds INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS preferences (id TEXT PRIMARY KEY, name TEXT UNIQUE, category TEXT, strength REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, evidence_count REAL NOT NULL DEFAULT 0, total_seconds REAL NOT NULL DEFAULT 0, first_seen TEXT, last_seen TEXT, updated_at TEXT, score REAL, first_observed TEXT, last_observed TEXT);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, type TEXT, name TEXT UNIQUE, category TEXT, strength REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, first_seen TEXT, last_seen TEXT, evidence_count REAL NOT NULL DEFAULT 0, total_seconds REAL NOT NULL DEFAULT 0, source TEXT, metadata_json TEXT, kind TEXT, content TEXT, embedding BLOB, created_at TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS memory_embeddings (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector TEXT NOT NULL, text_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recommendations (id TEXT PRIMARY KEY, title TEXT, description TEXT, category TEXT, reason TEXT, confidence REAL, score REAL, source_context TEXT, status TEXT, components TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS recommendation_feedback (id TEXT PRIMARY KEY, recommendation_id TEXT, feedback TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS permissions (tool TEXT PRIMARY KEY, level INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS excluded_items (kind TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(kind, value));
      CREATE TABLE IF NOT EXISTS agent_actions (id TEXT PRIMARY KEY, tool TEXT, action TEXT, status TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS pending_agent_actions (id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, source_context TEXT, reason TEXT, approved_at TEXT, completed_at TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, event TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
    `);
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    this.addColumnIfMissing('topics', 'category', 'TEXT');
    this.addColumnIfMissing('topics', 'first_seen', 'TEXT');
    this.addColumnIfMissing('topics', 'last_seen', 'TEXT');
    this.addColumnIfMissing('topics', 'evidence_count', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('categories', 'parent_id', 'TEXT');
    this.addColumnIfMissing('projects', 'confidence', 'REAL NOT NULL DEFAULT 0');
    this.addColumnIfMissing('projects', 'first_seen', 'TEXT');
    this.addColumnIfMissing('projects', 'last_seen', 'TEXT');
    this.addColumnIfMissing('projects', 'total_seconds', 'INTEGER NOT NULL DEFAULT 0');
    this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(1, new Date().toISOString());
    const version = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (version < 2) {
      this.addColumnIfMissing('memories', 'type', 'TEXT');
      this.addColumnIfMissing('memories', 'name', 'TEXT');
      this.addColumnIfMissing('memories', 'category', 'TEXT');
      this.addColumnIfMissing('memories', 'strength', 'REAL NOT NULL DEFAULT 0');
      this.addColumnIfMissing('memories', 'confidence', 'REAL NOT NULL DEFAULT 0');
      this.addColumnIfMissing('memories', 'first_seen', 'TEXT');
      this.addColumnIfMissing('memories', 'last_seen', 'TEXT');
      this.addColumnIfMissing('memories', 'evidence_count', 'REAL NOT NULL DEFAULT 0');
      this.addColumnIfMissing('memories', 'total_seconds', 'REAL NOT NULL DEFAULT 0');
      this.addColumnIfMissing('memories', 'source', 'TEXT');
      this.addColumnIfMissing('memories', 'metadata_json', 'TEXT');
      this.addColumnIfMissing('preferences', 'strength', 'REAL NOT NULL DEFAULT 0');
      this.addColumnIfMissing('preferences', 'total_seconds', 'REAL NOT NULL DEFAULT 0');
      this.addColumnIfMissing('preferences', 'first_seen', 'TEXT');
      this.addColumnIfMissing('preferences', 'last_seen', 'TEXT');
      this.addColumnIfMissing('preferences', 'updated_at', 'TEXT');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(2, new Date().toISOString());
    }
    const versionAfterMemory = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterMemory < 3) {
      this.addColumnIfMissing('recommendations', 'type', 'TEXT');
      this.addColumnIfMissing('recommendations', 'description', 'TEXT');
      this.addColumnIfMissing('recommendations', 'category', 'TEXT');
      this.addColumnIfMissing('recommendations', 'confidence', 'REAL NOT NULL DEFAULT 0');
      this.addColumnIfMissing('recommendations', 'source_context', 'TEXT');
      this.addColumnIfMissing('recommendations', 'status', 'TEXT');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(3, new Date().toISOString());
    }
    const versionAfterRecommendations = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterRecommendations < 4) {
      this.db.exec('CREATE TABLE IF NOT EXISTS pending_agent_actions (id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)');
      this.addColumnIfMissing('pending_agent_actions', 'tool_name', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'request', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'status', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'created_at', 'TEXT');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(4, new Date().toISOString());
    }
    const versionAfterAgent = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterAgent < 5) this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(5, new Date().toISOString());
    const versionAfterPhase6 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase6 < 6) {
      this.addColumnIfMissing('pending_agent_actions', 'expires_at', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'source_context', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'reason', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'approved_at', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'completed_at', 'TEXT');
      this.addColumnIfMissing('pending_agent_actions', 'error', 'TEXT');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(6, new Date().toISOString());
    }
    const versionAfterPhase7 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase7 < 7) {
      this.addColumnIfMissing('recommendations', 'topic', 'TEXT');
      this.addColumnIfMissing('recommendations', 'project', 'TEXT');
      this.addColumnIfMissing('recommendation_feedback', 'subject_type', "TEXT NOT NULL DEFAULT 'recommendation'");
      this.addColumnIfMissing('recommendation_feedback', 'subject_id', 'TEXT');
      this.addColumnIfMissing('recommendation_feedback', 'recommendation_type', 'TEXT');
      this.addColumnIfMissing('recommendation_feedback', 'category', 'TEXT');
      this.addColumnIfMissing('recommendation_feedback', 'topic', 'TEXT');
      this.addColumnIfMissing('recommendation_feedback', 'project', 'TEXT');
      this.addColumnIfMissing('recommendation_feedback', 'tool_name', 'TEXT');
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_subject ON recommendation_feedback(subject_type, subject_id)");
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(7, new Date().toISOString());
    }
    const versionAfterPhase8 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase8 < 8) {
      this.db.exec('CREATE TABLE IF NOT EXISTS memory_embeddings (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector TEXT NOT NULL, text_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(8, new Date().toISOString());
    }
    const versionAfterPhase9 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase9 < 9) this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(9, new Date().toISOString());
    const versionAfterPhase10 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase10 < 10) {
      this.addColumnIfMissing('preferences', 'source_type', 'TEXT');
      this.addColumnIfMissing('preferences', 'trend', 'TEXT');
      this.addColumnIfMissing('preferences', 'distinct_days', 'INTEGER NOT NULL DEFAULT 0');
      this.addColumnIfMissing('preferences', 'evidence_summary', 'TEXT');
      this.addColumnIfMissing('preferences', 'time_pattern', 'TEXT');
      this.addColumnIfMissing('preferences', 'feedback_evidence', 'INTEGER NOT NULL DEFAULT 0');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(10, new Date().toISOString());
    }
    const versionAfterPhase11 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase11 < 11) {
      this.db.exec('CREATE TABLE IF NOT EXISTS browser_context (id TEXT PRIMARY KEY, domain TEXT NOT NULL, sanitized_url TEXT, title TEXT, category TEXT, topic TEXT, timestamp TEXT NOT NULL, duration_seconds INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT \'browser\'); CREATE TABLE IF NOT EXISTS selected_folders (id TEXT PRIMARY KEY, label TEXT NOT NULL, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_scan_at TEXT, file_count INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS folder_context (id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, relative_path TEXT NOT NULL, name TEXT NOT NULL, extension TEXT, size INTEGER NOT NULL DEFAULT 0, modified_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT \'folder\', UNIQUE(folder_id,relative_path))');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(11, new Date().toISOString());
    }
    const versionAfterPhase14 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase14 < 12) {
      this.addColumnIfMissing('preferences', 'projects_json', 'TEXT');
      this.addColumnIfMissing('preferences', 'technologies_json', 'TEXT');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(12, new Date().toISOString());
    }
    const versionAfterPhase17 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase17 < 13) {
      this.addColumnIfMissing('preferences', 'source_types_json', 'TEXT');
      this.addColumnIfMissing('preferences', 'project_continuity', 'REAL NOT NULL DEFAULT 0');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(13, new Date().toISOString());
    }
    const versionAfterPhase18 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase18 < 14) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_activities_started_at ON activities(started_at); CREATE INDEX IF NOT EXISTS idx_browser_context_timestamp ON browser_context(timestamp); CREATE INDEX IF NOT EXISTS idx_folder_context_modified_at ON folder_context(modified_at); CREATE INDEX IF NOT EXISTS idx_memories_name ON memories(name); CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category); CREATE INDEX IF NOT EXISTS idx_memories_last_seen ON memories(last_seen); CREATE INDEX IF NOT EXISTS idx_recommendations_status_created ON recommendations(status, created_at); CREATE INDEX IF NOT EXISTS idx_feedback_created ON recommendation_feedback(created_at); CREATE INDEX IF NOT EXISTS idx_embeddings_provider_model ON memory_embeddings(provider, model, dimensions);');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(14, new Date().toISOString());
    }
    const versionAfterPhase19 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase19 < 15) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, target_date TEXT, priority INTEGER NOT NULL DEFAULT 3, progress REAL NOT NULL DEFAULT 0, progress_source TEXT NOT NULL DEFAULT 'derived', associations TEXT NOT NULL DEFAULT '{}'); CREATE TABLE IF NOT EXISTS goal_associations (goal_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(goal_id,kind,value)); CREATE TABLE IF NOT EXISTS agent_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, source_context TEXT NOT NULL, goal_id TEXT, recommendation_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_plan_steps (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, step_order INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, tool TEXT NOT NULL, arguments TEXT NOT NULL, permission_level INTEGER NOT NULL, requires_confirmation INTEGER NOT NULL, status TEXT NOT NULL, result_summary TEXT, created_at TEXT NOT NULL, completed_at TEXT, idempotency_key TEXT NOT NULL UNIQUE); CREATE INDEX IF NOT EXISTS idx_goals_status_updated ON goals(status,updated_at); CREATE INDEX IF NOT EXISTS idx_goal_assoc_value ON goal_associations(kind,value); CREATE INDEX IF NOT EXISTS idx_plans_status_expiry ON agent_plans(status,expires_at); CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_order ON agent_plan_steps(plan_id,step_order);`);
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(15, new Date().toISOString());
    }
    const versionAfterPhase20 = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterPhase20 < 16) {
      this.addColumnIfMissing('agent_plan_steps', 'dependencies', "TEXT NOT NULL DEFAULT '[]'");
      this.db.exec('CREATE TABLE IF NOT EXISTS goal_milestones (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_milestones_goal_status ON goal_milestones(goal_id,status);');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(16, new Date().toISOString());
    }
    const versionAfterReliability = (this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }).version ?? 0;
    if (versionAfterReliability < 17) {
      this.addColumnIfMissing('agent_plan_steps', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0');
      this.addColumnIfMissing('agent_plan_steps', 'max_attempts', 'INTEGER NOT NULL DEFAULT 1');
      this.addColumnIfMissing('agent_plan_steps', 'last_attempt_at', 'TEXT');
      this.addColumnIfMissing('agent_plan_steps', 'next_retry_at', 'TEXT');
      this.addColumnIfMissing('agent_plan_steps', 'failure_code', 'TEXT');
      this.addColumnIfMissing('agent_plan_steps', 'retryable', 'INTEGER NOT NULL DEFAULT 0');
      this.db.prepare('INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES(?, ?)').run(17, new Date().toISOString());
    }
    const defaults = [['retention','30 days'],  ['titleCollection','true'], ['memoryLearning','true'], ['memoryRetention','90 days'], ['aiEnabled','false'], ['aiProvider','external'], ['semanticMemoryEnabled','true'], ['embeddingProvider','local-deterministic'], ['localNeuralModel',''], ['browserContextEnabled','false'], ['browserAllowedDomains','[]'], ['browserBlockedDomains','[]'], ['folderTrackingEnabled','false'], ['recommendationsEnabled','true'], ['recommendationFrequency','normal'], ['maxRecommendationsPerDay','10'], ['goalProgressEnabled','true']];
    const stmt = this.db.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)');
    const now = new Date().toISOString();
    for (const [key, value] of defaults) stmt.run(key, value, now);
  }
  private addColumnIfMissing(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  setting(key: string, fallback = ''): string { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value?: string} | undefined)?.value ?? fallback; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, value, new Date().toISOString()); this.audit('setting_changed', `${key}=${value}`); }
  browserPairingTokenHash() { return this.setting('browserPairingTokenHash', ''); }
  saveBrowserPairingTokenHash(hash: string) { this.db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run('browserPairingTokenHash', hash, new Date().toISOString()); this.audit('browser_extension_paired'); }
  clearBrowserPairingTokenHash() { this.db.prepare("DELETE FROM settings WHERE key='browserPairingTokenHash'").run(); this.audit('browser_extension_revoked'); }
  excludedApps(): string[] { return (this.db.prepare("SELECT value FROM excluded_items WHERE kind='application' ORDER BY value").all() as {value:string}[]).map(x => x.value); }
  addExclusion(value: string) { this.db.prepare("INSERT OR IGNORE INTO excluded_items(kind,value,created_at) VALUES('application',?,?)").run(value, new Date().toISOString()); this.audit('application_excluded', value); }
  removeExclusion(value: string) { this.db.prepare("DELETE FROM excluded_items WHERE kind='application' AND value=?").run(value); this.audit('application_exclusion_removed', value); }
  audit(event: string, detail = '') { this.db.prepare('INSERT INTO audit_log(id,event,detail,created_at) VALUES(?,?,?,?)').run(randomUUID(), event, detail, new Date().toISOString()); }
  startSession(id: string, startedAt: string) { this.db.prepare('INSERT INTO sessions(id,started_at,activity_count) VALUES(?,?,0)').run(id, startedAt); }
  endSession(id: string, endedAt: string) { this.db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(endedAt, id); }
  saveActivity(a: ActivitySummary) {
    this.db.prepare('INSERT INTO activities(id,application,title,started_at,ended_at,duration_seconds) VALUES(?,?,?,?,?,?)').run(a.id,a.application,a.title,a.startedAt,a.endedAt,a.durationSeconds);
    if (a.sessionId) this.db.prepare('UPDATE sessions SET activity_count=activity_count+1 WHERE id=?').run(a.sessionId);
    this.db.prepare(`INSERT INTO applications(id,name,first_seen,last_seen,total_seconds) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET last_seen=excluded.last_seen,total_seconds=applications.total_seconds+excluded.total_seconds`).run(randomUUID(), a.application, a.startedAt, a.endedAt ?? a.startedAt, a.durationSeconds);
  }
  timelineActivities(limit = 100): ActivitySummary[] { return [...this.recent(limit), ...this.browserActivities(limit), ...this.folderActivities(limit)].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, Math.max(1, Math.min(500, limit))); }
  recent(limit=12): ActivitySummary[] { return this.db.prepare('SELECT id,application,title,started_at as startedAt,ended_at as endedAt,duration_seconds as durationSeconds FROM activities ORDER BY started_at DESC LIMIT ?').all(limit) as ActivitySummary[]; }
  recordContext(context: CurrentContext) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO categories(id,name,parent_id) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET parent_id=excluded.parent_id').run(`category:${context.category.toLowerCase()}`, context.category, context.parentCategory ? `category:${context.parentCategory.toLowerCase()}` : null);
    for (const topic of context.recentTopics) this.db.prepare(`INSERT INTO topics(id,name,category,first_seen,last_seen,evidence_count) VALUES(?,?,?,?,?,1) ON CONFLICT(name) DO UPDATE SET category=excluded.category,last_seen=excluded.last_seen,evidence_count=topics.evidence_count+1`).run(randomUUID(), topic, context.category, now, now);
    if (context.project) this.recordProject({ id: `project:${context.project.toLowerCase()}`, name: context.project, confidence: context.confidence, firstSeen: now, lastSeen: now, totalSeconds: 0 });
  }
  recordProject(project: DetectedProject) { this.db.prepare(`INSERT INTO projects(id,name,confidence,first_seen,last_seen,total_seconds) VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET confidence=excluded.confidence,last_seen=excluded.last_seen,total_seconds=projects.total_seconds+excluded.total_seconds`).run(project.id, project.name, project.confidence, project.firstSeen, project.lastSeen, project.totalSeconds); }
  memories(): MemoryRecord[] { return this.db.prepare('SELECT id,type,name,category,strength,confidence,first_seen as firstSeen,last_seen as lastSeen,evidence_count as evidenceCount,total_seconds as totalSeconds,source,metadata_json as metadataJson FROM memories WHERE name IS NOT NULL ORDER BY strength DESC').all() as MemoryRecord[]; }
  searchMemories(filters: { query?: string; category?: string; project?: string; technology?: string; source?: string; minStrength?: number; minConfidence?: number; recentDays?: number; limit?: number }): MemoryRecord[] { const query = (filters.query ?? '').trim().toLowerCase(); const category = (filters.category ?? '').trim().toLowerCase(); const project = (filters.project ?? '').trim().toLowerCase(); const technology = (filters.technology ?? '').trim().toLowerCase(); const source = (filters.source ?? '').trim().toLowerCase(); const cutoff = filters.recentDays ? Date.now() - Math.min(3650, Math.max(1, filters.recentDays)) * 86400000 : 0; return this.memories().filter(memory => { const metadata = safeParseJson(memory.metadataJson) as Record<string, unknown> | undefined; const text = `${memory.name} ${memory.category} ${memory.source} ${JSON.stringify(metadata ?? {})}`.toLowerCase(); const projects = Array.isArray(metadata?.projects) ? metadata.projects.join(' ').toLowerCase() : ''; const technologies = Array.isArray(metadata?.technologies) ? metadata.technologies.join(' ').toLowerCase() : ''; return (!query || text.includes(query)) && (!category || memory.category.toLowerCase().includes(category)) && (!project || projects.includes(project)) && (!technology || technologies.includes(technology)) && (!source || String(metadata?.sourceTypes ?? memory.source).toLowerCase().includes(source)) && (filters.minStrength === undefined || memory.strength >= filters.minStrength) && (filters.minConfidence === undefined || memory.confidence >= filters.minConfidence) && (!cutoff || Date.parse(memory.lastSeen) >= cutoff); }).slice(0, Math.max(1, Math.min(100, filters.limit ?? 50))); }
  memoryById(id: string): MemoryRecord | null { return this.db.prepare('SELECT id,type,name,category,strength,confidence,first_seen as firstSeen,last_seen as lastSeen,evidence_count as evidenceCount,total_seconds as totalSeconds,source,metadata_json as metadataJson FROM memories WHERE id=? AND name IS NOT NULL').get(id) as MemoryRecord | undefined ?? null; }
  preferenceById(id: string): PreferenceRecord | null { const row = this.db.prepare('SELECT id,name,category,strength,confidence,first_seen as firstSeen,last_seen as lastSeen,evidence_count as evidenceCount,total_seconds as totalSeconds,updated_at as updatedAt,source_type as sourceType,distinct_days as distinctDays,trend,evidence_summary as evidenceSummary,time_pattern as timePattern,feedback_evidence as feedbackEvidence,projects_json as projectsJson,technologies_json as technologiesJson,source_types_json as sourceTypesJson,project_continuity as projectContinuity FROM preferences WHERE id=? AND name IS NOT NULL').get(id) as any; return row ? { ...row, timePattern: safeParseJson(row.timePattern), projects: Array.isArray(safeParseJson(row.projectsJson)) ? safeParseJson(row.projectsJson) : [], technologies: Array.isArray(safeParseJson(row.technologiesJson)) ? safeParseJson(row.technologiesJson) : [], sourceTypes: Array.isArray(safeParseJson(row.sourceTypesJson)) ? safeParseJson(row.sourceTypesJson) : [] } as PreferenceRecord : null; }
  privacySummary() { const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count; return { activities: count('activities'), browserContext: count('browser_context'), folderMetadata: count('folder_context'), selectedFolders: count('selected_folders'), memories: count('memories'), preferences: count('preferences'), semanticEmbeddings: count('memory_embeddings'), recommendations: count('recommendations'), feedback: count('recommendation_feedback'), auditEvents: count('audit_log') }; }
  upsertMemory(memory: MemoryRecord) {
    const existing = this.db.prepare('SELECT id FROM memories WHERE lower(name)=lower(?) LIMIT 1').get(memory.name) as { id: string } | undefined;
    if (existing) this.db.prepare('UPDATE memories SET type=?,category=?,strength=?,confidence=?,first_seen=?,last_seen=?,evidence_count=?,total_seconds=?,source=?,metadata_json=?,updated_at=? WHERE id=?').run(memory.type,memory.category,memory.strength,memory.confidence,memory.firstSeen,memory.lastSeen,memory.evidenceCount,memory.totalSeconds,memory.source,memory.metadataJson,memory.lastSeen,existing.id);
    else this.db.prepare('INSERT INTO memories(id,type,name,category,strength,confidence,first_seen,last_seen,evidence_count,total_seconds,source,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(memory.id,memory.type,memory.name,memory.category,memory.strength,memory.confidence,memory.firstSeen,memory.lastSeen,memory.evidenceCount,memory.totalSeconds,memory.source,memory.metadataJson,memory.firstSeen,memory.lastSeen);
  }
  getEmbedding(memoryId: string): MemoryEmbedding | null { const row = this.db.prepare('SELECT id,memory_id as memoryId,provider,model,dimensions,vector,text_hash as textHash,created_at as createdAt,updated_at as updatedAt FROM memory_embeddings WHERE memory_id=?').get(memoryId) as (Omit<MemoryEmbedding,'vector'> & { vector: string }) | undefined; return row ? { ...row, vector: parseVector(row.vector) } : null; }
  saveEmbedding(embedding: MemoryEmbedding) { this.db.prepare('INSERT OR REPLACE INTO memory_embeddings(id,memory_id,provider,model,dimensions,vector,text_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(embedding.id,embedding.memoryId,embedding.provider,embedding.model,embedding.dimensions,JSON.stringify(embedding.vector),embedding.textHash,embedding.createdAt,embedding.updatedAt); }
  getEmbeddings(): MemoryEmbedding[] { const rows = this.db.prepare('SELECT id,memory_id as memoryId,provider,model,dimensions,vector,text_hash as textHash,created_at as createdAt,updated_at as updatedAt FROM memory_embeddings').all() as Array<Omit<MemoryEmbedding,'vector'> & { vector: string }>; return rows.map(row => ({ ...row, vector: parseVector(row.vector) })); }
  deleteEmbedding(memoryId: string) { this.db.prepare('DELETE FROM memory_embeddings WHERE memory_id=?').run(memoryId); }
  clearEmbeddings() { this.db.prepare('DELETE FROM memory_embeddings').run(); }
  deleteMemory(id: string) { const memory = this.db.prepare('SELECT name FROM memories WHERE id=?').get(id) as { name?: string } | undefined; this.db.prepare('DELETE FROM memories WHERE id=?').run(id); this.deleteEmbedding(id); if (memory?.name) this.db.prepare('DELETE FROM preferences WHERE lower(name)=lower(?)').run(memory.name); this.audit('memory_forgotten', id); }
  clearMemories() { this.db.prepare('DELETE FROM memories').run(); this.clearEmbeddings(); }
  preferences(): PreferenceRecord[] { return this.db.prepare('SELECT id,name,category,strength,confidence,first_seen as firstSeen,last_seen as lastSeen,evidence_count as evidenceCount,total_seconds as totalSeconds,updated_at as updatedAt,source_type as sourceType,distinct_days as distinctDays,trend,evidence_summary as evidenceSummary,time_pattern as timePattern,feedback_evidence as feedbackEvidence,projects_json as projectsJson,technologies_json as technologiesJson,source_types_json as sourceTypesJson,project_continuity as projectContinuity FROM preferences WHERE name IS NOT NULL ORDER BY strength DESC').all().map((row: any) => ({ ...row, timePattern: safeParseJson(row.timePattern), projects: Array.isArray(safeParseJson(row.projectsJson)) ? safeParseJson(row.projectsJson) : [], technologies: Array.isArray(safeParseJson(row.technologiesJson)) ? safeParseJson(row.technologiesJson) : [], sourceTypes: Array.isArray(safeParseJson(row.sourceTypesJson)) ? safeParseJson(row.sourceTypesJson) : [] } as PreferenceRecord)); }
  upsertPreference(preference: PreferenceRecord) {
    const existing = this.db.prepare('SELECT id FROM preferences WHERE lower(name)=lower(?) LIMIT 1').get(preference.name) as { id: string } | undefined;
    const projects = JSON.stringify(preference.projects ?? []); const technologies = JSON.stringify(preference.technologies ?? []); const sourceTypes = JSON.stringify(preference.sourceTypes ?? []); const projectContinuity = preference.projectContinuity ?? 0;
    if (existing) this.db.prepare('UPDATE preferences SET category=?,strength=?,confidence=?,first_seen=?,last_seen=?,evidence_count=?,total_seconds=?,updated_at=?,source_type=?,distinct_days=?,trend=?,evidence_summary=?,time_pattern=?,feedback_evidence=?,projects_json=?,technologies_json=?,source_types_json=?,project_continuity=? WHERE id=?').run(preference.category,preference.strength,preference.confidence,preference.firstSeen,preference.lastSeen,preference.evidenceCount,preference.totalSeconds,preference.updatedAt,preference.sourceType ?? null,preference.distinctDays ?? 0,preference.trend ?? null,preference.evidenceSummary ?? null,preference.timePattern ? JSON.stringify(preference.timePattern) : null,preference.feedbackEvidence ?? 0,projects,technologies,sourceTypes,projectContinuity,existing.id);
    else this.db.prepare('INSERT INTO preferences(id,name,category,strength,confidence,first_seen,last_seen,evidence_count,total_seconds,updated_at,source_type,distinct_days,trend,evidence_summary,time_pattern,feedback_evidence,projects_json,technologies_json,source_types_json,project_continuity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(preference.id,preference.name,preference.category,preference.strength,preference.confidence,preference.firstSeen,preference.lastSeen,preference.evidenceCount,preference.totalSeconds,preference.updatedAt,preference.sourceType ?? null,preference.distinctDays ?? 0,preference.trend ?? null,preference.evidenceSummary ?? null,preference.timePattern ? JSON.stringify(preference.timePattern) : null,preference.feedbackEvidence ?? 0,projects,technologies,sourceTypes,projectContinuity);
  }
  forgetPreference(id: string) { this.db.prepare('DELETE FROM preferences WHERE id=?').run(id); this.audit('preference_forgotten', id); }
  clearPreferences() { this.db.prepare('DELETE FROM preferences').run(); this.audit('preferences_cleared'); }
  saveBrowserContext(record: BrowserContextRecord) { this.db.prepare('INSERT OR REPLACE INTO browser_context(id,domain,sanitized_url,title,category,topic,timestamp,duration_seconds,source) VALUES(?,?,?,?,?,?,?,?,?)').run(record.id,record.domain,record.sanitizedUrl ?? null,record.title ?? null,record.category ?? null,record.topic ?? null,record.timestamp,record.durationSeconds,record.source); }
  recentBrowserContext(limit = 20): BrowserContextRecord[] { return this.db.prepare('SELECT id,domain,sanitized_url as sanitizedUrl,title,category,topic,timestamp,duration_seconds as durationSeconds,source FROM browser_context ORDER BY timestamp DESC LIMIT ?').all(limit) as BrowserContextRecord[]; }
  browserActivities(limit = 100): ActivitySummary[] { return this.db.prepare('SELECT id, \'Browser: \' || domain as application, COALESCE(topic,category) as title, timestamp as startedAt, timestamp as endedAt, duration_seconds as durationSeconds, \'browser\' as source FROM browser_context ORDER BY timestamp DESC LIMIT ?').all(limit) as ActivitySummary[]; }
  clearBrowserContext() { this.db.prepare('DELETE FROM browser_context').run(); }
  deleteOldBrowserContext(days = 30) { const cutoff = new Date(Date.now() - days * 86400000).toISOString(); this.db.prepare('DELETE FROM browser_context WHERE timestamp < ?').run(cutoff); }
  addSelectedFolder(folder: SelectedFolder) { this.db.prepare('INSERT OR REPLACE INTO selected_folders(id,label,path,enabled,created_at,last_scan_at,file_count) VALUES(?,?,?,?,?,?,?)').run(folder.id,folder.label,folder.path,folder.enabled ? 1 : 0,new Date().toISOString(),folder.lastScanAt ?? null,folder.fileCount ?? 0); }
  selectedFolders(): SelectedFolder[] { return this.db.prepare('SELECT id,label,path,enabled,last_scan_at as lastScanAt,file_count as fileCount FROM selected_folders ORDER BY label').all().map((row: any) => ({ ...row, enabled: Boolean(row.enabled) })) as SelectedFolder[]; }
  selectedFolderSummaries() { return this.selectedFolders().map(folder => ({ id: folder.id, label: folder.label, enabled: folder.enabled, lastScanAt: folder.lastScanAt, fileCount: folder.fileCount ?? 0 })); }
  removeSelectedFolder(id: string) { this.db.prepare('DELETE FROM folder_context WHERE folder_id=?').run(id); this.db.prepare('DELETE FROM selected_folders WHERE id=?').run(id); }
  setSelectedFolderEnabled(id: string, enabled: boolean) { this.db.prepare('UPDATE selected_folders SET enabled=? WHERE id=?').run(enabled ? 1 : 0,id); }
  saveFolderEntries(folderId: string, entries: FolderFileEntry[], scannedAt: string) { const insert = this.db.prepare('INSERT OR REPLACE INTO folder_context(id,folder_id,relative_path,name,extension,size,modified_at,source) VALUES(?,?,?,?,?,?,?,?)'); const transaction = this.db.transaction((items: FolderFileEntry[]) => { const seen = new Set(items.map(item => item.relativePath)); for (const item of items) insert.run(`folder:${folderId}:${item.relativePath}`,folderId,item.relativePath,item.name,item.extension,item.size,item.modifiedAt,'folder'); const old = this.db.prepare('SELECT relative_path as relativePath FROM folder_context WHERE folder_id=?').all(folderId) as Array<{relativePath:string}>; for (const item of old) if (!seen.has(item.relativePath)) this.db.prepare('DELETE FROM folder_context WHERE folder_id=? AND relative_path=?').run(folderId,item.relativePath); }); transaction(entries); this.db.prepare('UPDATE selected_folders SET last_scan_at=?,file_count=? WHERE id=?').run(scannedAt,entries.length,folderId); }
  folderActivities(limit = 100): ActivitySummary[] { return this.db.prepare('SELECT f.id, \'Folder: \' || s.label as application, f.extension as title, f.modified_at as startedAt, f.modified_at as endedAt, 0 as durationSeconds, \'folder\' as source FROM folder_context f JOIN selected_folders s ON s.id=f.folder_id WHERE s.enabled=1 ORDER BY f.modified_at DESC LIMIT ?').all(limit) as ActivitySummary[]; }
  clearFolderContext() { this.db.prepare('DELETE FROM folder_context').run(); this.db.prepare('UPDATE selected_folders SET last_scan_at=NULL,file_count=0').run(); }
  folderFileCount() { return (this.db.prepare('SELECT COUNT(*) as count FROM folder_context').get() as {count:number}).count; }
  saveRecommendation(recommendation: Recommendation) { this.db.prepare('INSERT OR REPLACE INTO recommendations(id,type,title,description,category,reason,confidence,score,source_context,status,components,created_at,topic,project) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(recommendation.id,recommendation.type,recommendation.title,recommendation.description,recommendation.category,recommendation.reason,recommendation.confidence,recommendation.score,recommendation.sourceContext,recommendation.status ?? 'active',recommendation.signals ? JSON.stringify(recommendation.signals) : null,recommendation.createdAt,recommendation.topic ?? null,recommendation.project ?? null); }
  getRecentRecommendations(limit = 10): Recommendation[] { return this.db.prepare('SELECT id,type,title,description,category,reason,confidence,score,created_at as createdAt,source_context as sourceContext,status,topic,project,components FROM recommendations WHERE status IS NULL OR status != \'deleted\' ORDER BY created_at DESC LIMIT ?').all(limit).map((row: any) => ({ ...row, signals: Array.isArray(safeParseJson(row.components)) ? safeParseJson(row.components) : undefined })) as Recommendation[]; }
  recommendationById(id: string): Recommendation | null { return this.getRecentRecommendations(100).find(item => item.id === id) ?? null; }
  deleteRecommendation(id: string) { this.db.prepare("UPDATE recommendations SET status='deleted' WHERE id=?").run(id); this.db.prepare("DELETE FROM recommendation_feedback WHERE subject_type='recommendation' AND subject_id=?").run(id); }
  clearRecommendations() { this.db.prepare("UPDATE recommendations SET status='deleted'").run(); this.db.prepare("DELETE FROM recommendation_feedback WHERE subject_type='recommendation'").run(); }
  feedbackRecords(): FeedbackRecord[] { return this.db.prepare("SELECT id,subject_type as subjectType,subject_id as subjectId,feedback,created_at as createdAt,recommendation_type as recommendationType,category,topic,project,tool_name as toolName FROM recommendation_feedback").all() as FeedbackRecord[]; }
  getFeedbackSummary(): FeedbackSummary { return aggregateFeedback(this.feedbackRecords()); }
  submitRecommendationFeedback(id: string, feedback: FeedbackValue) { const recommendation = this.db.prepare("SELECT id,type,category,topic,project FROM recommendations WHERE id=? AND (status IS NULL OR status != 'deleted')").get(id) as { id: string; type: string; category: string; topic?: string; project?: string } | undefined; if (!recommendation) throw new Error('Unknown recommendation'); this.db.prepare("INSERT INTO recommendation_feedback(id,recommendation_id,subject_type,subject_id,feedback,created_at,recommendation_type,category,topic,project,tool_name) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_type,subject_id) DO UPDATE SET feedback=excluded.feedback,created_at=excluded.created_at,recommendation_type=excluded.recommendation_type,category=excluded.category,topic=excluded.topic,project=excluded.project").run(randomUUID(),id,'recommendation',id,feedback,new Date().toISOString(),recommendation.type,recommendation.category,recommendation.topic ?? null,recommendation.project ?? null,null); this.audit('recommendation_feedback', `${id}:${feedback}`); return this.getFeedbackSummary(); }
  submitActionFeedback(id: string, feedback: FeedbackValue) { const action = this.db.prepare("SELECT id,tool_name as toolName,status FROM pending_agent_actions WHERE id=?").get(id) as { id: string; toolName: string; status: string } | undefined; if (!action) throw new Error('Unknown action'); if (!actionFeedbackAllowed(action.status)) throw new Error('Only completed actions can receive feedback'); this.db.prepare("INSERT INTO recommendation_feedback(id,subject_type,subject_id,feedback,created_at,tool_name) VALUES(?,?,?,?,?,?) ON CONFLICT(subject_type,subject_id) DO UPDATE SET feedback=excluded.feedback,created_at=excluded.created_at,tool_name=excluded.tool_name").run(randomUUID(),'action',id,feedback,new Date().toISOString(),action.toolName); this.audit('action_feedback', `${id}:${feedback}`); return this.getFeedbackSummary(); }
  deleteOldRecommendations(days = 90) { const old = this.db.prepare("SELECT id FROM recommendations WHERE created_at < datetime('now', ?)").all(`-${days} days`) as Array<{id:string}>; const remove = this.db.transaction((rows: Array<{id:string}>) => { for (const row of rows) { this.db.prepare("DELETE FROM recommendation_feedback WHERE subject_type='recommendation' AND subject_id=?").run(row.id); this.db.prepare('DELETE FROM recommendations WHERE id=?').run(row.id); } }); remove(old); }
  savePendingAgentAction(action: PendingAgentAction) { this.db.prepare('INSERT OR REPLACE INTO pending_agent_actions(id,tool_name,request,status,created_at,expires_at,source_context,reason,approved_at,completed_at,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(action.id,action.toolName,JSON.stringify(action.request),action.status,action.createdAt,action.expiresAt,action.sourceContext,action.reason,action.approvedAt ?? null,action.completedAt ?? null,action.error ?? null); }
  getPendingAgentActions(): PendingAgentAction[] { const now = new Date().toISOString(); const expired = this.db.prepare("SELECT id,tool_name as toolName FROM pending_agent_actions WHERE status IN ('pending','approved') AND expires_at IS NOT NULL AND expires_at <= ?").all(now) as Array<{id:string;toolName:string}>; for (const item of expired) { this.db.prepare("UPDATE pending_agent_actions SET status='expired',completed_at=? WHERE id=?").run(now,item.id); this.audit('action_expired', `${item.id}:${item.toolName}`); } const rows = this.db.prepare("SELECT id,tool_name as toolName,request,status,created_at as createdAt,expires_at as expiresAt,source_context as sourceContext,reason,approved_at as approvedAt,completed_at as completedAt,error FROM pending_agent_actions ORDER BY created_at DESC LIMIT 50").all() as Array<Omit<PendingAgentAction,'request'> & { request: string }>; return rows.map(row => ({ ...row, expiresAt: row.expiresAt ?? new Date(Date.parse(row.createdAt) + 300000).toISOString(), request: safeParseRequest(row.request, row.toolName, row.sourceContext ?? '', row.reason ?? '') })); }
  setAgentActionStatus(id: string, status: AgentActionStatus, error?: string) { this.db.prepare('UPDATE pending_agent_actions SET status=?,error=?,approved_at=CASE WHEN ?=\'approved\' THEN ? ELSE approved_at END,completed_at=CASE WHEN ? IN (\'completed\',\'failed\',\'rejected\',\'expired\') THEN ? ELSE completed_at END WHERE id=?').run(status,error ?? null,status,new Date().toISOString(),status,new Date().toISOString(),id); }
  clearAgentActions() { this.db.prepare("UPDATE pending_agent_actions SET status='expired',completed_at=? WHERE status IN ('pending','approved')").run(new Date().toISOString()); }
  cleanupMemory() { this.cleanupExpiredAgentActions(); const retention = this.setting('memoryRetention','90 days'); const days = retention === 'Forever' ? null : retention === '30 days' ? 30 : retention === '1 year' ? 365 : 90; if (days) { this.db.prepare("DELETE FROM memories WHERE last_seen < datetime('now', ?)").run(`-${days} days`); this.db.prepare("DELETE FROM preferences WHERE last_seen < datetime('now', ?)").run(`-${days} days`); } this.db.prepare('DELETE FROM memory_embeddings WHERE memory_id NOT IN (SELECT id FROM memories)').run(); }
  countApps(): number { return (this.db.prepare('SELECT COUNT(*) as n FROM applications').get() as {n:number}).n; }
  cleanupExpiredAgentActions() { const now = new Date().toISOString(); const rows = this.db.prepare("SELECT id,tool_name as toolName FROM pending_agent_actions WHERE status IN ('pending','approved') AND expires_at IS NOT NULL AND expires_at <= ?").all(now) as Array<{id:string;toolName:string}>; for (const row of rows) { this.db.prepare("UPDATE pending_agent_actions SET status='expired',completed_at=? WHERE id=?").run(now,row.id); this.audit('action_expired', `${row.id}:${row.toolName}`); } }
  cleanup() { const r = this.setting('retention','30 days'); const days = r === 'Forever' ? null : r === '7 days' ? 7 : r === '90 days' ? 90 : r === '1 year' ? 365 : 30; if (days) { this.db.prepare("DELETE FROM activities WHERE started_at < datetime('now', ?)").run(`-${days} days`); const cutoff = new Date(Date.now() - days * 86400000).toISOString(); this.db.prepare('DELETE FROM browser_context WHERE timestamp < ?').run(cutoff); this.db.prepare('DELETE FROM folder_context WHERE modified_at < ?').run(cutoff); } }
  deleteAll() { this.db.exec('DELETE FROM activities; DELETE FROM applications; DELETE FROM sessions; DELETE FROM browser_context; DELETE FROM folder_context; DELETE FROM selected_folders; DELETE FROM recommendation_feedback; DELETE FROM goal_milestones; DELETE FROM goals; DELETE FROM agent_plan_steps; DELETE FROM agent_plans; DELETE FROM audit_log;'); this.audit('all_data_deleted'); }
  private recoverInterruptedPlans() { const now=new Date().toISOString(); const plans=this.db.prepare("SELECT id FROM agent_plans WHERE status='running'").all() as Array<{id:string}>; for(const plan of plans){this.db.prepare("UPDATE agent_plans SET status='paused' WHERE id=?").run(plan.id);this.db.prepare("UPDATE agent_plan_steps SET status='needs_review',result_summary=?,completed_at=? WHERE plan_id=? AND status='running'").run('Interrupted; needs review',now,plan.id);this.audit('plan_interrupted',plan.id);} }
  saveGoal(goal: Goal) { this.db.prepare('INSERT OR REPLACE INTO goals(id,title,description,category,status,created_at,updated_at,target_date,priority,progress,progress_source,associations) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(goal.id,goal.title,goal.description,goal.category,goal.status,goal.createdAt,goal.updatedAt,goal.targetDate??null,goal.priority,goal.progress,goal.progressSource,JSON.stringify(goal.associations)); this.db.prepare('DELETE FROM goal_associations WHERE goal_id=?').run(goal.id); for(const [kind,values] of Object.entries(goal.associations)) for(const value of values) this.db.prepare('INSERT OR IGNORE INTO goal_associations(goal_id,kind,value) VALUES(?,?,?)').run(goal.id,kind,value); this.audit(`goal_${goal.status==='completed'?'completed':'updated'}`,goal.id); }
  goals(): Goal[] { const rows=this.db.prepare('SELECT id,title,description,category,status,created_at as createdAt,updated_at as updatedAt,target_date as targetDate,priority,progress,progress_source as progressSource,associations FROM goals ORDER BY updated_at DESC LIMIT 100').all() as any[]; return rows.map(row=>({...row,associations:safeParseJson(row.associations)||{projects:[],technologies:[],categories:[],concepts:[],preferences:[]}})); }
  goal(id:string): Goal|null { return this.goals().find(g=>g.id===id)??null; }
  deleteGoal(id:string) { this.db.prepare('DELETE FROM goal_associations WHERE goal_id=?').run(id); this.db.prepare('DELETE FROM goals WHERE id=?').run(id); this.audit('goal_deleted',id); }
  savePlan(plan:AgentPlan) { const tx=this.db.transaction((p:AgentPlan)=>{this.db.prepare('INSERT OR REPLACE INTO agent_plans(id,title,description,source_context,goal_id,recommendation_id,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run(p.id,p.title,p.description,p.sourceContext,p.goalId??null,p.recommendationId??null,p.status,p.createdAt,p.expiresAt); this.db.prepare('DELETE FROM agent_plan_steps WHERE plan_id=?').run(p.id); for(const s of p.steps)this.db.prepare('INSERT INTO agent_plan_steps(id,plan_id,step_order,title,description,tool,arguments,permission_level,requires_confirmation,status,result_summary,created_at,completed_at,idempotency_key,dependencies,attempt_count,max_attempts,last_attempt_at,next_retry_at,failure_code,retryable) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.id,p.id,s.order,s.title,s.description,s.tool,JSON.stringify(s.arguments),s.permissionLevel,s.requiresConfirmation?1:0,s.status,s.resultSummary??null,s.createdAt,s.completedAt??null,s.idempotencyKey,JSON.stringify(s.dependsOn??[]),s.attemptCount??0,s.maxAttempts??1,s.lastAttemptAt??null,s.nextRetryAt??null,s.failureCode??null,s.retryable?1:0);});tx(plan); this.audit(`plan_${plan.status}`,plan.id); }
  plans(): AgentPlan[] { const rows=this.db.prepare("SELECT id,title,description,source_context as sourceContext,goal_id as goalId,recommendation_id as recommendationId,status,created_at as createdAt,expires_at as expiresAt FROM agent_plans WHERE status NOT IN ('cancelled','expired') ORDER BY created_at DESC LIMIT 50").all() as any[]; return rows.map(p=>({...p,steps:this.db.prepare('SELECT id,step_order as \"order\",title,description,tool,arguments,permission_level as permissionLevel,requires_confirmation as requiresConfirmation,status,result_summary as resultSummary,created_at as createdAt,completed_at as completedAt,idempotency_key as idempotencyKey,dependencies,attempt_count as attemptCount,max_attempts as maxAttempts,last_attempt_at as lastAttemptAt,next_retry_at as nextRetryAt,failure_code as failureCode,retryable FROM agent_plan_steps WHERE plan_id=? ORDER BY step_order').all(p.id).map((s:any)=>({...s,arguments:safeParseJson(s.arguments)||{},requiresConfirmation:Boolean(s.requiresConfirmation),dependsOn:Array.isArray(safeParseJson(s.dependencies))?safeParseJson(s.dependencies):[],retryable:Boolean(s.retryable)}))})); }
  plan(id:string){return this.plans().find(p=>p.id===id)??null;}
  updatePlanStatus(id:string,status:string){this.db.prepare('UPDATE agent_plans SET status=? WHERE id=?').run(status,id); this.audit(`plan_${status}`,id);}
  milestones(goalId: string): import('../shared/contracts').GoalMilestone[] { return this.db.prepare('SELECT id,goal_id as goalId,title,description,status,created_at as createdAt,updated_at as updatedAt FROM goal_milestones WHERE goal_id=? ORDER BY created_at LIMIT 30').all(goalId) as import('../shared/contracts').GoalMilestone[]; }
  saveMilestone(m: import('../shared/contracts').GoalMilestone) { this.db.prepare('INSERT OR REPLACE INTO goal_milestones(id,goal_id,title,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(m.id,m.goalId,m.title,m.description,m.status,m.createdAt,m.updatedAt); this.audit(`milestone_${m.status}`,m.id); }
  milestone(id:string): import('../shared/contracts').GoalMilestone|null { return (this.db.prepare('SELECT id,goal_id as goalId,title,description,status,created_at as createdAt,updated_at as updatedAt FROM goal_milestones WHERE id=?').get(id) as import('../shared/contracts').GoalMilestone|undefined) ?? null; }
  deleteMilestone(id:string){this.db.prepare('DELETE FROM goal_milestones WHERE id=?').run(id);this.audit('milestone_deleted',id);}
  dataLifecycle(){const count=(table:string)=>(this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {count:number}).count;return [{category:'Activity',count:count('activities'),retention:this.setting('retention','30 days'),clearable:true},{category:'Browser Context',count:count('browser_context'),retention:this.setting('retention','30 days'),clearable:true},{category:'Folder Metadata',count:count('folder_context'),retention:this.setting('retention','30 days'),clearable:true},{category:'Memories',count:count('memories'),retention:this.setting('memoryRetention','90 days'),clearable:true},{category:'Embeddings',count:count('memory_embeddings'),retention:this.setting('memoryRetention','90 days'),clearable:true},{category:'Preferences',count:count('preferences'),retention:this.setting('memoryRetention','90 days'),clearable:true},{category:'Goals',count:count('goals'),retention:'manual',clearable:true},{category:'Recommendations',count:count('recommendations'),retention:'90 days',clearable:true},{category:'Workflows',count:count('agent_plans'),retention:'90 days',clearable:true},{category:'Audit',count:count('audit_log'),retention:'protected',clearable:false}];}
  exportSnapshot(){const payload={schemaVersion:17,exportedAt:new Date().toISOString(),settings:this.db.prepare("SELECT key,value FROM settings WHERE key NOT LIKE '%Path%' AND key NOT LIKE '%Token%'").all(),goals:this.goals().map(g=>({...g,milestones:this.milestones(g.id)})),memories:this.memories().slice(0,1000),preferences:this.preferences().slice(0,500),recommendations:this.getRecentRecommendations(100),feedback:this.feedbackRecords().slice(0,1000),plans:this.plans().slice(0,50)};return {...payload,checksum:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};}
  importPortableData(snapshot:any){const tx=this.db.transaction((data:any)=>{for(const goal of data.goals??[]) {this.saveGoal(goal);for(const milestone of goal.milestones??[])this.saveMilestone(milestone);}for(const memory of data.memories??[])this.upsertMemory(memory);for(const preference of data.preferences??[])this.upsertPreference(preference);for(const recommendation of data.recommendations??[])this.saveRecommendation(recommendation);for(const feedback of data.feedback??[]){if(typeof feedback.subjectId==='string'&&typeof feedback.feedback==='string')this.db.prepare('INSERT OR IGNORE INTO recommendation_feedback(id,subject_type,subject_id,feedback,created_at,recommendation_type,category,topic,project,tool_name) VALUES(?,?,?,?,?,?,?,?,?,?)').run(feedback.id||randomUUID(),feedback.subjectType||'recommendation',feedback.subjectId,feedback.feedback,feedback.createdAt||new Date().toISOString(),feedback.recommendationType||null,feedback.category||null,feedback.topic||null,feedback.project||null,feedback.toolName||null);}for(const plan of data.plans??[])this.savePlan(plan);for(const setting of data.settings??[])if(['recommendationsEnabled','recommendationFrequency','maxRecommendationsPerDay','goalProgressEnabled'].includes(setting.key))this.setSetting(setting.key,String(setting.value));});tx(snapshot);}
  close() { this.db.close(); }
}
