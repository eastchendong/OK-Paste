import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'ui/assets/companion');
const output=path.join(root,'desktop-preview/assets');

// Embed unchanged originals rather than rewriting their paths, gradients or IDs.
// These transforms mirror the 48pt source rig in companion-character.css.
export function buildDesktopIcons({check=false}={}) {
  const layer=(name,x,y,attributes='')=>{
    const bytes=fs.readFileSync(path.join(source,name+'.svg'));
    const header=bytes.toString('utf8').match(/<svg\b[^>]*>/)?.[0];
    const width=header?.match(/\bwidth="([^"]+)"/)?.[1],height=header?.match(/\bheight="([^"]+)"/)?.[1];
    if(!width||!height)throw new Error('Missing companion SVG dimensions: '+name);
    return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/svg+xml;base64,${bytes.toString('base64')}" ${attributes}/>`;
  };
  const silhouette=`<g transform="translate(24 24) rotate(-7.34276264) translate(-21.43614578 -21.43614578)">${layer('body',-8.76375,-3.75525)}</g>`;
  const eyes=layer('eye-left',6.63135,11.49988)+layer('eye-right',14.84058,11.49988);
  const header='<!-- Generated from ui/assets/companion by scripts/build-desktop-icons.mjs. -->\n';
  const app=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="90" y="96" width="844" height="844" rx="190" fill="#38575d" opacity=".09"/>
  <rect x="90" y="80" width="844" height="844" rx="190" fill="#f9fcfc" stroke="#e5edee" stroke-width="2"/>
  <g transform="translate(270 210) scale(12)">${silhouette}${eyes}</g>
</svg>\n`;
  // The menu bar requires one alpha silhouette with clear eyes. A threshold
  // removes soft cast shadows; luminance subtraction cuts the original eyes.
  const status=`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 64 64">
  <defs>
    <filter id="solid" color-interpolation-filters="sRGB"><feComponentTransfer result="hard"><feFuncA type="discrete" tableValues="0 0 0 0 0 0 0 1"/></feComponentTransfer><feFlood flood-color="white"/><feComposite in2="hard" operator="in"/></filter>
    <filter id="eye" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter>
    <mask id="silhouette" maskUnits="userSpaceOnUse" x="-10" y="-10" width="74" height="74" style="mask-type:luminance">
      <g filter="url(#solid)">${silhouette}</g><g filter="url(#eye)">${eyes}</g>
    </mask>
  </defs>
  <g transform="translate(11 8)"><rect x="-10" y="-10" width="74" height="74" fill="black" mask="url(#silhouette)"/></g>
</svg>\n`;
  for(const [name,svg] of [['AppIcon.svg',app],['StatusIcon.svg',status]]) {
    const file=path.join(output,name),content=header+svg;
    if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===content)continue;
    if(check)throw new Error('Desktop icon is stale: '+name);
    fs.writeFileSync(file,content);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildDesktopIcons({check:process.argv.includes('--check')});
