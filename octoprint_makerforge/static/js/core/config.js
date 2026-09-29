// Shared configuration (macros, presets, fans ...) stored by the plugin, so every browser
// and every person using the printer sees the same buttons. Defaults fill any gaps.
import { store } from "mf/core/store.js";
import { mf, ApiError } from "mf/core/api.js";
import { DEFAULT_CONFIG } from "mf/core/defaults.js";
import { deepEqual } from "mf/core/store.js";

const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

let saved = { rev: 0 };   // what the server has (only keys that differ from the defaults)

function merged(overrides) {
  const out = clone(DEFAULT_CONFIG);
  for (const [k, v] of Object.entries(overrides || {})) {
    if (k === "rev") continue;
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = { ...out[k], ...v };
    else out[k] = clone(v);
  }
  return out;
}

function diffFromDefaults(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) if (!deepEqual(v, DEFAULT_CONFIG[k])) out[k] = v;
  return out;
}

export const config = {
  get data() { return store.get("config") || clone(DEFAULT_CONFIG); },
  get rev() { return saved.rev || 0; },

  async load() {
    try {
      saved = await mf.config();
    } catch (e) {
      // first run, no permission, or an older plugin build: run on defaults
      saved = { rev: 0 };
    }
    store.set("config", merged(saved));
    return this.data;
  },

  /** Edit a copy with mutator(draft), then save it. Throws on failure. */
  async update(mutator) {
    const draft = clone(this.data);
    mutator(draft);
    const doc = { ...diffFromDefaults(draft), rev: saved.rev || 0 };
    try {
      saved = await mf.saveConfig(doc);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // someone else saved first: take their version, replay the edit once
        await this.load();
        const again = clone(this.data);
        mutator(again);
        saved = await mf.saveConfig({ ...diffFromDefaults(again), rev: saved.rev || 0 });
      } else throw e;
    }
    store.set("config", merged(saved));
    return this.data;
  },
};
