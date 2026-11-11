/* Isolated, native vector fixture. Run through Illustrator File > Scripts.
   This creates a NEW document and does not change any previously open work. */
(function(){
 var doc=app.documents.add(DocumentColorSpace.RGB,300,300),ink='#123e4b';
 doc.artboards[0].artboardRect=[0,300,300,0];doc.artboards[0].name='01 · 瓶子';
 doc.artboards.add([340,300,640,0]).name='02 · 杯子';doc.artboards.add([680,300,980,0]).name='03 · 新角色';
 function rgb(hex){var c=new RGBColor();c.red=parseInt(hex.substr(1,2),16);c.green=parseInt(hex.substr(3,2),16);c.blue=parseInt(hex.substr(5,2),16);return c;}
 function ellipse(group,x,y,w,h,fill){var p=group.pathItems.ellipse(y,x,w,h);p.filled=true;p.fillColor=rgb(fill);p.stroked=true;p.strokeColor=rgb(ink);p.strokeWidth=5;return p;}
 function line(group,points,width){var p=group.pathItems.add();p.setEntirePath(points);p.filled=false;p.stroked=true;p.strokeColor=rgb(ink);p.strokeWidth=width;return p;}
 function face(group,x){ellipse(group,x-23,174,9,11,ink);ellipse(group,x+15,174,9,11,ink);line(group,[[x-9,148],[x,141],[x+10,148]],5);}
 var bottle=doc.groupItems.add();bottle.name='原有作品 · 瓶子';
 var body=bottle.pathItems.roundedRectangle(240,84,132,180,40,40);body.fillColor=rgb('#acd9b2');body.strokeColor=rgb(ink);body.strokeWidth=5;
 var neck=bottle.pathItems.rectangle(266,120,60,26);neck.fillColor=rgb('#acd9b2');neck.strokeColor=rgb(ink);neck.strokeWidth=5;
 face(bottle,150);line(bottle,[[85,170],[60,130],[72,120]],6);line(bottle,[[216,170],[240,130],[228,120]],6);line(bottle,[[125,60],[125,40]],8);line(bottle,[[175,60],[175,40]],8);
 var mug=doc.groupItems.add();mug.name='原有作品 · 杯子';ellipse(mug,550,215,65,90,'#f2a28d');
 var cup=mug.pathItems.roundedRectangle(230,425,140,160,26,26);cup.fillColor=rgb('#f2a28d');cup.strokeColor=rgb(ink);cup.strokeWidth=5;face(mug,495);
 line(mug,[[450,70],[450,42]],8);line(mug,[[535,70],[535,42]],8);
 doc.artboards.setActiveArtboardIndex(2);doc.selection=null;
 var directory=new Folder(Folder.userData.fsName+'/Tuotie/runtime/.local/illustrator-live');if(!directory.exists)directory.create();
 var file=new File(directory.fsName+'/妥帖-Illustrator-合成测试.ai');
 if(file.exists)file=new File(directory.fsName+'/妥帖-Illustrator-合成测试-'+new Date().getTime()+'.ai');
 var options=new IllustratorSaveOptions();options.pdfCompatible=true;doc.saveAs(file,options);app.redraw();
})();
