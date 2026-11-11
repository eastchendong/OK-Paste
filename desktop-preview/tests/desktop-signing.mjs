import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test,afterEach} from 'node:test';
import {fileURLToPath} from 'node:url';
import {resolveSigningIdentity,preflightSigning,signDesktopApp,parseKeychainSearchList,validateDesktopInstallation} from '../../scripts/desktop-signing.mjs';

const SHA='A'.repeat(40),OTHER='B'.repeat(40),roots=[];
const certificateRequirement=`identifier "cn.tuotie.desktop-preview" and certificate leaf = H"${SHA}"`;
afterEach(()=>roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
function setup() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-signing-'));roots.push(directory);
  const home=path.join(directory,'home'),root=path.join(directory,'project');
  fs.mkdirSync(path.join(root,'.local'),{recursive:true});fs.mkdirSync(home);
  const configFile=path.join(home,'Library/Application Support/Tuotie/signing/identity.json');
  const installedApp=path.join(home,'Applications/妥帖.app'),app=path.join(directory,'Candidate.app');
  fs.mkdirSync(app);
  const options={home,root,env:{},installedApp};
  return {directory,home,root,configFile,installedApp,app,options,config(value) {fs.mkdirSync(path.dirname(configFile),{recursive:true});fs.writeFileSync(configFile,JSON.stringify(value));}};
}
function certificateInfo(requirement=certificateRequirement) {
  return `Signature size=1234\nAuthority=Tuotie Local Code Signing\ndesignated => ${requirement}\n`;
}
function runner({identities=`  1) ${SHA} "Tuotie Local Code Signing"\n`,installed=certificateInfo(),candidate=certificateInfo(),rejectRequirement=false,rejectCandidateVerify=false,unlockError=null,initialSearchList=[],onSign=null,rejectSign=false,rejectRestore=false}={}) {
  const calls=[];
  let searchList=[...initialSearchList],listWrites=0;
  const run=(command,args)=>{
    calls.push({command,args:[...args]});
    const ok=stdout=>({status:0,stdout:stdout||'',stderr:''});
    if(command==='/usr/bin/security') {
      if(args[0]==='unlock-keychain') {if(unlockError)throw unlockError;return ok();}
      if(args[0]==='find-identity')return ok(identities);
      if(args[0]==='list-keychains') {
        if(args.includes('-s')) {
          listWrites++;
          if(rejectRestore&&listWrites>1)return {status:1,stderr:'fixture restore rejected'};
          searchList=args.slice(args.indexOf('-s')+1);return ok();
        }
        return ok(searchList.map(item=>'    '+JSON.stringify(item)).join('\n'));
      }
    }
    if(command==='/usr/bin/codesign') {
      if(args[0]==='-d')return ok(args.at(-1).endsWith('Candidate.app')?candidate:installed);
      if(args[0]==='--force') {
        onSign?.({searchList,calls});
        return rejectSign?{status:1,stderr:'fixture signing rejected'}:ok();
      }
      if(args[0]==='--verify') {
        if(args.includes('-R')&&rejectRequirement||rejectCandidateVerify&&args.at(-1).endsWith('Candidate.app')&&!args.includes('-R'))return {status:1,stderr:'fixture signature rejected'};
        return ok();
      }
    }
    throw new Error('Unexpected command in signing test');
  };
  return {run,calls,get searchList(){return [...searchList];}};
}

test('identity priority is environment, persistent metadata, then compatible newline-terminated legacy config',()=>{
  const s=setup();s.config({identitySHA1:SHA,keychainPath:path.join(s.home,'Private chain.keychain-db')});
  fs.writeFileSync(path.join(s.root,'.local/codesign-identity'),OTHER+'\n');
  assert.equal(resolveSigningIdentity({...s.options,env:{TUOTIE_CODESIGN_IDENTITY:'Explicit certificate'}}).identity,'Explicit certificate');
  assert.equal(resolveSigningIdentity(s.options).identity,SHA);
  fs.rmSync(s.configFile);
  const stub=runner({identities:` 1) ${OTHER} "Legacy certificate"\n`});
  assert.equal(preflightSigning({...s.options,run:stub.run}).identity,OTHER);
  assert.equal(stub.calls[0].args.includes('-v'),false);
});

test('installation without a fixed identity fails before any signing or keychain command',()=>{
  const s=setup(),stub=runner();
  fs.mkdirSync(s.installedApp,{recursive:true});
  assert.throws(()=>preflightSigning({...s.options,run:stub.run}),/固定的证书签名身份/);
  assert.throws(()=>preflightSigning({...s.options,env:{TUOTIE_CODESIGN_IDENTITY:'-'},run:stub.run}),/不会回退到 ad-hoc/);
  assert.equal(stub.calls.length,0);
});

test('explicit package-only can sign and verify an ad-hoc review candidate without inspecting the installed app',()=>{
  const s=setup(),stub=runner();fs.mkdirSync(s.installedApp,{recursive:true});
  const result=signDesktopApp({...s.options,app:s.app,packageOnly:true,run:stub.run});
  assert.equal(result.identity,'-');assert.equal(result.mode,'package-only');assert.equal(result.verified,true);
  assert.deepEqual(stub.calls.map(call=>call.args),[
    ['--force','--sign','-',s.app],['--verify','--deep','--strict',s.app],
  ]);
});

test('private-keychain signing uses SHA-1 and verifies the candidate against the existing certificate DR',()=>{
  const s=setup(),keychain=path.join(s.home,'Tuotie private chain.keychain-db');
  s.config({identitySHA1:SHA,keychainPath:keychain});fs.mkdirSync(s.installedApp,{recursive:true});
  const stub=runner(),result=signDesktopApp({...s.options,app:s.app,run:stub.run});
  assert.equal(result.previousRequirementVerified,true);
  const signing=stub.calls.find(call=>call.args[0]==='--force');
  assert.deepEqual(signing.args,['--force','--sign',SHA,'--keychain',keychain,s.app]);
  assert.equal(signing.args.some(arg=>arg==='-r'||arg.startsWith('--requirements')),false);
  assert.deepEqual(stub.calls.at(-1).args,['--verify','--strict','-R','='+certificateRequirement,s.app]);
});

test('default self-signed anchor-hash requirements are retained as certificate-bound identity',()=>{
  const s=setup();s.config({identitySHA1:SHA});fs.mkdirSync(s.installedApp,{recursive:true});
  const requirement=`identifier "cn.tuotie.desktop-preview" and anchor H"${SHA}"`;
  const stub=runner({installed:certificateInfo(requirement),candidate:certificateInfo(requirement)});
  assert.equal(signDesktopApp({...s.options,app:s.app,run:stub.run}).previousRequirementVerified,true);
  assert.equal(stub.calls.at(-1).args[3],'='+requirement);
});

test('comment-prefixed implicit default DR output is verified without replacing it',()=>{
  const s=setup();s.config({identitySHA1:SHA});fs.mkdirSync(s.installedApp,{recursive:true});
  const info=certificateInfo().replace('designated =>','# designated =>');
  const stub=runner({installed:info,candidate:info});
  assert.equal(signDesktopApp({...s.options,app:s.app,run:stub.run}).previousRequirementVerified,true);
  assert.equal(stub.calls.at(-1).args[3],'='+certificateRequirement);
});

test('an existing ad-hoc app only produces a first-migration notice and never pins the old cdhash',()=>{
  const s=setup();s.config({identitySHA1:SHA});fs.mkdirSync(s.installedApp,{recursive:true});
  const stub=runner({installed:`Signature=adhoc\n# designated => cdhash H"${OTHER}"\n`});
  const result=signDesktopApp({...s.options,app:s.app,run:stub.run});
  assert.equal(result.previousRequirementVerified,false);assert.match(result.warnings[0],/首次迁移/);
  assert.equal(stub.calls.some(call=>call.args.includes('-R')),false);
});

test('a candidate that fails the old DR is rejected after signing and integrity validation',()=>{
  const s=setup();s.config({identitySHA1:SHA});fs.mkdirSync(s.installedApp,{recursive:true});
  const stub=runner({rejectRequirement:true});
  assert.throws(()=>signDesktopApp({...s.options,app:s.app,run:stub.run}),/身份连续性检查失败/);
  assert.ok(stub.calls.some(call=>call.args[0]==='--force'));
  assert.equal(stub.calls.at(-1).args[3],'='+certificateRequirement);
});

test('identifier-only or cdhash-bound certificate DRs never get replaced with loose signing requirements',()=>{
  for(const requirement of ['identifier "cn.certificate.desktop"',`identifier "cn.tuotie.desktop-preview" and certificate leaf = H"${SHA}" and cdhash H"${OTHER}"`]) {
    const s=setup();s.config({identitySHA1:SHA});fs.mkdirSync(s.installedApp,{recursive:true});
    const stub=runner({installed:certificateInfo(requirement)});
    assert.throws(()=>signDesktopApp({...s.options,app:s.app,run:stub.run}),/拒绝用宽松要求替代/);
    assert.equal(stub.calls.some(call=>call.args[0]==='--force'),false);
  }
});

test('only the selected identity diagnostic can block preflight, and trust is never changed by a build',()=>{
  const s=setup();s.config({identitySHA1:SHA});
  const unrelated=runner({identities:`1) ${OTHER} "Other" (CSSMERR_TP_NOT_TRUSTED)\n2) ${SHA} "Tuotie Local Code Signing"\n`});
  assert.equal(preflightSigning({...s.options,run:unrelated.run}).identity,SHA);
  const selected=runner({identities:`1) ${SHA} "Tuotie Local Code Signing" (CSSMERR_TP_NOT_TRUSTED)\n`});
  assert.throws(()=>preflightSigning({...s.options,run:selected.run}),/显式的代码签名信任配置/);
  assert.deepEqual(selected.calls.map(call=>call.args[0]),['find-identity']);
});

test('dedicated password files must be owner-only and unlock only their configured keychain',()=>{
  const s=setup(),keychain=path.join(s.home,'Private.keychain-db'),passwordFile=path.join(s.home,'Private.password');
  fs.writeFileSync(passwordFile,'independent-fixture-secret\n',{mode:0o600});
  s.config({identitySHA1:SHA,keychainPath:keychain,keychainPasswordFile:passwordFile});
  const stub=runner();preflightSigning({...s.options,run:stub.run});
  assert.deepEqual(stub.calls[0].args,['unlock-keychain','-p','independent-fixture-secret',keychain]);
  assert.deepEqual(stub.calls[1].args,['find-identity','-p','codesigning',keychain]);
  fs.chmodSync(passwordFile,0o644);
  const invalid=runner();assert.throws(()=>preflightSigning({...s.options,run:invalid.run}),/0600/);
  assert.equal(invalid.calls.length,0);
});

test('unlock failures never expose a stored keychain password through command errors',()=>{
  const s=setup(),password='private-test-secret',passwordFile=path.join(s.home,'Private.password');
  fs.writeFileSync(passwordFile,password,{mode:0o600});
  s.config({identitySHA1:SHA,keychainPath:path.join(s.home,'Private.keychain-db'),keychainPasswordFile:passwordFile});
  const stub=runner({unlockError:Object.assign(new Error('security -p '+password),{spawnargs:['-p',password]})});
  let captured;
  try {preflightSigning({...s.options,run:stub.run});}catch(error){captured=error;}
  assert.equal(captured.message,'专用签名钥匙串解锁失败。');assert.equal(String(captured).includes(password),false);
  assert.equal('cause'in captured,false);
});

test('invalid configured identity metadata fails closed even for review packages',()=>{
  const s=setup(),stub=runner();s.config({identitySHA1:'not-a-fingerprint'});
  assert.throws(()=>preflightSigning({...s.options,packageOnly:true,run:stub.run}),/完整的证书 SHA-1/);
  assert.equal(stub.calls.length,0);
});

test('daily build fails its preflight before UI preparation or compiler invocation',()=>{
  const s=setup(),desktop=path.join(s.root,'desktop-preview'),scripts=path.join(s.root,'scripts'),bin=path.join(s.directory,'bin');
  for(const directory of [desktop,scripts,bin])fs.mkdirSync(directory,{recursive:true});
  fs.copyFileSync(fileURLToPath(new URL('../build.sh',import.meta.url)),path.join(desktop,'build.sh'));
  fs.copyFileSync(fileURLToPath(new URL('../../scripts/desktop-signing.mjs',import.meta.url)),path.join(scripts,'desktop-signing.mjs'));
  const compilerMarker=path.join(s.directory,'compiler-called');
  fs.writeFileSync(path.join(bin,'xcrun'),`#!/bin/sh\ntouch '${compilerMarker}'\nexit 99\n`,{mode:0o755});
  const result=spawnSync('/bin/zsh',[path.join(desktop,'build.sh')],{encoding:'utf8',env:{...process.env,HOME:s.home,TUOTIE_CODESIGN_IDENTITY:'',PATH:path.dirname(process.execPath)+':'+bin+':/usr/bin:/bin'}});
  assert.equal(result.status,1);assert.match(result.stderr,/固定的证书签名身份/);
  assert.equal(fs.existsSync(compilerMarker),false);assert.equal(fs.existsSync(path.join(desktop,'build')),false);
});

const lockPath=home=>path.join(home,'Library/Application Support/Tuotie/signing/search-list.lock');
test('search-list parser preserves quoted absolute paths as data and rejects shell-style or relative input',()=>{
  const paths=['/Users/example/Library/Keychains/with space.keychain-db','/Users/example/Library/Keychains/with "quote" and \\ slash.keychain-db','/Users/example/$(touch untouched).keychain'];
  assert.deepEqual(parseKeychainSearchList(paths.map(item=>'    '+JSON.stringify(item)).join('\n')),paths);
  assert.deepEqual(parseKeychainSearchList(' \n'),[]);
  for(const input of ['/Users/example/unsafe.keychain','"relative.keychain"','"/Users/example/bad\\npath.keychain"'])assert.throws(()=>parseKeychainSearchList(input),/搜索列表/);
});

test('dedicated keychain is visible only during signing and the owner lock is released afterward',()=>{
  const s=setup(),keychain=path.join(s.home,'Private "quoted" chain.keychain-db'),login=path.join(s.home,'login.keychain-db');
  s.config({identitySHA1:SHA,keychainPath:keychain});
  let signingSeen=false;
  const stub=runner({initialSearchList:[login],onSign:({searchList})=>{
    signingSeen=true;assert.deepEqual(searchList,[login,keychain]);
    const owner=JSON.parse(fs.readFileSync(path.join(lockPath(s.home),'owner.json'),'utf8'));
    assert.equal(owner.pid,process.pid);assert.equal(owner.uid,process.getuid());
    assert.equal(fs.statSync(lockPath(s.home)).mode&0o777,0o700);
  }});
  signDesktopApp({...s.options,app:s.app,run:stub.run});
  assert.equal(signingSeen,true);assert.deepEqual(stub.searchList,[login]);
  assert.equal(fs.existsSync(lockPath(s.home)),false);
  const mutations=stub.calls.filter(call=>call.args[0]==='list-keychains'&&call.args.includes('-s'));
  assert.deepEqual(mutations.map(call=>call.args),[['list-keychains','-d','user','-s',login,keychain],['list-keychains','-d','user','-s',login]]);
});

test('failed codesign still removes only the temporarily added keychain and stops verification',()=>{
  const s=setup(),keychain=path.join(s.home,'Private.keychain-db'),login=path.join(s.home,'login.keychain-db');
  s.config({identitySHA1:SHA,keychainPath:keychain});
  const stub=runner({initialSearchList:[login],rejectSign:true});
  assert.throws(()=>signDesktopApp({...s.options,app:s.app,run:stub.run}),/签名应用失败/);
  assert.deepEqual(stub.searchList,[login]);assert.equal(fs.existsSync(lockPath(s.home)),false);
  assert.equal(stub.calls.some(call=>call.args[0]==='--verify'),false);
});

test('an already listed dedicated keychain is not duplicated or removed',()=>{
  const s=setup(),keychain=path.join(s.home,'Private.keychain-db'),login=path.join(s.home,'login.keychain-db');
  s.config({identitySHA1:SHA,keychainPath:keychain});
  const stub=runner({initialSearchList:[login,keychain]});
  signDesktopApp({...s.options,app:s.app,run:stub.run});
  assert.deepEqual(stub.searchList,[login,keychain]);
  assert.equal(stub.calls.some(call=>call.args[0]==='list-keychains'&&call.args.includes('-s')),false);
  assert.equal(fs.existsSync(lockPath(s.home)),false);
});

test('cleanup merges the latest list and preserves a concurrent external addition',()=>{
  const s=setup(),keychain=path.join(s.home,'Private.keychain-db'),login=path.join(s.home,'login.keychain-db'),external=path.join(s.home,'External.keychain-db');
  s.config({identitySHA1:SHA,keychainPath:keychain});
  const stub=runner({initialSearchList:[login],onSign:({searchList})=>searchList.push(external)});
  signDesktopApp({...s.options,app:s.app,run:stub.run});
  assert.deepEqual(stub.searchList,[login,external]);
  assert.deepEqual(stub.calls.filter(call=>call.args[0]==='list-keychains'&&call.args.includes('-s')).at(-1).args,['list-keychains','-d','user','-s',login,external]);
});

test('search-list restoration failure rejects the candidate and releases the lock',()=>{
  const s=setup(),keychain=path.join(s.home,'Private.keychain-db'),login=path.join(s.home,'login.keychain-db');
  s.config({identitySHA1:SHA,keychainPath:keychain});
  const stub=runner({initialSearchList:[login],rejectRestore:true});
  assert.throws(()=>signDesktopApp({...s.options,app:s.app,run:stub.run}),/恢复临时钥匙串搜索列表失败/);
  assert.deepEqual(stub.searchList,[login,keychain]);assert.equal(fs.existsSync(lockPath(s.home)),false);
  assert.equal(stub.calls.some(call=>call.args[0]==='--verify'),false);
});

test('a concurrent tool signing attempt fails fast without disturbing its owner lock or current search list',()=>{
  const s=setup(),keychain=path.join(s.home,'Private.keychain-db'),login=path.join(s.home,'login.keychain-db');
  s.config({identitySHA1:SHA,keychainPath:keychain});
  let nestedSeen=false;
  const stub=runner({initialSearchList:[login],onSign:({searchList})=>{
    nestedSeen=true;
    assert.throws(()=>signDesktopApp({...s.options,app:s.app,run:stub.run}),/另一个妥帖签名任务/);
    assert.deepEqual(searchList,[login,keychain]);assert.equal(fs.existsSync(lockPath(s.home)),true);
  }});
  signDesktopApp({...s.options,app:s.app,run:stub.run});
  assert.equal(nestedSeen,true);assert.deepEqual(stub.searchList,[login]);
  assert.equal(stub.calls.filter(call=>call.args[0]==='--force').length,1);
  assert.equal(fs.existsSync(lockPath(s.home)),false);
});

test('ordinary identities and explicit ad-hoc reviews never query or mutate the user search list',()=>{
  const s=setup();s.config({identitySHA1:SHA});
  for(const options of [{}, {env:{TUOTIE_CODESIGN_IDENTITY:'-'},packageOnly:true}]) {
    const stub=runner();signDesktopApp({...s.options,...options,app:s.app,run:stub.run});
    assert.equal(stub.calls.some(call=>call.args[0]==='list-keychains'),false);
    assert.equal(fs.existsSync(lockPath(s.home)),false);
  }
});

test('changed or corrupted lock ownership is preserved and rejects installation after search-list restoration',()=>{
  for(const changedOwner of [JSON.stringify({token:'another-owner',pid:1}),'{damaged-owner-json']) {
    const s=setup(),keychain=path.join(s.home,'Private.keychain-db'),login=path.join(s.home,'login.keychain-db');
    s.config({identitySHA1:SHA,keychainPath:keychain});
    const ownerFile=path.join(lockPath(s.home),'owner.json');
    const stub=runner({initialSearchList:[login],onSign:()=>fs.writeFileSync(ownerFile,changedOwner)});
    assert.throws(()=>signDesktopApp({...s.options,app:s.app,run:stub.run}),/释放钥匙串搜索列表签名锁失败/);
    assert.deepEqual(stub.searchList,[login]);
    assert.equal(fs.existsSync(lockPath(s.home)),true);
    assert.equal(fs.readFileSync(ownerFile,'utf8'),changedOwner);
    assert.equal(stub.calls.some(call=>call.args[0]==='--verify'),false);
  }
});

test('installation validator accepts a compatible certificate candidate without signing or reading private identity configuration',()=>{
  const s=setup();s.config({identitySHA1:'invalid-private-config-not-used'});fs.mkdirSync(s.installedApp,{recursive:true});
  const stub=runner(),result=validateDesktopInstallation({...s.options,app:s.app,run:stub.run});
  assert.equal(result.verified,true);assert.equal(result.previousRequirementVerified,true);
  assert.equal(stub.calls.every(call=>call.command==='/usr/bin/codesign'),true);
  assert.equal(stub.calls.some(call=>call.args[0]==='--force'),false);
  assert.deepEqual(stub.calls.at(-1).args,['--verify','--strict','-R','='+certificateRequirement,s.app]);
});

test('installation validator rejects ad-hoc or integrity-invalid candidates before inspecting the installed app',()=>{
  const s=setup();fs.mkdirSync(s.installedApp,{recursive:true});
  const adhoc=runner({candidate:`Signature=adhoc\n# designated => cdhash H"${OTHER}"\n`});
  assert.throws(()=>validateDesktopInstallation({...s.options,app:s.app,run:adhoc.run}),/完整证书签名/);
  assert.equal(adhoc.calls.some(call=>call.args.at(-1)===s.installedApp),false);
  const invalid=runner({rejectCandidateVerify:true});
  assert.throws(()=>validateDesktopInstallation({...s.options,app:s.app,run:invalid.run}),/验证安装候选应用签名失败/);
  assert.equal(invalid.calls.length,1);
});

test('installation validator rejects a valid certificate candidate that breaks the old stable DR',()=>{
  const s=setup();fs.mkdirSync(s.installedApp,{recursive:true});
  const stub=runner({rejectRequirement:true});
  assert.throws(()=>validateDesktopInstallation({...s.options,app:s.app,run:stub.run}),/安装候选与旧版签名身份连续性检查失败/);
  assert.equal(stub.calls.some(call=>call.args[0]==='--force'),false);
});

test('installation validator permits one-time migration from old ad-hoc to a certificate candidate',()=>{
  const s=setup();fs.mkdirSync(s.installedApp,{recursive:true});
  const stub=runner({installed:`Signature=adhoc\n# designated => cdhash H"${OTHER}"\n`});
  const result=validateDesktopInstallation({...s.options,app:s.app,run:stub.run});
  assert.equal(result.verified,true);assert.equal(result.previousRequirementVerified,false);
  assert.match(result.warnings[0],/首次迁移/);assert.equal(stub.calls.some(call=>call.args.includes('-R')),false);
});

function prepareFixture() {
  const s=setup(),scripts=path.join(s.root,'scripts'),packageDirectory=path.join(s.root,'node_modules/esbuild'),marker=path.join(s.directory,'sync-called');
  fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(packageDirectory,{recursive:true});
  for(const name of ['prepare-desktop-runtime.mjs','desktop-signing.mjs'])fs.copyFileSync(fileURLToPath(new URL('../../scripts/'+name,import.meta.url)),path.join(scripts,name));
  fs.writeFileSync(path.join(scripts,'sync-component-library.mjs'),`import fs from 'node:fs';export function syncComponentLibrary(){fs.writeFileSync(${JSON.stringify(marker)},'sync');throw new Error('RESOURCE_SYNC_REACHED');}`);
  fs.writeFileSync(path.join(packageDirectory,'package.json'),JSON.stringify({name:'esbuild',type:'module',exports:'./index.mjs'}));
  fs.writeFileSync(path.join(packageDirectory,'index.mjs'),`export async function build(){throw new Error('UNEXPECTED_BUILD');}`);
  const execute=args=>spawnSync(process.execPath,[path.join(scripts,'prepare-desktop-runtime.mjs'),...args],{encoding:'utf8',env:{...process.env,HOME:s.home,TUOTIE_CODESIGN_IDENTITY:''}});
  return {...s,marker,execute};
}

test('direct prepare installer validates an invalid candidate before UI or temporary-home runtime mutations',()=>{
  const s=prepareFixture(),result=s.execute([s.app]);
  // Only read-only codesign verification of this empty temporary fixture app
  // runs; all potential runtime writes are redirected to an isolated HOME.
  assert.equal(result.status,1);assert.match(result.stderr,/验证安装候选应用签名失败/);
  assert.equal(fs.existsSync(s.marker),false);
  assert.equal(fs.existsSync(path.join(s.home,'Library/Application Support/Tuotie/runtime')),false);
  assert.equal(fs.existsSync(path.join(s.home,'Applications/妥帖.app')),false);
});

test('resource-only preparation bypasses install validation and reaches the existing UI sync path',()=>{
  const s=prepareFixture(),result=s.execute([]);
  assert.equal(result.status,1);assert.match(result.stderr,/RESOURCE_SYNC_REACHED/);
  assert.equal(fs.readFileSync(s.marker,'utf8'),'sync');
  assert.equal(fs.existsSync(path.join(s.home,'Library/Application Support/Tuotie/runtime')),false);
});
