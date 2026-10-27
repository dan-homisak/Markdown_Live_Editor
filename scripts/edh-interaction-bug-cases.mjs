import assert from 'node:assert/strict';

export async function runInteractionBugChecks({check,liveEval,select,screenshot,writeFixture,sleep,key,send,workbench}) {
  const primary=process.platform==='darwin'?4:2;
  const save=async()=>{await key('s','KeyS',83,primary);await sleep(250);};
  const fixture=async text=>{
    await save();await liveEval("view.dom.style.width='';return true;");
    await writeFixture(text);await select(0);
  };
  const caret=()=>liveEval(`const s=view.state.selection.main,c=view.coordsAtPos(s.head,s.assoc||1);return {head:s.head,assoc:s.assoc,goal:s.goalColumn,x:c?.left,y:c?.top,focus:view.hasFocus,active:root.activeElement?.className,source:view.state.doc.toString()};`);
  const click=async p=>{
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});await sleep(180);
  };
  await check('interaction bugs: empty bullet vertical entry and End include the trailing space',async()=>{
    const doc='- Text in first item\n- \nAfter';await fixture(doc);await select(doc.indexOf('\n'));
    await key('ArrowDown','ArrowDown',40);const down=await caret();await screenshot('interaction-empty-bullet');
    assert.equal(down.head,doc.indexOf('\n')+3,JSON.stringify(down));
    await select(doc.indexOf('\n')+1);await key('End','End',35);const end=await caret();
    assert.equal(end.head,down.head,JSON.stringify(end));return {down,end};
  });
  await check('interaction bugs: End and vertical arrows follow visual wrapped list rows',async()=>{
    const doc='- '+('wrapped words with text '.repeat(8))+'end\n- next';await fixture(doc);
    await liveEval("view.dom.style.width='420px';return true;");await sleep(200);await select(2);
    const start=await caret();await key('End','End',35);const end=await caret();
    await screenshot('interaction-wrapped-end');
    assert(Math.abs(end.y-start.y)<1,JSON.stringify({start,end}));assert(end.x>start.x+100);
    await key('End','End',35);const repeated=await caret();assert.equal(repeated.head,end.head);assert.equal(repeated.assoc,end.assoc);
    await key('ArrowDown','ArrowDown',40);const down=await caret();assert(down.y>end.y+5,JSON.stringify({end,down}));
    await key('ArrowUp','ArrowUp',38);const up=await caret();assert(Math.abs(up.y-end.y)<1,JSON.stringify({end,up}));
    return {start,end,repeated,down,up};
  });
  await check('interaction bugs: deleting into an empty numbered item keeps the original text column',async()=>{
    const doc='1. First item\n2. ';await fixture(doc);await select(doc.indexOf('\n'));
    const position=()=>liveEval(`const a=view.domAtPos(3,1),r=root.createRange();r.setStart(a.node,a.offset);r.setEnd(a.node,a.offset+1);const b=r.getBoundingClientRect();return {x:b.x,y:b.y,html:view.contentDOM.innerHTML};`);
    const before=await position(),steps=[];
    for(let i=0;i<4;i++){await key('Delete','Delete',46);steps.push(await position());}
    await screenshot('interaction-number-delete');
    for(const step of steps)assert(Math.abs(step.x-before.x)<0.5,JSON.stringify({before,steps}));
    return {before,steps};
  });
  await check('interaction bugs: one Tab nests numbered items and Shift Tab restores them',async()=>{
    const doc='1. Parent\n2. Child\n3. Next';await fixture(doc);await select(doc.indexOf('Child'));
    await key('Tab','Tab',9);const nested=await caret();
    const geometry=await liveEval(`const rows=[...view.contentDOM.querySelectorAll('.cm-line')];return rows.map(el=>({text:el.textContent,render:el.style.getPropertyValue('--mlrt-list-render-column'),source:el.style.getPropertyValue('--mlrt-list-source-column')}));`);
    await screenshot('interaction-number-tab');
    assert(/^1\. Parent\n {3,}2\. Child\n3\. Next$/u.test(nested.source),JSON.stringify({nested,geometry}));
    await key('Tab','Tab',9,8);assert.equal((await caret()).source,doc);return {nested,geometry};
  });
  await check('interaction bugs: Delete Enter Backspace leaves an empty row at the gutter',async()=>{
    const cases=[];
    for (const deletes of [3,4]) {
      const doc='1. First item';await fixture(doc);await select(doc.length);
      await key('Enter','Enter',13);const created=await caret();
      await key('ArrowUp','ArrowUp',38);await key('End','End',35);
      for(let i=0;i<deletes;i++)await key('Delete','Delete',46);
      const joined=await caret();await key('Enter','Enter',13);const recreated=await caret();
      await key('Backspace','Backspace',8);const removed=await caret();
      const geometry=await liveEval(`const s=view.state.selection.main,line=view.state.doc.lineAt(s.head),c=view.coordsAtPos(s.head,s.assoc||1),content=view.contentDOM.getBoundingClientRect();return {line:line.text,column:s.head-line.from,x:c.left,contentLeft:content.left,html:view.contentDOM.innerHTML};`);
      await screenshot('interaction-delete-enter-backspace-'+deletes);
      cases.push({deletes,created,joined,recreated,removed,geometry});
      assert.equal(geometry.line,'',JSON.stringify(cases));assert.equal(geometry.column,0,JSON.stringify(cases));
      assert(Math.abs(geometry.x-geometry.contentLeft)<0.5,JSON.stringify(cases));
    }
    return cases;
  });
  await check('interaction bugs: table Enter moves down the same column through populated and empty cells',async()=>{
    const doc='Before\n\n| A | B | Last |\n| --- | --- | --- |\n| a | b | first |\n| c | d | |\n| e | f | final |\n\nAfter';await fixture(doc);
    await liveEval(`const cell=root.querySelector('.mlrt-table-cell[data-row-kind="header"][data-column="2"]');cell.focus();const r=root.createRange();r.selectNodeContents(cell);r.collapse(false);win.getSelection().removeAllRanges();win.getSelection().addRange(r);return true;`);
    const states=[];
    for(let row=0;row<3;row++){
      await key('Enter','Enter',13);
      const state=await liveEval('const c=root.activeElement;return {cell:c?.classList.contains("mlrt-table-cell"),kind:c?.dataset.rowKind,row:c?.dataset.rowIndex,column:c?.dataset.column,text:c?.textContent};');states.push(state);
      await screenshot('interaction-table-enter-'+row);
      assert.deepEqual([state.cell,state.kind,state.row,state.column],[true,'body',String(row),'2'],JSON.stringify(states));
    }
    await key('Enter','Enter',13);assert((await caret()).focus,'Enter from the final row exits after the table');return states;
  });
  await check('interaction bugs: wide tables support horizontal wheel, Shift wheel and scrollbar drag',async()=>{
    const labels=Array.from({length:24},(_,i)=>'Column'+i),row=values=>'| '+values.join(' | ')+' |';
    await fixture(['Before','',row(labels),row(labels.map(()=> '---')),row(labels.map(x=>x+'Content')),'','After'].join('\n'));
    const geometry=await liveEval(`const s=root.querySelector('.mlrt-table-scroll'),bar=root.querySelector('.mlrt-table-scrollbar'),thumb=root.querySelector('.mlrt-table-scrollbar-thumb'),r=s.getBoundingClientRect(),t=thumb.getBoundingClientRect(),b=bar.getBoundingClientRect();s.scrollLeft=0;return {max:s.scrollWidth-s.clientWidth,point:{x:r.x+r.width/2,y:r.y+20},thumb:{x:t.x+t.width/2,y:t.y+t.height/2},track:{x:b.x+b.width*.7,y:b.y+b.height/2}};`);
    assert(geometry.max>100,JSON.stringify(geometry));
    const left=()=>liveEval('return root.querySelector(".mlrt-table-scroll").scrollLeft;');
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...geometry.point,deltaX:150,deltaY:0});await sleep(250);const wheel=await left();
    await liveEval('root.querySelector(".mlrt-table-scroll").scrollLeft=0;return true;');
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...geometry.point,deltaX:0,deltaY:150,modifiers:8});await sleep(250);const shiftWheel=await left();
    await liveEval('root.querySelector(".mlrt-table-scroll").scrollLeft=0;return true;');await sleep(100);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...geometry.thumb});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...geometry.thumb,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...geometry.track,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...geometry.track,button:'left',buttons:0,clickCount:1});await sleep(200);const dragged=await left();
    await screenshot('interaction-table-horizontal-scroll');assert(wheel>50&&shiftWheel>50&&dragged>50,JSON.stringify({geometry,wheel,shiftWheel,dragged}));
    return {geometry,wheel,shiftWheel,dragged};
  });
  await check('interaction bugs: first click after external focus restores an editable visible caret',async()=>{
    const doc='Click into this line\nSecond line\nThird line';await fixture(doc);await select(0);
    const point=await liveEval('const c=view.coordsAtPos(7);return {x:c.left,y:(c.top+c.bottom)/2};');
    // Focus the enclosing workbench, then return through one native click.
    await workbench(`(()=>{const e=document.querySelector('.search-label,.titlebar-center');e?.setAttribute('tabindex','0');e?.focus();return document.activeElement?.className;})()`);
    await sleep(200);await click(point);const clicked=await caret();await key('ArrowDown','ArrowDown',40);const moved=await caret();
    // Reproduce an activation race: the editable loses focus after its normal
    // mousedown selection, while the enclosing webview retains keyboard focus.
    await liveEval(`view.dom.addEventListener('mousedown',()=>view.contentDOM.blur(),{once:true});return true;`);
    await click(point);const recovered=await caret();await key('ArrowDown','ArrowDown',40);const recoveredMove=await caret();
    await screenshot('interaction-first-click');assert(clicked.focus,JSON.stringify(clicked));assert(moved.head>doc.indexOf('\n'),JSON.stringify({clicked,moved}));
    assert(recovered.focus,JSON.stringify(recovered));assert(recoveredMove.head>doc.indexOf('\n'),JSON.stringify({recovered,recoveredMove}));
    return {clicked,moved,recovered,recoveredMove};
  });
  await save();await liveEval("view.dom.style.width='';return true;");
}
