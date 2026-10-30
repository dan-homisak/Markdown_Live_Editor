import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function runFollowupChecks({check,liveEval,select,screenshot,fixture,writeSettings,sleep,key,send,workbench}) {
  const table='Before\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n\nAfter';
  await check('interaction bugs: followup empty history shows both disabled arrow buttons',async()=>{
    const buttons=await workbench(`(()=>{return ['Undo','Redo'].map(name=>{const el=[...document.querySelectorAll('.editor-actions .action-label')].find(e=>(e.getAttribute('aria-label')||'').startsWith(name));return {name,visible:!!el&&el.getBoundingClientRect().width>0,disabled:el?.classList.contains('disabled'),color:el&&getComputedStyle(el).color};});})()`);
    await screenshot('followup-history-empty');assert(buttons.every(b=>b.visible&&b.disabled),JSON.stringify(buttons));return buttons;
  });
  await check('interaction bugs: followup first edit preserves the visible scroll position',async()=>{
    const source=await readFile(new URL('../standard-markdown-fixture.md',import.meta.url),'utf8');
    const samples=[];
    for(const inCell of [false,true]) {
      const doc=inCell ? 'Intro\n\n'+Array.from({length:50},(_,i)=>`Paragraph ${i}\n\n${table}\n\n`).join('') : source.repeat(5);
      await fixture(doc);
      if(inCell) {
        const position=doc.indexOf('| alpha',Math.floor(doc.length/2));await select(position-30);
        await liveEval(`const cells=[...root.querySelectorAll('.mlrt-table-cell')],cell=cells.find(c=>Number(c.dataset.sourceFrom)>${position})||cells[0];cell.focus();const r=root.createRange();r.selectNodeContents(cell);r.collapse(false);win.getSelection().removeAllRanges();win.getSelection().addRange(r);return true;`);
      } else {
        const pos=doc.indexOf('paragraph',Math.floor(doc.length/2));await select(pos<0?Math.floor(doc.length/2):pos);
      }
      await sleep(500);
      const measure=()=>liveEval(`const cell=root.activeElement?.closest('.mlrt-table-cell'),cursor=cell?.getBoundingClientRect()||view.coordsAtPos(view.state.selection.main.head);return {top:view.scrollDOM.scrollTop,height:view.scrollDOM.scrollHeight,caretY:cursor?.top,active:root.activeElement?.className,head:view.state.selection.main.head};`);
      const before=await measure();await send('Input.insertText',{text:'X'});await sleep(600);const after=await measure();samples.push({inCell,before,after});
      await screenshot('followup-first-edit-'+(inCell?'cell':'text'));
      assert(Math.abs(before.top-after.top)<1&&Math.abs(before.caretY-after.caretY)<1,JSON.stringify(samples));
    }
    return samples;
  });
  await check('interaction bugs: followup ordered markers remain correct inside the number',async()=>{
    await fixture('8. First\n9. Second\n10. Third\n\nAfter');await select(8);await key('Enter','Enter',13);await send('Input.insertText',{text:'Inserted'});
    await key('ArrowDown','ArrowDown',40);await key('Home','Home',36);await key('Home','Home',36);
    const result=await liveEval(`return {source:view.state.doc.toString(),lines:[...view.contentDOM.querySelectorAll('.cm-line')].map(el=>el.textContent),head:view.state.selection.main.head};`);
    await screenshot('followup-list-marker');assert(result.lines.includes('10. Second'),JSON.stringify(result));
    assert(result.source.includes('10. Second\n11. Third'),JSON.stringify(result));return result;
  });
  await check('interaction bugs: followup table insertion undo restores the original cell caret',async()=>{
    await fixture(table);await liveEval(`const cell=root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-row-index="0"][data-column="1"]');cell.focus();const r=root.createRange();r.setStart(cell.firstChild,2);r.collapse(true);win.getSelection().removeAllRanges();win.getSelection().addRange(r);return true;`);
    await key('Enter','Enter',13,2);await sleep(200);await key('z','KeyZ',90,2);await sleep(250);
    const state=await liveEval(`const s=win.getSelection();return {source:view.state.doc.toString(),active:root.activeElement.className,row:root.activeElement.dataset.rowIndex,column:root.activeElement.dataset.column,offset:s.focusOffset,text:s.focusNode?.textContent};`);
    await screenshot('followup-table-undo');assert.equal(state.source,table);assert.equal(state.column,'1',JSON.stringify(state));assert.equal(state.row,'0');assert.equal(state.offset,2);
    await key('y','KeyY',89,2);await sleep(250);
    assert.equal(await liveEval(`return root.activeElement.dataset.rowIndex;`),'1');
    await key('z','KeyZ',90,2);await sleep(250);
    assert.equal(await liveEval(`return win.getSelection().focusOffset;`),2);
    assert.equal(await liveEval(`return root.activeElement.dataset.rowIndex;`),'0');return state;
  });
  await check('interaction bugs: followup history buttons stay visible and reflect available history',async()=>{
    const buttons=()=>workbench(`(()=>{return ['Undo','Redo'].map(name=>{const el=[...document.querySelectorAll('.editor-actions .action-label')].find(e=>(e.getAttribute('aria-label')||'').startsWith(name));return {name,found:!!el,disabled:el?.closest('.action-item')?.classList.contains('disabled')||el?.getAttribute('aria-disabled')==='true',icon:el?.className,opacity:el&&getComputedStyle(el).opacity};});})()`);
    await fixture('Fresh history probe');await select(3);await send('Input.insertText',{text:'X'});await sleep(250);const edited=await buttons();await screenshot('followup-history-buttons');
    assert(edited.every(b=>b.found));assert.equal(edited[1].disabled,true,JSON.stringify(edited));
    await key('z','KeyZ',90,2);await sleep(250);const undone=await buttons();assert.equal(undone[1].disabled,false,JSON.stringify(undone));return {edited,undone};
  });
  await check('interaction bugs: followup code copy text and hover fit within the fence row',async()=>{
    await fixture('Before\n\n```js\nconst value = 1;\n```\n\nAfter');await select(0);
    const metrics=await liveEval(`const b=root.querySelector('.mlrt-preview-code-copy'),line=b.closest('.cm-line'),r=b.getBoundingClientRect(),l=line.getBoundingClientRect();return {font:parseFloat(win.getComputedStyle(b).fontSize),editorFont:view.defaultLineHeight,sourceFont:parseFloat(win.getComputedStyle(line).fontSize),top:r.top,bottom:r.bottom,lineTop:l.top,lineBottom:l.bottom,x:r.x+r.width/2,y:r.y+r.height/2};`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:metrics.x,y:metrics.y});await sleep(180);await screenshot('followup-code-hover');
    assert(metrics.font<metrics.sourceFont,JSON.stringify(metrics));assert(metrics.top>=metrics.lineTop+0.5 && metrics.bottom<=metrics.lineBottom-0.5,JSON.stringify(metrics));return metrics;
  });
}
