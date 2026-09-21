// Confirmed London listings. Settlement currency alone cannot identify an exchange.
export const instrumentRegistry = Object.freeze({
  AJB: { symbol: "AJB.L", name: "AJ Bell", currency: "GBP", exchange: "LSE", nameMatch: /aj\s*bell/i },
  IAG: { symbol: "IAG.L", currency: "GBP", exchange: "LSE" },
  SGLN: { symbol: "SGLN.L", currency: "GBP", exchange: "LSE" },
  VUAA: { symbol: "VUAA.L", currency: "USD", exchange: "LSE" },
  WXBT: { symbol: "WXBT.L", currency: "GBP", exchange: "LSE" },
});

export function yahooSymbol(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  if (["CRYPTO", "CASH"].includes(key)) return "";
  return instrumentRegistry[key]?.symbol || key;
}

export function quoteValidationError(quote, now = Date.now()) {
  if (!quote || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) return "No valid price is available.";
  const symbol = yahooSymbol(quote.ticker);
  if (quote.yahoo_symbol !== symbol) return `Expected ${symbol}, received ${quote.yahoo_symbol || "an unknown symbol"}.`;
  if (!["GBP", "USD"].includes(quote.currency)) return "The quote currency is unsupported.";
  const registered = instrumentRegistry[String(quote.ticker).toUpperCase()];
  if (registered && registered.currency !== quote.currency) return `Expected ${registered.currency} for ${symbol}.`;
  const instrument = quote.metrics?.instrument;
  if ((registered?.exchange || symbol.endsWith(".L")) && instrument?.exchange && instrument.exchange !== "LSE") return `Expected the London listing for ${symbol}.`;
  if (registered?.nameMatch && instrument?.name && !registered.nameMatch.test(instrument.name)) return `The returned company does not match ${registered.name}.`;
  const marketTime = Date.parse(quote.market_time || "");
  if (!Number.isFinite(marketTime)) return "Yahoo did not supply the time of the market quote.";
  if (marketTime > now + 5 * 60_000) return "The market quote is dated in the future.";
  // Allow weekends and multi-day exchange holidays, but never freshly label an obsolete quote.
  if (now - marketTime > 7 * 86_400_000) return "The last market quote is more than seven days old.";
  return "";
}

export function normaliseYahooQuote(ticker, meta, now = Date.now()) {
  const symbol = yahooSymbol(ticker);
  if (!meta || meta.symbol !== symbol) throw new Error(`${ticker}: Yahoo returned a different instrument.`);
  const rawCurrency = String(meta.currency || "");
  const pence = rawCurrency === "GBp" || ["GBX", "GBPENCE", "GBP PENCE"].includes(rawCurrency.toUpperCase());
  const currency = pence ? "GBP" : rawCurrency.toUpperCase();
  const price = Number(meta.regularMarketPrice) / (pence ? 100 : 1);
  const name = meta.longName || meta.shortName;
  if (!name || !meta.exchangeName) throw new Error(`${ticker}: Yahoo did not identify the company and exchange.`);
  const marketMs = Number(meta.regularMarketTime) * 1000;
  const quote = {
    ticker, yahoo_symbol: symbol, price, currency,
    market_time: Number.isFinite(marketMs) && marketMs > 0 ? new Date(marketMs).toISOString() : null,
    fetched_at: new Date(now).toISOString(), source: "Yahoo",
    metrics: { instrument: { name, exchange: meta.exchangeName, quote_currency: rawCurrency, quote_unit: pence ? "pence" : "major", raw_price: Number(meta.regularMarketPrice) } },
  };
  const problem = quoteValidationError(quote, now);
  if (problem) throw new Error(`${ticker}: ${problem}`);
  return quote;
}

export function fxHistoryMetrics(result, current, now = Date.now()) {
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = (result?.timestamp || [])
    .map((timestamp, index) => ({ time: timestamp * 1000, rate: Number(closes[index]) }))
    .filter((point) => Number.isFinite(point.rate) && point.rate > 0);
  return Object.fromEntries([["d28", 28], ["m6", 183], ["y1", 365], ["y5", 1826]].map(([key, days]) => {
    const target = now - days * 86_400_000;
    const previous = [...points].reverse().find((point) => point.time <= target) || points[0];
    return [key, { rate: previous?.rate ?? null, change_pct: previous ? (current - previous.rate) / previous.rate : null }];
  }));
}
