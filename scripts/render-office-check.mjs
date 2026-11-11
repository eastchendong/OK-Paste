import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
const root=process.cwd(),local=path.join(root,'.local');
const directories=fs.readdirSync(local).filter(name=>/^office-agent-check-\d+$/.test(name)).sort().reverse();
const inputs=['docx','xlsx','pptx'].map(extension=>{
 const folder=directories.find(name=>fs.existsSync(path.join(local,name,`verified-preview.${extension}`)));
 if(!folder)throw new Error('Missing verified preview for '+extension);
 return path.join(local,folder,`verified-preview.${extension}`);
});
const output=path.join(local,'office-render-check');fs.mkdirSync(output,{recursive:true});
const profile=pathToFileURL(path.join(local,'office-render-profile')).href;
const fontDirectories=['/System/Library/Fonts','/System/Library/Fonts/Supplemental','/Library/Fonts','/Applications/LibreOffice.app/Contents/Resources/fonts/truetype'].filter(folder=>fs.existsSync(folder));
const fontconfig=path.join(local,'office-fonts.conf');
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
fs.writeFileSync(fontconfig,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>${fontDirectories.map(folder=>`<dir>${xml(folder)}</dir>`).join('')}<cachedir>${xml(path.join(local,'office-font-cache'))}</cachedir><alias><family>PingFang SC</family><prefer><family>Hiragino Sans GB</family></prefer></alias></fontconfig>`);
const environment={...process.env,FONTCONFIG_FILE:fontconfig,SAL_FONTPATH:fontDirectories.join(path.delimiter)};
function run(args){
 const result=spawnSync('/Applications/LibreOffice.app/Contents/MacOS/soffice',[`-env:UserInstallation=${profile}`,'--headless',...args],{encoding:'utf8',timeout:120000,env:environment});
 if(result.status!==0)throw new Error(result.stderr||'LibreOffice conversion failed');
 process.stdout.write(result.stdout);
}
const recalculated=path.join(output,'recalculated');fs.mkdirSync(recalculated,{recursive:true});
run(['--convert-to','xlsx:Calc MS Excel 2007 XML','--outdir',recalculated,inputs[1]]);
const bundledPoppler=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm');
const poppler=process.env.PDFTOPPM||(fs.existsSync(bundledPoppler)?bundledPoppler:'pdftoppm');
for(const extension of ['docx','xlsx','pptx']){
 // All exported inputs have the same base name, so convert independently below.
 const target=path.join(output,extension);fs.mkdirSync(target,{recursive:true});
 run(['--convert-to','pdf','--outdir',target,inputs[['docx','xlsx','pptx'].indexOf(extension)]]);
 const pdf=path.join(target,'verified-preview.pdf');
 if(!fs.existsSync(pdf))throw new Error('Missing PDF for '+extension);
 const rendered=spawnSync(poppler,['-scale-to','1440','-png',pdf,path.join(target,'page')],{encoding:'utf8',timeout:60000});
 if(rendered.status!==0)throw new Error(rendered.stderr);
}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({checkedAt:new Date().toISOString(),inputs,output},null,2));
console.log('QA render folder:',output);
