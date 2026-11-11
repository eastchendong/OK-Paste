// Compare document content and formatting, not XML attribute order, package
// timestamps or editor bookkeeping. Word exports these differently on each read.
export function wordContentVersion(xml,Parser=DOMParser) {
  const document=new Parser().parseFromString(xml,'application/xml');
  if(document.getElementsByTagName('parsererror').length)throw new Error('Word 返回的文档版本无效');
  const pkg='http://schemas.microsoft.com/office/2006/xmlPackage';
  const isBookkeeping=node=>/wordprocessingml|office\/word/.test(node.namespaceURI||'')&&['proofErr','proofState','rsids','zoom','view','docId'].includes(node.localName);
  function serialize(node) {
    if(node.nodeType===3||node.nodeType===4) {
      if(node.parentNode?.localName==='binaryData')return node.nodeValue.replace(/\s/g,'');
      return node.nodeValue.trim()||['t','instrText','delText'].includes(node.parentNode?.localName)?node.nodeValue:'';
    }
    if(node.nodeType!==1||isBookkeeping(node))return null;
    const attributes=[...node.attributes].filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/'&&!(/^rsid|^(paraId|textId)$/.test(a.localName)&&/wordprocessingml|office\/word/.test(a.namespaceURI||''))&&!(a.localName==='Ignorable'&&a.namespaceURI?.includes('markup-compatibility')))
      .map(a=>[a.namespaceURI||'',a.localName,a.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return [node.namespaceURI||'',node.localName,attributes,[...node.childNodes].map(serialize).filter(value=>value!==null&&value!=='')];
  }
  const parts=[...document.getElementsByTagNameNS(pkg,'part')];
  if(!parts.length)return JSON.stringify(serialize(document.documentElement));
  return JSON.stringify(parts.filter(part=>!part.getAttributeNS(pkg,'name')?.startsWith('/docProps/')).map(part=>[part.getAttributeNS(pkg,'name'),serialize(part)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}

/** Actual embedded images read back from Word, used only as local positioning templates. */
export function wordImageLocators(xml,Parser=DOMParser){
 try{
  const doc=new Parser().parseFromString(xml,'application/xml'),pkg='http://schemas.microsoft.com/office/2006/xmlPackage';
  if(doc.getElementsByTagName('parsererror').length)return [];
  const elements=(root,name)=>[...root.getElementsByTagName('*')].filter(node=>node.namespaceURI===pkg&&node.localName===name);
  return elements(doc,'part').filter(part=>/^image\/(png|jpeg)$/.test(part.getAttributeNS(pkg,'contentType')||part.getAttribute('pkg:contentType')||'')).map(part=>{
   const image=elements(part,'binaryData')[0]?.textContent?.replace(/\s/g,'')||'';
   return {kind:'rendered-surface',scope:'document',image,regions:[{x:0,y:0,width:1,height:1}]};
  }).filter(item=>item.image.length>0&&item.image.length<8000000);
 }catch{return [];}
}

/* Office.js owns all document reads and edits. Transport and UI do not know Word ranges. */
export function createWordAdapter(Word) {
  const anchors=new Map();
  const requireAnchor=id=>{const value=anchors.get(id);if(!value)throw new Error('插入位置已失效，请回到 Word 按 ⌥⌘V');return value;};
  async function snapshot(context,entry) {
    const sync=async stage=>{try{await context.sync();}catch(error){throw new Error(`${stage} · ${error.message} · ${error.debugInfo?.errorLocation||''}`);}};
    const body=context.document.body,paragraphs=body.paragraphs;
    body.load('text');paragraphs.load('items/text,items/style');
    const xml=body.getOoxml();await sync('读取主文档正文');
    const before=body.getRange('Start').expandTo(entry.range),after=entry.range.expandTo(body.getRange('End'));
    before.load('text');after.load('text');
    await sync('读取插入位置前后');
    // The exact prefix/suffix come from the saved Range. Map a paragraph index
    // only when the text sequence agrees; tables or other structures may differ.
    const normalize=text=>text.replace(/\r\n|\n/g,'\r').replace(/\r$/,'');
    const data=paragraphs.items.map(p=>({text:p.text,style:p.style}));
    const sequential=normalize(data.map(p=>p.text).join('\r'))===normalize(body.text);
    const paragraphIndex=sequential?Math.min(data.length-1,(before.text.match(/\r/g)||[]).length):-1;
    let section='';
    for(const paragraph of data.slice(0,paragraphIndex+1)){
      const title=paragraph.text.trim();
      const numberedTitle=/^(?:[一二三四五六七八九十百]+、|第[一二三四五六七八九十百0-9]+[章节])[^。！？；]{1,36}$/u.test(title);
      if(/heading|标题/i.test(paragraph.style)||numberedTitle)section=title;
    }
    return {protocolVersion:2,anchorId:entry.id,body:body.text,bodyOoxml:xml.value,paragraphs:paragraphs.items.map(p=>({text:p.text,style:p.style})),location:{paragraphIndex,section,before:before.text.slice(-3000),after:after.text.slice(0,3000),paragraph:paragraphIndex>=0?data[paragraphIndex].text:''}};
  }
  return async function execute(method,args={}) {
    if(method==='capture')return Word.run(async context=>{
      const sync=async stage=>{try{await context.sync();}catch(error){throw new Error(`${stage} · ${error.message} · ${error.debugInfo?.errorLocation||''}`);}};
      const selection=context.document.getSelection();selection.load('isEmpty');await sync('读取文字光标');
      if(!selection.isEmpty)throw new Error('请先点击正文，出现文字插入光标后再按 ⌥⌘V');
      const range=selection.getRange('Start');range.track();await sync('保存插入范围');
      const entry={id:crypto.randomUUID(),range,inserted:null,versions:[],uncertain:false};
      try{const result=await snapshot(context,entry);anchors.set(entry.id,entry);return result;}
      catch(error){try{range.untrack();await context.sync();}catch{}throw error;}
    });
    let mutationStarted=false;
    try{
    const entry=requireAnchor(args.anchorId);
    return await Word.run(entry.range,async context=>{
      if(method==='read')return snapshot(context,entry);
      if(method==='release'){

        entry.range.untrack();entry.inserted?.untrack();await context.sync();anchors.delete(entry.id);return {ok:true};
      }
      if(method==='insert'){
        if(entry.uncertain)throw new Error('上次 Word 写入结果未确认，请检查文稿后重新建立任务');
        if(args.expectedRevision!==entry.versions.length)throw new Error('版本已改变，请勿重复应用');
        if(entry.versions.length>=20)throw new Error('本次任务最多保留 20 个版本');
        if(typeof args.text!=='string'||!args.text.trim()||args.text.length>100000)throw new Error('待插入文字无效');
        if(args.ooxml!==undefined&&(typeof args.ooxml!=='string'||!args.ooxml.trim()||args.ooxml.length>18*1024*1024))throw new Error('待插入图文无效或过大');
        const current=context.document.body.getOoxml();await context.sync();
        if(wordContentVersion(current.value)!==wordContentVersion(args.expectedOoxml))throw new Error('文档内容或格式已改变，请取消当前预览，再回到 Word 按 ⌥⌘V');
        if(entry.inserted){
          const owned=entry.inserted.getOoxml();await context.sync();
          if(wordContentVersion(owned.value)!==wordContentVersion(entry.versions.at(-1)))throw new Error('插入内容已被继续编辑，不能覆盖你的修改；请重新建立任务');
        }
        if(args.ooxml){
          const start=entry.inserted?entry.inserted.getRange('Start'):entry.range;
          const prefix=context.document.body.getRange('Start').expandTo(start);prefix.load('text');await context.sync();
          if(prefix.text&&!/[\r\n]$/.test(prefix.text))throw new Error('图文插入位置已不在段首，请重新放置光标，避免改变原段落格式');
        }
        // Once a write is sent to Word it is never retried automatically.
        // One replacement command, never delete the previous result first.
        const previous=entry.inserted,target=previous||entry.range,location=previous?'Replace':'Before';
        let previousText='';if(previous){previous.load('text');await context.sync();previousText=previous.text;}
        mutationStarted=true;entry.uncertain=true;
        const inserted=args.ooxml?target.insertOoxml(args.ooxml,location):target.insertText(args.text.replace(/\r\n|\n/g,'\r'),location);
        inserted.track();entry.inserted=inserted;await context.sync();
        inserted.load('text');const xml=inserted.getOoxml();await context.sync();
        // Read back Word's actual representation, including its formatting and images.
        wordContentVersion(xml.value);
        previous?.untrack();await context.sync();
        entry.versions.push(xml.value);entry.uncertain=false;

        const next=inserted.text||'';let start=0,end=next.length,oldEnd=previousText.length;
        while(start<end&&start<oldEnd&&next[start]===previousText[start])start++;
        while(end>start&&oldEnd>start&&next[end-1]===previousText[oldEnd-1]){end--;oldEnd--;}
        // Keep UTF-16 surrogate pairs together when only one emoji changes.
        if(start>0&&/[\uDC00-\uDFFF]/.test(next[start]||''))start--;
        if(end<next.length&&/[\uDC00-\uDFFF]/.test(next[end]||''))end++;
        const images=args.ooxml?wordImageLocators(xml.value):[];
        const locators=end>start&&next.slice(start,end).trim()?(images.length?next.slice(start,end).split(/[\r\n\uFFFC]+/).filter(text=>text.trim()).map(text=>({kind:'text',text})):[{kind:'text',text:next.slice(start,end),before:next.slice(0,start),after:next.slice(end)}]):[];
        // Images carry actual host-exported bytes. Never use the model's alt text as geometry.
        const previousImages=new Set(wordImageLocators(entry.versions.at(-2)||'<empty/>').map(item=>item.image));
        locators.push(...images.filter(item=>!previousImages.has(item.image)));
        return {ok:true,inserted:true,revision:entry.versions.length,resultReceipt:{documentId:entry.id,revision:entry.versions.length,locators,reason:'当前图文范围未提供可定位文字'}};
      }
      if(method==='undo'){
        if(entry.uncertain)throw new Error('上次 Word 写入结果未确认，请先检查文稿');
        if(args.expectedRevision!==entry.versions.length)throw new Error('版本已改变，请勿重复撤回');
        if(!entry.inserted)throw new Error('没有本次插入可撤回');
        const xml=entry.inserted.getOoxml();await context.sync();
        if(wordContentVersion(xml.value)!==wordContentVersion(entry.versions.at(-1)))throw new Error('插入内容已被继续编辑，无法安全撤回；请使用 Word 的撤销');
        mutationStarted=true;entry.uncertain=true;
        const previous=entry.inserted;

        if(entry.versions.length>1){
          entry.inserted=previous.insertOoxml(entry.versions.at(-2),'Replace');entry.inserted.track();await context.sync();
          const restored=entry.inserted.getOoxml();await context.sync();
          // Store the host-normalized range for the next conflict check.
          wordContentVersion(restored.value);entry.versions[entry.versions.length-2]=restored.value;
        }else{previous.delete();await context.sync();entry.inserted=null;}
        previous.untrack();await context.sync();entry.versions.pop();entry.uncertain=false;

        return {ok:true,revision:entry.versions.length};
      }
      throw new Error('没有这个 Word 操作');
    });
    }catch(error){error.mutationStarted=mutationStarted;throw error;}
  };
}
