import fs from 'node:fs';
import path from 'node:path';

export interface LocalModelAsset {
  filename: string;
  format: 'glb';
  path: string;
  note: string;
}

export function listLocalModels(root: string): LocalModelAsset[] {
  const dir = path.join(root, 'assets', 'models');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.glb'))
    .sort((a, b) => a.localeCompare(b))
    .map(filename => ({
      filename,
      format: 'glb' as const,
      path: path.join(dir, filename),
      note: '本地已有的 GLB。用不用由参考图和已确认的计划决定。',
    }));
}
