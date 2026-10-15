import assert from 'node:assert/strict';

// Sample actual paint opportunities, including the first frame after a row
// enters the viewport. A settled screenshot misses delayed syntax colors.
export async function runMarkdownScrollChecks({ check, liveEval, liveClient, writeFixture, select, sleep, screenshot, palette, text }) {
  await check('scroll rendering: layout decorations stay prepared and visible text has stable paint', async () => {
    const section = index => [`## Ready heading ${index}`, '',
      `Ready **bold ${index}**, *italic ${index}*, ~~strike ${index}~~, \`inline ${index}\` and [link ${index}](./LinkedTarget.md). ` + 'Long wrapping content. '.repeat(16), '',
      `- Ready bullet ${index}`, `- [ ] Ready task ${index}`, '', '---', '',
      `> Ready quote ${index}`, '', '> [!NOTE]', `> Ready alert ${index}`, '',
      '```javascript', `const readyValue${index} = "ready ${index}";`, '```', '',
      '| Ready header | Value |', '| --- | --- |', `| Ready cell ${index} | stable |`, '',
    ].join('\n');
    const source=['Resting caret.','',...Array.from({length:70},(_,index)=>section(index))].join('\n');
    try {
      await writeFixture(source); await select(0);
      const result=await liveEval(`return (async()=>{
        const source=${JSON.stringify(source)},ctor=view.constructor;
        const direct=()=>view.state.facet(ctor.decorations).filter(set=>typeof set!=='function');
        const outer=()=>view.state.facet(ctor.outerDecorations).filter(set=>typeof set!=='function');
        const before=[...direct(),...outer()],unprepared=[];
        // Task/bullet slots have always incorporated viewport measurements.
        // Check their actual glyph geometry below; the remaining source/block
        // projections must stay unchanged while scrolling.
        const structural=sets=>sets.filter(set=>{for(let cursor=set.iter();cursor.value;cursor.next())if(cursor.value.spec.widget?.constructor.name==='TaskControl')return false;return true;});
        const structuralBefore=structural(before);
        // Include offscreen code colors: waiting for a viewport update is too
        // late when native/compositor scrolling exposes already mounted rows.
        const checks=[['Ready heading 69','role-heading'],['bold 69','markdown-bold'],['italic 69','markdown-italic'],['strike 69','markdown-strike'],['inline 69','markdown-inline-code'],['link 69','role-link'],['- Ready bullet 69','markdown-bullet'],['[ ] Ready task 69','markdown-task'],['> Ready quote 69','block-quote'],['> Ready alert 69','block-alert'],['const readyValue69','block-code'],['const readyValue69','vscode-code-token'],['---\\n','rule-row']];
        for(const [needle,role] of checks){const pos=source.indexOf(needle);let found=false;for(const set of before)set.between(pos,pos+1,(_from,_to,value)=>{if(value.spec.class?.includes(role))found=true;});if(!found)unprepared.push({needle,role});}
        const drifts=[],rebuilds=[],positions=new Map();let frames=0,samples=0;
        const observe=label=>{
          frames++;const now=structural([...direct(),...outer()]);
          if(now.length!==structuralBefore.length||now.some((set,index)=>set!==structuralBefore[index]))rebuilds.push(label);
          const scroller=view.scrollDOM.getBoundingClientRect();
          for(const row of root.querySelectorAll('.cm-line')){
            const box=row.getBoundingClientRect();if(box.bottom<=scroller.top||box.top>=scroller.bottom||!row.textContent.includes('Ready')&&!row.textContent.includes('readyValue'))continue;
            const from=view.posAtDOM(row),key=from,signature=[];samples++;
            const range=root.createRange(),walker=root.createTreeWalker(row,win.NodeFilter.SHOW_TEXT);
            while(walker.nextNode()){const node=walker.currentNode,el=node.parentElement;if(!node.textContent.trim()||el.closest('.mlrt-preview-code-copy,.mlrt-preview-code-fence-hidden'))continue;range.selectNodeContents(node);const r=range.getBoundingClientRect(),css=win.getComputedStyle(el);signature.push([node.textContent,r.x,r.y+view.scrollDOM.scrollTop,r.width,r.height,css.color,css.fontWeight,css.fontStyle,css.textDecorationLine]);}
            const current={top:box.top+view.scrollDOM.scrollTop,height:box.height,signature},previous=positions.get(key);
            if(previous){if(Math.abs(current.top-previous.top)>0.5||Math.abs(current.height-previous.height)>0.5||signature.length!==previous.signature.length)drifts.push({label,from,kind:'row or text structure'});else for(let n=0;n<signature.length;n++){const a=signature[n],b=previous.signature[n];if(a.some((value,index)=>typeof value==='number'?Math.abs(value-b[index])>0.5:value!==b[index])){drifts.push({label,from,kind:'glyph paint or geometry',before:b,after:a});break;}}}
            positions.set(key,current);
          }
        };
        for(const width of [810,360]){
          view.dom.style.width=width+'px';await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));positions.clear();
          for(const index of [69,5,48,20,61,0,37,12]){view.scrollDOM.scrollTop=view.lineBlockAt(source.indexOf('## Ready heading '+index+'\\n')).top;for(let frame=0;frame<5;frame++){await new Promise(resolve=>win.requestAnimationFrame(resolve));observe(width+':'+index+':'+frame);}}
        }
        view.dom.style.removeProperty('width');
        return {unprepared,drifts,rebuilds,frames,samples,sourceExact:view.state.doc.toString()===source};
      })();`);
      assert.deepEqual(result.unprepared,[],'all distant elements must have their final decoration in document state before mounting');
      assert.deepEqual(result.rebuilds,[],'scrolling and wrapping must preserve layout decorations');
      assert.deepEqual(result.drifts.slice(0,6),[],'first-mounted text colors and glyph boxes must remain stable on following frames');
      assert(result.samples>150&&result.sourceExact); await screenshot('scroll-all-elements');
      return {frames:result.frames,samples:result.samples,preMountRoles:13,scrollRebuilds:0,paintOrGeometryDrifts:0,sourceExact:true};
    } finally { await liveEval("view.dom.style.removeProperty('width');return true;"); await writeFixture(text); await select(0); }
  });
  await check('scroll rendering: native wheel scrolling keeps heavy code prepared under CPU throttling', async () => {
    const source = ['Resting caret.', '', ...Array.from({ length: 12 }, (_, section) => [
      ...Array.from({ length: 18 }, (_, row) => `Wheel approach ${section}/${row}.`), '',
      `## Heavy code ${section}`, '', '```javascript',
      ...Array.from({ length: 55 }, (_, row) => `const wheelValue${section}_${row} = "${'Long wrapped string. '.repeat(8)}";`),
      '```', '', '> [!NOTE]', '> Heavy code below.', '',
      '    const wheelIndented = "indented code";', '',
    ].join('\n'))].join('\n');
    try {
      await writeFixture(source); await select(0);
      await liveEval(`view.scrollDOM.scrollTop=0;return true;`); await sleep(100);
      const point = await liveEval(`const r=view.scrollDOM.getBoundingClientRect();return {x:r.left+Math.min(350,r.width/2),y:r.top+r.height/2};`);
      await liveClient.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await liveEval(`
        const result={frames:0,codeSamples:0,missing:[],paintDrifts:[],scrollEvents:0,minTop:Infinity,maxTop:0,running:true};
        const styles=new Map();
        const onScroll=()=>result.scrollEvents++;
        view.scrollDOM.addEventListener('scroll',onScroll,{passive:true});
        result.stop=()=>{result.running=false;view.scrollDOM.removeEventListener('scroll',onScroll);};
        win.__MLRT_WHEEL_PAINT__=result;
        const sample=()=>{
          if(!result.running)return;
          result.frames++;result.minTop=Math.min(result.minTop,view.scrollDOM.scrollTop);result.maxTop=Math.max(result.maxTop,view.scrollDOM.scrollTop);
          const scroller=view.scrollDOM.getBoundingClientRect();
          for(const row of root.querySelectorAll('.cm-line')){
            const box=row.getBoundingClientRect();if(box.bottom<=scroller.top||box.top>=scroller.bottom||!row.textContent.includes('const wheel'))continue;
            result.codeSamples++;
            if(!row.classList.contains('mlrt-markdown-block-code')||!row.querySelector('.mlrt-vscode-code-token')){
              if(result.missing.length<10)result.missing.push({frame:result.frames,text:row.textContent.slice(0,70)});
            }
            const key=view.posAtDOM(row),signature=[...row.querySelectorAll('.mlrt-vscode-code-token')].map(el=>{
              const css=win.getComputedStyle(el);return [el.textContent,css.color,css.fontWeight,css.fontStyle];
            });
            const previous=styles.get(key),current=JSON.stringify(signature);
            if(previous&&previous!==current&&result.paintDrifts.length<10)result.paintDrifts.push({frame:result.frames,key});
            styles.set(key,current);
          }
          win.requestAnimationFrame(sample);
        };win.requestAnimationFrame(sample);return true;
      `);
      for (const direction of [1, -1]) {
        for (let step = 0; step < 28; step++) {
          await liveClient.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: direction * (step % 6 === 0 ? 1600 : 460) });
          await sleep(35);
        }
        await screenshot(direction === 1 ? 'scroll-native-wheel-down' : 'scroll-native-wheel-up');
      }
      const result = await liveEval(`const r=win.__MLRT_WHEEL_PAINT__;r.stop();delete win.__MLRT_WHEEL_PAINT__;
        return {frames:r.frames,codeSamples:r.codeSamples,missing:r.missing,paintDrifts:r.paintDrifts,scrollEvents:r.scrollEvents,travel:r.maxTop-r.minTop};`);
      assert(result.frames>30&&result.codeSamples>100&&result.scrollEvents>10&&result.travel>8000,
        `native scrolling must exercise cold heavy code: ${JSON.stringify(result)}`);
      assert.deepEqual(result.missing,[], 'native-wheel frames must contain fully colored code');
      assert.deepEqual(result.paintDrifts,[], 'code colors must remain stable after first entry');
      return {...result,cpuThrottling:4};
    } finally {
      await liveClient.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await liveEval(`win.__MLRT_WHEEL_PAINT__?.stop();delete win.__MLRT_WHEEL_PAINT__;return true;`);
      await writeFixture(text); await select(0);
    }
  });
  await check('scroll rendering: cold jumps, live edits and undo paint complete elements on every frame', async () => {
    const sections = Array.from({length:32}, (_,i)=>[
      ...Array.from({length:22},(_,row)=>`Cold approach ${i}/${row}.`), '',
      `## Cold heading ${i}`, `Cold **cold bold ${i}** and \`cold inline ${i}\` [cold link ${i}](./LinkedTarget.md).`, '',
      `- cold bullet ${i}`, `- [ ] Cold task ${i}`, '',
      `> Cold quote ${i}`, '', `> [!NOTE]`, `> Cold alert ${i}`, '',
      '```javascript', `const coldValue${i} = "cold string ${i}";`, '// cold comment', '```', '',
      `    const coldIndent${i} = "indented ${i}";`, '',
      '| Cold header | Value |', '| --- | --- |', `| Cold cell ${i} | **cell bold** |`, '',
    ].join('\n'));
    const source = ['Resting caret.','',...sections,'Cold end.',''].join('\n');
    try {
      await writeFixture(source); await select(0);
      const result=await liveEval(`return (async()=>{
        const source=${JSON.stringify(source)},frames=[];let codeSamples=0,elementSamples=0;
        const sample=label=>{
          const box=view.scrollDOM.getBoundingClientRect(),missing=[];
          for(const row of root.querySelectorAll('.cm-line')){
            const rect=row.getBoundingClientRect();if(rect.bottom<=box.top||rect.top>=box.bottom)continue;
            const text=row.textContent;
            if(/const cold(?:Value|Indent)/.test(text)||text.includes('let coldValue')){
              codeSamples++;
              if(!row.classList.contains('mlrt-markdown-block-code')||!row.querySelector('.mlrt-vscode-code-token'))missing.push({kind:'code',text});
            }
            for(const [needle,selector] of [['Cold heading','.mlrt-markdown-role-heading'],['cold bold','.mlrt-markdown-bold'],['cold inline','.mlrt-markdown-inline-code'],['cold link','.mlrt-markdown-role-link'],['cold bullet','.mlrt-markdown-bullet'],['Cold task','.mlrt-markdown-task-control']]){
              if(!text.includes(needle))continue;elementSamples++;
              if(!row.querySelector(selector))missing.push({kind:needle,text});
            }
            if(text.includes('cold bold')&&(text.includes('**')||text.includes('](./')))missing.push({kind:'unhidden syntax',text});
            if(text.includes('Cold quote')&&!row.classList.contains('mlrt-markdown-block-quote'))missing.push({kind:'quote',text});
            if(text.includes('Cold alert')&&!row.classList.contains('mlrt-markdown-block-alert'))missing.push({kind:'alert',text});
          }
          frames.push({label,missing});
        };
        const paint=async label=>{for(let n=0;n<4;n++){await new Promise(resolve=>win.requestAnimationFrame(resolve));sample(label+':'+n);}};
        // Fresh sections are farther apart than the previous overscan. Reverse
        // order also catches models that only prepare a forward scroll path.
        for(const section of [31,3,24,8,19,0,27,12,16,5]){
          const pos=source.indexOf('## Cold heading '+section+'\\n');
          view.scrollDOM.scrollTop=view.lineBlockAt(pos).top;await paint('cold-jump-'+section);
        }
        const code=source.indexOf('const coldValue17');
        view.scrollDOM.scrollTop=view.lineBlockAt(code).top;await paint('before-edit');
        view.dispatch({changes:{from:code,to:code+5,insert:'let'}});sample('edit-synchronous');await paint('after-edit');
        view.dispatch({changes:{from:code,to:code+3,insert:'const'}});sample('undo-synchronous');await paint('after-undo');
        // Invalidate all downstream Markdown structure while the destination
        // remains offscreen, then jump there without allowing a warm-up frame.
        view.scrollDOM.scrollTop=0;await paint('before-offscreen-edit');
        const heading=source.indexOf('## Cold heading 30\\n');
        view.dispatch({changes:{from:heading,to:heading+2,insert:'###'}});
        const jump=view.state.doc.toString().indexOf('### Cold heading 30\\n');
        view.scrollDOM.scrollTop=view.lineBlockAt(jump).top;await paint('edited-cold-jump');
        view.dispatch({changes:{from:heading,to:heading+3,insert:'##'}});await paint('edited-cold-undo');
        return {frames,codeSamples,elementSamples,sourceExact:view.state.doc.toString()===source};
      })();`);
      assert(result.codeSamples>10&&result.elementSamples>50,'cold jumps must exercise visible code and other Markdown elements');
      assert.deepEqual(result.frames.filter(frame=>frame.missing.length),[], 'every paint opportunity must contain fully rendered elements');
      assert(result.sourceExact,'edits and undo must preserve exact source');
      await screenshot('scroll-cold-edited');
      return {frames:result.frames.length,codeSamples:result.codeSamples,elementSamples:result.elementSamples,unstyledFrames:0,sourceExact:true};
    } finally { await palette('File: Revert File'); await writeFixture(text); await select(0); }
  });
  await check('scroll rendering: code rows keep their paint and geometry on entry and return', async () => {
    const source = ['Resting caret.', '',
      ...Array.from({ length: 80 }, (_, i) => `Prose before code ${i}.`), '',
      '```javascript', ...Array.from({ length: 140 }, (_, i) => `const scrollValue${i} = "fenced ${i}";`), '```', '',
      ...Array.from({ length: 35 }, (_, i) => `Prose between code ${i}.`), '',
      ...Array.from({ length: 140 }, (_, i) => `    const scrollIndent${i} = "indented ${i}";`), '',
      ...Array.from({ length: 80 }, (_, i) => `Prose after code ${i}.`), ''].join('\n');
    try {
      await writeFixture(source); await select(0); await sleep(800);
      await liveEval('view.scrollDOM.scrollTop=0;return true;'); await sleep(200);
      const phases = [];
      for (const direction of [1, -1]) {
        const data = await liveEval(`return (async()=>{
          const frames=[], positions=new Map(); let codeSamples=0;
          for(let frame=0;frame<145;frame++){
            await new Promise(resolve=>win.requestAnimationFrame(resolve));
            const box=view.scrollDOM.getBoundingClientRect(),missing=[],drift=[];
            for(const row of root.querySelectorAll('.cm-line')){
              const rect=row.getBoundingClientRect();
              if(rect.bottom<=box.top||rect.top>=box.bottom||!row.textContent.includes('const scroll'))continue;
              codeSamples++;
              const from=view.posAtDOM(row),offset=rect.top+view.scrollDOM.scrollTop;
              if(!row.classList.contains('mlrt-markdown-block-code')||!row.querySelector('.mlrt-vscode-code-token'))
                missing.push({from,text:row.textContent.slice(0,55),classes:row.className,tokens:row.querySelectorAll('.mlrt-vscode-code-token').length});
              const previous=positions.get(from);
              if(previous!==undefined&&Math.abs(previous-offset)>0.5)drift.push({from,pixels:offset-previous});
              positions.set(from,offset);
            }
            frames.push({frame,scrollTop:view.scrollDOM.scrollTop,height:view.contentHeight,missing,drift});
            view.scrollDOM.scrollTop+=${direction * 64};
          }
          return {direction:${direction},codeSamples,frames};
        })();`);
        phases.push(data);
        await screenshot(direction === 1 ? 'scroll-code-bottom' : 'scroll-code-return');
      }
      const failures=phases.flatMap(phase=>phase.frames.filter(frame=>frame.missing.length||frame.drift.length));
      assert(phases.every(phase=>phase.codeSamples>100), 'both scroll directions exercise actual visible code');
      assert.equal(failures.length,0,`code flicker at paint opportunities: ${JSON.stringify(failures.slice(0,5))}`);
      assert.equal(await liveEval('return view.state.doc.toString();'),source);
      for (const [name, needle] of [['fenced', 'const scrollValue40'], ['indented', '    const scrollIndent40']]) {
        await liveEval(`view.scrollDOM.scrollTop=view.lineBlockAt(${source.indexOf(needle)}).top;return true;`);
        await sleep(250); await screenshot(`scroll-code-${name}`);
      }
      return {phases:phases.map(phase=>({direction:phase.direction,frames:phase.frames.length,codeSamples:phase.codeSamples})),unstyledFrames:0,geometryDriftFrames:0,sourceExact:true};
    } finally { await writeFixture(text); await select(0); }
  });
}
