export const DRAWDOWN_THRESHOLDS = Object.freeze([10, 15, 20, 25]);

export function activeQuotedHoldings(transactions = []) {
  const holdings = new Map();
  for (const row of transactions) {
    if (row.deleted_at || !["opening", "buy", "sell"].includes(row.type)) continue;
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!ticker || ticker === "CASH" || ticker === "CRYPTO") continue;
    const current = holdings.get(ticker) || { ticker, holding: row.holding || ticker, quantity: 0 };
    current.quantity += (row.type === "sell" ? -1 : 1) * Number(row.quantity || 0);
    if (row.holding) current.holding = row.holding;
    holdings.set(ticker, current);
  }
  return [...holdings.values()].filter((item) => item.quantity > 1e-8);
}

export function rollingClosingHigh(points, closeDate, cutoffDate) {
  const usable = points
    .filter((point) => point.date >= cutoffDate && point.date <= closeDate && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (usable.length < 2 || usable.at(-1)?.date !== closeDate) return null;
  let high = usable[0];
  for (const point of usable) if (point.close >= high.close) high = point;
  const close = usable.at(-1);
  const cutoffTime = Date.parse(`${cutoffDate}T00:00:00Z`);
  const startTime = Date.parse(`${usable[0].date}T00:00:00Z`);
  return {
    close_date: close.date,
    close_price: close.close,
    high_date: high.date,
    high_price: high.close,
    drawdown_pct: Math.max(0, ((high.close - close.close) / high.close) * 100),
    history_start_date: usable[0].date,
    full_year_history: startTime - cutoffTime <= 7 * 86_400_000,
  };
}

export function evaluateThresholds(previousRows, drawdownPct, closeDate) {
  const previous = new Map(previousRows.map((row) => [Number(row.threshold_pct), row]));
  const crossed = [];
  const states = DRAWDOWN_THRESHOLDS.map((threshold) => {
    const row = previous.get(threshold);
    if (row?.last_evaluated_close_date === closeDate) {
      return { threshold_pct: threshold, armed: row.armed, last_evaluated_close_date: closeDate };
    }
    let armed = row ? Boolean(row.armed) : drawdownPct < threshold;
    if (drawdownPct <= threshold - 2) armed = true;
    else if (drawdownPct >= threshold && armed) {
      armed = false;
      crossed.push(threshold);
    }
    return { threshold_pct: threshold, armed, last_evaluated_close_date: closeDate };
  });
  return { states, highestCrossed: crossed.length ? Math.max(...crossed) : null };
}

export function alertSuppressedBySnooze(alert, priorAlert, priorReceipt, now = Date.now()) {
  return Boolean(
    priorAlert?.ticker === alert.ticker
    && Number(priorAlert.threshold_pct) >= Number(alert.threshold_pct)
    && Date.parse(priorReceipt?.snoozed_until || "") > now
    && !priorReceipt?.acknowledged_at
  );
}
