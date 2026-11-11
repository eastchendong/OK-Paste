async function createTuotieFigmaFixture(figma){
 await figma.loadAllPagesAsync();
 if(figma.root.children.some(page=>page.children.length))throw new Error('测试画布只允许在全新的空白文件建立，请先新建 Figma Design 文件');
 const page=figma.currentPage;page.name='妥帖 · 同系列角色测试';
 const names=['01 · 瓶子','02 · 杯子','03 · 新角色'],frames=names.map((name,index)=>{const frame=figma.createFrame();frame.name=name;frame.resize(300,300);frame.x=index*340;frame.y=0;return frame;});
 const style='stroke="#123e4b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
 const face='<circle cx="129" cy="139" r="5" fill="#123e4b"/><circle cx="171" cy="139" r="5" fill="#123e4b"/><path d="M139 165 Q150 178 161 165" fill="none"/>';
 const bottle=`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><g ${style}><path d="M118 43 H182 V76 C202 88 214 108 214 129 V233 Q214 250 197 250 H103 Q86 250 86 233 V129 Q86 97 118 76 Z" fill="#acd9b2"/>${face}<path d="M86 157 L61 190 L72 201 M214 157 L239 190 L228 201 M126 250 V272 M174 250 V272" fill="none"/></g></svg>`;
 const mug=`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><g ${style}><ellipse cx="227" cy="143" rx="29" ry="39" fill="#f2a28d"/><path d="M83 85 H217 V220 Q217 244 193 244 H107 Q83 244 83 220 Z" fill="#f2a28d"/>${face}<path d="M123 244 V272 M177 244 V272" fill="none"/></g></svg>`;
 for(const [index,svg]of[bottle,mug].entries()){const node=figma.createNodeFromSvg(svg);frames[index].appendChild(node);node.name=`原有作品 · ${index?'杯子':'瓶子'}`;node.x=0;node.y=0;}
 page.selection=[frames[2]];figma.viewport.scrollAndZoomIntoView(frames);figma.commitUndo();
}

async function createTuotieFigmaRevisionFixture(figma){
 const page=figma.currentPage;
 if(!figma.root.name.startsWith('妥帖 · Figma 矢量测试')||page.name!=='妥帖 · 同系列角色测试')throw new Error('仅允许在独立的妥帖 Figma 矢量测试文件建立修订验收画框');
 await page.loadAsync();const name='04 · 修订验收',existing=page.children.find(node=>node.name===name);
 if(existing&&(existing.type!=='FRAME'||existing.children.length))throw new Error('已有验收画框不是空画框，未清理或覆盖');
 const frame=existing||figma.createFrame();
 if(!existing){page.appendChild(frame);frame.name=name;frame.resize(300,300);frame.x=Math.max(0,...page.children.filter(node=>node!==frame).map(node=>node.x+node.width))+40;frame.y=0;}
 page.selection=[frame];figma.viewport.scrollAndZoomIntoView(page.children.filter(node=>node.type==='FRAME'));figma.commitUndo();
}
