// Public Office APIs only: frozen slide/shape IDs, file snapshots and image coercion.
export function createPowerPointAdapter(PowerPoint, Office) {
  const anchors = new Map();
  const fontProperties=['name','size','bold','italic','underline','color','allCaps','doubleStrikethrough','smallCaps','strikethrough','subscript','superscript'];
  const fontData=font=>Object.fromEntries(fontProperties.map(key=>[key,font[key]]));
  const setText=(shape,item)=>{shape.textFrame.textRange.text=item.text;Object.assign(shape.textFrame.textRange.font,item.font);};
  const officeCall = call => new Promise((resolve, reject) => call(result => {
    if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
    else reject(new Error(result.error?.message || 'PowerPoint 接口没有完成'));
  }));
  async function exportFile() {
    const file = await officeCall(done => Office.context.document.getFileAsync(Office.FileType.Compressed, {sliceSize: 1024 * 1024}, done));
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('演示文稿超过 32 MB，暂不处理；没有截取部分页面冒充全文');
      const parts = [];
      for (let i = 0; i < file.sliceCount; i++) {
        const slice = await officeCall(done => file.getSliceAsync(i, done));
        parts.push(Uint8Array.from(slice.data));
      }
      const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    } finally { await officeCall(done => file.closeAsync(done)); }
  }
  async function pageState(entry, includeFile = true) {
    const state = await PowerPoint.run(async context => {
      const slides = context.presentation.slides; slides.load('items/id');
      await context.sync();
      const slide = slides.getItem(entry.slideId);
      const shapes = slide.shapes; shapes.load('items/id,items/name,items/type,items/left,items/top,items/width,items/height,items/rotation,items/zOrderPosition');
      const image = slide.getImageAsBase64({width: 1200});
      await context.sync();
      const textShapes=shapes.items.filter(shape=>['TextBox','GeometricShape','Placeholder'].includes(shape.type));
      for(const shape of textShapes){shape.textFrame.textRange.load('text');shape.textFrame.textRange.font.load(fontProperties);}
      await context.sync();
      const facts = shapes.items.map(shape => ({id: shape.id, name: shape.name, type: shape.type, left: shape.left, top: shape.top, width: shape.width, height: shape.height, rotation: shape.rotation, zOrderPosition: shape.zOrderPosition,...(textShapes.includes(shape)?{text:shape.textFrame.textRange.text,font:fontData(shape.textFrame.textRange.font)}:{})}));
      if (entry.shapeIds.some(id => !facts.some(shape => shape.id === id))) throw new Error('原来选择的对象已被删除，请重新选择');
      return {slideId: entry.slideId, slideIndex: slides.items.findIndex(slide => slide.id === entry.slideId), slideIds: slides.items.map(slide => slide.id), shapes: facts, slideImage: image.value};
    });
    // The rendered page catches picture, formatting and layout changes, not only text changes.
    const bytes = new TextEncoder().encode(JSON.stringify({slideId: state.slideId, shapes: state.shapes, image: state.slideImage}));
    state.version = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    return {...state, protocolVersion:2,revision:entry.versions.length,anchorId: entry.id, selectedShapeIds: [...entry.shapeIds],captureScope:entry.captureScope, ...(includeFile ? {fileBase64: await exportFile()} : {})};
  }
  async function insertPicture(entry, image) {
    const before = await PowerPoint.run(async context => {
      context.presentation.setSelectedSlides([entry.slideId]);
      const shapes = context.presentation.slides.getItem(entry.slideId).shapes; shapes.load('items/id');
      await context.sync(); return shapes.items.map(shape => shape.id);
    });
    await officeCall(done => Office.context.document.setSelectedDataAsync(image.base64, {
      coercionType: Office.CoercionType.Image, imageLeft: image.left, imageTop: image.top, imageWidth: image.width, imageHeight: image.height,
    }, done));
    return PowerPoint.run(async context => {
      const shapes = context.presentation.slides.getItem(entry.slideId).shapes; shapes.load('items/id');
      await context.sync();
      const added = shapes.items.filter(shape => !before.includes(shape.id));
      if (added.length !== 1) throw new Error('无法确认 PowerPoint 新插入的图片，请检查页面后重新开始');
      added[0].name = image.name; added[0].rotation = image.rotation;
      await context.sync(); return added[0].id;
    });
  }
  async function replace(entry, images) {
    const added = [];
    let deleting = false;
    try {
      // Prepare every replacement before retiring any original object.
      for (const image of images) added.push({oldId: image.shapeId, newId: await insertPicture(entry, image), retained: image.retainOriginal === true});
      deleting = true;
      await PowerPoint.run(async context => {
        const slide = context.presentation.slides.getItem(entry.slideId);
        for (const image of images) if (!image.retainOriginal) slide.shapes.getItem(image.shapeId).delete();
        await context.sync();
        const order = entry.order.flatMap(id => {const mapping = added.find(item => item.oldId === id); return mapping ? mapping.retained ? [id, mapping.newId] : [mapping.newId] : [id];});
        for (const id of order) slide.shapes.getItem(id).setZOrder('BringToFront');
        await context.sync();
      });
      entry.order = entry.order.flatMap(id => {const mapping = added.find(item => item.oldId === id); return mapping ? mapping.retained ? [id, mapping.newId] : [mapping.newId] : [id];});
      entry.shapeIds = entry.shapeIds.map(id => added.find(item => item.oldId === id)?.newId || id);
      return added;
    } catch (error) {
      if (!deleting) {
        await PowerPoint.run(async context => {
          const shapes = context.presentation.slides.getItem(entry.slideId).shapes;
          for (const image of added) shapes.getItem(image.newId).delete();
          await context.sync();
        }).catch(() => {});
      }
      throw new Error(deleting ? `PowerPoint 修改结果未完全确认，请检查页面，勿重复应用。${error.message}` : error.message);
    }
  }
  return async function execute(method, args = {}) {
    if (method === 'capture') {
      const entry = await PowerPoint.run(async context => {
        const slides = context.presentation.getSelectedSlides(), shapes = context.presentation.getSelectedShapes();
        slides.load('items/id'); shapes.load('items/id,items/type'); await context.sync();
        if (slides.items.length !== 1) throw new Error('请先点击当前幻灯片，再按 ⌥⌘V');
        if (shapes.items.some(shape => !['Image', 'GeometricShape', 'Placeholder','TextBox'].includes(shape.type))) throw new Error('请直接选择图片、文字框或空白形状；组合和图表暂不编辑');
        if(shapes.items.length>12)throw new Error('一次任务最多选择 12 个对象');
        return {id: crypto.randomUUID(), slideId: slides.items[0].id, shapeIds: shapes.items.map(shape => shape.id),captureScope:shapes.items.length?'selection':'page', uncertain:false,order: [],versions:[]};
      });
      const state = await pageState(entry); entry.order = [...state.shapes].sort((a,b) => a.zOrderPosition-b.zOrderPosition).map(shape => shape.id); anchors.set(entry.id, entry); return state;
    }
    const entry = anchors.get(args.anchorId);
    if (!entry) throw new Error('PowerPoint 目标已失效，请重新选择后按 ⌥⌘V');
    if (method === 'release') { anchors.delete(entry.id); return {ok: true}; }
    if (method === 'read') return pageState(entry);
    let mutationStarted=false;
    try{
    if (method === 'apply') {
      if(entry.uncertain)throw new Error('上次 PowerPoint 写入结果未确认，请检查页面后重新建立任务');
      if(args.expectedRevision!==entry.versions.length)throw new Error('版本已改变，请勿重复应用');
      if(entry.versions.length>=20)throw new Error('本次任务最多保留 20 个版本');
      const current = await pageState(entry, false);
      if (current.version !== args.expectedVersion) throw new Error('目标页内容或版式已经改变，请重新按 ⌥⌘V');
      const images=args.images||[],texts=args.texts||[],ids=[...images,...texts].map(item=>item.shapeId);
      if(!ids.length||ids.length>12||new Set(ids).size!==ids.length||ids.some(id=>!entry.shapeIds.includes(id)))throw new Error('修改必须指向本次选择的不同对象');
      if(texts.some(item=>typeof item.text!=='string'||!item.text.trim()||item.text.length>10000||/[\r\n\x00-\x1f]/.test(item.text)||!['TextBox','GeometricShape','Placeholder'].includes(current.shapes.find(shape=>shape.id===item.shapeId)?.type)))throw new Error('文字修改只支持选中的单段文字框');
      const originals=texts.map(item=>{const shape=current.shapes.find(shape=>shape.id===item.shapeId);return {shapeId:item.shapeId,text:shape.text,font:shape.font};});
      if(originals.some(item=>fontProperties.some(key=>item.font[key]===null||item.font[key]===undefined)))throw new Error('文字框有混合字体或字样，首版仅支持字体与字样统一的单段文字');
      mutationStarted=true;entry.uncertain=true;
      const mappings=images.length?await replace(entry,images):[];
      if(texts.length)await PowerPoint.run(async context=>{
        const shapes=context.presentation.slides.getItem(entry.slideId).shapes;
        for(const item of texts)setText(shapes.getItem(item.shapeId),{...item,font:originals.find(original=>original.shapeId===item.shapeId).font});
        await context.sync();
      });
      const after=await pageState(entry,false),version=after.version;
      entry.versions.push({mappings,texts:originals,version});entry.uncertain=false;
      const changedIds=new Set([...texts.map(t=>t.shapeId),...mappings.map(m=>m.newId)]);
      const page=args.pageSize;
      const normalized=page&&page.width>0&&page.height>0?after.shapes.filter(s=>changedIds.has(s.id)).map(s=>{
       const radians=(s.rotation||0)*Math.PI/180,w=Math.abs(s.width*Math.cos(radians))+Math.abs(s.height*Math.sin(radians)),h=Math.abs(s.width*Math.sin(radians))+Math.abs(s.height*Math.cos(radians));
       return {x:(s.left+s.width/2-w/2)/page.width,y:(s.top+s.height/2-h/2)/page.height,width:w/page.width,height:h/page.height};
      }):[];
      let visible=false;
      try{visible=await PowerPoint.run(async context=>{const selected=context.presentation.getSelectedSlides();selected.load('items/id');await context.sync();return selected.items.length===1&&selected.items[0].id===entry.slideId;});}catch{}
      const locators=!visible?[]:normalized.length?[{kind:'rendered-surface',image:after.slideImage,regions:normalized}]:after.shapes.filter(s=>changedIds.has(s.id)).map(s=>s.text?.trim()?{kind:'text',text:s.text}:{kind:'element',name:s.name});
      return {ok:true,mappings,revision:entry.versions.length,resultReceipt:{documentId:entry.slideId,revision:entry.versions.length,locators}};
    }
    if (method === 'undo') {
      if(entry.uncertain)throw new Error('上次 PowerPoint 写入结果未确认，请先检查页面');
      if(args.expectedRevision!==entry.versions.length)throw new Error('版本已改变，请勿重复撤销');
      const applied=entry.versions.at(-1);
      if (!applied) throw new Error('没有本次修改可撤回');
      if ((await pageState(entry, false)).version !== applied.version) throw new Error('目标页已被继续编辑，无法安全撤回；请使用 PowerPoint 撤销或打开原稿备份');
      const originals = args.images?.map(image => ({...image, shapeId: applied.mappings.find(item => item.oldId === image.shapeId)?.newId}));
      const replaced = applied.mappings.filter(item => !item.retained);
      if (!originals || originals.length !== replaced.length || new Set(originals.map(image=>image.shapeId)).size!==originals.length||originals.some(image => !image.shapeId)) throw new Error('撤回备份与本次修改不一致');
      mutationStarted=true;entry.uncertain=true;
      const restored=originals.length?await replace(entry,originals):[];
      const retained = applied.mappings.filter(item => item.retained);
      if (retained.length) await PowerPoint.run(async context => {
        const shapes = context.presentation.slides.getItem(entry.slideId).shapes;
        for (const mapping of retained) shapes.getItem(mapping.newId).delete();
        await context.sync();
      });
      entry.order = entry.order.filter(id => !retained.some(item => item.newId === id));
      entry.shapeIds = entry.shapeIds.map(id => retained.find(item => item.newId === id)?.oldId || id);
      if(applied.texts.length)await PowerPoint.run(async context=>{
        const shapes=context.presentation.slides.getItem(entry.slideId).shapes;
        for(const item of applied.texts)setText(shapes.getItem(item.shapeId),item);
        await context.sync();
      });
      const mappings=restored.map((item,index)=>({oldId:args.images[index].shapeId,newId:item.newId}));
      entry.versions.pop();
      const previous=entry.versions.at(-1);
      if(previous){
        for(const mapping of previous.mappings)mapping.newId=mappings.find(item=>item.oldId===mapping.newId)?.newId||mapping.newId;
        previous.version=(await pageState(entry,false)).version;
      }
      entry.uncertain=false;return {ok:true,mappings,revision:entry.versions.length};
    }
    throw new Error('没有这个 PowerPoint 操作');
    }catch(error){throw Object.assign(error,{mutationStarted});}
  };
}
