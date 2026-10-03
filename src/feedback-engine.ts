import { FeedbackRecord, FeedbackSummary, FeedbackValue, RecommendationType } from './shared/contracts';

export const FEEDBACK_VALUES: readonly FeedbackValue[] = ['useful', 'not_useful', 'dismissed', 'ignored'];
export type FeedbackDimension = 'type' | 'category' | 'topic' | 'project' | 'tool';
export type FeedbackCounts = Record<FeedbackValue, number>;

export function actionFeedbackAllowed(status: string): boolean { return status === 'completed'; }
export function normalizeFeedback(value: unknown): FeedbackValue | null {
  return typeof value === 'string' && FEEDBACK_VALUES.includes(value as FeedbackValue) ? value as FeedbackValue : null;
}
export function emptyFeedbackCounts(): FeedbackCounts { return { useful: 0, not_useful: 0, dismissed: 0, ignored: 0 }; }
export function emptyFeedbackSummary(): FeedbackSummary { return { totalUseful: 0, totalNotUseful: 0, totalDismissed: 0, totalIgnored: 0, byType: {}, byCategory: {}, byTopic: {}, byProject: {}, byTool: {} }; }

export function aggregateFeedback(records: FeedbackRecord[]): FeedbackSummary {
  const summary = emptyFeedbackSummary();
  for (const record of records) {
    const value = normalizeFeedback(record.feedback); if (!value) continue;
    if (value === 'useful') summary.totalUseful++; else if (value === 'not_useful') summary.totalNotUseful++; else if (value === 'dismissed') summary.totalDismissed++; else summary.totalIgnored++;
    if (record.recommendationType) add(summary.byType, record.recommendationType, value);
    if (record.category) add(summary.byCategory, record.category, value);
    if (record.topic) add(summary.byTopic, record.topic, value);
    if (record.project) add(summary.byProject, record.project, value);
    if (record.toolName) add(summary.byTool, record.toolName, value);
  }
  return summary;
}

export function feedbackAdjustment(summary: FeedbackSummary, fields: { type?: RecommendationType | string; category?: string; topic?: string | null; project?: string | null }): number {
  const buckets = [fields.type && summary.byType[fields.type], fields.category && summary.byCategory[fields.category], fields.topic && summary.byTopic[fields.topic], fields.project && summary.byProject[fields.project]].filter(Boolean) as FeedbackCounts[];
  if (!buckets.length) return 0;
  const signals = buckets.map(signal).filter(value => value !== null) as number[];
  if (!signals.length) return 0;
  // At most eight score points; feedback never replaces the core deterministic model.
  return Math.max(-8, Math.min(8, signals.reduce((sum, value) => sum + value, 0) / signals.length * 100));
}
function signal(counts: FeedbackCounts): number | null {
  const total = counts.useful + counts.not_useful + counts.dismissed + counts.ignored;
  if (!total) return null;
  const value = (counts.useful * .08 - counts.not_useful * .08 - counts.dismissed * .06 - counts.ignored * .03) / Math.max(1, total);
  return Math.max(-.08, Math.min(.08, value));
}
function add(target: Record<string, FeedbackCounts>, key: string, value: FeedbackValue) { target[key] ??= emptyFeedbackCounts(); target[key][value]++; }
