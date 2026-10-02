import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/portfolio-drawdown-alerts/index.ts", import.meta.url), "utf8");
const actionSource = app.slice(app.indexOf("function bindDrawdownAlertActions("), app.indexOf("function mobilePerformanceSortTools("));

test("alert preflight permits the headers sent by the pinned Supabase browser client", () => {
  const corsSource = edge.match(/const CORS = \{[\s\S]*?\n\};/)?.[0];
  assert.ok(corsSource);
  const cors = vm.runInNewContext(`${corsSource}\nCORS;`);
  const allowedHeaders = cors["Access-Control-Allow-Headers"].split(",").map((value) => value.trim().toLowerCase());
  for (const header of ["authorization", "x-client-info", "apikey", "content-type", "x-cron-secret"]) {
    assert.ok(allowedHeaders.includes(header), `${header} is allowed`);
  }
  assert.equal(cors["Access-Control-Allow-Origin"], "*");
  assert.equal(cors["Access-Control-Allow-Methods"], "POST, OPTIONS");
  assert.match(edge, /req\.method === "OPTIONS"\) return new Response\("ok", \{ headers: CORS \}\)/);
  assert.match(edge, /headers: \{ \.\.\.CORS, "Content-Type": "application\/json" \}/);
});

function harness(invoke, { receipts = [], action = "snooze" } = {}) {
  let click;
  const messages = [];
  const renders = [];
  const timers = [];
  const buttons = [{ disabled: false }, { disabled: false }];
  const row = { dataset: { alertId: "alert-1" }, querySelectorAll: () => buttons, querySelector: () => ({ value: "3" }) };
  const button = { dataset: { drawdownAction: action }, closest: () => row, addEventListener: (_event, handler) => { click = handler; } };
  const state = { ledger: { drawdown_alert_receipts: receipts }, drawdownMessage: "" };
  const context = vm.createContext({
    state,
    document: { querySelectorAll: () => [button] },
    supabaseClient: { functions: { invoke } },
    announce: (message, tone) => messages.push({ message, tone }),
    calculatePortfolio: () => ({}),
    renderDashboard: (portfolio) => renders.push(portfolio),
    window: { setTimeout: (handler, delay) => timers.push({ handler, delay }) },
    el: () => null,
  });
  vm.runInContext(actionSource, context);
  context.bindDrawdownAlertActions();
  return { click: () => click(), state, messages, renders, timers, buttons };
}

test("snooze updates the confirmed receipt, redraws the dashboard and keeps deeper-level alerts", async () => {
  const receipt = { alert_id: "alert-1", snoozed_until: "2026-10-05T15:00:00Z" };
  const h = harness(async (name, options) => {
    assert.equal(name, "portfolio-drawdown-alerts");
    assert.equal(options.body.action, "snooze");
    assert.equal(options.body.alert_id, "alert-1");
    assert.equal(options.body.days, 3);
    assert.ok(h.buttons.every((button) => button.disabled));
    return { data: { ok: true, receipt }, error: null };
  }, { receipts: [{ alert_id: "alert-1" }] });
  await h.click();
  assert.equal(h.state.ledger.drawdown_alert_receipts.length, 1);
  assert.equal(h.state.ledger.drawdown_alert_receipts[0], receipt);
  assert.match(h.state.drawdownMessage, /snoozed for 3 days.*deeper level can still alert/);
  assert.equal(h.renders.length, 1);
  assert.equal(h.messages.length, 0);
  assert.equal(h.timers[0].delay, 10000);
  assert.ok(h.buttons.every((button) => !button.disabled));
});

test("a confirmed review adds a receipt without duplicating other alerts", async () => {
  const receipt = { alert_id: "alert-1", acknowledged_at: "2026-10-02T15:00:00Z" };
  const h = harness(async () => ({ data: { ok: true, receipt }, error: null }), { action: "acknowledge", receipts: [{ alert_id: "other-alert" }] });
  await h.click();
  assert.equal(h.state.ledger.drawdown_alert_receipts.length, 2);
  assert.equal(h.state.ledger.drawdown_alert_receipts[0].alert_id, "other-alert");
  assert.equal(h.state.drawdownMessage, "Alert marked reviewed.");
});

test("transport failures leave receipts unchanged and allow a retry", async () => {
  const original = { alert_id: "alert-1", snoozed_until: null };
  for (const invoke of [
    async () => ({ data: null, error: new Error("Failed to send a request to the Edge Function") }),
    async () => { throw new Error("Network disconnected"); },
  ]) {
    const h = harness(invoke, { receipts: [original] });
    await h.click();
    assert.equal(h.state.ledger.drawdown_alert_receipts[0], original);
    assert.equal(h.state.drawdownMessage, "");
    assert.equal(h.renders.length, 0);
    assert.equal(h.messages[0].tone, "error");
    assert.ok(h.buttons.every((button) => !button.disabled));
  }
});

test("server rejection details are shown, and an incomplete response cannot claim success", async () => {
  const h = harness(async () => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "Not signed in" }) } } }));
  await h.click();
  assert.match(h.messages[0].message, /Not signed in/);
  assert.ok(h.buttons.every((button) => !button.disabled));

  const incomplete = harness(async () => ({ data: { ok: true }, error: null }));
  await incomplete.click();
  assert.equal(incomplete.state.ledger.drawdown_alert_receipts.length, 0);
  assert.equal(incomplete.messages[0].tone, "error");
  assert.ok(incomplete.buttons.every((button) => !button.disabled));
});

test("a pending alert offers Mark reviewed rather than claiming it is already reviewed", () => {
  const renderSource = app.slice(app.indexOf("function renderDrawdownAlerts("), app.indexOf("function bindDrawdownAlertActions("));
  const context = vm.createContext({
    state: { drawdownAlertsAvailable: true, drawdownMessage: "", ledger: { drawdown_quotes: [], drawdown_alert_receipts: [], drawdown_alerts: [{ id: "alert-1", ticker: "UNH", holding: "UnitedHealth", threshold_pct: 15, drawdown_pct: 16, full_year_history: true, close_date: "2026-10-01" }] } },
    displayHoldingName: (_ticker, name) => name,
    escapeHtml: (text) => String(text),
    displayDate: (date) => date,
    displayDateTime: (date) => date,
  });
  vm.runInContext(renderSource, context);
  const html = context.renderDrawdownAlerts({ combined: [{ ticker: "UNH", holding: "UnitedHealth" }] });
  assert.match(html, /<span>Mark reviewed<\/span>/);
  assert.doesNotMatch(html, /<span>Reviewed<\/span>/);
});
