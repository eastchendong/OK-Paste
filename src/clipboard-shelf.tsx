import type {ClipboardSnapshot, DestinationInfo, PublicClipboardItem} from './clipboard/types';
import {itemSummary, sourceSummary} from './clipboard/types';

function choices(item: PublicClipboardItem, destinations: DestinationInfo[]) {
  return destinations.filter(destination => destination.accepts.includes('*') || destination.accepts.includes(item.type));
}

export function ClipboardShelf({snapshot, pasteError, onPaste}: {
  snapshot: ClipboardSnapshot | null;
  pasteError?: string;
  onPaste: (itemId: string, destinationId: string) => void;
}) {
  const items = snapshot?.items ?? [];
  const label = snapshot == null
    ? '正在读取已保存的剪贴板'
    : snapshot.ready === false
      ? '浏览器写入未接通'
      : items.length ? `${items.length} 项已保存` : '还没有复制内容';
  return (
    <section className="shelf" aria-label="剪贴板">
      <div className="shelf-head"><b>剪贴板</b><span>{label}</span></div>
      {snapshot?.error ? <p className="error">{snapshot.error}</p> : null}
      {pasteError ? <p role="alert" className="error">{pasteError}</p> : null}
      <ul>
        {items.map(item => {
          const available = choices(item, snapshot?.destinations ?? []);
          return (
            <li key={item.id}>
              {item.preview ? <img src={item.preview} alt="" /> : null}
              <div>
                <b>{item.type}</b>
                <span>{itemSummary(item)}</span>
                <small>{sourceSummary(item.source)}</small>
              </div>
              {available.length ? <select aria-label={`粘贴 ${item.type}`} defaultValue="" onChange={event => {
                const destinationId = event.currentTarget.value;
                event.currentTarget.value = '';
                if (destinationId) onPaste(item.id, destinationId);
              }}>
                <option value="">粘贴到…</option>
                {available.map(destination => <option key={destination.id} value={destination.id}>{destination.name}</option>)}
              </select> : <small>没有可粘贴的目的地</small>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
