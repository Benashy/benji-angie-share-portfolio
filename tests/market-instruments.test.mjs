import test from "node:test";
import assert from "node:assert/strict";
import { normaliseYahooQuote, quoteValidationError, yahooSymbol, fxHistoryMetrics } from "../market-instruments.js";
import { calculatePortfolioCore } from "../portfolio-core.js";

const now = Date.now();
const meta = {
  symbol: "AJB.L", currency: "GBp", regularMarketPrice: 604.5,
  regularMarketTime: Math.floor(now / 1000) - 900,
  longName: "AJ Bell plc", exchangeName: "LSE",
};
const purchase = { type: "buy", ticker: "AJB", holding: "AJ Bell", owner: "Test", account: "Trading", date: "2026-01-01", quantity: 100, price: 5.90, currency: "GBP", amount_gbp: 590 };

test("AJB uses the confirmed London listing and pence are converted once", () => {
  assert.equal(yahooSymbol("ajb"), "AJB.L");
  for (const currency of ["GBp", "GBX", "GBpence"]) {
    const quote = normaliseYahooQuote("AJB", { ...meta, currency }, now);
    assert.equal(quote.price, 6.045);
    assert.equal(quote.currency, "GBP");
    assert.equal(quote.metrics.instrument.quote_unit, "pence");
  }
  assert.equal(normaliseYahooQuote("AJB", { ...meta, currency: "GBP", regularMarketPrice: 6.045 }, now).price, 6.045);
});

test("wrong symbols, companies, exchanges and currencies are rejected", () => {
  for (const changed of [{ symbol: "AJB" }, { longName: "Safety First Trust" }, { exchangeName: "NYQ" }, { currency: "USD" }, { currency: "" }]) {
    assert.throws(() => normaliseYahooQuote("AJB", { ...meta, ...changed }, now));
  }
});

test("obsolete, missing and future market times cannot pass as freshly fetched", () => {
  for (const regularMarketTime of [undefined, 0, Date.parse("2014-03-25T20:00:00Z") / 1000, (now + 600_000) / 1000]) {
    assert.throws(() => normaliseYahooQuote("AJB", { ...meta, regularMarketTime }, now));
  }
  assert.equal(quoteValidationError(normaliseYahooQuote("AJB", { ...meta, regularMarketTime: (now - 4 * 86400_000) / 1000 }, now), now), "");
});

test("London USD listings remain USD and explicit .L symbols work", () => {
  const quote = normaliseYahooQuote("VUAA", { ...meta, symbol: "VUAA.L", currency: "USD", regularMarketPrice: 149.34, longName: "Vanguard S&P 500" }, now);
  assert.equal(quote.price, 149.34);
  assert.equal(quote.currency, "USD");
  assert.equal(normaliseYahooQuote("AJB.L", meta, now).price, 6.045);
  assert.equal(yahooSymbol("MA"), "MA");
});

test("AJB valuation and both performance rankings use the actual GBP cost", () => {
  const quote = normaliseYahooQuote("AJB", meta, now);
  const portfolio = calculatePortfolioCore({ transactions: [purchase], marketPrices: [quote] });
  assert.ok(Math.abs(portfolio.totalPositions - 604.5) < 1e-8);
  assert.ok(Math.abs(portfolio.combined[0].gain_gbp - 14.5) < 1e-8);
  assert.ok(Math.abs(portfolio.combined[0].gain_pct - 14.5 / 590) < 1e-8);
  const down = calculatePortfolioCore({ transactions: [purchase], marketPrices: [{ ...quote, price: 5.8 }] });
  assert.ok(Math.abs(down.combined[0].gain_gbp + 10) < 1e-8);
});

test("a previously cached wrong AJB quote is not used or ranked", () => {
  const obsolete = { ticker: "AJB", yahoo_symbol: "AJB", price: 23.93, currency: "USD", market_time: "2014-03-25T20:00:00Z", fetched_at: new Date(now).toISOString() };
  const portfolio = calculatePortfolioCore({ transactions: [purchase], marketPrices: [obsolete] });
  assert.equal(portfolio.totalPositions, 590);
  assert.equal(portfolio.combined[0].gain_gbp, null);
  assert.equal(portfolio.combined[0].gain_pct, null);
  assert.match(portfolio.combined[0].price_issue, /Expected AJB.L/);
});

test("non-positive prices and unidentified instruments are rejected", () => {
  for (const changed of [{ regularMarketPrice: 0 }, { regularMarketPrice: -1 }, { regularMarketPrice: null }, { longName: null }, { exchangeName: null }]) {
    assert.throws(() => normaliseYahooQuote("AJB", { ...meta, ...changed }, now));
  }
});

test("FX history skips null points and accompanies both refresh paths", () => {
  const result = { timestamp: [(now - 31 * 86400_000) / 1000, (now - 29 * 86400_000) / 1000], indicators: { quote: [{ close: [1.25, null] }] } };
  const metrics = fxHistoryMetrics(result, 1.35, now);
  assert.equal(metrics.d28.rate, 1.25);
  assert.ok(Math.abs(metrics.d28.change_pct - 0.08) < 1e-8);
});
