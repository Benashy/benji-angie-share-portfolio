import test from "node:test";
import assert from "node:assert/strict";

import {
  availableQuantityForSale,
  calculatePortfolioCore,
  orderedTransactions,
  validateTransactionInput,
} from "../portfolio-core.js";

const base = {
  owner: "Benji",
  account: "Benji ISA",
  ticker: "MSFT",
  holding: "Microsoft",
  currency: "GBP",
  deleted_at: null,
};

function quote(price = 100) {
  return [{ ticker: "MSFT", price, currency: "GBP", fetched_at: "2026-08-19T12:00:00Z" }];
}

test("same-day transactions follow their creation time", () => {
  const rows = [
    { ...base, id: "sell", date: "2026-08-19", type: "sell", quantity: 4, price: 110, amount_gbp: 440, created_at: "2026-08-19T10:00:00Z" },
    { ...base, id: "buy", date: "2026-08-19", type: "buy", quantity: 10, price: 100, amount_gbp: 1000, created_at: "2026-08-19T09:00:00Z" },
  ];
  assert.deepEqual(orderedTransactions(rows).map((row) => row.id), ["buy", "sell"]);
  const portfolio = calculatePortfolioCore({ transactions: rows, marketPrices: quote(110) });
  assert.equal(portfolio.positions[0].quantity, 6);
  assert.equal(portfolio.positions[0].cost_basis_gbp, 600);
  assert.equal(portfolio.totalCash, -560);
});

test("a sale before a later same-day purchase is rejected", () => {
  const rows = [
    { ...base, id: "sale-first", date: "2026-08-19", type: "sell", quantity: 4, price: 110, amount_gbp: 440, created_at: "2026-08-19T09:00:00Z" },
    { ...base, id: "buy-later", date: "2026-08-19", type: "buy", quantity: 10, price: 100, amount_gbp: 1000, created_at: "2026-08-19T10:00:00Z" },
  ];
  assert.throws(() => calculatePortfolioCore({ transactions: rows, marketPrices: quote() }), /exceeds the available holding/);
});

test("an oversized sale is rejected without crediting excess proceeds", () => {
  const rows = [
    { ...base, id: "open", date: "2026-08-18", type: "opening", quantity: 5, price: 100, cost_basis_gbp: 500, amount_gbp: 500, created_at: "2026-08-18T08:00:00Z" },
    { ...base, id: "sell", date: "2026-08-19", type: "sell", quantity: 6, price: 110, amount_gbp: 660, created_at: "2026-08-19T09:00:00Z" },
  ];
  assert.throws(() => calculatePortfolioCore({ transactions: rows, marketPrices: quote() }), /exceeds the available holding/);
});

test("historic USD purchases retain their stored GBP cost", () => {
  const rows = [
    { ...base, id: "open", date: "2026-08-17", type: "opening", quantity: 10, price: 100, cost_basis_gbp: 1000, amount_gbp: 1000, created_at: "2026-08-17T09:00:00Z" },
    { ...base, id: "buy", date: "2026-08-18", type: "buy", quantity: 10, price: 100, currency: "USD", amount_gbp: 800, fx_rate_used: 1.25, created_at: "2026-08-18T09:00:00Z" },
    { ...base, id: "sell", date: "2026-08-19", type: "sell", quantity: 5, price: 100, amount_gbp: 500, created_at: "2026-08-19T09:00:00Z" },
  ];
  const portfolio = calculatePortfolioCore({ transactions: rows, marketPrices: quote(100), fxFallback: 1.4 });
  assert.equal(portfolio.positions[0].quantity, 15);
  assert.equal(portfolio.positions[0].cost_basis_gbp, 1350);
  assert.equal(portfolio.totalCash, -300);
});

test("manual values and pensions use the latest dated entry", () => {
  const transactions = [{ ...base, id: "open", date: "2026-01-01", type: "opening", quantity: 1, price: 100, cost_basis_gbp: 100, amount_gbp: 100 }];
  const manualValues = [
    { ...base, date: "2026-08-19", value_gbp: 140, created_at: "2026-08-19T09:00:00Z" },
    { ...base, date: "2026-08-18", value_gbp: 130, created_at: "2026-08-20T09:00:00Z" },
  ];
  const pensions = [
    { name: "Pension 401", date: "2026-08-19", value_gbp: 200 },
    { name: "Pension 401", date: "2026-08-18", value_gbp: 190 },
  ];
  const portfolio = calculatePortfolioCore({ transactions, manualValues, pensions, marketPrices: [] });
  assert.equal(portfolio.positions[0].value_gbp, 140);
  assert.equal(portfolio.pensionTotal, 200);
});

test("sale availability and positive-value validation are explicit", () => {
  const rows = [{ ...base, id: "open", date: "2026-08-18", type: "opening", quantity: 7, price: 100, amount_gbp: 700 }];
  const candidate = { ...base, client_request_id: "candidate", date: "2026-08-19", type: "sell", quantity: 2, price: 110, amount_gbp: 220 };
  assert.equal(availableQuantityForSale(rows, candidate), 7);
  assert.match(validateTransactionInput({ ...candidate, quantity: 0 })[0], /Quantity/);
  assert.match(validateTransactionInput({ ...candidate, price: -1 })[0], /Price/);
});
