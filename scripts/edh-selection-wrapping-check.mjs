import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Exercises the installed webview input paths with trusted Electron keys. */
export async function runSelectionWrappingCheck({ liveClient, wb, evaluateJson, captureWorkbenchScreenshot, qaDir }) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evaluate = body => evaluateJson(liveClient, `(async () => {
    const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(frame => {
      try { return frame.contentDocument; } catch { return null; }
    }).filter(Boolean)];
    const root = roots.find(doc => doc.defaultView?.__MLRT_EDITOR_VIEW__);
    const view = root?.defaultView.__MLRT_EDITOR_VIEW__;
    if (!view) throw new Error('Live editor missing');
    ${body}
  })()`);
  const key = async (character, modifiers = 0) => {
    await liveClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: character,
      text: modifiers ? undefined : character, modifiers,
      ...(character === "z" ? { code: "KeyZ", windowsVirtualKeyCode: 90 } : {}) });
    await liveClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: character, modifiers });
    await sleep(100);
  };
  const sourceResult = () => evaluate(`const range = view.state.selection.main;
    return JSON.stringify({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head,
      selected: view.state.doc.sliceString(range.from, range.to) });`);

  // Authoritative VS Code history, before synthetic fixture isolation.
  const original = await evaluate(`view.focus(); view.dispatch({ selection: { anchor: 0, head: 4 } });
    return JSON.stringify({ text: view.state.doc.toString() });`);
  await key("*");
  const wrapped = await sourceResult();
  assert.equal(wrapped.text, "*Text*" + original.text.slice(4));
  assert.equal(wrapped.selected, "Text");
  await key("z", process.platform === "darwin" ? 4 : 2);
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await sourceResult()).text === original.text) break;
    await sleep(100);
  }
  assert.equal((await sourceResult()).text, original.text, "VS Code Undo restores the original source");

  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(true); return JSON.stringify(true);`);
  let revision = 999900;
  const setup = async (text = "word", anchor = 0, head = 4) => {
    await evaluate(`root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setDocument', text: ${JSON.stringify(text)}, revision: ${++revision}, debug: false }
    })); await new Promise(done => root.defaultView.requestAnimationFrame(() => root.defaultView.requestAnimationFrame(done)));
    view.focus(); view.dispatch({ selection: { anchor: ${anchor}, head: ${head} } }); return JSON.stringify(true);`);
  };
  const results = [];
  for (const [character, expected] of [
    ["*", ["*word*", "**word**", "***word***"]],
    ["_", ["_word_", "__word__", "___word___"]],
    ["`", ["`word`", "``word``", "```\nword\n```"]],
    ["[", ["[word]()", "[[word]]"]],
    ["~", ["~word~", "~~word~~"]], ["=", ["=word=", "==word=="]],
    ["$", ["$word$", "$$word$$"]], ["^", ["^word^"]],
    ["!", ["![word]()"]], ["(", ["(word)"]], ["{", ["{word}"]],
    ["<", ["<word>"]], ['"', ['"word"']], ["'", ["'word'"]],
  ]) {
    await setup();
    for (const text of expected) {
      await key(character);
      const result = await sourceResult();
      assert.equal(result.text, text, `source ${character}`);
      assert.equal(result.selected, "word");
      results.push({ character, ...result });
    }
  }
  await setup("before word after", 11, 7);
  for (let n = 0; n < 3; n++) await key("`");
  const fence = await sourceResult();
  assert.equal(fence.text, "before \n```\nword\n```\n after");
  assert.ok(fence.anchor > fence.head, "backward selection survives fence conversion");
  await captureWorkbenchScreenshot(wb, path.join(qaDir, "edh-selection-wrapping-fence.png"));

  // The beforeinput fallback is exercised separately from the trusted key path.
  await setup();
  await liveClient.send("Input.insertText", { text: "*" });
  assert.equal((await sourceResult()).text, "*word*");
  await setup("word", 4, 4);
  await key("*");
  assert.equal((await sourceResult()).text, "word*", "collapsed selections keep ordinary typing");
  await setup();
  await key("x");
  assert.equal((await sourceResult()).text, "x", "ordinary letters replace the selection");

  const tableText = "| Key | Value |\n| --- | --- |\n| word | keep |\n";
  const tableSetup = async () => {
    await setup(tableText, 0, 0);
    await evaluate(`const cell = root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-column="0"]');
      if (!cell) throw new Error('Table cell missing');
      cell.focus(); root.getSelection().setBaseAndExtent(cell.firstChild, 4, cell.firstChild, 0);
      return JSON.stringify(true);`);
  };
  const tableResult = () => evaluate(`const cell = root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-column="0"]');
    return JSON.stringify({ value: cell.textContent, selected: root.getSelection().toString(), text: view.state.doc.toString(),
      cells: root.querySelectorAll('.mlrt-table-cell').length });`);
  for (const [character, expected] of [
    ["*", ["*word*", "**word**", "***word***"]],
    ["`", ["`word`", "``word``", "```word```"]],
    ["[", ["[word]()", "[[word]]"]], ["!", ["![word]()"]],
  ]) {
    await tableSetup();
    for (const value of expected) {
      await key(character);
      const result = await tableResult();
      assert.equal(result.value, value);
      assert.equal(result.selected, "word");
      assert.equal(result.cells, 4, "wrapping must preserve the table grid");
      assert.ok(result.text.includes(`| ${value} | keep |`));
      results.push({ table: true, character, ...result });
    }
  }
  await tableSetup();
  await liveClient.send("Input.insertText", { text: "*" });
  assert.equal((await tableResult()).value, "*word*");
  await captureWorkbenchScreenshot(wb, path.join(qaDir, "edh-selection-wrapping-table.png"));
  await writeFile(path.join(qaDir, "edh-selection-wrapping.json"), JSON.stringify({ results, fence, hostUndo: true }, null, 2));
  console.log("SELECTION WRAPPING CHECK: trusted keys, beforeinput, retained selections, fences, table source, and VS Code Undo passed.");
}
