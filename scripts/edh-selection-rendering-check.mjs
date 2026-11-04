import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Actual composited-pixel regressions. A correct CSS background on a hidden
// layer is not sufficient: code/YAML used to cover every selected glyph.
export async function runSelectionRenderingCheck({ liveClient, wb, evaluateJson, qaDir }) {
  await wb.send('Page.bringToFront');
  const evaluate = body => evaluateJson(liveClient, `(async () => {
    const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
    const root = roots.find(doc => doc.defaultView.__MLRT_EDITOR_VIEW__), win = root.defaultView, view = win.__MLRT_EDITOR_VIEW__;
    const frames = (n=4) => new Promise(resolve => { const step = () => n-- ? win.requestAnimationFrame(step) : resolve(); step(); });
    ${body}
  })()`);
  const source = [
    '---', 'title: Selected properties', 'enabled: true', '---', '',
    'Before **bold** and `inline code` after.',
    '```ts', 'const selected = 12345;', 'const next = 2;', '```', '',
    '> [!NOTE] Callout', '> First callout row', '> Second row', '',
    'A wide selected row for corners', 'short', '', '', 'finish',
    '- List item with a long description '.repeat(8),
    'A long wrapped paragraph '.repeat(12), 'last',
    '# A heading with **bold** and `inline code`',
    '- [ ] A task to select', 'prefix אבגדה suffix', '\tIndented with a tab',
  ].join('\n');
  const outer = await evaluateJson(wb, `JSON.stringify((() => {
    const r = [...document.querySelectorAll('iframe')].find(f => f.src.startsWith('vscode-webview:') && f.getBoundingClientRect().width > 0).getBoundingClientRect();
    return {x:r.x,y:r.y,width:innerWidth,height:innerHeight};
  })())`);
  await evaluate(`win.__MLRT_TEST_SET_HOST_ISOLATION__(true);
    win.dispatchEvent(new win.MessageEvent('message', {data:{type:'setDocument',text:${JSON.stringify(source)},revision:999900,debug:false}}));
    await frames(); return JSON.stringify(true);`);
  const cases = [
    ['yaml', source.indexOf('Selected properties'), source.indexOf('enabled: true') + 7],
    ['inline-code', source.indexOf('Before'), source.indexOf(' after.') + 7],
    ['code', source.indexOf('const selected') + 3, source.indexOf('const next') + 8],
    ['callout', source.indexOf('First callout') + 2, source.indexOf('Second row') + 6],
    ['corners-and-empty-lines', source.indexOf('wide selected'), source.indexOf('finish') + 3],
    ['wrapped', source.indexOf('A long wrapped') + 5, source.indexOf('\nlast') + 3],
    ['wrapped-list', source.indexOf('- List item') + 4, source.indexOf('\nA long wrapped') - 5],
    ['heading', source.indexOf('A heading'), source.indexOf('\n- [ ]')],
    ['task', source.indexOf('- [ ]'), source.indexOf('\nprefix')],
    ['bidi', source.indexOf('prefix'), source.indexOf('אבגדה') + 2],
    ['tab', source.indexOf('\tIndented'), source.length],
  ];
  const reports = [];
  try {
    for (const [name, anchor, head] of cases) {
      const state = await evaluate(`view.focus(); view.dispatch({selection:{anchor:${anchor},head:${head}}});
        await frames(); view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(${anchor}).top - 30);
        await frames();
        const rows = [...root.querySelectorAll('.mlrt-prose-selection-rect')];
        const rect = r => ({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
        const boxes = rows.map(el => rect(el.getBoundingClientRect()));
        const styles = rows.map(el => { const s=win.getComputedStyle(el); return {fill:s.backgroundColor,radius:s.borderRadius}; });
        const fillets = [...root.querySelectorAll('.mlrt-selection-fillet')].map(el => ({...rect(el.getBoundingClientRect()),clip:el.style.clipPath}));
        const layout = [...view.contentDOM.querySelectorAll('.cm-line')].map(el => ({text:el.textContent,...rect(el.getBoundingClientRect())}));
        view.dispatch({selection:{anchor:${head},head:${anchor}}}); await frames();
        const reverse = [...root.querySelectorAll('.mlrt-prose-selection-rect')].map(el => rect(el.getBoundingClientRect()));
        const reverseLayout = [...view.contentDOM.querySelectorAll('.cm-line')].map(el => ({text:el.textContent,...rect(el.getBoundingClientRect())}));
        const iframe = win.frameElement?.getBoundingClientRect() ?? {left:0,top:0};
        return JSON.stringify({boxes,styles,fillets,layout,reverse,reverseLayout,inner:{x:iframe.left,y:iframe.top},dpr:win.devicePixelRatio});`);
      assert.deepEqual(state.reverse, state.boxes, name + ': reverse selection has identical geometry');
      assert.deepEqual(state.reverseLayout, state.layout, name + ': reversing selection does not reflow text');
      assert(state.boxes.length > 0, name + ': has selected rows');
      if (name === 'wrapped' || name === 'wrapped-list') {
        assert(state.boxes.length >= 2, name + ': exercises a real soft wrap');
        for (let i=1; i<state.boxes.length; i++) assert(Math.abs(state.boxes[i-1].bottom-state.boxes[i].top)<0.01, name+': no inter-row seam');
      }
      const visible = await wb.send('Page.captureScreenshot', {format:'png'});
      await writeFile(path.join(qaDir, `edh-selection-${name}-visible.png`), Buffer.from(visible.result.data,'base64'));
      // Hide ink only; preserve all real backgrounds, padding and stacking.
      // A reference swatch at each selected row's y uses that row's own block
      // surface, so translucent theme selections are tested as composites.
      const samples = await evaluate(`const style=root.createElement('style'); style.id='selection-pixel-ink';
        style.textContent='.cm-content,.cm-content *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}.cm-cursorLayer{visibility:hidden!important}.mlrt-selection-whitespace{background-image:none!important}';
        root.head.append(style);
        const rows=[...root.querySelectorAll('.mlrt-prose-selection-rect')];
        const samples=[];
        const addSample=(x,y,corner=false)=>{
          const line=[...view.contentDOM.querySelectorAll('.cm-line')].find(el=>{const b=el.getBoundingClientRect();return y>=b.top&&y<b.bottom;});
          if(!line) return;
          const probe=root.createElement('div'); probe.className='selection-pixel-probe';
          const py=8+samples.length*14;
          probe.style.cssText='position:fixed;right:4px;width:16px;height:12px;z-index:99999;pointer-events:none;background:var(--vscode-editor-background);top:'+py+'px';
          const surface=root.createElement('div');surface.style.cssText='position:absolute;inset:0;background:'+win.getComputedStyle(line,'::before').backgroundColor;
          const fill=root.createElement('div');fill.style.cssText='position:absolute;inset:0;height:6px;background:var(--mlrt-text-selection-fill)';
          probe.append(surface,fill);view.dom.append(probe);
          samples.push({x,y,corner,probeX:probe.getBoundingClientRect().left+8,probeY:py+3});
        };
        for (const row of rows) {
          const r=row.getBoundingClientRect(); if(r.top<0||r.bottom>win.innerHeight||r.width<5) continue;
          const x=r.left+Math.min(r.width/2,12), y=r.top+r.height/2;
          addSample(x,y);
        }
        if(${JSON.stringify(name)}==='corners-and-empty-lines') for(const el of root.querySelectorAll('.mlrt-selection-fillet')) {
          const r=el.getBoundingClientRect(),boxes=rows.map(row=>row.getBoundingClientRect());
          const left=boxes.some(b=>Math.abs(b.top-r.top)<0.01&&Math.abs(b.left-r.right)<0.01);
          const top=boxes.some(b=>Math.abs(b.bottom-r.top)<0.01&&b.left<=r.left&&b.right>=r.right),half=0.5/win.devicePixelRatio;
          addSample(left?r.right-half:r.left+half,top?r.top+half:r.bottom-half,true);
        }
        await frames(); return JSON.stringify(samples);`);
      const capture = await wb.send('Page.captureScreenshot', {format:'png'});
      const pixels = await evaluate(`const bytes=Uint8Array.from(atob(${JSON.stringify(capture.result.data)}),c=>c.charCodeAt(0));
        const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
        const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
        const data=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
        const sx=bitmap.width/${outer.width},sy=bitmap.height/${outer.height};
        const at=(x,y)=>{const i=(Math.floor((y+${outer.y + state.inner.y})*sy)*bitmap.width+Math.floor((x+${outer.x + state.inner.x})*sx))*4;return Array.from(data.slice(i,i+3));};
        const result=${JSON.stringify(samples)}.map(p=>({...p,actual:at(p.x,p.y),expected:at(p.probeX,p.probeY),background:at(p.probeX,p.probeY+6)}));
        bitmap.close(); root.getElementById('selection-pixel-ink').remove(); root.querySelectorAll('.selection-pixel-probe').forEach(el=>el.remove());
        return JSON.stringify(result);`);
      assert(pixels.length > 0, name+': sampled visible selection');
      for (const pixel of pixels) {
        // Curves at fractional embedding offsets are antialiased. Require
        // majority fill coverage; an unpainted/missing fillet must still fail.
        const error=Math.max(...pixel.actual.map((v,i)=>Math.abs(v-pixel.expected[i])));
        const contrast=Math.max(...pixel.background.map((v,i)=>Math.abs(v-pixel.expected[i])));
        assert(error <= (pixel.corner ? contrast*0.5 : 3), name+': selected pixel hidden/tinted by another surface '+JSON.stringify(pixel));
      }
      if (name === 'corners-and-empty-lines') {
        assert(state.fillets.length > 0 && state.fillets.every(f=>f.clip.includes('path(')), 'inward corners have clipped paint');
        assert(state.styles.some(s=>s.radius.includes('3px')), 'exposed corners are rounded');
      }
      reports.push({name,rows:state.boxes.length,fillets:state.fillets.length,pixels,dpr:state.dpr});
    }
    await wb.send('Page.bringToFront');
    const focus = await evaluate(`view.focus();await frames();const fill=()=>win.getComputedStyle(root.querySelector('.mlrt-prose-selection-rect')).backgroundColor;
      const activeProbe=root.createElement('div');activeProbe.style.background='var(--vscode-editor-selectionBackground)';view.dom.append(activeProbe);
      const expectedActive=win.getComputedStyle(activeProbe).backgroundColor;activeProbe.remove();
      const active=fill();view.contentDOM.blur();await frames();const inactive=fill();
      const probe=root.createElement('div');probe.style.background='var(--vscode-editor-inactiveSelectionBackground)';view.dom.append(probe);
      const expected=win.getComputedStyle(probe).backgroundColor;probe.remove();view.focus();return JSON.stringify({active,inactive,expected,expectedActive});`);
    assert.equal(focus.active,focus.expectedActive,'focus uses the host active selection color');
    assert.equal(focus.inactive,focus.expected,'blur uses the host inactive selection color');
    await evaluate(`view.dispatch({selection:{anchor:${source.indexOf('wide selected')},head:${source.indexOf('finish')+3}}});
      win.dispatchEvent(new win.MessageEvent('message',{data:{type:'setEditorOptions',editorOptions:{...win.__MLRT_EDITOR_OPTIONS__,roundedSelection:false}}}));await frames();return JSON.stringify(true);`);
    const square = await evaluate(`return JSON.stringify({fillets:root.querySelectorAll('.mlrt-selection-fillet').length,radii:[...root.querySelectorAll('.mlrt-prose-selection-rect')].map(el=>el.style.borderRadius)});`);
    assert.equal(square.fillets,0,'roundedSelection=false removes concave fillets');
    assert(square.radii.every(radius=>radius==='0px'),'roundedSelection=false removes external rounding');
    await writeFile(path.join(qaDir, 'edh-selection-rendering.json'),JSON.stringify({reports,focus,square},null,2));
    console.log('SELECTION RENDERING:', {cases:reports.length, pixelSamples:reports.reduce((n,r)=>n+r.pixels.length,0),focus,square});
  } finally {
    await evaluate(`win.__MLRT_TEST_SET_HOST_ISOLATION__(false);return JSON.stringify(true);`);
  }
}
