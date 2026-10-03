import { ActivitySummary } from './shared/contracts';

export interface KnowledgeMapping { terms: string[]; topic: string; technology?: string; subtopic?: string; category?: string; }

export const KNOWLEDGE_BASE: KnowledgeMapping[] = [
  { terms: ['godot', 'godotengine.org'], topic: 'Godot', technology: 'Godot', category: 'Game Development' },
  { terms: ['gdscript', '.gd', 'navigationagent3d', 'pathfinding', 'enemy ai', 'enemy navigation', 'granny'], topic: 'Godot', technology: 'GDScript', category: 'Game Development' },
  { terms: ['javascript', '.js'], topic: 'JavaScript', technology: 'JavaScript', category: 'Programming' },
  { terms: ['typescript', '.ts', '.tsx'], topic: 'TypeScript', technology: 'TypeScript', category: 'Programming' },
  { terms: ['react', '.jsx'], topic: 'React', technology: 'React', category: 'Programming' },
  { terms: ['node.js', 'nodejs', 'npm'], topic: 'Node.js', technology: 'Node.js', category: 'Programming' },
  { terms: ['c++', '.cpp', '.hpp'], topic: 'C++', technology: 'C++', category: 'Programming' },
  { terms: ['git', 'github'], topic: 'Git/GitHub', technology: 'Git', category: 'Programming' },
  { terms: ['minecraft'], topic: 'Minecraft', category: 'Gaming' },
  { terms: ['steam'], topic: 'Steam', category: 'Gaming' },
  { terms: ['discord'], topic: 'Discord', category: 'Social' },
  { terms: ['spotify', 'music', 'youtube music'], topic: 'Music', category: 'Music' },
  { terms: ['enemy ai', 'enemy navigation', 'pathfinding', 'navigationagent3d'], topic: 'Enemy AI', subtopic: 'Enemy AI', category: 'Game Development' },
];

export interface TopicSignal { name: string; technology?: string; subtopic?: string; category?: string; evidence: string; score: number; }

export class TopicExtractor {
  constructor(private knowledgeBase: KnowledgeMapping[] = KNOWLEDGE_BASE) {}
  extract(activities: ActivitySummary[]): TopicSignal[] {
    const scores = new Map<string, TopicSignal>();
    for (const activity of activities) {
      const text = `${activity.application} ${activity.title ?? ''}`.toLowerCase();
      for (const mapping of this.knowledgeBase) {
        const hits = mapping.terms.filter(term => text.includes(term.toLowerCase()));
        if (!hits.length) continue;
        const existing = scores.get(mapping.topic);
        const score = hits.length * Math.max(1, Math.min(activity.durationSeconds / 60, 10));
        const signal: TopicSignal = existing ?? { name: mapping.topic, technology: mapping.technology, subtopic: mapping.subtopic, category: mapping.category, evidence: '', score: 0 };
        signal.score += score;
        signal.technology = signal.technology ?? mapping.technology;
        signal.subtopic = signal.subtopic ?? mapping.subtopic;
        signal.category = signal.category ?? mapping.category;
        signal.evidence = signal.evidence || `${activity.application}${activity.title ? ` window contains ${activity.title}` : ''}`;
        scores.set(mapping.topic, signal);
      }
    }
    return [...scores.values()].sort((a, b) => b.score - a.score);
  }
}
