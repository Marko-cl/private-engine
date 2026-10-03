export interface MemoryRelationship { name: string; related: string[]; category?: string; }

// Local, editable relationship definitions. This is intentionally not a personal profile.
export const MEMORY_RELATIONSHIPS: MemoryRelationship[] = [
  { name: 'Godot', related: ['Game Development', 'GDScript', 'Game Engine', 'Navigation', 'Enemy AI'], category: 'Game Development' },
  { name: 'GDScript', related: ['Godot', 'Game Development', 'Game Engine'], category: 'Game Development' },
  { name: 'JavaScript', related: ['Programming', 'Web Development', 'Node.js', 'React'], category: 'Programming' },
  { name: 'TypeScript', related: ['Programming', 'Web Development', 'Node.js', 'React'], category: 'Programming' },
  { name: 'C++', related: ['Programming', 'Game Development'], category: 'Programming' },
  { name: 'Node.js', related: ['Programming', 'JavaScript', 'TypeScript', 'Web Development'], category: 'Programming' },
  { name: 'React', related: ['Programming', 'JavaScript', 'TypeScript', 'Web Development'], category: 'Programming' },
  { name: 'Minecraft', related: ['Gaming', 'Game Development'], category: 'Gaming' },
];
