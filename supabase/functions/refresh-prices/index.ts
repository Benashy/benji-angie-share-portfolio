import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const symbolMap: Record<string, string> = {
  IAG: "IAG.L",
  SGLN: "SGLN.L",
  VUAA: "VUAA.L",
  WXBT: "WXBT.L",
  Crypto: "",
};

const quoteTimeoutMs = 7000;

type Quote = {
  ticker: string;
  yahoo_symbol: string;
  price: number;
  currency: string;
  market_time: string | null;
  metrics?: Record<string, unknown> | null;
  fetched_at: string;
  source: string;
};

function yahooSymbol(ticker: string) {
  if (symbolMap[ticker] !== undefined) return symbolMap[ticker];
  if (ticker === "CASH") return "";
  return ticker;
}

async function fetchYahooQuote(ticker: string): Promise<Quote | null> {
  const symbol = yahooSymbol(ticker);
  if (!symbol) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), quoteTimeoutMs);
  const url = ticker === "GBPUSD=X"
    ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`
    : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 portfolio-price-refresh" },
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`${ticker}: Yahoo returned ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  const rawPrice = Number(meta?.regularMarketPrice ?? meta?.previousClose);
  if (!Number.isFinite(rawPrice)) throw new Error(`${ticker}: Yahoo did not return a price`);

  const rawCurrency = String(meta?.currency || "USD");
  let currency = rawCurrency.toUpperCase();
  let price = rawPrice;
  if (rawCurrency === "GBp" || ["GBX", "GBPENCE", "GBP PENCE"].includes(currency)) {
    currency = "GBP";
    price = rawPrice / 100;
  }

  return {
    ticker,
    yahoo_symbol: symbol,
    price,
    currency,
    market_time: meta?.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : null,
    metrics: ticker === "GBPUSD=X" ? fxMetrics(result, price) : null,
    fetched_at: new Date().toISOString(),
    source: "Yahoo",
  };
}

function fxMetrics(result: any, current: number) {
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = timestamps
    .map((timestamp: number, index: number) => ({ date: new Date(timestamp * 1000), rate: Number(closes[index]) }))
    .filter((point: { rate: number }) => Number.isFinite(point.rate));
  const periods = [["d28", 28], ["m6", 183], ["y1", 365], ["y5", 1826]] as const;
  return Object.fromEntries(periods.map(([key, days]) => {
    const target = Date.now() - days * 86_400_000;
    const previous = [...points].reverse().find((point) => point.date.getTime() <= target) || points[0];
    return [key, {
      rate: previous?.rate ?? null,
      change_pct: previous?.rate ? (current - previous.rate) / previous.rate : null,
    }];
  }));
}

async function fetchQuotes(tickers: string[]) {
  const results = await Promise.allSettled(tickers.map((ticker) => fetchYahooQuote(ticker)));
  const updated: Quote[] = [];
  const skipped: Array<{ ticker: string; reason: string }> = [];
  results.forEach((result, index) => {
    const ticker = tickers[index];
    if (result.status === "fulfilled" && result.value) updated.push(result.value);
    if (result.status === "rejected") skipped.push({ ticker, reason: result.reason?.message || "Yahoo lookup failed" });
  });
  return { updated, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body: { extraTickers?: string[]; mode?: "all" | "lookup" } = await req.json().catch(() => ({}));
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) throw new Error("Missing Supabase environment variables");

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: member, error: memberError } = await userClient.from("app_members").select("user_id").single();
    if (memberError || !member) {
      return new Response(JSON.stringify({ error: "Not authorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requested = new Set<string>();
    if (body.mode !== "lookup") {
      requested.add("GBPUSD=X");
      const { data: transactions, error } = await userClient
        .from("portfolio_transactions")
        .select("ticker")
        .is("deleted_at", null);
      if (error) throw error;
      for (const row of transactions || []) {
        const ticker = String(row.ticker || "").trim();
        if (ticker && ticker !== "CASH" && ticker !== "Crypto") requested.add(ticker);
      }
    }
    for (const value of body.extraTickers || []) {
      const ticker = String(value || "").trim().toUpperCase();
      if (ticker && ticker !== "CASH" && ticker !== "CRYPTO") requested.add(ticker);
    }
    const requestedTickers = [...requested];
    if (!requestedTickers.length) throw new Error("No market tickers were requested");

    let { updated, skipped } = await fetchQuotes(requestedTickers);
    if (skipped.length) {
      const retry = await fetchQuotes(skipped.map((item) => item.ticker));
      const recovered = new Set(retry.updated.map((item) => item.ticker));
      updated = [...updated, ...retry.updated];
      skipped = retry.skipped.filter((item) => !recovered.has(item.ticker));
    }
    if (updated.length) {
      const { error } = await userClient.from("market_prices").upsert(updated, { onConflict: "ticker" });
      if (error) throw error;
    }

    const updatedTickers = updated.map((item) => item.ticker);
    const completionRatio = requestedTickers.length ? updatedTickers.length / requestedTickers.length : 0;
    return new Response(JSON.stringify({
      requested: requestedTickers,
      updated: updatedTickers,
      skipped,
      complete: skipped.length === 0 && updatedTickers.length === requestedTickers.length,
      completion_ratio: completionRatio,
      fetched_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
