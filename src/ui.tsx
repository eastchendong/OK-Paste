import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{initialState,type DesktopAPI,type Action}from'./types';import type {ClipboardSnapshot} from './clipboard/types';import {ClipboardShelf} from './clipboard-shelf';import './ui.css';
declare global{interface Window{okpaste:DesktopAPI}}
function App(){
 const[s,set]=useState(initialState());const[text,setText]=useState('');const[clip,setClip]=useState<ClipboardSnapshot|null>(null);const[pasteError,setPasteError]=useState('');
 useEffect(()=>{window.okpaste.state().then(set);return window.okpaste.subscribe(set);},[]);
 useEffect(()=>{let seen=0;const stop=window.okpaste.subscribeClipboard(snapshot=>{seen=Math.max(seen,snapshot.generation);setClip(snapshot);});void window.okpaste.clipboard().then(snapshot=>{if(snapshot.generation>=seen)setClip(snapshot);});return stop;},[]);
 const act=(a:Action)=>void window.okpaste.action(a);
 const paste=(itemId:string,destinationId:string)=>{setPasteError('');void window.okpaste.paste(itemId,destinationId).catch(error=>setPasteError(error instanceof Error?error.message:String(error)));};
 const panel=['analyzing','intent','preparing','preview','committing','error','done','answer'].includes(s.stage);
 const cursor=s.context?.cursor;const objects=s.context?.scene?.objects??[];
 const send=()=>{if(!text.trim()||s.busy)return;const message=text;setText('');void window.okpaste.send(message);};
 const location=cursor?.hitRoot??cursor?.hitObject?.name??'未指定具体物体';
 const binding=cursor?.hit?`鼠标落点：${location}`:'参考当前场景与选择，落点位置待确认';
 return <main><header><div className="brand"><b>妥帖</b><span>OK Paste</span></div><span className="clip-count">{clip?`剪贴板 ${clip.items.length}`:'剪贴板'}</span><span className={'status '+(s.active?'on':'')}>{s.active?'AI 模式':'待机'}</span></header>
 <div className="context"><span className={s.connected?'dot live':'dot'}/>{s.connected?'Blender 已连接':'正在连接 Blender'}</div>
 {!s.active&&!panel?<section className="start"><h1>把参考带到<br/>需要它的地方</h1><button className="primary" onClick={()=>act('toggle')} disabled={s.busy||!s.connected}>进入 AI 模式 <kbd>⌘⇧空格</kbd></button></section>:null}
 {s.active&&!panel?<><p className="instruction">{s.message}</p>{s.error?<p role="alert" className="error">{s.error}</p>:null}{s.source?<div className="reference" draggable onDragStart={e=>{e.preventDefault();window.okpaste.drag();}}><img src={s.source} draggable={false}/><div><b>1 张参考图片</b><span>拖到 Blender 窗口</span></div><span className="grip">⠿</span></div>:<div className="empty">复制网页图片，或框选截图<br/><small>只收集 AI 模式下新复制的图片</small></div>}<div className="tools"><button onClick={()=>act('screenshot')}>截图收集</button><button onClick={()=>act('capture')}>收集剪贴板</button><button onClick={()=>act('cancel')}>退出</button></div></>:null}
 {panel?<section className="panel"><div className="source-row">{s.source?<img src={s.source}/>:null}<div><span>参考图片 ＋ 当前场景 ＋ 你的要求</span><b>{binding}</b></div></div>
 <h1>{s.stage==='intent'?s.plan?.title:s.stage==='preview'?'检查这次修改':s.stage==='done'?'已应用到 Blender':s.stage==='answer'?'本次未修改场景':s.stage==='error'?'需要处理一下':s.message}</h1>
 {s.plan&&s.stage==='intent'?<><p>{s.plan.summary}</p><div className="intent">{s.plan.actions.map((action,i)=><div key={i}>{action}</div>)}</div>{s.plan.questions.map((question,i)=><p key={i} className="question">{question}</p>)}</>:null}
 {s.previewImage||s.sceneImage?<figure><img src={s.previewImage??s.sceneImage}/><figcaption>{s.previewImage&&s.stage!=='done'?'真实临时场景 · 尚未应用到原场景':`真实 Blender 视口 · ${s.context?.scene?.objectCount??'—'} 个对象`}</figcaption></figure>:null}
 {['preview','answer'].includes(s.stage)?<><p className="review">{s.review}</p>{s.changes?<div className="diff">新增 {s.changes.added.length} · 修改 {s.changes.modified.length} · 删除 {s.changes.removed.length}{s.changes.scene?.length ? ` · 场景设置 ${s.changes.scene.length}` : ''}</div>:null}</>:null}
 {s.toolSteps?.length&&s.busy?<div className="tool-trace">{s.toolSteps.slice(-3).map((step,i)=><div key={i}>{step}</div>)}</div>:null}
 {s.error?<p role="alert" className="error">{s.error}</p>:null}
 {s.busy?<div className="working"><i/>{s.message}</div>:null}
 {['intent','preview','error','answer'].includes(s.stage)?<form className="composer" onSubmit={e=>{e.preventDefault();send();}}><textarea aria-label="补充你的要求" value={text} onChange={e=>setText(e.target.value)} placeholder="告诉妥帖你想怎么改，也可以继续追问…" rows={2} disabled={s.busy}/><button type="submit" disabled={s.busy||!text.trim()}>发送</button></form>:null}
 <div className="actions">{s.stage==='intent'?<button className="primary" disabled={s.busy||s.plan?.needsClarification} onClick={()=>act('preview')}>按这个计划生成预览</button>:null}{s.stage==='preview'?<button className="primary" disabled={s.busy} onClick={()=>act('commit')}>确认应用这些修改</button>:null}{s.stage==='done'&&s.canUndo?<button className="primary" disabled={s.busy} onClick={()=>act('undo')}>撤回本次修改</button>:null}{s.stage==='error'&&s.source?<button disabled={s.busy} onClick={()=>act('retry')}>重新理解</button>:null}<button disabled={s.stage==='committing'} onClick={()=>act('cancel')}>{s.stage==='done'?'完成':'取消'}</button></div>
 <p className="footnote">{s.stage==='done'?'已退出 AI 模式。':'确认后才应用到原场景。'} 图片是参考，现有模型和程序化建模能力由工具提供。</p></section>:null}
 {!panel?<ClipboardShelf snapshot={clip} pasteError={pasteError} onPaste={paste}/>:null}
 {!s.shortcut?<small className="error">快捷键不可用，可使用面板按钮。</small>:null}
 </main>
}
createRoot(document.getElementById('root')!).render(<App/>);
