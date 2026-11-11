// Original Figma SVGs stay immutable. Native wrappers own placement and motion.
// The same rig powers the desktop dock, catalog and portable review.
function companionMarkup({id='dockOrb',className='orb',pose='idle'}={}) {
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const aliases={ready:'idle',done:'success',complete:'success'};
  const allowed=new Set(['idle','nod','received','thinking','working','success','failure']);
  const state=aliases[pose]||(allowed.has(pose)?pose:'idle');
  const image=(name,classes='')=>`<img class="${classes}" src="${escape(companionAssetUrl(name))}" alt="" draggable="false">`;
  const body=(file,classes)=>`<span class="companion-silhouette ${classes}"><span class="companion-art">${image(file)}</span></span>`;
  const glint=classes=>`<span class="companion-prop companion-sparkle ${classes}"><span class="companion-glint"></span></span>`;
  return `<div${id?` id="${escape(id)}"`:''} class="companion-character ${escape(className)}" data-companion-pose="${state}" aria-hidden="true">
    <span class="companion-stage"><span class="companion-placement"><span class="companion-rig"><span class="companion-body">
      <span class="companion-base">
        ${body('body.svg','companion-normal-shape')}${body('body-thinking.svg','companion-thinking-shape')}${body('body-success.svg','companion-success-shape')}${body('body-failure.svg','companion-failure-shape')}
        <span class="companion-face"><span class="companion-eyes orb-eyes">
          ${image('eye-left.svg','companion-eye companion-eye-left')}${image('eye-right.svg','companion-eye companion-eye-right')}
        </span><span class="companion-thinking-eyes"><span></span><span></span></span>
        <span class="companion-gaze"><span></span><span></span></span>
        <span class="companion-happy-eyes">${image('eye-happy-left.svg')}${image('eye-happy-right.svg')}</span>
        <span class="companion-failure-eyes"><span>${image('eye-failure-left.svg')}</span><span>${image('eye-failure-right.svg')}</span></span></span>
        <span class="companion-prop companion-tool"><span>${image('pencil.svg')}</span></span>
      </span>
      ${image('wink.svg','companion-wink')}
    </span>
    <span class="companion-prop companion-bubble companion-bubble-left">${image('bubble.svg')}</span>
    <span class="companion-prop companion-bubble companion-bubble-middle">${image('bubble-small.svg')}</span>
    <span class="companion-prop companion-bubble companion-bubble-right">${image('bubble.svg')}</span>
    ${glint('companion-sparkle-top')}${glint('companion-sparkle-left')}${glint('companion-sparkle-right')}
    </span></span></span>
  </div>`;
}
