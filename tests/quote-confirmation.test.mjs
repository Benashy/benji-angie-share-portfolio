import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { activeRows } from "../portfolio-core.js";
import { normaliseYahooQuote, quoteValidationError } from "../market-instruments.js";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const confirmationSource = app.slice(app.indexOf("async function confirmEquityQuote("), app.indexOf("async function submitCashConfirmation("));
const now = Date.now();
const quote = normaliseYahooQuote("MA", { symbol: "MA", currency: "USD", regularMarketPrice: 500, regularMarketTime: now / 1000, longName: "Mastercard Incorporated", exchangeName: "NYQ" });
const row = { ticker: "MA", holding: "Mastercard", price: 400, currency: "GBP", quantity: 2, date: "2026-09-21" };

function harness({ transactions = [], marketQuote = quote, accept = true } = {}) {
  const confirmations = [];
  const errors = [];
  const context = vm.createContext({
    state: { ledger: { transactions } }, activeRows, quoteValidationError,
    marketPriceMap: () => new Map(marketQuote ? [["MA", marketQuote]] : []),
    priceIsFresh: () => true, todayIso: () => "2026-09-21",
    refreshMarketPrices: async () => {},
    showFormError: (_form, message) => errors.push(message),
    appConfirm: async (options) => { confirmations.push(options); return accept; },
  });
  vm.runInContext(confirmationSource, context);
  return { run: (candidate = row) => context.confirmEquityQuote(candidate, {}, 1.25), confirmations, errors };
}

test("new holdings require confirmation of the actual company and exchange", async () => {
  const h = harness();
  assert.equal(await h.run(), true);
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0].message, /Mastercard Incorporated \(MA, NYQ\)/);
});

test("cancelling confirmation or an unverifiable new ticker prevents saving", async () => {
  assert.equal(await harness({ accept: false }).run(), false);
  const missing = harness({ marketQuote: null });
  assert.equal(await missing.run(), false);
  assert.equal(missing.errors.length, 1);
});

test("GBP settlement for a USD quote is compared after FX conversion", async () => {
  const h = harness({ transactions: [{ ticker: "MA" }] });
  assert.equal(await h.run(), true);
  assert.equal(h.confirmations.length, 0);
  await h.run({ ...row, price: 40000 });
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0].message, /pounds, not pence/);
});

test("backdated purchases are not compared to today's trading price", async () => {
  const h = harness({ transactions: [{ ticker: "MA" }] });
  assert.equal(await h.run({ ...row, date: "2020-01-01", price: 50 }), true);
  assert.equal(h.confirmations.length, 0);
});

test("market reload updates only prices and preserves a transaction draft", async () => {
  const start = app.indexOf("async function reloadMarketPrices()");
  const end = app.indexOf("async function refreshMarketPrices(", start);
  const state = { ledger: { market_prices: [], transactions: [row] }, transactionDrafts: { equity: row } };
  const context = vm.createContext({ state, selectAllRows: async (table) => {
    assert.equal(table, "market_prices");
    return { data: [quote], error: null };
  } });
  vm.runInContext(app.slice(start, end), context);
  await context.reloadMarketPrices();
  assert.deepEqual(state.ledger.market_prices, [quote]);
  assert.deepEqual(state.ledger.transactions, [row]);
  assert.equal(state.transactionDrafts.equity, row);
});

test("session callbacks release the auth lock before loading portfolio data", async () => {
  const start = app.indexOf("function handleSessionChange(");
  const end = app.indexOf("function showAppLoadError(", start);
  let loads = 0;
  const pending = [];
  const state = {};
  const context = vm.createContext({ state, window: { setTimeout: (work) => pending.push(work) }, loadApp: async () => { loads++; }, showAppLoadError: () => {} });
  vm.runInContext(app.slice(start, end), context);
  assert.equal(context.handleSessionChange("SIGNED_IN", { user: { id: "test" } }), undefined);
  assert.equal(loads, 0);
  await pending[0]();
  assert.equal(loads, 1);
  context.handleSessionChange("TOKEN_REFRESHED", { user: { id: "test" } });
  context.handleSessionChange("INITIAL_SESSION", { user: { id: "test" } });
  assert.equal(pending.length, 1);
});
