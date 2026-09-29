// Printer prompts: the questions a macro can ask on screen. Two dialects reach us.
//
//  - Klipper macros print Mainsail's macro prompt lines through [respond], e.g.
//      RESPOND TYPE=command MSG="action:prompt_begin Filament runout"
//      RESPOND TYPE=command MSG="action:prompt_button Resume|RESUME|primary"
//      RESPOND TYPE=command MSG="action:prompt_show"
//    Each button carries the G-code it runs. The macro closes the prompt with prompt_end.
//  - Marlin-style host prompts go through OctoPrint's bundled Action Command Prompt plugin,
//    which answers the printer with M876. ui/printer-prompt.js talks to that plugin directly.
//
// This module only reads the lines. It has no DOM so the tests can run it in Node.

const LINE = /^Recv:\s*\/\/\s*action:prompt_(\w+)\s?(.*)$/i;
// OctoPrint's own log lines when the serial link comes or goes: whatever asked is gone
const LINK = /^(Connected to: |Changing monitoring state from "[^"]*" to "(Offline|Error|Opening serial|Connecting|Detecting))/;
const COLORS = new Set(["primary", "secondary", "info", "warning", "error"]);

/** "label|gcode|color": the G-code defaults to the label, like Mainsail. */
export function parseButton(msg) {
  const [label = "", gcode = "", color = ""] = String(msg).split("|").map((s) => s.trim());
  return { label: label || gcode, gcode: gcode || label, color: COLORS.has(color.toLowerCase()) ? color.toLowerCase() : "" };
}

/**
 * Feed it terminal lines; `shown` is the prompt the printer currently wants on screen, or null.
 * A prompt looks like {title, items: [{kind:"text", text} | {kind:"buttons", buttons, grouped}], footer, rev}.
 * `rev` goes up each time the printer shows the same prompt again with more in it.
 */
export class PromptReader {
  constructor() {
    this.shown = null;
    this.reset();
  }

  /** Forget a half-read prompt (the log is about to be replayed). Keeps what is on screen. */
  reset() {
    this.building = null;
    this.group = null;
  }

  /** Returns true when what should be on screen changed. */
  feed(raw) {
    const line = String(raw);
    const m = LINE.exec(line);
    if (!m) {
      if (!LINK.test(line)) return false;
      this.reset();
      const had = !!this.shown;
      this.shown = null;
      return had;
    }
    const type = m[1].toLowerCase();
    const msg = m[2] || "";
    const b = this.building;
    switch (type) {
      case "begin":
        this.building = { title: msg.trim(), items: [], footer: [], rev: 0 };
        this.group = null;
        return false;
      case "text":
        if (b) b.items.push({ kind: "text", text: msg.trim() });
        return false;
      case "button": {
        if (!b) return false;
        const button = parseButton(msg);
        if (!button.label) return false;
        if (this.group) this.group.buttons.push(button);
        else b.items.push({ kind: "buttons", buttons: [button], grouped: false });
        return false;
      }
      case "button_group_start":
        if (b) {
          this.group = { kind: "buttons", buttons: [], grouped: true };
          b.items.push(this.group);
        }
        return false;
      case "button_group_end":
        this.group = null;
        return false;
      case "footer_button": {
        const button = parseButton(msg);
        if (b && button.label) b.footer.push(button);
        return false;
      }
      case "show":
        if (!b || (!b.title && !b.items.length && !b.footer.length)) return false;
        b.rev++;
        this.shown = b;
        return true;
      case "end":
        this.reset();
        if (!this.shown) return false;
        this.shown = null;
        return true;
      default:
        return false;
    }
  }
}
