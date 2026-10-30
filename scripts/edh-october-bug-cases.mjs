import assert from 'node:assert/strict';

export async function runOctoberBugChecks({check,liveEval,select,screenshot,fixture,writeSettings,palette,sleep,key,send,workbench,click}) {
  const table = 'Before\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n\nAfter';
  const cellSelector = (row=0,column=0) => `.mlrt-table-cell[data-row-kind="body"][data-row-index="${row}"][data-column="${column}"]`;
  const focusCell = async (row=0,column=0,all=false) => liveEval(`const c=root.querySelector(${JSON.stringify(cellSelector(row,column))});c.focus();const r=root.createRange();r.selectNodeContents(c);${all?'':'r.collapse(false);'}win.getSelection().removeAllRanges();win.getSelection().addRange(r);return c.textContent;`);
  const shape = () => liveEval(`const t=root.querySelector('.mlrt-table');return {rows:t?.rows.length,columns:t?.rows[0].querySelectorAll(".mlrt-table-cell").length,active:{...root.activeElement?.dataset},text:view.state.doc.toString()};`);
  await check('interaction bugs: October numbered list labels stay stable on arrow entry after insertion',async()=>{
    await fixture('1. First\n2. Second\n3. Third\n\nAfter');await select(8);await key('Enter','Enter',13);
    await send('Input.insertText',{text:'Inserted'});await sleep(150);
    const read=()=>liveEval(`return [...view.contentDOM.querySelectorAll('.cm-line')].map(el=>el.textContent);`);
    const before=await read();await key('ArrowDown','ArrowDown',40);const inside=await read();await key('ArrowDown','ArrowDown',40);const third=await read();
    assert(inside.some(x=>/^3\. Second$/.test(x)),JSON.stringify({before,inside,third}));
    assert(third.some(x=>/^4\. Third$/.test(x)),JSON.stringify({before,inside,third}));
    await screenshot('october-list-numbering');return {before,inside,third};
  });
  await check('interaction bugs: October four insertion shortcuts and live custom settings preserve cells',async()=>{
    const cases=[];
    for(const [modifiers,rows,columns,row,column] of [[2,4,2,'1','1'],[10,4,2,'0','1'],[1,3,3,'0','2'],[9,3,3,'0','1']]){
      await fixture(table);await focusCell(0,1);await key('Enter','Enter',13,modifiers);const state=await shape();cases.push(state);
      assert.equal(state.rows,rows);assert.equal(state.columns,columns);assert.equal(state.active.rowIndex,row);assert.equal(state.active.column,column);
      for(const value of ['alpha','beta','gamma','delta'])assert(state.text.includes(value));
    }
    await writeSettings({'markdownLiveRenderTables.tableShortcuts.insertRowBelow':'Ctrl+Shift+KeyI'});
    await fixture(table);await focusCell();await key('I','KeyI',73,10);assert.equal((await shape()).rows,4);
    await writeSettings();await fixture(table);
    await liveEval(`root.querySelector('.mlrt-table-cell[data-row-kind="header"]').focus();return true;`);
    await key('Enter','Enter',13,10);const header=await shape();
    assert.equal(header.rows,4);assert.equal(header.active.rowKind,'header');
    assert(header.text.includes('| A | B |\n| alpha | beta |'),JSON.stringify(header));
    await screenshot('october-shortcuts');return [...cases,header];
  });
  await check('interaction bugs: October custom held navigation supports Control and Ctrl Space',async()=>{
    await fixture(table);
    for(const modifier of ['Control','Ctrl+Space','KeyQ']) {
      await writeSettings({'markdownLiveRenderTables.tableNavigation.modifierKey':modifier});await focusCell();
      const mods=modifier==='KeyQ'?0:2;
      if(modifier!=='Control')await send('Input.dispatchKeyEvent',{type:'keyDown',key:modifier==='KeyQ'?'q':' ',code:modifier==='KeyQ'?'KeyQ':'Space',windowsVirtualKeyCode:modifier==='KeyQ'?81:32,modifiers:mods});
      await key('ArrowRight','ArrowRight',39,mods);
      if(modifier!=='Control')await send('Input.dispatchKeyEvent',{type:'keyUp',key:modifier==='KeyQ'?'q':' ',code:modifier==='KeyQ'?'KeyQ':'Space',windowsVirtualKeyCode:modifier==='KeyQ'?81:32,modifiers:mods});
      const state=await shape();assert.equal(state.active.column,'1',JSON.stringify({modifier,state}));assert.equal(state.text,table);
    }
    await writeSettings();return true;
  });
  await check('interaction bugs: October selected cell text copy paste preserves exact newlines',async()=>{
    const cases=[];
    for(const value of ['alpha','one<br>two','one<br><br>']){
      await fixture(table.replace('alpha',value));await focusCell(0,0,true);
      await key('c','KeyC',67,2);await sleep(150);await focusCell(0,1,true);await key('v','KeyV',86,2);await sleep(200);
      const state=await shape();cases.push(state);
      const target=await liveEval(`return root.querySelector(${JSON.stringify(cellSelector(0,1))}).textContent;`);
      assert.equal(target,value.replaceAll('<br>','\n'),JSON.stringify(state));
    }
    // Chromium/Office can surround the fragment with unrelated table layout.
    await fixture(table);await focusCell(0,1,true);
    await liveEval(`const data=new win.DataTransfer();data.setData('text/plain','alpha');data.setData('text/html','<div><br><span data-mlrt-cell-text="1">alpha</span><br></div>');root.activeElement.dispatchEvent(new win.ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return true;`);
    assert((await shape()).text.includes('| alpha | alpha |'));await screenshot('october-cell-paste');return cases;
  });
  await check('interaction bugs: October Delete table removes populated table on first menu click',async()=>{
    await fixture(table);await focusCell();
    await liveEval(`root.activeElement.dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:160,clientY:140}));return true;`);
    await screenshot('october-delete-menu');
    await liveEval(`root.querySelector('.mlrt-clipboard-menu [data-action="delete-table"]').click();return true;`);
    const state=await shape();assert.equal(state.rows,undefined);assert(state.text.includes('Before')&&state.text.includes('After'));assert(!state.text.includes('alpha'));
    await key('z','KeyZ',90,2);await sleep(250);assert.equal((await shape()).rows,3);return state;
  });
  await check('interaction bugs: October title buttons undo and redo source and cell edits',async()=>{
    await fixture(table);await select(0);await send('Input.insertText',{text:'EDIT'});await sleep(250);
    const buttons=await workbench(`(()=>{return [...document.querySelectorAll('.editor-actions .action-label')].map(e=>({label:e.getAttribute('aria-label'),title:e.getAttribute('title')}));})()`);
    const clickHistory=async command=>{const found=await workbench(`(()=>{const e=[...document.querySelectorAll('.editor-actions .action-label')].find(e=>(e.getAttribute('aria-label')||'').startsWith(${JSON.stringify(command)}));if(!e)return false;e.click();return true;})()`);assert(found,JSON.stringify(buttons));await sleep(300);};
    await clickHistory('Undo');assert.equal((await shape()).text,table);await clickHistory('Redo');assert((await shape()).text.startsWith('EDITBefore'));
    await focusCell(0,0,true);await send('Input.insertText',{text:'CHANGED'});await sleep(250);await clickHistory('Undo');assert((await shape()).text.includes('alpha'));await clickHistory('Redo');assert((await shape()).text.includes('CHANGED'));
    await screenshot('october-history-buttons');return buttons;
  });
  await check('interaction bugs: October code copy label is upright and dark surface is lighter',async()=>{
    await fixture('Before\n\n```js\nconst value = 1;\n```\n\nAfter');await select(0);
    const styles=await liveEval(`const b=root.querySelector('.mlrt-preview-code-copy');return {fontStyle:win.getComputedStyle(b).fontStyle,code:win.getComputedStyle(view.dom).getPropertyValue('--mlrt-markdown-code-background'),canvas:win.getComputedStyle(root.body).getPropertyValue('--vscode-editor-background')};`);
    assert.equal(styles.fontStyle,'normal');assert(styles.code && styles.code !== styles.canvas,JSON.stringify(styles));
    const point=await liveEval(`const r=root.querySelector('.mlrt-preview-code-copy').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(200);await screenshot('october-code-style');return styles;
  });
  await check('interaction bugs: October delayed activation blur repairs prose and table focus',async()=>{
    for(const inCell of [false,true]){
      await fixture(table);if(inCell)await focusCell();else await select(3);
      const point=await liveEval(`const el=${inCell?`root.querySelector(${JSON.stringify(cellSelector())})`:'view.contentDOM'},r=${inCell?'el.getBoundingClientRect()':'view.coordsAtPos(3)'};view.dom.addEventListener('click',()=>win.setTimeout(()=>el.blur(),0),{once:true});return {x:r.left+3,y:(r.top+r.bottom)/2};`);
      await click(point);await sleep(130);
      const state=await liveEval(`return {focus:view.hasFocus,active:root.activeElement.className,caret:view.dom.classList.contains('mlrt-prose-cursor-focused')};`);
      assert(inCell?state.active.includes('mlrt-table-cell'):state.focus&&state.caret,JSON.stringify(state));
      await send('Input.insertText',{text:'Z'});assert((await shape()).text.includes('Z'));
    }
    await screenshot('october-first-click');return true;
  });
}
