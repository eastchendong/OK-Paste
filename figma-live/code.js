if(figma.command==='fixture-revisions'){
 createTuotieFigmaRevisionFixture(figma).then(()=>figma.closePlugin('修订验收空画框已就绪')).catch(error=>figma.closePlugin(error.message));
}else if(figma.command==='fixture'){
 createTuotieFigmaFixture(figma).then(()=>figma.closePlugin('测试画布已建立')).catch(error=>figma.closePlugin(error.message));
}else{
 const dispatch=createTuotieFigmaHost(figma);
 figma.showUI(__html__,{width:310,height:180,themeColors:true});
 let chain=Promise.resolve();
 figma.ui.onmessage=message=>{
  if(!message||message.type!=='host-command'||typeof message.id!=='string')return;
  chain=chain.then(async()=>{let result,error,mutationStarted;try{result=await dispatch(message.method,message.args);}catch(e){error=e.message||String(e);mutationStarted=e.mutationStarted;}figma.ui.postMessage({type:'host-result',id:message.id,result,error,mutationStarted});});
 };
}
