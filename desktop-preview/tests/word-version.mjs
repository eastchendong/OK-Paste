import assert from 'node:assert/strict';import {test} from 'node:test';import {JSDOM} from 'jsdom';
import {wordContentVersion} from '../../office-live/word-adapter.js';
const dom=new JSDOM(''),Parser=dom.window.DOMParser;
const documentXML=(text='原文',bold='<w:b/>',rsid='111')=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p w:rsidR="${rsid}"><w:r><w:rPr>${bold}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`;
const packageXML=(content,time,reverse=false)=>{
 const parts=[`<pkg:part pkg:name="/word/document.xml"><pkg:xmlData>${content}</pkg:xmlData></pkg:part>`,`<pkg:part pkg:name="/docProps/core.xml"><pkg:xmlData><modified>${time}</modified></pkg:xmlData></pkg:part>`];
 return `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">${(reverse?parts.reverse():parts).join('')}</pkg:package>`;
};
const version=xml=>wordContentVersion(xml,Parser);
test('Word version ignores export bookkeeping and package ordering while protecting text, spaces and formatting',()=>{
 const original=version(packageXML(documentXML(),'first'));
 assert.equal(version(packageXML(documentXML('原文','<w:b/>','222'),'later',true)),original);
 assert.notEqual(version(packageXML(documentXML('改了'),'first')),original);
 assert.notEqual(version(packageXML(documentXML('原文',''),'first')),original);
 assert.notEqual(version(packageXML(documentXML('原文 '),'first')),original);
 assert.throws(()=>version('<broken>'),/无效/);
});
dom.window.close();
