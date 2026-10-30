import assert from "node:assert/strict";
import { keyboardBindingMatches, normalizeTableShortcuts, parseKeyboardBinding } from "../shared/keyboardBinding";
import fs from "node:fs";
import path from "node:path";
import { EditorState } from "@codemirror/state";
import {
  tableNavigationModifierCompartment,
  tableNavigationModifierFacet,
} from "../editor/tableNavigation";
import {
  adjacentTableCell,
  DEFAULT_TABLE_NAVIGATION_MODIFIER_KEY,
  normalizeTableNavigationModifierKey,
  TableNavigationKeyState,
  TABLE_NAVIGATION_MODIFIER_KEYS,
} from "../shared/tableKeyboardNavigation";

const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as {
  contributes?: {
    configuration?: {
      properties?: Record<
        string,
        {
          type?: unknown;
          scope?: unknown;
          enum?: unknown;
          default?: unknown;
          markdownDescription?: unknown;
        }
      >;
    };
  };
};

const setting =
  packageJson.contributes?.configuration?.properties?.[
    "markdownLiveRenderTables.tableNavigation.modifierKey"
  ];
assert.ok(setting, "expected the table-navigation modifier setting");
assert.equal(setting.type, "string");
assert.equal(setting.scope, "window");
assert.equal(setting.enum, undefined, "custom bindings are not restricted to function keys");
assert.equal(setting.default, DEFAULT_TABLE_NAVIGATION_MODIFIER_KEY);
assert.match(
  String(setting.markdownDescription),
  /hold.*arrow key.*adjacent rendered table cell/i,
);

for (const key of TABLE_NAVIGATION_MODIFIER_KEYS) {
  assert.equal(normalizeTableNavigationModifierKey(key), key);
}
assert.equal(
  normalizeTableNavigationModifierKey(undefined),
  DEFAULT_TABLE_NAVIGATION_MODIFIER_KEY,
);
assert.equal(
  normalizeTableNavigationModifierKey("F13"),
  "F13",
);
assert.equal(
  normalizeTableNavigationModifierKey("f2", "F8"),
  "f2",
);

const initialState = EditorState.create({
  extensions: [
    tableNavigationModifierCompartment.of(
      tableNavigationModifierFacet.of("F2"),
    ),
  ],
});
assert.equal(initialState.facet(tableNavigationModifierFacet), "F2");
const reconfiguredState = initialState.update({
  effects: tableNavigationModifierCompartment.reconfigure(
    tableNavigationModifierFacet.of("F8"),
  ),
}).state;
assert.equal(reconfiguredState.facet(tableNavigationModifierFacet), "F8");

const grid = { rowCount: 3, columnCount: 3 };
assert.deepEqual(adjacentTableCell({ row: 1, column: 1 }, "up", grid), {
  row: 0,
  column: 1,
});
assert.deepEqual(adjacentTableCell({ row: 1, column: 1 }, "down", grid), {
  row: 2,
  column: 1,
});
assert.deepEqual(adjacentTableCell({ row: 1, column: 1 }, "left", grid), {
  row: 1,
  column: 0,
});
assert.deepEqual(adjacentTableCell({ row: 1, column: 1 }, "right", grid), {
  row: 1,
  column: 2,
});
assert.equal(adjacentTableCell({ row: 0, column: 1 }, "up", grid), null);
assert.equal(adjacentTableCell({ row: 2, column: 1 }, "down", grid), null);
assert.equal(adjacentTableCell({ row: 1, column: 0 }, "left", grid), null);
assert.equal(adjacentTableCell({ row: 1, column: 2 }, "right", grid), null);

const heldKeys = new TableNavigationKeyState();
heldKeys.keyDown("F2");
assert.equal(heldKeys.isHeld("F2"), true);
heldKeys.keyDown("ArrowRight");
assert.equal(heldKeys.isHeld("F2"), true);
heldKeys.keyUp("F2");
assert.equal(heldKeys.isHeld("F2"), false);
heldKeys.keyDown("F8");
heldKeys.clear();
assert.equal(heldKeys.isHeld("F8"), false);

console.log("table keyboard navigation configuration tests passed");

for (const binding of ["Control", "Alt+Shift", "Ctrl+Space", "KeyQ", "Numpad0", "F24", "PageDown", "Plus", "Shift+;"]) {
  assert.equal(normalizeTableNavigationModifierKey(binding), binding);
  assert.ok(parseKeyboardBinding(binding));
}
for (const binding of ["Ctrl+", "Ctrl+Banana", "F25", "a+b", ""]) assert.equal(parseKeyboardBinding(binding), null);
const event = { key: "Enter", code: "Enter", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
assert(keyboardBindingMatches("Ctrl+Enter", event));
assert(!keyboardBindingMatches("Ctrl+Shift+Enter", event));
assert(keyboardBindingMatches("Ctrl+Shift+Enter", { ...event, shiftKey: true }));
assert(keyboardBindingMatches("Ctrl+Space", { ...event, key: " ", code: "Space" }));
assert(keyboardBindingMatches("Alt+Numpad0", { ...event, key: "0", code: "Numpad0", ctrlKey: false, altKey: true }));
assert.equal(normalizeTableShortcuts({ insertRowAbove: "" }).insertRowAbove, "");
assert.equal(normalizeTableShortcuts({ insertRowAbove: "nonsense" }).insertRowAbove, "Ctrl+Shift+Enter");
heldKeys.keyDown("KeyQ");
assert(heldKeys.isHeld("KeyQ"));
heldKeys.keyUp("KeyQ");
assert(!heldKeys.isHeld("KeyQ"));
