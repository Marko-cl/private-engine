import { ActivitySummary, DetectedProject } from './shared/contracts';

export class ProjectDetector {
  detect(activities: ActivitySummary[]): DetectedProject | null {
    const candidates = new Map<string, { seconds: number; first: string; last: string; evidence: number }>();
    for (const activity of activities) {
      const title = activity.title ?? '';
      const match = title.match(/^\s*([^|–—:-]{2,80}?)\s+-\s+[^-]+$/) || title.match(/^\s*([^|–—:]{2,80}?)\s+[|–—:]\s+/);
      if (!match) continue;
      const name = match[1].trim();
      if (!this.isPlausible(name)) continue;
      const prior = candidates.get(name) ?? { seconds: 0, first: activity.startedAt, last: activity.endedAt ?? activity.startedAt, evidence: 0 };
      prior.seconds += activity.durationSeconds; prior.first = prior.first < activity.startedAt ? prior.first : activity.startedAt; prior.last = prior.last > (activity.endedAt ?? activity.startedAt) ? prior.last : (activity.endedAt ?? activity.startedAt); prior.evidence++;
      candidates.set(name, prior);
    }
    const best = [...candidates.entries()].sort((a,b) => b[1].seconds - a[1].seconds)[0];
    if (!best || best[1].evidence < 1) return null;
    return { id: `project:${best[0].toLowerCase()}`, name: best[0], confidence: Math.min(0.98, 0.55 + best[1].evidence * 0.12), firstSeen: best[1].first, lastSeen: best[1].last, totalSeconds: best[1].seconds };
  }
  private isPlausible(name: string) { return !/^(microsoft visual studio code|visual studio code|untitled|new tab|home|settings)$/i.test(name) && /[a-z0-9]/i.test(name) && !name.includes('http'); }
}
