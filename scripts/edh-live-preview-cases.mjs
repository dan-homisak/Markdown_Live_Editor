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
  const content = () => liveEval('return view.contentDOM.textContent;');
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
  await check('live preview: code language, copy button, and fence reveal', async () => {
    await select(source.indexOf('const answer')+8);
    assert((await content()).includes('```js'));
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-preview-code-header").length;'),1);
    await screenshot('live-preview-code-edit');
    await liveEval('root.querySelector(".mlrt-preview-code-copy").focus();return true;');
    const copyFocus=await liveEval('return {active:root.activeElement?.className,debug:win.__MLRT_TEST_LIVE_PREVIEW__()};');
    await sleep(150);const settledFocus=await liveEval('return {active:root.activeElement?.className,debug:win.__MLRT_TEST_LIVE_PREVIEW__()};');
    await key('Enter','Enter',13); await sleep(250);
    const copied = await liveEval('return root.querySelector(".mlrt-preview-code-copy")?.textContent;'); assert.equal(copied,'Copied',JSON.stringify({copyFocus,settledFocus,after:await liveEval('return {copied:root.querySelector(".mlrt-preview-code-copy")?.textContent,active:root.activeElement?.outerHTML,focus:view.hasFocus,events:win.__MLRT_DEBUG_EVENTS__?.slice(-8)};')}));
    const clipboard = await liveEval('return win.navigator.clipboard.readText();'); assert.equal(clipboard.replace(/\r\n/g,'\n'),'const answer = 42;\n// exact code\n');
    await restore(); assert(!(await content()).includes('```'));
    return {language:'js',clipboard,sourceExact:true};
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
