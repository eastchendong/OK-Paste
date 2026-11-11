async function reloadStored() {
  const response = await fetch('/v1/clipboard/items', {cache: 'no-store'});
  const payload = await response.json();
  const list = document.querySelector('#items');
  list.replaceChildren();
  for (const item of payload.items) {
    const row = document.createElement('li');
    const text = typeof item.body?.text === 'string' ? item.body.text : '';
    const resource = typeof item.body?.resourceUrl === 'string' ? item.body.resourceUrl : '';
    row.textContent = [item.type, item.source?.title || '', item.source?.url || '', text || resource].filter(Boolean).join(' · ');
    list.append(row);
  }
  document.querySelector('#count').textContent = payload.items.length ? `${payload.items.length} 项` : '还没有保存的内容';
}
document.querySelector('#reload').addEventListener('click', () => { void reloadStored(); });
void reloadStored();
setInterval(() => { void reloadStored(); }, 800);
