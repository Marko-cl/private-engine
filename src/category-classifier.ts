import { ActivitySummary, ActivityCategory } from './shared/contracts';

export const CATEGORIES = ['Programming','Game Development','Gaming','School','Learning','Web Research','Entertainment','Music','Social','Shopping','Communication','Productivity','Other'] as const;

export class CategoryClassifier {
  classify(activities: ActivitySummary[]): ActivityCategory {
    const text = activities.map(a => `${a.application} ${a.title ?? ''}`).join(' ').toLowerCase();
    const scores: Record<string, number> = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
    const add = (category: string, points: number) => { scores[category] += points; };
    for (const a of activities) {
      const value = `${a.application} ${a.title ?? ''}`.toLowerCase();
      const minutes = Math.max(1, a.durationSeconds / 60);
      if (['vs code','visual studio','cursor','webstorm','terminal','powershell'].some(x => value.includes(x))) add('Programming', 3 * minutes);
      if (['godot','.gd','unity','unreal','3d_horror','game development','navigationagent','enemy ai'].some(x => value.includes(x))) add('Game Development', 5 * minutes);
      if (['minecraft','steam','game','elden ring','fortnite'].some(x => value.includes(x))) add('Gaming', 4 * minutes);
      if (['spotify','music','soundcloud','youtube music'].some(x => value.includes(x))) add('Music', 5 * minutes);
      if (['discord','messenger','telegram','whatsapp'].some(x => value.includes(x))) add('Social', 4 * minutes);
      if (['docs','school','assignment','lecture','course'].some(x => value.includes(x))) add('School', 3 * minutes);
      if (['chrome','edge','firefox','documentation','github','search'].some(x => value.includes(x))) add('Web Research', 2 * minutes);
      if (['youtube','netflix','twitch'].some(x => value.includes(x))) add('Entertainment', 3 * minutes);
      if (['shopping','amazon','ebay'].some(x => value.includes(x))) add('Shopping', 3 * minutes);
    }
    const winner = Object.entries(scores).sort((a,b) => b[1] - a[1])[0];
    const category = winner[1] > 0 ? winner[0] : 'Other';
    const programmingScore = scores.Programming; const gameScore = scores['Game Development'];
    return { name: category, parent: category === 'Game Development' && programmingScore > gameScore * 0.35 ? 'Programming' : undefined, confidence: this.confidence(scores, category) };
  }
  private confidence(scores: Record<string, number>, winner: string) { const values = Object.values(scores).sort((a,b) => b-a); const total = values.reduce((a,b)=>a+b,0); return total ? Math.min(0.99, Math.max(0.35, (scores[winner] / total) + (values[0] > values[1] * 1.5 ? 0.2 : 0))) : 0.2; }
}
