// Run with the repository's Electron (Chromium), isolated from the product.
// WebKit/AppKit rasterize nested Figma SVG masks at their tiny source size.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'.renderer-profile'));
app.commandLine.appendSwitch('force-device-scale-factor','2');
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
let rendererWindow;
async function render(file,size) {
  const window=rendererWindow||(rendererWindow=new BrowserWindow({width:size,height:size,show:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}}));
  window.setContentSize(size,size);
  await window.loadFile(file);
  await window.webContents.executeJavaScript('Promise.all([...document.images].map(image=>image.decode()))');
  await new Promise(resolve=>setTimeout(resolve,120));
  const image=await window.webContents.capturePage();
  if(image.isEmpty())throw Error('Empty icon render: '+path.basename(file));
  return image;
}
app.whenReady().then(async()=>{
  app.dock?.hide();
  const art=await render(source,1024);
  const set=path.join(output,'AppIcon.iconset');fs.mkdirSync(set,{recursive:true});
  const png=(image,size)=>image.resize({width:size,height:size,quality:'best'}).toPNG();
  for(const size of [16,32,128,256,512]) {
    fs.writeFileSync(path.join(set,`icon_${size}x${size}.png`),png(art,size));
    fs.writeFileSync(path.join(set,`icon_${size}x${size}@2x.png`),png(art,size*2));
  }
  fs.writeFileSync(path.join(output,'AppIcon.png'),png(art,1024));
  const status=await render(path.join(path.dirname(source),'StatusIcon.svg'),18);
  fs.writeFileSync(path.join(output,'StatusIcon.png'),png(status,36));
  rendererWindow.destroy();
  console.log('Rendered Figma companion icons with Chromium.');
  app.quit();
}).catch(error=>{console.error(error.message);app.exit(1);});
