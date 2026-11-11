export type Shortcut = {key: string; modifiers: string[]};
export const DEFAULT_SHORTCUTS: Record<string, Shortcut> = {
  magicCopy: {key:'c', modifiers:['alt']},
  addContent: {key:'c', modifiers:['meta','alt']},
  pasteToWord: {key:'v', modifiers:['meta','alt']},
  toggle: {key:'Space', modifiers:['meta','shift']},
  archive: {key:'h', modifiers:['meta','shift']},
  settings: {key:',', modifiers:['meta']},
  stop: {key:'.', modifiers:['meta','shift']},
};
export function matchesShortcut(event: Pick<KeyboardEvent,'code'|'key'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'>, shortcut: Shortcut | null) {
  if (!shortcut) return false;
  const key = shortcut.key.toLowerCase();
  const code = key === 'space' ? 'Space' : /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : '';
  return (code ? event.code === code || (!event.code && event.key.toLowerCase() === key) : event.key.toLowerCase() === key)
    && event.metaKey === shortcut.modifiers.includes('meta') && event.ctrlKey === shortcut.modifiers.includes('ctrl')
    && event.altKey === shortcut.modifiers.includes('alt') && event.shiftKey === shortcut.modifiers.includes('shift');
}
