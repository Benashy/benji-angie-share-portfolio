import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("function clearSaveMessage("), app.indexOf("function readTransactionDrafts("));

function harness() {
  const banners = new Map();
  const timers = new Map();
  const state = { saveMessages: {}, saveTimers: {} };
  let nextTimer = 0;
  const context = vm.createContext({
    state,
    document: {
      querySelector: (selector) => banners.get(selector.match(/data-save-area="([^"]+)"/)?.[1]),
      createElement: () => ({
        dataset: {}, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { banners.delete(this.dataset.saveArea); },
      }),
    },
    el: () => ({ querySelector: () => ({ after: (banner) => banners.set(banner.dataset.saveArea, banner) }) }),
    escapeHtml: (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
    window: {
      setTimeout: (run, delay) => { timers.set(++nextTimer, { run, delay }); return nextTimer; },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  vm.runInContext(source, context);
  return { context, state, banners, timers };
}

test("a rejected save displays its error immediately and keeps it visible", () => {
  const h = harness();
  h.context.setSaveMessage("manual", "Manual value save failed", "error");
  assert.equal(h.banners.get("manual").textContent, "Manual value save failed");
  assert.equal(h.banners.get("manual").attributes.role, "alert");
  assert.equal(h.timers.size, 0);
  assert.match(h.context.saveBanner("manual"), /role="alert" aria-live="assertive"/);
});

test("successful saves appear immediately and clear after ten seconds", () => {
  const h = harness();
  h.context.setSaveMessage("manual", "Saved");
  h.context.setSaveMessage("cash", "Cash saved");
  assert.equal(h.banners.get("manual").textContent, "Saved");
  const timer = h.timers.get(h.state.saveTimers.manual);
  assert.equal(timer.delay, 10000);
  timer.run();
  assert.equal(h.banners.has("manual"), false);
  assert.equal(h.state.saveMessages.manual, undefined);
  assert.equal(h.banners.get("cash").textContent, "Cash saved");
});

test("a previous success timer cannot remove a later error", () => {
  const h = harness();
  h.context.setSaveMessage("manual", "Saved");
  const oldTimer = h.state.saveTimers.manual;
  h.context.setSaveMessage("manual", "Failed", "error");
  assert.equal(h.timers.has(oldTimer), false);
  assert.equal(h.banners.get("manual").textContent, "Failed");
  h.context.clearSaveMessage("manual");
  assert.equal(h.banners.has("manual"), false);
  assert.equal(h.context.saveBanner("manual"), "");
});

test("editing a failed form clears its error while retaining the draft", () => {
  const h = harness();
  const handlers = {};
  let drafts = 0;
  h.context.saveTransactionDraft = () => { drafts++; };
  const start = app.indexOf("function wireTransactionDraft(");
  vm.runInContext(app.slice(start, app.indexOf("function setReportMessage(", start)), h.context);
  h.context.wireTransactionDraft({ addEventListener: (name, run) => { handlers[name] = run; } }, "manual");
  h.context.setSaveMessage("manual", "Failed", "error");
  handlers.input();
  assert.equal(h.banners.has("manual"), false);
  assert.equal(drafts, 1);
});
