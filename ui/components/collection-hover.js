// The popover lives outside the scrolling/masked list, with its own native
// material and hit region. Its links remain reachable across the small gap.
function installCollectionHover({body,bundle,stack,trackMotion}) {
  const panel=document.createElement('aside');
  panel.id='collectionHover';panel.className='collection-hover';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','内容与来源');
  document.body.append(panel);
  let owner=null,openTimer=0,closeTimer=0;
  const rowFor=target=>target?.closest?.('#bundle.collection-list .bundle-card, #bundle.collection-stack .collection-front');
  function hide() {
    clearTimeout(openTimer);clearTimeout(closeTimer);
    owner?.classList.remove('collection-hovered');owner?.removeAttribute('aria-describedby');
    owner=null;panel.hidden=true;
  }
  function position() {
    if(panel.hidden)return;
    const viewport=body.getBoundingClientRect(),anchor=owner?.getBoundingClientRect();
    if(!owner?.isConnected||stack.hidden||!rowFor(owner)||!document.querySelector('#detailBackdrop').hidden||!anchor||anchor.bottom<=viewport.top||anchor.top>=viewport.bottom) {hide();return;}
    const width=Math.min(300,innerWidth-24),gap=12;
    const put=(name,value)=>{if(panel.style[name]!==value)panel.style[name]=value;};
    put('width',`${width}px`);
    const height=panel.getBoundingClientRect().height;
    let x,y;
    if(anchor.right+gap+width<=innerWidth-12) {x=anchor.right+gap;y=anchor.top;}
    else if(anchor.left-gap-width>=12) {x=anchor.left-gap-width;y=anchor.top;}
    else {x=anchor.left;y=anchor.bottom+gap+height<=innerHeight-12?anchor.bottom+gap:anchor.top-gap-height;}
    put('left',`${Math.max(12,Math.min(x,innerWidth-width-12))}px`);
    put('top',`${Math.max(12,Math.min(y,innerHeight-height-12))}px`);
  }
  positionCollectionHover=position;
  function show(row) {
    if(body.hasAttribute('data-mention-picking')||!row.isConnected||stack.hidden||!rowFor(row))return;
    const item=sources.find(item=>item.id===row.dataset.card);if(!item)return;
    hide();owner=row;
    const source={...item,url:/^(https?:\/\/|file:\/\/|tuotie-app:\/\/)/i.test(item.url||'')?item.url:''};
    const appName=item.appName||(item.sourceKind==='web'?'浏览器（未记录具体应用）':'未记录来源应用');
    const appIcon=/^data:image\/png;base64,[a-z\d+/=]+$/i.test(item.appIcon||'')
      ?`<img class="collection-app-icon" src="${escapeHtml(item.appIcon)}" alt="">`
      :icon(item.sourceKind==='web'?'source-web':'source-app','collection-app-icon');
    panel.innerHTML=`<div class="collection-hover-preview">${contentPreview(item)}</div>
      <div class="collection-hover-source"><span class="collection-hover-app"><span>应用：</span>${appIcon}<span>${escapeHtml(appName)}</span></span>${originMarkup(source)}</div>`;
    panel.hidden=false;row.classList.add('collection-hovered');row.setAttribute('aria-describedby',panel.id);
    position();reportGeometry();
    if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches&&panel.animate) {
      panel.animate([{transform:'translateY(3px) scale(.985)'},{transform:'none'}],{duration:160,easing:'cubic-bezier(.22,.8,.22,1)'});
      trackMotion(180);
    }
  }
  function schedule(row) {
    clearTimeout(closeTimer);clearTimeout(openTimer);
    if(owner===row&&!panel.hidden)return;
    openTimer=setTimeout(()=>show(row),220);
  }
  function leave() {
    clearTimeout(openTimer);clearTimeout(closeTimer);
    closeTimer=setTimeout(()=>{hide();reportGeometry();},180);
  }
  body.addEventListener('pointerover',event=>{const row=rowFor(event.target);if(row&&!row.contains(event.relatedTarget))schedule(row);});
  body.addEventListener('pointerout',event=>{
    const row=rowFor(event.target);
    if(row&&!row.contains(event.relatedTarget)&&!panel.contains(event.relatedTarget))leave();
  });
  body.addEventListener('focusin',event=>{const row=rowFor(event.target);if(row)schedule(row);});
  body.addEventListener('focusout',event=>{if(!body.contains(event.relatedTarget)&&!panel.contains(event.relatedTarget))leave();});
  panel.addEventListener('pointerenter',()=>{clearTimeout(closeTimer);clearTimeout(openTimer);});
  panel.addEventListener('pointerleave',event=>{if(!owner?.contains(event.relatedTarget))leave();});
  panel.addEventListener('focusin',()=>clearTimeout(closeTimer));
  panel.addEventListener('focusout',event=>{if(!panel.contains(event.relatedTarget)&&!owner?.contains(event.relatedTarget))leave();});
  panel.addEventListener('load',()=>{position();reportGeometry();},true);
  body.addEventListener('scroll',()=>{hide();reportGeometry();},{passive:true});
  document.addEventListener('pointerdown',event=>{if(!panel.contains(event.target)&&!owner?.contains(event.target))hide();},true);
  document.addEventListener('dragstart',()=>{hide();reportGeometry();},true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.hidden){event.stopImmediatePropagation();hide();reportGeometry();}
  },true);
  return {hide};
}
