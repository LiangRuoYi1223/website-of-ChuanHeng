import test from 'node:test';
import assert from 'node:assert/strict';
test('real xlsx ZIP preserves Chinese and 18-digit identifiers as inline text without formulas',async()=>{
 const module=await import('../src/applications/insurance-export.js');
 const bytes=module.createInsuranceWorkbook({title:'合成活动',rows:[{realName:'=HYPERLINK("unsafe")',idNumber:'11010519491231002X',phone:'013800138000',insuranceStatus:'uninsured',detailsComplete:true}]});
 assert.ok(bytes instanceof Uint8Array);assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
 const xml=new TextDecoder().decode(bytes);assert.match(xml,/xl\/worksheets\/sheet1.xml/);assert.match(xml,/11010519491231002X/);assert.match(xml,/013800138000/);assert.match(xml,/t="inlineStr"/);assert.doesNotMatch(xml,/<f[ >]/);assert.match(xml,/未购买/);
});

test('OOXML package has valid local records and central directory and every user value is a text cell',async()=>{
 const {createInsuranceWorkbook}=await import('../src/applications/insurance-export.js');
 const bytes=createInsuranceWorkbook({rows:[{realName:'+cmd & <中文>',idNumber:'110105194912310021',phone:'0013800138000',insuranceStatus:'insured',detailsComplete:true},{realName:'@SUM(1)',idNumber:null,phone:null,insuranceStatus:'uninsured',detailsComplete:false}]});
 const view=new DataView(bytes.buffer),entries=new Map();let offset=0;
 while(view.getUint32(offset,true)===0x04034b50){assert.equal(view.getUint16(offset+8,true),0);const size=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+nameSize+extra;entries.set(new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameSize)),new TextDecoder().decode(bytes.subarray(start,start+size)));offset=start+size;}
 assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);assert.equal(view.getUint16(bytes.length-12,true),5);
 assert.ok(entries.has('[Content_Types].xml'));assert.ok(entries.has('xl/workbook.xml'));assert.ok(entries.has('xl/_rels/workbook.xml.rels'));
 const sheet=entries.get('xl/worksheets/sheet1.xml');assert.match(sheet,/>110105194912310021<\/t>/);assert.match(sheet,/>0013800138000<\/t>/);assert.match(sheet,/\+cmd &amp; &lt;中文&gt;/);assert.match(sheet,/@SUM\(1\)/);assert.match(sheet,/资料缺失/);assert.equal((sheet.match(/<c /g)||[]).length,(sheet.match(/t="inlineStr"/g)||[]).length);assert.doesNotMatch(sheet,/<f[ >]/);
});
