import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { activeRows, calculatePortfolioCore } from "../portfolio-core.js";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const span = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const holding = { owner: "Benji", account: "Benji - Revolut - Crypto", ticker: "Crypto", currency: "GBP", date: "2026-01-01" };
const cash = { ...holding, ticker: "CASH", type: "deposit", quantity: 0, amount_gbp: 2000 };
const opening = { ...holding, type: "opening", quantity: 1, price: 10000, is_locked: true };
const closing = { ...holding, type: "sell", date: "2026-11-16", quantity: 1, price: 14575, amount_gbp: 14575 };
const aliases = ["Crypto", "CRYPTO", "CRYPT0", " crypt0 "];

function harness(stubs = {}) {
  const context = vm.createContext({ activeRows, ...stubs });
  vm.runInContext([
    span("function isRetiredHoldingTicker(", "const marketDefinitions"),
    span("function requiredMarketTickers(", "function marketDataHealth("),
    span("function restoreTransactionDraft(", "function wireTransactionDraft("),
    span("function wireTickerLookup(", "function wireTransactionPreview("),
    span("async function submitEquity(", "async function confirmEquityQuote("),
    span("async function submitManual(", "async function insertRow("),
  ].join("\n"), context);
  return context;
}

test("the closed holding remains in ledger history but no longer has shares or a price lookup", () => {
  const transactions = [opening, cash, closing];
  const { positions, totalCash } = calculatePortfolioCore({ transactions });
  const ui = harness({ state: { ledger: { transactions: [...transactions, ...aliases.map((ticker) => ({ ticker })), { ticker: "WXBT" }] } } });
  assert.equal(positions.length, 0);
  assert.equal(totalCash, 16575);
  assert.equal(ui.isLedgerEntryLocked(opening), true);
  assert.equal(ui.isLedgerEntryLocked(closing), true);
  assert.equal(ui.isLedgerEntryLocked(cash), false);
  assert.deepEqual([...ui.requiredMarketTickers()], ["GBPUSD=X", "WXBT"]);
});

test("retired spellings are stopped before quote lookup or transaction submission", async () => {
  for (const ticker of aliases) {
    const events = new Map();
    const status = {};
    const form = {
      elements: { ticker: { value: ticker, addEventListener: (name, fn) => events.set(name, fn) }, holding: {} },
      querySelector: (selector) => selector === ".lookup-status" ? status : null,
    };
    const errors = [];
    const ui = harness({
      state: { busyForms: {} },
      marketPriceMap: () => assert.fail("quote lookup should not start"),
      confirmBackdatedUsdFx: () => assert.fail("transaction should not proceed"),
      setFormWorking: () => {},
      clearSaveMessage: () => {},
      clearFormError: () => {},
      showFormError: (_form, message) => errors.push(message),
      FormData: class { entries() { return [["ticker", ticker]]; } },
    });
    ui.wireTickerLookup(form, {});
    await events.get("change")();
    assert.match(status.textContent, /retired/);
    await ui.submitEquity({ preventDefault() {}, currentTarget: form }, {});
    assert.equal(errors.length, 1);
    assert.match(errors[0], /retired/);
  }
});

test("stale Revolut drafts are discarded without restoring any form fields", () => {
  const cleared = [];
  const ui = harness({
    readTransactionDrafts: () => ({ manual: { kind: "crypto" }, equity: { ticker: "CRYPT0" } }),
    clearTransactionDraft: (key) => cleared.push(key),
  });
  assert.equal(ui.restoreTransactionDraft({}, "manual"), false);
  assert.equal(ui.restoreTransactionDraft({}, "equity"), false);
  assert.deepEqual(cleared, ["manual", "equity"]);
});

test("manual valuations only save to an existing pension, using its current value and cost", async () => {
  const inserts = [];
  const errors = [];
  const pension = { name: "Pension 043", value_gbp: 1000, cost_gbp: 800 };
  const data = { date: "2026-11-16", account: holding.account, value: 1050, currency: "GBP" };
  const ui = harness({
    state: { busyForms: {}, session: { user: { id: "test-user" } } },
    latestPensions: () => [pension],
    setFormWorking: () => {},
    clearSaveMessage: () => {},
    clearFormError: () => {},
    showFormError: (_form, message) => errors.push(message),
    insertRow: (table, row) => inserts.push({ table, row }),
    setSaveMessage: () => {},
    money: String,
    moneySigned: String,
    shortUkTime: () => "12:00",
    loadCloudLedger: () => {},
    renderAll: () => {},
    clearTransactionDraft: () => {},
    FormData: class { entries() { return Object.entries(data); } },
  });
  const event = { preventDefault() {}, currentTarget: { reset() {} } };
  await ui.submitManual(event, {});
  assert.deepEqual(errors, ["Choose a pension."]);
  assert.equal(inserts.length, 0);
  data.account = pension.name;
  await ui.submitManual(event, {});
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "pension_values");
  assert.equal(inserts[0].row.name, pension.name);
  assert.equal(inserts[0].row.value_gbp, 1050);
  assert.equal(inserts[0].row.cost_gbp, 800);
});
