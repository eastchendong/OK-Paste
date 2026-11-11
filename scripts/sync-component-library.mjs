import fs from 'node:fs';
import {buildUI} from './build-ui.mjs';
import {buildDesktopIcons} from './build-desktop-icons.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function writeGenerated(file,content) {
 if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)fs.writeFileSync(file,content);
}

// ui/ owns the shared styles and component markup. Build the portable catalog
// before deriving browser and native adapters from the same design source.
export function syncComponentLibrary() {
 buildUI();
 buildDesktopIcons();
 const html=fs.readFileSync(path.join(root,'components-preview.html'),'utf8');
 const hash=crypto.createHash('sha256').update(html).digest('hex');
 const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
 if(!css)throw new Error('组件库缺少样式。');
 writeGenerated(path.join(root,'browser/component-library.css'),'/* Generated from components-preview.html; do not edit. */\n'+css);
 const rules=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selector:match[1].trim(),body:match[2]}));
 const roots=rules.filter(rule=>rule.selector===':root').map(rule=>rule.body).join('\n');
 const tokens=Object.fromEntries([...roots.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match=>[match[1],match[2].trim()]));
 const rule=selector=>{const value=rules.find(entry=>entry.selector===selector);if(!value)throw new Error('组件库缺少 '+selector);return selector+'{'+value.body+'}';};
 const license=html.match(/<!-- Lucide interface icons,[\s\S]*?-->/)?.[0]||'';
 const svg=name=>{
  const symbol=html.match(new RegExp('<symbol id="icon-'+name+'"[^>]*>([\\s\\S]*?)<\\/symbol>'))?.[1];
  if(!symbol)throw new Error('组件库缺少图标 '+name);
  return '<svg class="toolbar-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+symbol+'</svg>';
 };
 let markup=html.match(/<div class="demo-toolbar demo-glass"[\s\S]*?<\/div>/)?.[0];
 if(!markup)throw new Error('组件库缺少选区操作条。');
 markup=markup.replaceAll('${disabled}','').replace(/\$\{toolbarIcon\('(plus|scan)'\)\}/g,(_,name)=>svg(name));
 const labels=[...markup.matchAll(/<\/svg>([^<]+)<\/button>/g)].map(match=>match[1]);
 if(labels.length!==2)throw new Error('选区操作条缺少内容或目标按钮定义。');
 const anchorEnabled=!/<button\b[^>]*\bhidden\b[^>]*>[^]*?设为目标位置<\/button>/.test(markup);
 let button=0;
 markup=markup.replace('class="demo-toolbar demo-glass"','class="popup demo-toolbar demo-glass" hidden').replace(/<button type="button"/g,()=>'<button type="button" class="'+(['copy','start'][button++])+'"');
 markup=markup.slice(0,-6)+'<p class="note demo-glass" role="status" hidden></p></div>';
 const styles=':host{all:initial;'+roots+'font-size:14px;--g-blur:18px;--g-saturation:140%;--g-radius:22px;--g-angle:145deg;--g-highlight:.45;}\n'
  +'*,:before,:after{box-sizing:border-box}button{font:inherit;cursor:pointer}\n'
  +['.demo-glass','.demo-glass::before','.demo-toolbar','.demo-toolbar:hover','.demo-toolbar button','.demo-toolbar button:hover:not(:disabled), .demo-toolbar button:focus-visible:not(:disabled)','.demo-toolbar button:disabled','.toolbar-icon','.demo-toolbar .toolbar-icon'].map(rule).join('\n')+'\n'+fs.readFileSync(path.join(root,'ui/styles/browser-selection.css'),'utf8');
 const generated='// Generated from components-preview.html by scripts/sync-component-library.mjs.\n'
  +'export const COMPONENT_LIBRARY_HASH='+JSON.stringify(hash)+';\n'
  +'export const SELECTION_TOOLBAR_STYLES='+JSON.stringify(styles)+';\n'
  +'export const SELECTION_TOOLBAR_MARKUP='+JSON.stringify(license+'\n'+markup)+';\n';
 writeGenerated(path.join(root,'src/browser/selection-component.generated.ts'),generated);
 const assets=path.join(root,'desktop-preview/assets/components');fs.mkdirSync(assets,{recursive:true});
 for(const [name,file] of [['plus','SelectionPlus.svg'],['scan','SelectionScan.svg']]) {
  writeGenerated(path.join(assets,file),license+'\n'+svg(name).replace('stroke="currentColor"','stroke="'+tokens['--blue-12']+'"'));
 }
 const channel=value=>Number(value).toFixed(6);
 function color(name) {
  const value=tokens[name];if(!value)throw new Error('组件库缺少颜色 '+name);
  const hex=value.match(/^#([\da-f]{6})([\da-f]{2})?$/i),rgba=value.match(/^rgba?\(([^)]+)\)$/);
  const parts=hex?[parseInt(hex[1].slice(0,2),16)/255,parseInt(hex[1].slice(2,4),16)/255,parseInt(hex[1].slice(4,6),16)/255,hex[2]?parseInt(hex[2],16)/255:1]:rgba?rgba[1].split(',').map((part,index)=>Number(part.trim())/(index<3?255:1)):null;
  if(!parts)throw new Error('无法读取组件颜色 '+name);
  return 'NSColor(calibratedRed:'+channel(parts[0])+',green:'+channel(parts[1])+',blue:'+channel(parts[2])+',alpha:'+channel(parts[3]??1)+')';
 }
 const colors={ink:'--slate-12',muted:'--slate-11',blue:'--blue-12',paper:'--slate-1',control:'--slate-2',line:'--slate-6',glass:'--white-a11',border:'--white-a8',secondary:'--white-a9',hover:'--slate-a4'};
 const toolbarRule=rules.find(entry=>entry.selector==='.demo-toolbar').body;
 const buttonRule=rules.find(entry=>entry.selector==='.demo-toolbar button').body;
 const radius=toolbarRule.match(/border-radius:\s*(\d+)px/)[1];
 const buttonRadius=buttonRule.match(/border-radius:\s*(\d+)px/)[1];
 const toolbarHeight=toolbarRule.match(/(?:^|;)\s*height:\s*(\d+)px/)[1];
 const fontSize=buttonRule.match(/font-size:\s*(\d+)px/)[1];
 const iconSize=rules.find(entry=>entry.selector==='.demo-toolbar .toolbar-icon').body.match(/width:\s*(\d+)px/)[1];
 const native=['// Generated from components-preview.html ('+hash.slice(0,12)+'). Do not edit.','import AppKit','enum ComponentLibrary {',
  ...Object.entries(colors).map(([name,token])=>'    static let '+name+' = '+color(token)),
  '    static let copyLabel = '+JSON.stringify(labels[0]),'    static let anchorLabel = '+JSON.stringify(labels[1]),
  '    static let selectionAnchorEnabled = '+anchorEnabled,
  '    static let selectionRadius: CGFloat = '+radius,'    static let selectionButtonRadius: CGFloat = '+buttonRadius,
  '    static let selectionFontSize: CGFloat = '+fontSize,'    static let selectionIconSize: CGFloat = '+iconSize,
  '    static let selectionSize = NSSize(width:'+(anchorEnabled?214:102)+',height:'+toolbarHeight+')',
  '    static func font(_ size:CGFloat, bold:Bool = false) -> NSFont {',
  '        NSFont(name:bold ? "PingFangSC-Semibold" : "PingFangSC-Regular",size:size) ?? .systemFont(ofSize:size,weight:bold ? .semibold : .regular)',
  '    }','}'].join('\n')+'\n';
 writeGenerated(path.join(root,'desktop-preview/Sources/ComponentLibrary.generated.swift'),native);
 return {hash,labels};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const result=syncComponentLibrary();console.log('已同步官方组件库：'+result.hash.slice(0,12));
}
