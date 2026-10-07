import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function runLivePreviewChecks({check,liveEval,select,screenshot,writeFixture,writeSettings,waitFor,sleep,palette,send,key,workbench,reopenFixture,text,repo}) {
  const source = ['---', 'title: "Live preview"', 'tags:', '  - notes', '  - editor', '---', '',
    '# Live preview', '', 'Plain **bold**, *italic*, ~~strike~~ and `inline code`.',
    '[Local target](./LinkedTarget.md) and [[LinkedTarget|Wiki alias]].', '',
    '- Parent', '  - Child', '    - Grandchild', 'After list', '',
    '- [ ] Open task', '- [x] Done task', '',
    '> [!TIP] A useful callout', '> **Styled** content.', '',
    '> [!INFO]- Folded title', '> Hidden callout body.', '',
    '```js', 'const answer = 42;', '// exact code', '```', '',
    '| A | B |', '| --- | --- |', '| **Table bold** | value |', '', 'Resting caret.', ''].join('\n');
  const restore = async () => { await writeFixture(source); await select(source.indexOf('Resting caret')); await liveEval('view.scrollDOM.scrollTop=0;return true;'); await sleep(300); };
  const content = () => liveEval('const clone=view.contentDOM.cloneNode(true);clone.querySelectorAll(".mlrt-preview-code-copy").forEach(button=>{const suffix=button.dataset.copyState==="language"?"label":button.dataset.copyState;button.querySelectorAll("span").forEach(span=>{if(!span.classList.contains("mlrt-preview-code-copy-"+suffix))span.remove();});});clone.querySelectorAll(".mlrt-preview-code-fence-hidden,.mlrt-preview-code-copy-size").forEach(el=>el.remove());return clone.textContent;');
  const copyText = () => liveEval('const button=root.querySelector(".mlrt-preview-code-copy");return button?.querySelector(".mlrt-preview-code-copy-"+(button.dataset.copyState==="language"?"label":button.dataset.copyState))?.textContent;');
  await restore();
  await check('live preview: resting syntax is removed, properties and semantic content render', async () => {
    const visible = await content();
    assert(!visible.includes('**bold**')); assert(!visible.includes('*italic*')); assert(!visible.includes('`inline code`'));
    assert(!visible.includes('](./LinkedTarget.md)')); assert(!visible.includes('[[LinkedTarget')); assert(!visible.includes('```'));
    assert(visible.includes('bold')); assert(visible.includes('inline code')); assert(visible.includes('Wiki alias'));
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-preview-properties").length;'),1);
    assert.equal(await liveEval('return view.state.doc.toString();'),source);
    await screenshot('live-preview-resting'); return {visible,sourceExact:true};
  });
  await check('live preview: inline code surfaces have centered padding, separate rows and enclosed backticks', async () => {
    const sample = ['This `paragraph` has a code span.', 'This `should` appear on its own line.', 'The `JobInterest` and `Qualified` fields.', '', 'Resting caret.'].join('\n');
    await writeFixture(sample); await select(sample.indexOf('Resting caret')); await liveEval('view.scrollDOM.scrollTop=0;return true;'); await sleep(200);
    const measure = () => liveEval(`const rect=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height};};return Array.from(root.querySelectorAll('.mlrt-markdown-inline-code')).map(el=>{const range=root.createRange();range.selectNodeContents(el);const css=win.getComputedStyle(el);return {text:el.textContent,box:rect(el),glyph:rect(range),padding:[css.paddingTop,css.paddingBottom,css.paddingLeft,css.paddingRight],nested:el.querySelectorAll('.mlrt-markdown-inline-code').length};});`);
    const resting=await measure(); assert.equal(resting.length,4);
    assert(resting[0].text==='paragraph' && resting[1].text==='should');
    assert(resting[1].box.top-resting[0].box.bottom>=1,'consecutive backgrounds have a visible gap');
    for(const span of resting){assert.equal(span.nested,0);assert.deepEqual(span.padding,['0.5px','0.5px','4px','4px']);assert(Math.abs((span.box.top+span.box.bottom-span.glyph.top-span.glyph.bottom)/2)<0.5,'surface centered on actual text boxes');}
    await screenshot('inline-code-consecutive-resting');
    await select(sample.indexOf('paragraph')+3);
    const editing=await measure();assert.equal(editing[0].text,'`paragraph`');assert.equal(editing[0].nested,0);
    assert(editing[0].box.left<editing[0].glyph.left && editing[0].box.right>editing[0].glyph.right,'padding encloses the source backticks');
    assert(editing[1].box.top-editing[0].box.bottom>=1);
    assert.equal(await liveEval('return view.state.doc.toString();'),sample);
    await screenshot('inline-code-consecutive-editing'); await restore(); return {resting,editing};
  });
  await check('live preview: caret and selection reveal only the active formatting', async () => {
    const observations=[];
    for (const [word,syntax] of [['bold','**bold**'],['italic','*italic*'],['inline code','`inline code`'],['Local target','[Local target](./LinkedTarget.md)'],['Wiki alias','[[LinkedTarget|Wiki alias]]']]) {
      await select(source.indexOf(word)+2); const visible=await content(); assert(visible.includes(syntax),syntax); observations.push(syntax);
    }
    await liveEval(`view.dispatch({selection:{anchor:${source.indexOf('bold')},head:${source.indexOf('bold')+4}}});return true;`);
    assert((await content()).includes('**bold**'));
    await restore(); assert(!(await content()).includes('**bold**'));
    return {observations};
  });
  await check('live preview: property editing reveals exact YAML then restores the property view', async () => {
    await liveEval('root.querySelector(".mlrt-preview-property").click();return true;'); await sleep(250);
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-preview-properties").length;'),0);
    assert((await content()).includes('title: "Live preview"'));
    await screenshot('live-preview-yaml-edit'); await restore();
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-preview-properties").length;'),1);
    return {sourceExact:await liveEval('return view.state.doc.toString();')===source};
  });
  await check('live preview: arrows enter opening and closing code fences at the source text end', async () => {
    const observations=[];
    for (const [opening,closing,body] of [['```python','```','print("hello")'],['```','```','plain code'],['~~~~js','~~~~  ','const n = 1;'],['> ```python','> ```','> print("hello")']]) {
      const before='Before the code block with a long line of text.',after='After the code block with a long line of text.';
      const sample=[before,opening,body,closing,after].join('\n');
      await writeFixture(sample);
      for (const column of [0,6,before.length]) for (const forward of [true,false]) {
        const from=forward?0:sample.lastIndexOf(after);
        await select(from+Math.min(column,forward?before.length:after.length));
        await key(forward?'ArrowDown':'ArrowUp',forward?'ArrowDown':'ArrowUp',forward?40:38);
        const expected=forward?before.length+1+opening.length:sample.lastIndexOf(closing)+closing.trimEnd().length;
        const actual=await liveEval('const head=view.state.selection.main.head,point=view.domAtPos(head,-1),range=root.createRange();range.setStart(point.node,point.offset);range.setEnd(point.node,point.offset);const textBox=range.getBoundingClientRect(),caret=view.coordsAtPos(head,view.state.selection.main.assoc);return {head,assoc:view.state.selection.main.assoc,caretLeft:caret?.left,textRight:textBox.right,line:view.state.doc.lineAt(head).number,source:view.state.doc.toString(),toolbar:root.querySelector(".mlrt-preview-code-copy")?.getBoundingClientRect().left};');
        assert.equal(actual.head,expected,JSON.stringify({opening,column,forward,actual}));
        assert.equal(actual.source,sample,'navigation preserves the complete document');
        assert(Math.abs(actual.caretLeft-actual.textRight)<=0.5,'caret sits at the last source glyph: '+JSON.stringify(actual));
        observations.push({opening,column,forward,...actual,source:undefined});
        if(opening==='```python'&&column===before.length)await screenshot(forward?'fence-arrow-down':'fence-arrow-up');
        await key(forward?'ArrowDown':'ArrowUp',forward?'ArrowDown':'ArrowUp',forward?40:38);
        assert.equal(await liveEval('return view.state.doc.lineAt(view.state.selection.main.head).number;'),3,'the following arrow reaches the code body');
      }
    }
    const wrapped=['Long prose '.repeat(180),'```python','print("hello")','```','Long prose '.repeat(180)].join('\n');
    await writeFixture(wrapped);
    await select(0);await key('ArrowDown','ArrowDown',40);
    assert.equal(await liveEval('return view.state.doc.lineAt(view.state.selection.main.head).number;'),1);
    await select(wrapped.length);await key('ArrowUp','ArrowUp',38);
    assert.equal(await liveEval('return view.state.doc.lineAt(view.state.selection.main.head).number;'),5);
    await restore();return {observations,wrappedRowsStayNative:true};
  });
  await check('live preview: code language, copy button, and fence reveal', async () => {
    await select(source.indexOf('const answer')+8);
    assert((await content()).includes('```js'));
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-preview-code-header").length;'),1);
    await screenshot('live-preview-code-edit');
    await liveEval('root.querySelector(".mlrt-preview-code-copy").focus();return true;');
    const copyFocus=await liveEval('return {active:root.activeElement?.className,debug:win.__MLRT_TEST_LIVE_PREVIEW__()};');
    await sleep(150);const settledFocus=await liveEval('return {active:root.activeElement?.className,debug:win.__MLRT_TEST_LIVE_PREVIEW__()};');
    await key('Enter','Enter',13); await sleep(250);
    const copied = await copyText(); assert.equal(copied,'Copied',JSON.stringify({copyFocus,settledFocus,after:await liveEval('return {active:root.activeElement?.outerHTML,focus:view.hasFocus,events:win.__MLRT_DEBUG_EVENTS__?.slice(-8)};')}));
    const clipboard = await liveEval('return win.navigator.clipboard.readText();'); assert.equal(clipboard.replace(/\r\n/g,'\n'),'const answer = 42;\n// exact code\n');
    await restore(); assert(!(await content()).includes('```'));
    return {language:'js',clipboard,sourceExact:true};
  });
  await check('live preview: language replaces Copy until hover and the control stays within rounded code', async () => {
    const codeSource=['Resting caret.', '', '```typescript', 'const answer: number = 42;', '```', '', 'After code.', '',
      '    indented code', '    second indented row', '', 'After indented code.'].join('\n');
    await writeFixture(codeSource); await select(0); await liveEval('view.scrollDOM.scrollTop=0;return true;'); await sleep(250);
    const snapshot=()=>liveEval(`const button=root.querySelector('.mlrt-preview-code-copy'),row=button.closest('.cm-line'),end=root.querySelector('.cm-line.mlrt-markdown-block-end'),css=win.getComputedStyle(button),firstCSS=win.getComputedStyle(row),endCSS=win.getComputedStyle(end),rect=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};const label=button.querySelector('.mlrt-preview-code-copy-'+(button.dataset.copyState==='language'?'label':button.dataset.copyState)),glyph=root.createRange();glyph.selectNodeContents(label);const frame=Array.from(document.querySelectorAll('iframe')).find(frame=>frame.contentDocument===root)?.getBoundingClientRect();return {label:label.textContent,labelBox:rect(label),glyph:rect(glyph),button:rect(button),row:rect(row),end:rect(end),hover:button.matches(':hover'),focus:button===root.activeElement,fontSize:css.fontSize,rowFontSize:firstCSS.fontSize,fontFamily:css.fontFamily,rowFontFamily:firstCSS.fontFamily,textAlign:css.textAlign,layers:Array.from(button.querySelectorAll('.mlrt-preview-code-copy-label,.mlrt-preview-code-copy-action,.mlrt-preview-code-copy-status')).map(el=>{const style=win.getComputedStyle(el);return {role:el.className,fontSize:style.fontSize,fontFamily:style.fontFamily,opacity:parseFloat(style.opacity),transitionDuration:style.transitionDuration};}),firstShadow:firstCSS.boxShadow,endShadow:endCSS.boxShadow,firstRadius:[firstCSS.borderTopLeftRadius,firstCSS.borderTopRightRadius],endRadius:[endCSS.borderBottomLeftRadius,endCSS.borderBottomRightRadius],border:[firstCSS.borderTopWidth,endCSS.borderBottomWidth],outline:css.outlineWidth,outlineOffset:css.outlineOffset,source:view.state.doc.toString(),hidden:root.querySelector('.mlrt-preview-code-fence-hidden')?.textContent,frame:{left:frame?.left??0,top:frame?.top??0}};`);
    const inside=state=>{assert(state.button.left>=state.row.left);assert(state.button.right<=state.row.right);assert(state.button.top>=state.row.top);assert(state.button.bottom<=state.row.bottom+2.1,'only the allowed 2px extends below the opening row');assert(state.button.bottom<=state.end.bottom);};
    const centered=state=>{for(const axis of [['left','right'],['top','bottom']])assert(Math.abs((state.labelBox[axis[0]]+state.labelBox[axis[1]]-state.button[axis[0]]-state.button[axis[1]])/2)<=0.5,'label centered in the button');assert(Math.abs((state.glyph.left+state.glyph.right-state.button.left-state.button.right)/2)<=0.5,'actual text is centered');assert.equal(state.textAlign,'center');assert.equal(state.fontSize,state.rowFontSize);assert.equal(state.fontFamily,state.rowFontFamily);assert(state.layers.every(layer=>layer.fontSize===state.fontSize&&layer.fontFamily===state.fontFamily));};
    try {
      // Exercise both modes explicitly, independent of the Windows motion setting.
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2}); await sleep(100);
      const before=await snapshot(); inside(before);centered(before); assert.equal(before.label,'typescript'); assert.equal(before.hidden,'```typescript');
      const indentedCorners=await liveEval("const end=Array.from(root.querySelectorAll('.cm-line.mlrt-markdown-block-end')).at(-1),css=win.getComputedStyle(end);return [css.borderBottomLeftRadius,css.borderBottomRightRadius];");
      assert.deepEqual(indentedCorners,['3px','3px']);
      assert.deepEqual(before.firstRadius,['3px','3px']);assert.deepEqual(before.endRadius,['3px','3px']);assert.deepEqual(before.border,['0px','0px']);
      assert.equal(before.firstShadow,before.endShadow);assert(before.firstShadow.includes(' 0px 0px 0px 0px inset'),'no horizontal code border');
      await screenshot('code-language-control');
      const point={x:before.button.left+2+before.frame.left,y:(before.button.top+before.button.bottom)/2+before.frame.top};
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point}); await sleep(60);
      const crossfade=await snapshot();assert(crossfade.layers.slice(0,2).every(layer=>layer.opacity>0&&layer.opacity<1),'language and Copy overlap briefly during a real crossfade: '+JSON.stringify({hover:crossfade.hover,layers:crossfade.layers}));
      await sleep(180);
      const hovered=await snapshot();inside(hovered);centered(hovered);assert(hovered.hover);assert.equal(hovered.label,'Copy');assert.deepEqual(hovered.button,before.button,'hover reserves the language width');
      await screenshot('code-language-control-hover');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
      await waitFor(async()=>(await snapshot()).label==='Copied','pointer copy feedback');
      assert.equal((await liveEval('return win.navigator.clipboard.readText();')).replace(/\r\n/g,'\n'),'const answer: number = 42;\n');
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
      await waitFor(async()=>(await snapshot()).label==='typescript','language returns after copy feedback');
      await liveEval('root.querySelector(".mlrt-preview-code-copy").focus();return true;');await sleep(150);await key('Tab','Tab',9,8);await key('Tab','Tab',9);
      const focused=await snapshot();inside(focused);centered(focused);assert.equal(focused.label,'Copy');assert(parseFloat(focused.outlineOffset)+parseFloat(focused.outline)<=0,'focus outline is inset');
      await screenshot('code-language-control-focus');
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert((await snapshot()).layers.every(layer=>layer.transitionDuration==='0s'),'reduced motion disables the label animation');
      assert.equal(await liveEval('return win.getComputedStyle(root.querySelector(".mlrt-preview-code-copy")).transitionDuration;'),'0s','reduced motion disables the background animation');
      assert.equal(focused.source,codeSource);return {before,crossfade,hovered,focused,pointerCopy:true,reducedMotion:true};
    } finally { await send('Emulation.setEmulatedMedia',{features:[]});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await restore(); }
  });
  await check('live preview: fence glyphs reveal without moving numbered rows or wrapped code', async () => {
    const stable = ['Resting caret.', '', '```ts', 'const answer: number = 42;',
      '// This intentionally long code row wraps at narrow editor widths while its source row and gutter number stay fixed throughout fence reveal.',
      '```', 'After TypeScript.', '', '~~~', 'plain code', '~~~', 'After plain code.', '',
      '> ```js', '> const quoted = 1;', '> ```', 'After quoted code.'].join('\n');
    const anchors = [stable.indexOf('```ts'), stable.indexOf('answer'), stable.indexOf('\n```') + 1,
      stable.indexOf('~~~'), stable.indexOf('plain code'), stable.lastIndexOf('~~~'),
      stable.indexOf('```js'), stable.indexOf('quoted'), stable.lastIndexOf('```')];
    await writeFixture(stable);
    const oldWidth = await liveEval('return view.dom.style.width;');
    const measure = () => liveEval(`const rows=[];for(let number=1;number<=view.state.doc.lines;number++){const line=view.state.doc.line(number),block=view.lineBlockAt(line.from),at=view.domAtPos(line.from,1),el=at.node.nodeType===3?at.node.parentElement:at.node;const gutter=Array.from(root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')).find(el=>el.textContent.trim()===String(number));const range=root.createRange();const end=view.domAtPos(Math.min(line.to,line.from+1),-1);range.setStart(at.node,at.offset);range.setEnd(end.node,end.offset);const glyph=range.getBoundingClientRect();rows.push({number,top:block.top,height:block.height,x:glyph.x,y:glyph.y+view.scrollDOM.scrollTop,glyphHeight:glyph.height,gutterVisible:!!gutter&&win.getComputedStyle(gutter).visibility==='visible',gutterHeight:gutter?.getBoundingClientRect().height});}return {rows,height:view.contentHeight,source:view.state.doc.toString(),hidden:root.querySelectorAll('.mlrt-preview-code-fence-hidden').length};`);
    const observations=[];
    try {
      for (const width of [600,360]) {
        await liveEval(`view.dom.style.width='${width}px';view.scrollDOM.scrollTop=0;return true;`);
        await select(0); await sleep(300);
        const before=await measure(); assert.equal(before.source,stable);
        assert(before.rows.every(row=>row.gutterVisible),'every source row, including both fences, has a visible number');
        assert(before.hidden>=6);
        await screenshot(`code-rows-${width}-preview`);
        let maxDelta=0;
        for(const anchor of anchors) {
          await select(anchor); const after=await measure();
          assert.equal(after.source,stable); assert.equal(after.rows.length,before.rows.length);
          assert.equal(after.height,before.height,'content height stays fixed');
          assert(after.rows.every(row=>row.gutterVisible));
          for(let i=0;i<before.rows.length;i++) for(const property of ['top','height','x','y','glyphHeight','gutterHeight']) maxDelta=Math.max(maxDelta,Math.abs(before.rows[i][property]-after.rows[i][property]));
          assert(maxDelta<=0.5,`row/glyph/gutter drift ${maxDelta}px`);
        }
        await select(stable.indexOf('answer')); await screenshot(`code-rows-${width}-source`);
        observations.push({width,maxDelta,rows:before.rows,contentHeight:before.height});
      }
    } finally { await liveEval(`view.dom.style.width=${JSON.stringify(oldWidth)};return true;`); await restore(); }
    return observations;
  });
  await check('live preview: six heading colors and marker setting update the open editor', async () => {
    const headings=['Resting caret.', '', ...Array.from({length:6},(_,index)=>'#'.repeat(index+1)+' Heading '+(index+1)), '', '## Closing markers ##'].join('\n');
    await writeFixture(headings); await select(0); await sleep(250);
    const inspect=()=>liveEval(`return Array.from({length:6},(_,index)=>{const el=root.querySelector('.mlrt-markdown-role-heading.mlrt-markdown-heading-'+(index+1)),css=win.getComputedStyle(el);return {level:index+1,text:el.textContent,color:css.color,fontSize:css.fontSize,lineHeight:css.lineHeight};});`);
    try {
      const before=await inspect(); assert.equal(new Set(before.map(row=>row.color)).size,6);
      assert(before.every(row=>row.text.startsWith('#'.repeat(row.level))&&row.fontSize==='14px'));
      await screenshot('heading-levels-visible');
      await writeSettings({'markdownLiveRenderTables.markdownRendering.showHeadingMarkers':false});
      await waitFor(async()=>!(await content()).includes('#'),'hidden heading markers after settings change');
      await screenshot('heading-levels-hidden');
      await select(headings.indexOf('Heading 3'));
      assert((await content()).includes('### Heading 3'),'active heading reveals its exact source');
      await select(0); await writeSettings({'markdownLiveRenderTables.markdownRendering.showHeadingMarkers':true});
      await waitFor(async()=>(await content()).includes('###### Heading 6'),'visible heading markers after settings change');
      assert.deepEqual(await inspect(),before,'color and text metrics survive the toggle');
      assert.equal(await liveEval('return view.state.doc.toString();'),headings);
      return before;
    } finally { await writeSettings(); await restore(); }
  });
  await check('live preview: Obsidian task treatment and expandable callouts', async () => {
    const task=await liveEval('const el=root.querySelector(".mlrt-markdown-task-control[aria-checked=true]"),css=win.getComputedStyle(el,"::after");return {radius:css.borderRadius,fill:css.backgroundColor,prefixes:root.querySelectorAll(".mlrt-markdown-task-list-prefix").length};');
    assert.equal(task.radius,'3px'); assert.equal(task.prefixes,2);
    assert(!(await content()).includes('Hidden callout body'));
    await liveEval('root.querySelector(".mlrt-preview-callout-fold").click();return true;'); await sleep(200);
    assert((await content()).includes('Hidden callout body'));
    await select(source.indexOf('Hidden callout body')+3); assert((await content()).includes('[!INFO]- Folded title'));
    await restore(); await screenshot('live-preview-callouts-tasks'); return task;
  });
  await check('live preview: smart vertical caret, list nesting, continuation and host Undo', async () => {
    await select(source.indexOf('After list'));
    const navigation=await liveEval('return win.__MLRT_TEST_LIVE_PREVIEW__();');
    await key('ArrowUp','ArrowUp',38);
    assert.equal(await liveEval('return view.state.selection.main.head;'),source.indexOf('Grandchild'),JSON.stringify({navigation,after:await liveEval('return {focus:view.hasFocus,active:root.activeElement?.className,events:win.__MLRT_DEBUG_EVENTS__?.slice(-6)};')}));
    await select(source.indexOf('Child')+2); await key('Tab','Tab',9);
    await waitFor(async()=> (await liveEval('return view.state.doc.toString();')).includes('    - Child\n      - Grandchild'),'nested child');
    await key('Tab','Tab',9,8);
    assert.equal(await liveEval('return view.state.doc.toString();'),source);
    await sleep(300);
    // Return the real host undo stack to its saved checkpoint, rather than
    // using an external file write to overwrite a dirty editor.
    await key('z','KeyZ',90,process.platform==='darwin'?4:2); await sleep(150);
    await key('z','KeyZ',90,process.platform==='darwin'?4:2); await sleep(150);
    assert.equal(await liveEval('return view.state.doc.toString();'),source);
    await select(source.indexOf('Open task')+'Open task'.length); await key('Enter','Enter',13);
    try { await waitFor(async()=> (await liveEval('return view.state.doc.toString();')).includes('Open task\n- [ ] '),'continued task'); }
    catch(error) { throw Error(`${error}; ${JSON.stringify(await liveEval('return {source:view.state.doc.toString(),events:win.__MLRT_DEBUG_EVENTS__?.slice(-10)};'))}`); }
    await key('z','KeyZ',90,process.platform==='darwin'?4:2);
    await waitFor(async()=> await liveEval('return view.state.doc.toString();')===source,'host Undo list continuation');
    await restore(); return {clampedToText:true,nesting:true,taskContinuation:true,hostUndo:true};
  });
  await check('live preview: table ownership and recovery survive syntax concealment', async () => {
    await select(source.indexOf('Resting caret'));
    await liveEval('win.__MLRT_PREVIEW_TABLE=root.querySelector(".mlrt-table-widget");return true;');
    await select(source.indexOf('bold')+1);
    assert(await liveEval('return win.__MLRT_PREVIEW_TABLE===root.querySelector(".mlrt-table-widget");'));
    await writeSettings({'markdownLiveRenderTables.markdownRendering.enabled':false});
    assert((await content()).includes('**bold**')); assert.equal(await liveEval('return root.querySelectorAll(".mlrt-preview-properties").length;'),0);
    assert(await liveEval('return !!root.querySelector(".mlrt-table-widget");'));
    await writeSettings(); await restore(); return {tableRetained:true,recovery:true};
  });
  await check('live preview: plain click opens a rendered Markdown link and wiki command resolves a note', async () => {
    await restore();
    await liveEval(`win.__MLRT_PREVIEW_POINTERS=[];for(const type of ['pointerdown','pointerup','mousedown'])root.addEventListener(type,event=>{const row={type,x:event.clientX,y:event.clientY,target:event.target?.className,head:view.state.selection.main.head};win.__MLRT_PREVIEW_POINTERS.push(row);queueMicrotask(()=>{row.prevented=event.defaultPrevented;row.after=view.state.selection.main.head;});},true);return true;`);
    const point=await liveEval(`const at=view.domAtPos(${source.indexOf('Local target')+2});const r=root.createRange();r.setStart(at.node,at.offset);r.setEnd(at.node,at.offset+1);const b=r.getBoundingClientRect();const f=Array.from(document.querySelectorAll('iframe')).find(f=>f.contentDocument===root)?.getBoundingClientRect();return {x:b.left+b.width/2+(f?.left??0),y:b.top+b.height/2+(f?.top??0)};`);
    const linkBefore=await liveEval(`return win.__MLRT_TEST_LIVE_PREVIEW__(${point.x},${point.y});`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
    try { await waitFor(async()=>workbench("Array.from(document.querySelectorAll('.tab.active')).some(tab=>tab.textContent.includes('LinkedTarget.md'))"),'plain link target'); }
    catch(error) { throw Error(`${error}; ${JSON.stringify({linkBefore,after:await liveEval('return {pointers:win.__MLRT_PREVIEW_POINTERS,events:win.__MLRT_DEBUG_EVENTS__?.slice(-8)};')})}`); }
    await reopenFixture(); await select(source.indexOf('Wiki alias')+2);
    await palette('Markdown Live Editor: Open Markdown Link at Caret');
    await waitFor(async()=>workbench("Array.from(document.querySelectorAll('.tab.active')).some(tab=>tab.textContent.includes('LinkedTarget.md'))"),'wiki target');
    await reopenFixture(); await restore(); return {plainClick:true,wikiAlias:true};
  });
  await check('live preview: actual user fixture remains exact and renders without literal formatting', async () => {
    const standard=(await readFile(path.join(repo,'standard-markdown-fixture.md'),'utf8')).replace(/\r\n/g,'\n');
    await writeFixture(standard); await select(standard.length);
    for(const [name,needle] of [['standard-properties','# Standard Markdown Fixture'],['standard-inline','## Emphasis'],['standard-code','## Code Blocks'],['standard-callouts','> [!NOTE]']]) {
      const position=standard.indexOf(needle); if(position<0)continue;
      await liveEval(`view.scrollDOM.scrollTop=view.lineBlockAt(${position}).top;return true;`); await sleep(350); await screenshot(`live-preview-${name}`);
    }
    assert.equal(await liveEval('return view.state.doc.toString();'),standard); await restore(); return {sourceLength:standard.length,sourceExact:true};
  });
  await writeFixture(text); await select(0);
}
