// Shared, stateless content presentation. Callers supply icons and the symbol document.
function createContentComponents({icon, document}) {
  const contentTypes = Object.freeze({text:'文字',image:'图片',table:'表格',video:'视频',document:'文档'});
  const contentKind = kind => Object.hasOwn(contentTypes,kind) ? kind : 'document';
  const contentLabel = kind => contentTypes[contentKind(kind)];
  const contentTypeIcon = kind => icon(`type-${contentKind(kind)}`,'content-type-icon');
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function thumb(kind) {
    const name = kind === 'target' ? 'target' : `type-${contentKind(kind)}`;
    return `<span class="thumb ${kind}" aria-hidden="true">${icon(name)}</span>`;
  }
  function originMarkup(item) {
    const category = ['web','app','file'].includes(item.sourceKind) ? item.sourceKind : 'link';
    const ownIcon = typeof item.sourceIcon === 'string' && /^[a-z0-9-]+$/.test(item.sourceIcon) && document.getElementById(`icon-${item.sourceIcon}`);
    const content = `${icon(ownIcon ? item.sourceIcon : `source-${category}`)}<span class="origin-name">${escapeHtml(item.origin)}</span>`;
    return item.url
      ? `<a class="origin-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="打开${escapeHtml(item.origin)}的来源位置">${content}</a>`
      : `<span class="origin-label" title="来源暂时无法打开">${content}</span>`;
  }
  function sourceMeta(item) {
    return `<span class="source-meta"><span class="content-type">${escapeHtml(item.type)}</span>${originMarkup(item)}</span>`;
  }

  function bundlePreview(item) {
    const preview = typeof item.preview === 'string' ? item.preview : '';
    if (item.kind === 'image' && preview.startsWith('data:image/')) {
      return `<span class="thumb preview-thumb" aria-hidden="true"><img alt="" src="${escapeHtml(preview)}"></span>`;
    }
    const kindLabel = contentLabel(item.kind);
    const raw = typeof item.detail === 'string' && item.detail.trim() ? item.detail.trim() : (item.title || kindLabel);
    const snippet = escapeHtml(String(raw).replace(/\s+/g, ' ').slice(0, 42));
    const kind = contentKind(item.kind);
    return `<span class="thumb preview-thumb preview-${kind}" aria-hidden="true"><em>${escapeHtml(kindLabel)}</em><span>${snippet}</span></span>`;
  }
  function contentTitle(item) {
    return `<strong class="bundle-card-title">${contentTypeIcon(item.kind)}<span>${escapeHtml(item.title)}</span></strong>`;
  }
  function bundleCard(item, selected = false, demo = false) {
    const id = escapeHtml(item.id);
    return `<div class="${demo ? 'demo-bundle-card' : 'bundle-card'} ${selected ? 'selected' : ''}" data-kind="${contentKind(item.kind)}" ${demo ? `data-demo-card="${id}"` : `data-card="${id}" draggable="true"`}>
      <span class="collection-row-content">${contentPreview(item,true)}</span>
      <button type="button" class="bundle-card-select" ${demo ? `data-demo-select="${id}"` : `data-select="${id}"`} aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'}${escapeHtml(item.title)}"></button>
      <button type="button" class="thumb-button" ${demo ? `data-demo-detail="${id}"` : `data-detail="${id}"`} aria-label="查看${escapeHtml(item.title)}详情">${bundlePreview(item)}</button>
      <span class="bundle-card-copy">${contentTitle(item)}${sourceMeta(item)}</span>
      <span class="bundle-card-actions"><button type="button" ${demo ? `data-demo-remove="${id}"` : `data-remove="${id}"`} aria-label="移除${escapeHtml(item.title)}">${icon('x')}</button></span>
    </div>`;
  }

  function contentText(item) {
    if(item.kind==='table'&&Array.isArray(item.tableRows))return item.tableRows.filter(Array.isArray).map(row=>row.map(cell=>String(cell??'')).join('\t')).join('\n');
    return typeof item.detail==='string'&&item.detail.trim()?item.detail.trim():String(item.title||contentLabel(item.kind));
  }
  function contentPreview(item, compact = false) {
    if(['image','table'].includes(item.kind)&&typeof item.preview==='string'&&/^data:image\/(png|jpeg|jpg|gif|webp|tiff);/i.test(item.preview)) {
      return `<img class="collection-preview-image" alt="${escapeHtml(contentLabel(item.kind))}预览" src="${escapeHtml(item.preview)}">`;
    }
    if(item.kind==='table') {
      const raw=Array.isArray(item.tableRows)?item.tableRows:contentText(item).split(/\r?\n/).map(line=>line.split('\t'));
      const rows=raw.filter(Array.isArray).slice(0,compact?3:undefined);
      if(rows.length>1||rows[0]?.length>1)return `<table class="collection-preview-table"><tbody>${rows.map(row=>`<tr>${row.slice(0,compact?4:undefined).map(cell=>`<td>${escapeHtml(compact?String(cell??'').slice(0,40):String(cell??''))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    if(item.kind==='image')return `<span class="collection-preview-unavailable">${contentTypeIcon(item.kind)}图片预览暂不可用</span>`;
    return `<span class="collection-preview-text">${escapeHtml(contentText(item))}</span>`;
  }
  return {contentKind,contentLabel,contentTitle,contentText,contentPreview,escapeHtml,thumb,originMarkup,sourceMeta,bundlePreview,bundleCard};
}
