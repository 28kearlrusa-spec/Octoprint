// Macro prompts, fed with lines as OctoPrint logs them after Klipper's RESPOND TYPE=command.
//   node tests/prompts.test.mjs
import assert from "node:assert/strict";
import { PromptReader, parseButton } from "../octoprint_makerforge/static/js/core/prompts.js";

let failures = 0;
const test = (name, fn) => { try { fn(); console.log("ok   ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", e.message); } };
const feed = (reader, lines) => lines.map((l) => reader.feed(`Recv: // action:${l}`));

test("button fields: label|gcode|color, like Mainsail", () => {
  assert.deepEqual(parseButton("Resume|RESUME|primary"), { label: "Resume", gcode: "RESUME", color: "primary" });
  assert.deepEqual(parseButton("CLEAN_NOZZLE"), { label: "CLEAN_NOZZLE", gcode: "CLEAN_NOZZLE", color: "" });
  assert.deepEqual(parseButton("Heat|M104 S220|Warning"), { label: "Heat", gcode: "M104 S220", color: "warning" });
  assert.equal(parseButton("Odd|G28|purple").color, "", "unknown colours fall back to the default");
});

test("a full prompt: text, a single button, a group and footer buttons", () => {
  const r = new PromptReader();
  const changed = feed(r, [
    "prompt_begin Filament runout",
    "prompt_text Load new filament, then resume.",
    "prompt_button Unload|UNLOAD_FILAMENT",
    "prompt_button_group_start",
    "prompt_button 210°|M104 S210|secondary",
    "prompt_button 240°|M104 S240|warning",
    "prompt_button_group_end",
    "prompt_footer_button Cancel print|CANCEL_PRINT|error",
    "prompt_footer_button Resume|RESUME|primary",
    "prompt_show",
  ]);
  assert.deepEqual(changed, [false, false, false, false, false, false, false, false, false, true]);
  const p = r.shown;
  assert.equal(p.title, "Filament runout");
  assert.equal(p.items.length, 3);
  assert.deepEqual(p.items[0], { kind: "text", text: "Load new filament, then resume." });
  assert.equal(p.items[1].grouped, false);
  assert.equal(p.items[1].buttons[0].gcode, "UNLOAD_FILAMENT");
  assert.equal(p.items[2].grouped, true);
  assert.deepEqual(p.items[2].buttons.map((b) => b.gcode), ["M104 S210", "M104 S240"]);
  assert.deepEqual(p.footer.map((b) => [b.label, b.color]), [["Cancel print", "error"], ["Resume", "primary"]]);
});

test("nothing shows until prompt_show; prompt_end closes it", () => {
  const r = new PromptReader();
  feed(r, ["prompt_begin Question", "prompt_button OK"]);
  assert.equal(r.shown, null);
  feed(r, ["prompt_show"]);
  assert.equal(r.shown.title, "Question");
  assert.deepEqual(feed(r, ["prompt_end"]), [true]);
  assert.equal(r.shown, null);
  assert.deepEqual(feed(r, ["prompt_end"]), [false], "a second end changes nothing");
});

test("the open prompt stays up while the next one is being defined", () => {
  const r = new PromptReader();
  feed(r, ["prompt_begin First", "prompt_button A", "prompt_show", "prompt_begin Second", "prompt_button B"]);
  assert.equal(r.shown.title, "First");
  feed(r, ["prompt_show"]);
  assert.equal(r.shown.title, "Second");
});

test("showing again after adding more redraws the same prompt", () => {
  const r = new PromptReader();
  feed(r, ["prompt_begin Heat soak", "prompt_text 5 min left", "prompt_show"]);
  const first = r.shown;
  feed(r, ["prompt_text 4 min left", "prompt_show"]);
  assert.equal(r.shown, first);
  assert.equal(r.shown.rev, 2);
  assert.equal(r.shown.items.length, 2);
});

test("lines that are not prompts, or prompts without a begin, are ignored", () => {
  const r = new PromptReader();
  assert.equal(r.feed("Recv: // Klipper state: Ready"), false);
  assert.equal(r.feed("Send: RESPOND TYPE=command MSG=\"action:prompt_show\""), false);
  feed(r, ["prompt_button Orphan", "prompt_show"]);
  assert.equal(r.shown, null);
  assert.equal(r.feed("Recv: //action:prompt_begin No space after the slashes"), false);
  r.feed("Recv: //action:prompt_show");
  assert.equal(r.shown.title, "No space after the slashes");
});

test("a dropped or new serial link clears the prompt (OctoPrint's own log lines)", () => {
  const r = new PromptReader();
  feed(r, ["prompt_begin Q", "prompt_button OK", "prompt_show"]);
  assert.equal(r.feed('Changing monitoring state from "Operational" to "Offline after error"'), true);
  assert.equal(r.shown, null);
  feed(r, ["prompt_begin Q", "prompt_button OK", "prompt_show"]);
  assert.equal(r.feed("Connected to: Serial<id=0x1, open=True>(port='/tmp/printer', baudrate=250000), starting monitor"), true);
  assert.equal(r.shown, null);
  assert.equal(r.feed('Changing monitoring state from "Printing" to "Operational"'), false, "normal state changes keep it");
});

test("a replayed log after reconnecting ends where the printer is", () => {
  const r = new PromptReader();
  feed(r, ["prompt_begin Q", "prompt_button OK", "prompt_show"]);
  r.reset();
  feed(r, ["prompt_begin Q", "prompt_button OK", "prompt_show", "prompt_end"]);
  assert.equal(r.shown, null);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log("\nall prompt tests passed");
