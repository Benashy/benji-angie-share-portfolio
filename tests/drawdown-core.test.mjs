import test from "node:test";
import assert from "node:assert/strict";
import {
  activeQuotedHoldings,
  alertSuppressedBySnooze,
  evaluateThresholds,
  rollingClosingHigh,
} from "../drawdown-core.js";

test("only active quoted positions are monitored, combining accounts", () => {
  const rows = [
    { type: "opening", ticker: "AAPL", holding: "Apple", quantity: 10 },
    { type: "buy", ticker: "AAPL", holding: "Apple", quantity: 5 },
    { type: "sell", ticker: "AAPL", quantity: 14 },
    { type: "opening", ticker: "MSFT", quantity: 2, deleted_at: "2026-09-01" },
    { type: "opening", ticker: "VUAA", quantity: 4 },
    { type: "opening", ticker: "Crypto", quantity: 1 },
  ];
  assert.deepEqual(activeQuotedHoldings(rows).map(({ ticker, quantity }) => [ticker, quantity]), [["AAPL", 1], ["VUAA", 4]]);
});

test("rolling high uses daily closes inside the trailing year", () => {
  const points = Array.from({ length: 24 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    close: index === 12 ? 100 : 90,
  }));
  points.push({ date: "2026-09-29", close: 85 });
  points.push({ date: "2025-09-01", close: 150 });
  const result = rollingClosingHigh(points, "2026-09-29", "2025-09-29");
  assert.equal(result.high_price, 100);
  assert.equal(result.high_date, "2026-08-13");
  assert.equal(result.drawdown_pct, 15);
  assert.equal(result.full_year_history, false);
});

test("initial state is silent and a same-day repeat does not alert", () => {
  const first = evaluateThresholds([], 12, "2026-09-29");
  assert.equal(first.highestCrossed, null);
  assert.equal(first.states[0].armed, false);
  assert.equal(evaluateThresholds(first.states, 16, "2026-09-29").highestCrossed, null);
});

test("a deeper level alerts despite a prior lower level, only highest per close", () => {
  const first = evaluateThresholds([], 9, "2026-09-28");
  const second = evaluateThresholds(first.states, 16, "2026-09-29");
  assert.equal(second.highestCrossed, 15);
  assert.equal(second.states[0].armed, false);
  assert.equal(second.states[1].armed, false);
  const third = evaluateThresholds(second.states, 21, "2026-09-30");
  assert.equal(third.highestCrossed, 20);
});

test("threshold re-arms only after a two-point recovery", () => {
  const first = evaluateThresholds([], 9, "2026-09-25");
  const crossed = evaluateThresholds(first.states, 11, "2026-09-28");
  assert.equal(crossed.highestCrossed, 10);
  const noisy = evaluateThresholds(crossed.states, 9, "2026-09-29");
  assert.equal(noisy.states[0].armed, false);
  const recovered = evaluateThresholds(noisy.states, 8, "2026-09-30");
  assert.equal(recovered.states[0].armed, true);
  assert.equal(evaluateThresholds(recovered.states, 11, "2026-10-01").highestCrossed, 10);
});

test("snooze suppresses its level, not a deeper one", () => {
  const prior = { ticker: "AAPL", threshold_pct: 10 };
  const receipt = { snoozed_until: "2026-10-06T20:00:00Z" };
  const now = Date.parse("2026-09-29T20:00:00Z");
  assert.equal(alertSuppressedBySnooze({ ticker: "AAPL", threshold_pct: 10 }, prior, receipt, now), true);
  assert.equal(alertSuppressedBySnooze({ ticker: "AAPL", threshold_pct: 15 }, prior, receipt, now), false);
});
