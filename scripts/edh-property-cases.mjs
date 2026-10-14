import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';

export async function runPropertyChecks({ check, liveEval, select, screenshot, writeFixture, writeSettings, waitFor, sleep, send, key }) {
  const primary = process.platform === 'darwin' ? 4 : 2;
  const content = () => liveEval('return view.state.doc.toString();');
  const input = text => send('Input.insertText', { text });
  const enter = () => key('Enter', 'Enter', 13);
  const escape = () => key('Escape', 'Escape', 27);
  const save = async () => { await key('s', 'KeyS', 83, primary); await sleep(250); };
  const reset = async (text, at = text.length) => {
    await escape(); await save(); await writeFixture(text); await select(at);
    await liveEval('view.scrollDOM.scrollTop=0;return true;'); await sleep(150);
  };
  const options = () => liveEval('return Array.from(root.querySelectorAll(".cm-tooltip-autocomplete .cm-completionLabel")).map(el=>el.textContent);');
  const selected = () => liveEval('return root.querySelector(".cm-tooltip-autocomplete [aria-selected=true] .cm-completionLabel")?.textContent;');
  await check('properties: source rendering keeps exact text and stable row geometry at rest and while editing', async () => {
    const sample = '---\ntitle: Standard Markdown Fixture\ntags:\n  - markdown\n  - fixture\n  - render-test\ncreated: 2026-06-30\n---\n\n# Standard Markdown Fixture\n\nBody stays here.\n';
    await reset(sample);
    const measure = () => liveEval('return Array.from(root.querySelectorAll(".mlrt-markdown-block-frontmatter")).map(el=>{const b=el.getBoundingClientRect(),css=win.getComputedStyle(el);return {text:el.textContent,x:b.x,y:b.y,height:b.height,font:css.fontFamily,fontSize:css.fontSize,lineHeight:css.lineHeight};});');
    const resting = await measure(); assert.equal(resting.length,8); await screenshot('properties-resting');
    await select(sample.indexOf('title:')+6);
    const editing = await measure(); assert.deepEqual(editing,resting); assert.equal(await content(),sample);
    assert.equal(await liveEval('return root.querySelectorAll(".mlrt-preview-properties").length;'),0);
    await screenshot('properties-editing'); return {resting,stable:true};
  });
  await check('properties: a typed opener protects body text, suggests tags, and participates in host undo and redo', async () => {
    const body = '# Existing body\n\n---\nKeep this text.\n', before = '--\n'+body, expected = '---\n\n---\n\n'+body;
    await reset(before,2); await input('-');
    await waitFor(async()=>await content()===expected,'automatic closed frontmatter');
    await waitFor(async()=>await selected()==='tags','tags is the default suggestion');
    await screenshot('properties-suggestions');
    await escape(); await key('z','KeyZ',90,primary);
    await waitFor(async()=>await content()===before,'host undo opener and scaffold');
    await key('z','KeyZ',90,primary|8);
    await waitFor(async()=>await content()===expected,'host redo restores scaffold exactly');
    await select(4); await key(' ','Space',32,primary);
    await waitFor(async()=>await selected()==='tags','explicit property completion');
    await enter(); await input('markdown'); await enter(); await input('editor'); await enter(); await enter();
    await waitFor(async()=>await selected()==='aliases','existing tags is omitted');
    assert((await content()).includes('tags:\n  - markdown\n  - editor\n\n---\n\n'+body));
    await key('ArrowDown','ArrowDown',40); assert.equal(await selected(),'title'); await enter(); await input('A note');
    assert((await content()).includes('title: A note')); await screenshot('properties-keyboard-edit');
    await save(); return {bodyPreserved:true,undoRedo:true,tagsFirst:true,listContinuation:true,arrowCompletion:true};
  });
  await check('properties: punctuation, custom keys, spaces and canonical formatting preserve YAML values', async () => {
    await reset('---\ncustom\n---\n\nBody',10); await input(':'); await input('hello');
    assert.equal(await content(),'---\ncustom: hello\n---\n\nBody');
    await enter(); await escape(); await key('Tab','Tab',9); await input('child: value');
    assert((await content()).includes('\n  child: value\n'),await content()); assert(!(await content()).includes('\t'));
    const sample = '---\n# keep comment\ntitle:    "001"\ntags:\n    - one\ntext: |\n    literal:unchanged\n    another line\n---\n\n# Body\nuntouched\n';
    await reset(sample,sample.indexOf('one')+3); await input('x');
    const edited=await content(); await select(edited.indexOf('# Body'));
    await waitFor(async()=>(await content()).includes('title: "001"\ntags:\n  - onex'),'canonical format after leaving properties');
    const formatted=await content(), body=s=>s.slice(4,s.indexOf('\n---',4)+1);
    assert.deepEqual(parseDocument(body(formatted)).toJS(),parseDocument(body(edited)).toJS());
    assert(formatted.endsWith('\n---\n\n# Body\nuntouched\n')); assert(formatted.includes('# keep comment'));
    await screenshot('properties-formatted'); await save(); return {spacing:true,spacesOnly:true,scalarValuesPreserved:true,bodyExact:true};
  });
  await check('properties: malformed YAML is visibly diagnosed and retained for correction', async () => {
    const sample='---\ntitle: One\ntitle: Two\ntags: [unfinished\n---\n\nBody';
    await reset(sample,sample.indexOf('Two')+3); await input('!'); await select((await content()).indexOf('Body'));
    await waitFor(async()=>await liveEval('return root.querySelectorAll(".cm-lintRange-error").length>0;'),'visible YAML diagnostics');
    const errorStyle=await liveEval('const el=root.querySelector(".cm-lintRange-error"),css=win.getComputedStyle(el);return {line:css.textDecorationLine,style:css.textDecorationStyle};');
    assert.deepEqual(errorStyle,{line:'underline',style:'wavy'});
    assert.equal(await content(),sample.replace('Two','Two!'));
    await screenshot('properties-invalid');
    await reset('---\ntitle: Fixed\ntags: [one, two]\n---\n\nBody');
    await waitFor(async()=>await liveEval('return root.querySelectorAll(".cm-lintRange-error").length===0;'),'diagnostics clear after correction');
    return {visibleErrors:true,noLossyRepair:true,recovery:true};
  });
  await check('properties: multiline source and ordinary Markdown remain ordinary text', async () => {
    const sample='---\ntext: |\n  title\n---\n\nBody\n--';
    await reset(sample,sample.indexOf('title')+5); await input(':');
    assert((await content()).includes('  title\u003a\n')); await enter(); await input('literal');
    assert((await content()).includes('  title:\n  literal'));
    await select((await content()).length); await input('-');
    assert((await content()).endsWith('Body\n---'));
    await save();
    await writeSettings({'markdownLiveRenderTables.markdownRendering.enabled':false});
    await reset('--\nBody',2); await input('-'); assert.equal(await content(),'---\nBody');
    await save(); await writeSettings(); return {literalContentsPreserved:true,bodyUnaffected:true,disabledModeUnaffected:true};
  });
}
