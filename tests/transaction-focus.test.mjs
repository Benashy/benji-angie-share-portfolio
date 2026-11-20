import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const span = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const focusSource = span("function rememberTransactionFocus(", "function setReportMessage(");
const sessionSource = span("function handleSessionChange(", "function showAppLoadError(");

function focusHarness({ start = 2, end = 4 } = {}) {
  const events = {};
  const frames = [];
  const state = { session: { user: { id: "benji" } }, activeView: "transaction", transactionFocus: null };
  let visible = true;
  const field = {
    id: "price", disabled: false, isConnected: true, selectionStart: start, selectionEnd: end, selectionDirection: "forward",
    matches: () => true, getClientRects: () => visible ? [{}] : [],
    focus: () => { document.activeElement = field; },
    setSelectionRange: (a, b, direction) => { field.selectionStart = a; field.selectionEnd = b; field.selectionDirection = direction; },
  };
  const document = {
    activeElement: field, body: {}, documentElement: {}, visibilityState: "visible", hasFocus: () => true,
    addEventListener: (name, handler) => { events[name] = handler; },
  };
  const context = vm.createContext({
    state, document,
    el: (id) => id === "transactionView" ? { contains: (node) => node === field } : field,
    window: { addEventListener: (name, handler) => { events[name] = handler; }, requestAnimationFrame: (work) => frames.push(work) },
  });
  vm.runInContext(focusSource, context);
  return { context, state, field, document, events, frames, hide: () => { visible = false; } };
}

test("returning restores the selected transaction field and text selection without changing its value", () => {
  const h = focusHarness();
  h.field.value = "123.45";
  h.context.rememberTransactionFocus();
  h.document.activeElement = h.document.body;
  h.field.selectionStart = h.field.selectionEnd = 0;
  h.context.restoreTransactionFocus();
  assert.equal(h.document.activeElement, h.field);
  assert.equal(h.field.selectionStart, 2);
  assert.equal(h.field.selectionEnd, 4);
  assert.equal(h.field.value, "123.45");
});

test("numeric and select controls restore focus without unsupported text-selection operations", () => {
  const h = focusHarness({ start: null, end: null });
  h.field.setSelectionRange = () => assert.fail("Numeric controls do not support selection ranges");
  h.context.rememberTransactionFocus();
  h.document.activeElement = h.document.body;
  h.context.restoreTransactionFocus();
  assert.equal(h.document.activeElement, h.field);
});

test("returning never steals focus from another control or a dialog", () => {
  const h = focusHarness();
  h.context.rememberTransactionFocus();
  const other = {};
  h.document.activeElement = other;
  h.context.restoreTransactionFocus();
  assert.equal(h.document.activeElement, other);
});

test("hidden views, hidden fields, disabled controls and signed-out sessions do not regain focus", () => {
  for (const block of [
    (h) => { h.state.activeView = "holdings"; },
    (h) => { h.state.session = null; },
    (h) => { h.document.visibilityState = "hidden"; },
    (h) => { h.field.disabled = true; },
    (h) => h.hide(),
  ]) {
    const h = focusHarness();
    h.context.rememberTransactionFocus();
    h.document.activeElement = h.document.body;
    block(h);
    h.context.restoreTransactionFocus();
    assert.equal(h.document.activeElement, h.document.body);
  }
});

test("a deliberate click cancels the pending return-focus request", () => {
  const h = focusHarness();
  h.context.bindTransactionFocus();
  h.context.rememberTransactionFocus();
  h.document.activeElement = h.document.body;
  h.events.focus();
  h.events.pointerdown();
  h.frames[0]();
  assert.equal(h.state.transactionFocus, null);
  assert.equal(h.document.activeElement, h.document.body);
});

test("repeated same-user sign-in updates the token without reloading an existing form", async () => {
  const pending = [];
  const state = { session: { user: { id: "benji" }, access_token: "old" }, member: { user_id: "benji" } };
  const context = vm.createContext({ state, window: { setTimeout: (work) => pending.push(work) }, loadApp: async () => {}, showAppLoadError() {} });
  vm.runInContext(sessionSource, context);
  const renewed = { user: { id: "benji" }, access_token: "new" };
  context.handleSessionChange("SIGNED_IN", renewed);
  assert.equal(state.session, renewed);
  assert.equal(pending.length, 0);
  context.handleSessionChange("SIGNED_OUT", null);
  context.handleSessionChange("SIGNED_IN", renewed);
  assert.equal(pending.length, 2, "Signing out and back in still reloads the app");
  context.handleSessionChange("SIGNED_IN", { user: { id: "angie" } });
  assert.equal(pending.length, 3, "Switching user still reloads the app");
});

test("market refresh preserves form nodes while explicit saves retain the normal redraw", () => {
  const events = [];
  let redraws = 0;
  const nodes = { authCard: { classList: { add() {} } }, headlineNetWorth: {}, transactionView: { querySelectorAll: () => [{ dispatchEvent: (event) => events.push(event) }] }, equityForm: {} };
  const portfolio = { netWorthTotal: 0 };
  const context = vm.createContext({
    state: { activeView: "transaction" }, isConfigured: false,
    el: (id) => nodes[id],
    document: { body: { classList: { remove() {} } } },
    window: { location: { hash: "" } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    calculatePortfolio: () => portfolio, money: String,
    renderTransaction: () => { redraws++; },
    hideBootScreen() {}, renderDashboard() {}, renderHoldings() {}, renderLedger() {}, renderReports() {}, renderAudit() {},
    showView() {}, placePresenceInHeader() {}, updateLiveMarketAgeLabels() {}, startMarketAgeTicker() {}, startAutoRefresh() {}, renderIcons() {},
  });
  vm.runInContext(span("function renderAll(", "function startMarketAgeTicker("), context);
  context.renderAll({ preserveTransactionForm: true });
  assert.equal(redraws, 0);
  assert.equal(events[0].type, "portfolio-prices-updated");
  assert.equal(events[0].detail, portfolio);
  context.renderAll();
  assert.equal(redraws, 1);
  const refreshSource = span("async function refreshMarketPrices(", "function startAutoRefresh(");
  assert.equal((refreshSource.match(/renderAll\(\{ preserveTransactionForm: true \}\)/g) || []).length, 2);
});

test("an in-place FX refresh updates the preview without changing the entered fields", () => {
  const handlers = {};
  const target = {};
  const elements = { quantity: { value: "2" }, price: { value: "100" }, currency: { value: "USD" }, ticker: { value: "MA" } };
  const context = vm.createContext({ money: (value) => `GBP ${value}`, usd: (value) => `USD ${value}` });
  vm.runInContext(span("function wireTransactionPreview(", "function setupManualForm("), context);
  context.wireTransactionPreview({ id: "equityForm", elements, querySelector: () => target, addEventListener: (name, handler) => { handlers[name] = handler; } }, { fx: 2 });
  assert.match(target.textContent, /GBP 100/);
  handlers["portfolio-prices-updated"]({ detail: { fx: 1.25 } });
  assert.match(target.textContent, /GBP 160/);
  assert.equal(elements.price.value, "100");
  assert.equal(elements.quantity.value, "2");
});
