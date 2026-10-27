import assert from 'node:assert/strict';

export async function runListStructureChecks({check, liveEval, select, screenshot, writeFixture, sleep, send, key}) {
  const source = ['Lists and nesting', '', '- Bullet list', '  - nested', '    - nested further',
    '      - further', '        - and so on', '      - back some', '    - back more', '  - back even more',
    '- Last bullet', '', '- [ ] Task parent', '  - [x] Task child', '    - Task grandchild', '',
    '1. Ordered parent', '   1. Ordered child', '      - Mixed child', '', '- Blocks parent', '',
    '  A **bold** continuation with `inline code`.', '', '  > [!NOTE] Callout', '  > Quote child', '',
    '  ```js', '  const nestedCode = 1;', '  ```', '', '  | Key | Value |', '  | --- | --- |',
    '  | Nested table | cell |', '', '- After blocks', '', 'Resting caret.', ''].join('\n');
  const from = label => {
    let offset=0;
    for(const line of source.split('\n')) {
      if(line===label || line.trim().replace(/^(?:[-+*]|\d+[.)]) (?:\[[xX ]\] )?/, '')===label) return offset+line.indexOf(label);
      offset+=line.length+1;
    }
    return source.indexOf(label);
  };
  const rowStart = label => source.lastIndexOf('\n', from(label)) + 1;
  const marker = label => rowStart(label) + source.slice(rowStart(label), from(label)).search(/\S/);
  const restore = async () => { await writeFixture('reset'); await writeFixture(source); await select(from('Resting caret.')); await liveEval('view.scrollDOM.scrollTop=0;return true;'); await sleep(150); };
  const point = async label => liveEval(`const button=root.querySelector('[data-list-from="${marker(label)}"]');if(!button)throw new Error('No fold button for ${label}');const box=button.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};`);
  const move = async label => {
    await liveEval(`root.querySelector('[data-list-from="${marker(label)}"]')?.scrollIntoView({block:'nearest',inline:'nearest'});return true;`);
    await sleep(80);
    await send('Input.dispatchMouseEvent', {type:'mouseMoved', ...await point(label)}); await sleep(100);
  };
  const click = async label => {
    await move(label); const p=await point(label);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1}); await sleep(180);
  };
  const visible = () => liveEval('return view.contentDOM.textContent;');
  const gutter = () => liveEval('return {width:root.querySelector(".cm-gutters").getBoundingClientRect().width,rows:[...root.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].filter(el=>el.style.visibility!=="hidden").map(el=>Number(el.textContent))};');
  await restore();
  await check('list structure: hover controls, blue guide and unchanged layout', async () => {
    const before=await gutter();
    await move('nested further');
    const state=await liveEval(`const button=root.querySelector('[data-list-from="${marker('nested further')}"]');const row=button.closest('.cm-line');return {opacity:win.getComputedStyle(button).opacity,color:win.getComputedStyle(button).color,hit:root.elementFromPoint(${(await point('nested further')).x},${(await point('nested further')).y})===button,background:win.getComputedStyle(row.querySelector('.mlrt-markdown-bullet'),'::after').backgroundColor,guides:root.querySelectorAll('.mlrt-list-guide').length,active:root.querySelectorAll('.mlrt-list-guide-active').length};`);
    await screenshot('lists-hover');
    assert.equal(state.opacity,'1');assert.equal(state.hit,true);assert(state.guides>=5);assert.equal(state.active,1,JSON.stringify(state));
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:800,y:15});await sleep(100);
    assert.equal(await liveEval(`return win.getComputedStyle(root.querySelector('[data-list-from="${marker('nested further')}"]')).opacity;`),'0');
    assert.equal((await gutter()).width,before.width);return state;
  });
  await check('list structure: caret guides stay blue independently of hover and follow arrow navigation', async () => {
    const active = () => liveEval('return [...root.querySelectorAll(".mlrt-list-guide-active")].map(el=>Number(el.dataset.listFrom)).sort((a,b)=>a-b);');
    const expect = async labels => {
      const expected=labels.map(marker).sort((a,b)=>a-b);
      const actual=await active();assert.deepEqual(actual,expected);return actual;
    };
    // Park the pointer over ordinary prose inside the editor. Keyboard input
    // must still activate a guide, even though a hover position is recorded.
    await liveEval('view.scrollDOM.scrollTop=0;return true;');await sleep(100);
    const prose=await liveEval('const box=view.coordsAtPos(5);return {x:box.left,y:(box.top+box.bottom)/2};');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...prose});
    await select(from('nested')+2);await expect(['nested']);
    await key('ArrowDown','ArrowDown',40);await sleep(100);await expect(['nested further']);
    await screenshot('lists-caret-guide');
    await key('ArrowDown','ArrowDown',40);await sleep(100);await expect(['further']);
    await key('ArrowUp','ArrowUp',38);await sleep(100);await expect(['nested further']);
    await move('Task child');await expect(['nested further','Task child']);
    await screenshot('lists-caret-and-hover-guides');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:800,y:-10});await sleep(100);
    await expect(['nested further']);
    for(const child of ['Task child','Ordered child']) {
      await select(from(child)+2);await expect([child]);
    }
    await select(from('and so on')+2);await expect([]); // A leaf has no guide beneath its marker.
    await select(from('Resting caret.'));await expect([]);
    assert.equal(await liveEval('return view.state.doc.toString();'),source);
    await liveEval('view.scrollDOM.scrollTop=0;return true;');await sleep(100);
    return {keyboardLevels:3,currentRowGuide:true,leafDoesNotHighlightAncestor:true,caretSurvivesHover:true,kinds:['bullet','task','ordered'],sourcePreserved:true};
  });
  await check('list structure: nested folding preserves sibling rows, child state and gutter spacing', async () => {
    const before=await gutter();await click('further');
    assert(!(await visible()).includes('and so on'));assert((await visible()).includes('back some'));
    const after=await gutter();assert.equal(after.width,before.width);assert(!after.rows.includes(7));assert(after.rows.includes(8));
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-list-fold-hint").length;'),1);
    await screenshot('lists-collapsed');
    await select(source.indexOf('\n',from('further')));
    await key('ArrowRight','ArrowRight',39);
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-list-fold-hint").length;'),1,'right arrow crosses the folded range without expanding');
    await key('ArrowLeft','ArrowLeft',37);
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-list-fold-hint").length;'),1,'left arrow retains the fold');
    await click('nested');assert(!(await visible()).includes('nested further'));assert((await visible()).includes('back even more'));
    await click('nested');assert((await visible()).includes('nested further'));assert(!(await visible()).includes('and so on'));
    await click('further');assert((await visible()).includes('and so on'));
    assert.equal(await liveEval('return view.state.doc.toString();'),source);
    return {before,after,sourcePreserved:true};
  });
  await check('list structure: shared marker columns, clear carets and matching accent colors', async () => {
    await select(from('Resting caret.'));await liveEval('view.scrollDOM.scrollTop=0;return true;');await sleep(150);
    const labels=['Bullet list','Task parent','Ordered parent','nested','Task child','Ordered child'];
    const metrics=[];
    for(const label of labels) {
      metrics.push(await liveEval(`const from=${marker(label)},button=root.querySelector('[data-list-from="'+from+'"]'),anchor=button.parentElement.getBoundingClientRect(),line=button.closest('.cm-line'),slot=line.querySelector('.mlrt-markdown-task-control,.mlrt-markdown-bullet'),guide=root.querySelector('.mlrt-list-guide[data-list-from="'+from+'"]'),glyph=root.createRange();if(slot)glyph.selectNodeContents(slot);const box=slot?.matches('.mlrt-list-bullet-slot')?glyph.getBoundingClientRect():slot?.getBoundingClientRect();const a=view.domAtPos(${from(label)},1),b=view.domAtPos(${from(label)+1},-1),range=root.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);return {label:${JSON.stringify(label)},center:box?box.x+box.width/2:anchor.left+view.defaultCharacterWidth,guide:guide?.getBoundingClientRect().x,text:range.getBoundingClientRect().x};`));
    }
    for(const group of [metrics.slice(0,3),metrics.slice(3)]) for(const item of group) {
      assert(Math.abs(item.center-group[0].center)<=0.5,JSON.stringify(group));
      assert(Math.abs(item.text-group[0].text)<=0.5,JSON.stringify(group));
      assert(Math.abs(item.center-item.guide)<=0.5,'guide originates at its marker center: '+JSON.stringify(item));
    }
    const gaps=[];
    for(const [child,parent] of [['nested further','nested'],['Task child','Task parent'],['Ordered child','Ordered parent']]) {
      await move(child);
      const state=await liveEval(`const button=root.querySelector('[data-list-from="${marker(child)}"]'),ancestor=root.querySelector('.mlrt-list-guide[data-list-from="${marker(parent)}"]'),guide=root.querySelector('.mlrt-list-guide[data-list-from="${marker(child)}"]'),bullet=button.closest('.cm-line').querySelector('.mlrt-markdown-bullet');return {gap:button.getBoundingClientRect().left-ancestor.getBoundingClientRect().right,caret:win.getComputedStyle(button).color,guide:win.getComputedStyle(guide).backgroundColor,bullet:bullet?win.getComputedStyle(bullet,'::after').backgroundColor:null};`);
      assert(state.gap>=3,JSON.stringify({child,...state}));assert.equal(state.caret,state.guide);if(state.bullet)assert.equal(state.bullet,state.guide);gaps.push({child,...state});
    }
    await move('Task child');await screenshot('lists-task-hover');return {metrics,gaps};
  });
  await check('list structure: compact checkboxes expand when entered from either direction', async () => {
    const label='Task parent',start=marker(label),end=source.indexOf(']',start)+1;
    const glyph=()=>liveEval(`const a=view.domAtPos(${from(label)},1),b=view.domAtPos(${from(label)+1},-1),range=root.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);return range.getBoundingClientRect().x;`);
    await select(from(label));const resting=await glyph();
    await key('ArrowLeft','ArrowLeft',37);assert.equal(await liveEval('return view.state.selection.main.head;'),end);
    const expanded=await glyph();assert(expanded-resting>20,'literal checkbox prefix expands to the right');
    await screenshot('lists-task-expanded');
    for(let head=end-1;head>=start;head--) {await key('ArrowLeft','ArrowLeft',37);assert.equal(await liveEval('return view.state.selection.main.head;'),head);}
    await key('ArrowLeft','ArrowLeft',37);await key('ArrowRight','ArrowRight',39);
    assert.equal(await liveEval('return view.state.selection.main.head;'),start);
    assert(Math.abs(await glyph()-expanded)<=0.5,'entering from the left reveals the same source prefix');
    await select(from(label));assert(Math.abs(await glyph()-resting)<=0.5);await select(from('Resting caret.'));
    return {resting,expanded,shift:expanded-resting};
  });
  await check('list structure: bullets and numbers stay fixed when source is revealed', async () => {
    const fixture = ['- Dash bullet ' + 'wrapped words '.repeat(8), '  + Plus child', '    * Star grandchild',
      '1. Number parent', '   1. Number child', '- [ ] Checkbox parent', '  - [x] Checkbox child', '', 'Resting caret.'].join('\n');
    const position = label => fixture.indexOf(label);
    const start = label => {
      const row = fixture.lastIndexOf('\n', position(label)) + 1;
      return row + fixture.slice(row, position(label)).search(/\S/);
    };
    const sample = label => liveEval(`const a=view.domAtPos(${position(label)},1),b=view.domAtPos(${position(label)+1},-1),range=root.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const text=range.getBoundingClientRect(),line=(a.node.nodeType===3?a.node.parentElement:a.node).closest('.cm-line'),slot=line.querySelector('.mlrt-list-bullet-slot,.mlrt-markdown-task-control'),glyph=root.createRange();if(slot)glyph.selectNodeContents(slot);const box=slot?.matches('.mlrt-list-bullet-slot')?glyph.getBoundingClientRect():slot?.getBoundingClientRect();return {x:text.x,y:text.y,height:line.getBoundingClientRect().height,markerCenter:box?box.x+box.width/2:null,rendered:!!line.querySelector('.mlrt-markdown-marker,.mlrt-markdown-task-control')};`);
    const results=[];
    try {
      await writeFixture(fixture);
      await liveEval("view.dom.style.width='450px';return true;");
      await select(position('Resting caret.'));
      await liveEval('view.scrollDOM.scrollTop=0;return true;');await sleep(150);
      const resting=Object.fromEntries(await Promise.all(['Dash bullet','Number parent','Checkbox parent','Plus child','Number child','Checkbox child'].map(async label=>[label,await sample(label)])));
      for(const labels of [['Dash bullet','Number parent','Checkbox parent'],['Plus child','Number child','Checkbox child']]) {
        for(const label of labels) assert(Math.abs(resting[label].x-resting[labels[0]].x)<=0.5,JSON.stringify(resting));
        assert(Math.abs(resting[labels[0]].markerCenter-resting[labels[2]].markerCenter)<=0.5,'bullet and checkbox marker centers align');
      }
      await screenshot('lists-markers-fixed-rendered');
      for(const label of ['Dash bullet','Plus child','Star grandchild','Number parent','Number child']) {
        const markerStart=start(label),markerEnd=markerStart+(label.startsWith('Number')?2:1);
        await select(position(label));const before=await sample(label);
        await select(markerEnd+1);await key('ArrowLeft','ArrowLeft',37);
        if(label==='Dash bullet') await screenshot('lists-marker-right-caret');
        for(let head=markerEnd;head>=markerStart;head--) {
          assert.equal(await liveEval('return view.state.selection.main.head;'),head);
          const literal=await sample(label);
          for(const metric of ['x','height']) assert(Math.abs(literal[metric]-before[metric])<=0.5,JSON.stringify({label,head,before,literal}));
          if(before.markerCenter!==null) {
            assert.equal(literal.rendered,false);
            assert(Math.abs(literal.markerCenter-before.markerCenter)<=0.5,JSON.stringify({label,before,literal}));
            const center=await liveEval(`const a=view.domAtPos(${markerStart},1),b=view.domAtPos(${markerEnd},-1),range=root.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const box=range.getBoundingClientRect();return box.x+box.width/2;`);
            assert(Math.abs(center-before.markerCenter)<=0.5,'literal bullet glyph keeps the rendered marker center');
            const caret=await liveEval(`const a=view.domAtPos(${markerStart},1),b=view.domAtPos(${markerEnd},-1),range=root.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const box=range.getBoundingClientRect(),expected=${head===markerStart?'box.left':'box.right'};return {defaultGap:view.coordsAtPos(${head}).left-expected,reverseGap:view.coordsAtPos(${head},-1).left-expected};`);
            for(const gap of Object.values(caret)) assert(Math.abs(gap)<=0.5,JSON.stringify({label,head,caret}));
          }
          if(head>markerStart) await key('ArrowLeft','ArrowLeft',37);
        }
        if(label==='Dash bullet'||label==='Star grandchild') await screenshot(`lists-markers-fixed-source-${label==='Dash bullet'?'dash':'star'}`);
        if(markerStart>0) {
          await select(markerStart-1);await key('ArrowRight','ArrowRight',39);
          assert.equal(await liveEval('return view.state.selection.main.head;'),markerStart);
          assert(Math.abs((await sample(label)).x-before.x)<=0.5,'entering from the left keeps the label column');
        }
        await select(position(label));const after=await sample(label);
        assert(Math.abs(after.x-before.x)<=0.5);
        results.push({label,before,after});
      }
      for(const label of ['Checkbox parent','Checkbox child']) {
        await select(position(label));const before=await sample(label);
        await select(start(label));const literal=await sample(label);
        assert(literal.x-before.x>20,'only checkbox labels expand for source syntax');
        results.push({label,shift:literal.x-before.x});
      }
      assert.equal(await liveEval('return view.state.doc.toString();'),fixture);
      return {resting,results,sourcePreserved:true};
    } finally {
      await liveEval("view.dom.style.width='';return true;");
      await restore();
    }
  });
  await check('list structure: literal bullets and all task-prefix caret boundaries', async () => {
    const observations=[];
    for(const label of ['Bullet list','Task parent','Task child']) {
      const start=marker(label),end=label==='Bullet list'?start+1:source.indexOf(']',start)+1;
      await select(start);
      for(let head=start;head<=end;head++) {
        const state=await liveEval('const head=view.state.selection.main.head,line=view.domAtPos(head).node;const el=(line.nodeType===3?line.parentElement:line).closest(".cm-line");return {head,markers:el.querySelectorAll(".mlrt-markdown-marker,.mlrt-markdown-task-control").length};');
        assert.equal(state.head,head);assert.equal(state.markers,0,`${label} at ${head-start}`);observations.push(state);
        if(head<end) await key('ArrowRight','ArrowRight',39);
      }
      for(let head=end-1;head>=start;head--) {await key('ArrowLeft','ArrowLeft',37);assert.equal(await liveEval('return view.state.selection.main.head;'),head);}
    }
    await screenshot('lists-task-source');await select(from('Resting caret.'));return {boundaries:observations.length};
  });
  await check('list structure: ordered and checkbox parents fold all descendants', async () => {
    for(const [parent,child] of [['Task parent','Task grandchild'],['Ordered parent','Mixed child']]) {
      await click(parent);assert(!(await visible()).includes(child));await click(parent);assert((await visible()).includes(child));
    }
    return {kinds:['ordered','task','mixed']};
  });
  await check('list structure: continuation, callout, code and table widgets collapse together', async () => {
    await select(from('Blocks parent'));await liveEval('view.scrollDOM.scrollTop=view.lineBlockAt(view.state.selection.main.head).top-80;return true;');await sleep(200);
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-table").length;'),1);
    await click('Blocks parent');const content=await visible();
    for(const hidden of ['bold','Quote child','nestedCode','Nested table'])assert(!content.includes(hidden),hidden);
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-table").length;'),0);
    await screenshot('lists-blocks-collapsed');
    await key('ArrowDown','ArrowDown',40);
    assert(await liveEval(`return view.state.doc.lineAt(view.state.selection.main.head).number===35 && root.querySelectorAll('.mlrt-list-fold-hint').length===1;`),'arrow skips hidden widgets to the visible blank row');
    await click('Blocks parent');await sleep(100);assert.equal(await liveEval('return root.querySelectorAll(".mlrt-table").length;'),1);
    assert.equal(await liveEval('return view.state.doc.toString();'),source);
    return {allNestedBlocksHidden:true,sourcePreserved:true};
  });
  await check('list structure: wrapped rows and viewport changes keep guides aligned', async () => {
    const wrapped=['- Parent '+ 'wrapping text '.repeat(24),'  - Child '+ 'more text '.repeat(40),'    - Grandchild','  - Sibling','- Next'].join('\n');
    await writeFixture(wrapped);await select(wrapped.indexOf('Grandchild'));
    await liveEval("view.dom.style.width='450px';view.scrollDOM.scrollTop=0;return true;");await sleep(200);
    const geometry=await liveEval(`const guide=root.querySelector('.mlrt-list-guide[data-list-from="0"]'),box=guide.getBoundingClientRect(),block=view.lineBlockAt(0);return {top:box.top,parentBottom:view.documentTop+block.bottom,height:box.height,parentHeight:block.height,lineHeight:view.defaultLineHeight};`);
    assert(geometry.parentHeight>geometry.lineHeight*2);assert(Math.abs(geometry.top-geometry.parentBottom)<=0.5,JSON.stringify(geometry));
    await screenshot('lists-wrapped');
    await liveEval("view.dom.style.width='';return true;");await sleep(200);
    const after=await liveEval("const box=root.querySelector('.mlrt-list-guide[data-list-from=\"0\"]').getBoundingClientRect();return {top:box.top,parentBottom:view.documentTop+view.lineBlockAt(0).bottom};");
    assert(Math.abs(after.top-after.parentBottom)<=0.5,JSON.stringify(after));
    await restore();return {geometry,after};
  });
  await check('list structure: typing directly below text preserves bullets, Enter and every gutter row', async () => {
    const above='Text directly above';
    await writeFixture(above+'\n');await select(above.length+1);
    const rows=()=>liveEval(`return {lines:[...view.contentDOM.querySelectorAll('.cm-line')].map(el=>({text:el.textContent,y:el.getBoundingClientRect().y,height:el.getBoundingClientRect().height})),gutters:[...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(el=>el.style.visibility!=='hidden').map(el=>Number(el.textContent)),headings:root.querySelectorAll('.mlrt-markdown-role-heading').length,bullets:root.querySelectorAll('.mlrt-list-bullet-row').length};`);
    const observations=[];
    for(const text of ['-',' ']) {
      await send('Input.insertText',{text});await sleep(180);
      const state=await rows();observations.push(state);
      assert.equal(state.headings,0,'typing a marker must not restyle the preceding text');
      assert.equal(state.bullets,1);assert.deepEqual(state.gutters,[1,2]);assert.equal(state.lines.length,2);
    }
    await screenshot('lists-adjacent-empty-bullet');
    await send('Input.insertText',{text:'item'});await key('Enter','Enter',13);await sleep(150);
    assert.equal(await liveEval('return view.state.doc.toString();'),above+'\n- item\n- ');
    let state=await rows();assert.deepEqual(state.gutters,[1,2,3]);assert.equal(state.lines.length,3);
    assert.equal(state.bullets,2);await screenshot('lists-adjacent-enter');
    await key('Enter','Enter',13);await sleep(150);
    assert.equal(await liveEval('return view.state.doc.toString();'),above+'\n- item\n');
    state=await rows();assert.deepEqual(state.gutters,[1,2,3]);assert.equal(state.lines.length,3);
    await send('Input.insertText',{text:'Text directly after the list'});await sleep(180);
    state=await rows();assert.equal(state.headings,0);assert.deepEqual(state.gutters,[1,2,3]);
    assert.equal(state.lines[2].text,'Text directly after the list');
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-list-guide").length;'),0,'following plain text is outside the list');
    await screenshot('lists-adjacent-plain-text');observations.push(state);
    // External fixture writes reload only clean documents. Save the native
    // typing above before restoring the next case's on-disk source.
    await key('s','KeyS',83,process.platform==='darwin'?4:2);await sleep(250);
    await restore();return {observations};
  });
  await check('list structure: adjacent formatting and dedented text stay outside folded lists', async () => {
    const adjacent=['Text above','- Parent','  - Child','**Bold after list**','*Italic*','`inline code`','9. Ordered','Plain after ordered','- [ ] Task','Plain after task','# Heading','> Quote','# After quote','- Final'].join('\n');
    await writeFixture(adjacent);await select(adjacent.length);
    const before=await gutter();assert.deepEqual(before.rows,Array.from({length:14},(_,i)=>i+1));
    const fold=await liveEval(`const button=root.querySelector('[data-list-from="${adjacent.indexOf('- Parent')}"]');if(!button)throw Error('Missing parent fold');const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...fold,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...fold,button:'left',clickCount:1});await sleep(180);
    const content=await visible();assert(!content.includes('Child'));
    for(const label of ['Bold after list','Italic','inline code','Plain after ordered','Plain after task','Heading','Final'])assert(content.includes(label),label);
    const after=await gutter();assert.deepEqual(after.rows,before.rows.filter(number=>number!==3));
    await screenshot('lists-adjacent-folded');await restore();return {before,after};
  });
}
