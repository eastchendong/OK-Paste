import fs from 'node:fs';
import path from 'node:path';
import {DEFAULT_SHORTCUTS} from './shortcuts';

// Public browser settings deliberately contain no model credentials.
export function publicSettings(root: string) {
  let saved: {shortcuts?: Record<string, unknown>} = {};
  try { saved = JSON.parse(fs.readFileSync(path.join(root,'.local/settings.json'),'utf8')); } catch {}
  return {shortcuts:{...DEFAULT_SHORTCUTS,...saved.shortcuts}};
}

export function readAgentConfig(root: string): Record<string,string> {
  const config: Record<string,string> = {};
  if (!fs.existsSync(path.join(root,'.env.local'))) return config;
  for (const line of fs.readFileSync(path.join(root,'.env.local'),'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i=line.indexOf('='); if(i<0)continue;
    const value=line.slice(i+1).trim();
    config[line.slice(0,i)]=value.startsWith('"')?JSON.parse(value):value;
  }
  return config;
}
