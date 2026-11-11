import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha1=/^[a-f\d]{40}$/i;
const cleanText=value=>{
  if(typeof value!=='string')return null;
  const text=value.trim();
  return text&&!/[\0\r\n]/.test(text)?text:null;
};
const defaultRun=(command,args)=>spawnSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});

function configPath(value,name,home) {
  if(value===undefined)return undefined;
  const text=cleanText(value);
  if(!text)throw new Error(`签名配置的 ${name} 必须是绝对路径。`);
  const expanded=text.startsWith('~/')?path.join(home,text.slice(2)):text;
  if(!path.isAbsolute(expanded))throw new Error(`签名配置的 ${name} 必须是绝对路径。`);
  return expanded;
}

/** Read signing metadata only. This function never reads a password or keychain. */
export function resolveSigningIdentity({root=defaultRoot,home=os.homedir(),env=process.env}={}) {
  const environment=cleanText(env.TUOTIE_CODESIGN_IDENTITY);
  if(typeof env.TUOTIE_CODESIGN_IDENTITY==='string'&&env.TUOTIE_CODESIGN_IDENTITY.trim()&&!environment)throw new Error('TUOTIE_CODESIGN_IDENTITY 包含无效字符。');
  if(environment)return {identity:environment,source:'environment'};
  const persistent=path.join(home,'Library/Application Support/Tuotie/signing/identity.json');
  if(fs.existsSync(persistent)) {
    let config;
    try {config=JSON.parse(fs.readFileSync(persistent,'utf8'));}
    catch {throw new Error(`无法读取签名配置：${persistent}`);}
    if(!config||typeof config!=='object'||Array.isArray(config)||typeof config.identitySHA1!=='string'||!sha1.test(config.identitySHA1))throw new Error('签名配置 identitySHA1 必须是完整的证书 SHA-1。');
    const metadata={identity:config.identitySHA1.toUpperCase(),source:'persistent-config',
      keychainPath:configPath(config.keychainPath,'keychainPath',home),
      certificatePath:configPath(config.certificatePath,'certificatePath',home),
      keychainPasswordFile:configPath(config.keychainPasswordFile,'keychainPasswordFile',home)};
    if(metadata.keychainPasswordFile&&!metadata.keychainPath)throw new Error('keychainPasswordFile 必须同时指定专用 keychainPath。');
    return metadata;
  }
  const legacy=path.join(root,'.local/codesign-identity');
  if(fs.existsSync(legacy)) {
    const identity=cleanText(fs.readFileSync(legacy,'utf8'));
    if(!identity)throw new Error('旧版 codesign-identity 配置为空或包含无效换行。');
    return {identity,source:'legacy-config'};
  }
  return null;
}

function commandResult(run,command,args,operation) {
  let result;
  try {result=run(command,args);}
  catch {throw new Error(`${operation}失败。`);}
  if(result?.error||result?.status!==0)throw new Error(`${operation}失败。`);
  return String(result.stdout||'')+'\n'+String(result.stderr||'');
}

function unlockKeychain(selection,run) {
  if(!selection.keychainPasswordFile)return;
  let password;
  try {
    const info=fs.statSync(selection.keychainPasswordFile);
    if(!info.isFile()||(info.mode&0o777)!==0o600||typeof process.getuid==='function'&&info.uid!==process.getuid())throw new Error();
    password=fs.readFileSync(selection.keychainPasswordFile,'utf8').replace(/\r?\n$/,'');
    if(!password||password.length>4096||/[\0\r\n]/.test(password))throw new Error();
  } catch {throw new Error('专用签名钥匙串密码文件必须属于当前用户、权限为 0600 且内容有效。');}
  // Never propagate command exceptions or output here: a process error can
  // contain its argv, including this independently generated local password.
  let result;
  try {result=run('/usr/bin/security',['unlock-keychain','-p',password,selection.keychainPath]);}
  catch {throw new Error('专用签名钥匙串解锁失败。');}
  if(result?.error||result?.status!==0)throw new Error('专用签名钥匙串解锁失败。');
}

function availableIdentity(selection,run) {
  unlockKeychain(selection,run);
  // Include identities whose leaf is locally self-signed. Actual codesign
  // signing and verification below decide whether the identity is usable.
  const output=commandResult(run,'/usr/bin/security',['find-identity','-p','codesigning',...(selection.keychainPath?[selection.keychainPath]:[])],'查询签名身份');
  const identities=[...output.matchAll(/^\s*\d+\)\s+([a-f\d]{40})\s+"([^"\r\n]+)"([^\r\n]*)$/gim)].map(match=>({sha1:match[1].toUpperCase(),name:match[2],diagnostic:match[3]}));
  const identity=identities.find(item=>sha1.test(selection.identity)?item.sha1===selection.identity.toUpperCase():item.name===selection.identity);
  if(!identity)throw new Error('配置的固定签名身份不可用或缺少私钥；请先准备并解锁该签名身份。');
  if(identity.diagnostic.includes('CSSMERR_TP_NOT_TRUSTED'))throw new Error('固定签名证书尚未获本机代码签名信任。请先完成一次显式的代码签名信任配置；构建不会自动修改信任，也不会回退到 ad-hoc。');
  if(identity.diagnostic.includes('CSSMERR_'))throw new Error('固定签名身份未通过代码签名策略检查；请先修复该身份的证书状态。');
  return {...selection,identity:identity.sha1,identitySHA1:identity.sha1};
}

function signatureInfo(app,run) {
  const output=commandResult(run,'/usr/bin/codesign',['-d','--verbose=4','-r-',app],'读取应用签名');
  const requirement=output.match(/^\s*(?:#\s*)?designated\s*=>\s*(.+)$/m)?.[1]?.trim();
  if(/^Signature=adhoc\s*$/m.test(output))return {kind:'ad-hoc',designatedRequirement:requirement||null};
  const tokens=(requirement||'').replace(/"(?:\\.|[^"\\])*"/g,'""');
  const certificateBound=/\bcertificate\s+(?:leaf|\d+)\b/.test(tokens)||/\banchor\s+(?:=\s*)?H"[a-f\d]{40}"/i.test(requirement||'')||/\banchor\s+apple\b/.test(tokens);
  if(!/^Authority=/m.test(output)||!requirement||!certificateBound||/\bcdhash\b/.test(tokens))throw new Error('应用缺少可复用的证书签名要求，拒绝用宽松要求替代。');
  return {kind:'certificate',designatedRequirement:requirement};
}

export function parseKeychainSearchList(output) {
  return output.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    let item;
    try {item=JSON.parse(line);}catch {throw new Error('无法安全解析用户钥匙串搜索列表。');}
    if(typeof item!=='string'||!path.isAbsolute(item)||/[\0\r\n]/.test(item))throw new Error('用户钥匙串搜索列表包含无效路径。');
    return item;
  });
}

function sameKeychain(first,second) {
  if(path.resolve(first)===path.resolve(second))return true;
  try {return fs.realpathSync(first)===fs.realpathSync(second);}catch {return false;}
}

function searchListLock(home) {
  const directory=path.join(home,'Library/Application Support/Tuotie/signing/search-list.lock');
  fs.mkdirSync(path.dirname(directory),{recursive:true,mode:0o700});
  try {fs.mkdirSync(directory,{mode:0o700});}
  catch(error) {
    if(error?.code==='EEXIST')throw new Error('另一个妥帖签名任务正在使用钥匙串搜索列表，请在该任务结束后重试。');
    throw new Error('无法取得钥匙串搜索列表签名锁。');
  }
  const ownerFile=path.join(directory,'owner.json'),token=randomUUID();
  let acquired;
  try {fs.writeFileSync(ownerFile,JSON.stringify({token,pid:process.pid,uid:process.getuid?.(),createdAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});acquired=fs.statSync(directory);}
  catch {fs.rmSync(directory,{recursive:true,force:true});throw new Error('无法登记钥匙串搜索列表签名锁。');}
  return ()=>{
    const current=fs.lstatSync(directory);
    if(!current.isDirectory()||current.dev!==acquired.dev||current.ino!==acquired.ino)throw new Error('钥匙串搜索列表签名锁的目录所有者已改变。');
    let owner;
    try {owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));}
    catch {throw new Error('钥匙串搜索列表签名锁的所有者记录已损坏。');}
    if(owner?.token!==token)throw new Error('钥匙串搜索列表签名锁的所有者已改变。');
    fs.rmSync(directory,{recursive:true,force:true});
  };
}

function withSigningSearchList(selection,{home=os.homedir(),run=defaultRun},sign) {
  if(!selection.keychainPath||selection.identity==='-')return sign();
  const release=searchListLock(home);
  const read=()=>parseKeychainSearchList(commandResult(run,'/usr/bin/security',['list-keychains','-d','user'],'读取用户钥匙串搜索列表'));
  const write=list=>commandResult(run,'/usr/bin/security',['list-keychains','-d','user','-s',...list],'更新临时签名钥匙串搜索列表');
  let added=false,result,signError,restoreError,releaseError;
  try {
    const original=read();
    if(!original.some(item=>sameKeychain(item,selection.keychainPath))) {
      // Mark ownership before setting so a partially failed update still gets
      // a best-effort cleanup of exactly this dedicated keychain.
      added=true;write([...original,selection.keychainPath]);
      if(!read().some(item=>sameKeychain(item,selection.keychainPath)))throw new Error('专用钥匙串未进入临时签名搜索列表。');
    }
    result=sign();
  } catch(error) {signError=error;}
  finally {
    try {
      if(added) {
        // Re-read instead of restoring a stale snapshot: external additions
        // made while codesign ran must survive our temporary membership.
        const current=read(),index=current.findIndex(item=>sameKeychain(item,selection.keychainPath));
        if(index>=0) {
          const beforeCount=current.filter(item=>sameKeychain(item,selection.keychainPath)).length;
          current.splice(index,1);write(current);
          if(read().filter(item=>sameKeychain(item,selection.keychainPath)).length>=beforeCount)throw new Error('临时签名钥匙串仍在用户搜索列表中。');
        }
      }
    } catch {restoreError=new Error('恢复临时钥匙串搜索列表失败；已拒绝后续验证和安装，请检查用户搜索列表。');}
    try {release();}catch {releaseError=new Error('释放钥匙串搜索列表签名锁失败；已拒绝安装。');}
  }
  if(restoreError)throw restoreError;
  if(releaseError)throw releaseError;
  if(signError)throw signError;
  return result;
}

/** Validate before compiling; run(command,args) may be injected by tests. */
export function preflightSigning(options={}) {
  const {root=defaultRoot,home=os.homedir(),env=process.env,run=defaultRun,packageOnly=false}=options;
  const configured=resolveSigningIdentity({root,home,env});
  if(!configured||configured.identity==='-') {
    if(!packageOnly)throw new Error('日常安装构建需要固定的证书签名身份；请配置 Tuotie/signing/identity.json 或 TUOTIE_CODESIGN_IDENTITY。未开始编译，也不会回退到 ad-hoc。');
    return {mode:'package-only',identity:'-',source:configured?.source||'review-ad-hoc',installedSignature:null,warnings:['仅生成不安装的 ad-hoc 审查包。']};
  }
  const selection=availableIdentity(configured,run);
  const installedApp=path.resolve(options.installedApp||path.join(home,'Applications/妥帖.app'));
  let installedSignature=null;
  const warnings=[];
  if(!packageOnly&&fs.existsSync(installedApp)) {
    installedSignature=signatureInfo(installedApp,run);
    if(installedSignature.kind==='certificate')commandResult(run,'/usr/bin/codesign',['--verify','--deep','--strict',installedApp],'验证已安装应用签名');
    else warnings.push('已有应用使用 ad-hoc 签名；首次迁移到固定证书后，macOS 可能要求重新登记一次辅助功能授权。后续构建将验证身份连续性。');
  }
  return {...selection,mode:packageOnly?'package-only':'install',installedApp,installedSignature,warnings};
}

/** Sign with the certificate's default DR, then enforce prior identity. */
export function signDesktopApp(options={}) {
  if(!options.app)throw new Error('缺少要签名的 --app 路径。');
  const app=path.resolve(options.app);
  if(!fs.existsSync(app))throw new Error('待签名的应用不存在。');
  const run=options.run||defaultRun;
  const selection=preflightSigning(options);
  withSigningSearchList(selection,options,()=>commandResult(run,'/usr/bin/codesign',['--force','--sign',selection.identity,...(selection.keychainPath?['--keychain',selection.keychainPath]:[]),app],'签名应用'));
  commandResult(run,'/usr/bin/codesign',['--verify','--deep','--strict',app],'验证候选应用签名');
  if(selection.identity!=='-'&&signatureInfo(app,run).kind!=='certificate')throw new Error('候选应用未得到证书签名，拒绝安装。');
  const oldRequirement=selection.installedSignature?.kind==='certificate'?selection.installedSignature.designatedRequirement:null;
  if(oldRequirement) {
    // codesign treats bare requirement text as a file path. '=' explicitly
    // selects literal source, passed as a single argv entry without a shell.
    commandResult(run,'/usr/bin/codesign',['--verify','--strict','-R','='+oldRequirement,app],'候选应用与旧版签名身份连续性检查');
  }
  return {...selection,app,verified:true,previousRequirementVerified:Boolean(oldRequirement)};
}

/** Read-only guard for every installer entry; no identity or keychain access. */
export function validateDesktopInstallation(options={}) {
  if(!options.app)throw new Error('缺少要验证的 --app 路径。');
  const app=path.resolve(options.app);
  if(!fs.existsSync(app))throw new Error('安装候选应用不存在。');
  const {home=os.homedir(),run=defaultRun}=options;
  const installedApp=path.resolve(options.installedApp||path.join(home,'Applications/妥帖.app'));
  commandResult(run,'/usr/bin/codesign',['--verify','--deep','--strict',app],'验证安装候选应用签名');
  const candidateSignature=signatureInfo(app,run);
  if(candidateSignature.kind!=='certificate')throw new Error('安装入口需要完整证书签名的应用。');
  let installedSignature=null,previousRequirementVerified=false;
  const warnings=[];
  if(fs.existsSync(installedApp)) {
    installedSignature=signatureInfo(installedApp,run);
    if(installedSignature.kind==='certificate') {
      commandResult(run,'/usr/bin/codesign',['--verify','--deep','--strict',installedApp],'验证已安装应用签名');
      commandResult(run,'/usr/bin/codesign',['--verify','--strict','-R','='+installedSignature.designatedRequirement,app],'安装候选与旧版签名身份连续性检查');
      previousRequirementVerified=true;
    } else warnings.push('已有应用使用 ad-hoc 签名；首次迁移到固定证书后，macOS 可能要求重新登记一次辅助功能授权。');
  }
  return {app,installedApp,candidateSignature,installedSignature,previousRequirementVerified,verified:true,warnings};
}

function cli(argv) {
  const [mode,...argumentsList]=argv,options={};
  if(!['preflight','sign','validate-install'].includes(mode))throw new Error('用法：desktop-signing.mjs preflight|sign|validate-install --root <prototype> [--app <candidate>] [--installed-app <path>] [--package-only]');
  for(let index=0;index<argumentsList.length;index++) {
    const flag=argumentsList[index];
    if(flag==='--package-only') {options.packageOnly=true;continue;}
    const names={'--root':'root','--app':'app','--installed-app':'installedApp'};
    if(!names[flag]||!argumentsList[index+1]||argumentsList[index+1].startsWith('--'))throw new Error('无效签名参数：'+flag);
    options[names[flag]]=argumentsList[++index];
  }
  if(mode==='validate-install'&&options.packageOnly)throw new Error('安装入口验证不能跳过证书签名检查。');
  const result=mode==='preflight'?preflightSigning(options):mode==='validate-install'?validateDesktopInstallation(options):signDesktopApp(options);
  if(mode==='preflight'||mode==='validate-install')for(const warning of result.warnings)console.log(warning);
  console.log(mode==='preflight'?`签名预检通过：${result.identity==='-'?'ad-hoc 审查包':result.identitySHA1}`:`${mode==='validate-install'?'安装候选':'应用'}签名验证通过${result.previousRequirementVerified?'，满足旧版身份要求':''}。`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {cli(process.argv.slice(2));}
  catch(error) {console.error(error instanceof Error?error.message:'签名步骤失败。');process.exitCode=1;}
}
