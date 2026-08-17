import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { calculatePortfolioCore } from "../_shared/portfolio-core.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const APPROVED_EMAILS = new Set([
  "ben_ashurst@me.com",
  "angelika_kleczka@hotmail.com",
]);

const symbolMap: Record<string, string> = {
  IAG: "IAG.L",
  SGLN: "SGLN.L",
  VUAA: "VUAA.L",
  WXBT: "WXBT.L",
  Crypto: "",
};

const holdingNameMap: Record<string, string> = {
  AAPL: "Apple",
  AMZN: "Amazon",
  AVGO: "Broadcom",
  GOOGL: "Google / Alphabet",
  HWM: "Howmet Aerospace",
  IAG: "IAG",
  JPM: "J P Morgan",
  MA: "Mastercard",
  MCK: "McKesson",
  META: "Meta",
  MS: "Morgan Stanley",
  MSFT: "Microsoft",
  NVDA: "Nvidia",
  NVO: "Novo Nordisk",
  PH: "Parker Hannifin",
  SGLN: "iShares Physical Gold GBP",
  TSLA: "Tesla",
  TSM: "Taiwan Semiconductor",
  UNH: "UnitedHealth Group",
  V: "Visa",
  VUAA: "Vanguard S&P 500 USD",
  WXBT: "Bitcoin ETF",
};

type AnyRow = Record<string, any>;

const REPORT_TIME_ZONE = "Europe/Lisbon";
const REPORT_LOCAL_HOUR = 14;
const REPORT_LOCAL_MINUTE = 45;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string) {
  return Deno.env.get(name) || "";
}

function serviceClient() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase service environment variables");
  return createClient(url, key, { auth: { persistSession: false } });
}

function anonClient(authHeader: string) {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Missing Supabase anon environment variables");
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

async function requireApprovedUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Not signed in");

  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.email) throw new Error("Not signed in");
  const email = data.user.email.toLowerCase();
  if (!APPROVED_EMAILS.has(email)) throw new Error("Not authorised");

  const userScoped = anonClient(authHeader);
  const { data: member, error: memberError } = await userScoped.from("app_members").select("*").single();
  if (memberError || !member) throw new Error("Not authorised");
  return { user: data.user, member, admin };
}

async function requireCron(req: Request, body: AnyRow) {
  const actual = req.headers.get("x-cron-secret") || body.cron_secret || body.secret || "";
  const admin = serviceClient();
  const { data, error } = await admin.rpc("portfolio_report_cron_secret_matches", { provided_secret: actual });
  if (error || data !== true) throw new Error("Cron not authorised");
  return { admin };
}

async function telegramApi(method: string, payload: AnyRow) {
  const token = env("PORTFOLIO_TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function todayUk() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dayNameUk() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(new Date());
}

function localReportTimeParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number(map.hour),
    minute: Number(map.minute),
    label: `${map.hour}:${map.minute} ${REPORT_TIME_ZONE}`,
  };
}

function isReportWindow() {
  const now = localReportTimeParts();
  return now.hour === REPORT_LOCAL_HOUR && now.minute === REPORT_LOCAL_MINUTE;
}

function daysBetweenIso(earlier: string, later: string) {
  const start = new Date(`${earlier.slice(0, 10)}T12:00:00Z`).getTime();
  const end = new Date(`${later.slice(0, 10)}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function reportDate(value: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `£${Number(value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function moneySigned(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  const number = Number(value);
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `${sign}£${Math.abs(number).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function pct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function pctSigned(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;
}

function percentagePointsSigned(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)} percentage points`;
}

function activeRows(rows: AnyRow[]) {
  return (rows || []).filter((row) => !row.deleted_at);
}

function displayHoldingName(ticker: string, holding: string) {
  if (ticker === "Crypto") return "Crypto (Revolut)";
  return holding || holdingNameMap[ticker] || ticker;
}

function priceMap(rows: AnyRow[]) {
  return new Map(activeRows(rows).map((row) => [row.ticker, row]));
}

function calculatePortfolio(data: Record<string, AnyRow[]>) {
  const portfolio = calculatePortfolioCore({
    transactions: data.portfolio_transactions || [],
    manualValues: data.manual_values || [],
    pensions: data.pension_values || [],
    marketPrices: data.market_prices || [],
  });
  portfolio.positions = portfolio.positions.map((item: AnyRow) => ({
    ...item,
    holding: displayHoldingName(item.ticker, item.holding),
  }));
  portfolio.combined = portfolio.combined.map((item: AnyRow) => ({
    ...item,
    holding: displayHoldingName(item.ticker, item.holding),
  }));
  return portfolio;
}

function yahooSymbol(ticker: string) {
  if (symbolMap[ticker] !== undefined) return symbolMap[ticker];
  if (ticker === "CASH") return "";
  return ticker;
}

async function fetchYahooQuote(ticker: string) {
  const symbol = yahooSymbol(ticker);
  if (!symbol) return null;
  const url = ticker === "GBPUSD=X"
    ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`
    : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 portfolio-report-refresh" } });
  if (!response.ok) throw new Error(`${ticker}: Yahoo returned ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  const rawPrice = Number(meta?.regularMarketPrice ?? meta?.previousClose);
  if (!Number.isFinite(rawPrice)) throw new Error(`${ticker}: Yahoo did not return a price`);
  const rawCurrency = String(meta?.currency || "USD");
  let currency = rawCurrency.toUpperCase();
  let price = rawPrice;
  if (rawCurrency === "GBp" || currency === "GBX" || currency === "GBPENCE" || currency === "GBP PENCE") {
    currency = "GBP";
    price = rawPrice / 100;
  }
  return {
    ticker,
    yahoo_symbol: symbol,
    price,
    currency,
    market_time: meta?.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : null,
    fetched_at: new Date().toISOString(),
    source: "Yahoo",
  };
}

async function refreshMarketPrices(admin: any) {
  const { data: transactions, error } = await admin.from("portfolio_transactions").select("ticker").is("deleted_at", null);
  if (error) throw error;
  const tickers = new Set<string>(["GBPUSD=X", "^GSPC"]);
  for (const row of transactions || []) {
    const ticker = String(row.ticker || "").trim();
    if (ticker && ticker !== "CASH" && ticker !== "Crypto") tickers.add(ticker);
  }
  const requested = [...tickers];
  const results = await Promise.allSettled(requested.map((ticker) => fetchYahooQuote(ticker)));
  const updated: AnyRow[] = [];
  const failed: string[] = [];
  results.forEach((result, index) => {
    const ticker = requested[index];
    if (result.status === "fulfilled" && result.value) updated.push(result.value);
    if (result.status === "rejected" || !result.value) failed.push(ticker);
  });
  const retryResults = await Promise.allSettled(failed.map((ticker) => fetchYahooQuote(ticker)));
  const skipped: AnyRow[] = [];
  retryResults.forEach((result, index) => {
    const ticker = failed[index];
    if (result.status === "fulfilled" && result.value) updated.push(result.value);
    else skipped.push({ ticker, error: result.status === "rejected" ? result.reason?.message || "Yahoo lookup failed" : "Yahoo lookup failed" });
  });
  if (updated.length) {
    const { error: upsertError } = await admin.from("market_prices").upsert(updated, { onConflict: "ticker" });
    if (upsertError) throw upsertError;
  }
  const updatedTickers = [...new Set(updated.map((row) => row.ticker))];
  return {
    requested,
    updated: updatedTickers,
    skipped,
    complete: skipped.length === 0 && updatedTickers.length === requested.length,
  };
}

function assertCompleteMarketRefresh(result: AnyRow) {
  if (result.complete) return;
  const missing = (result.skipped || []).map((item: AnyRow) => item.ticker).join(", ") || "unknown tickers";
  throw new Error(`Market refresh was incomplete (${missing}). No portfolio snapshot or report was created.`);
}

async function loadPortfolioData(admin: any) {
  const tables = ["portfolio_transactions", "manual_values", "pension_values", "market_prices", "research_statuses"];
  const entries = await Promise.all(tables.map(async (table) => {
    const { data, error } = await admin.from(table).select("*");
    if (error) throw error;
    return [table, data || []] as const;
  }));
  return Object.fromEntries(entries);
}

function researchStatusMap(rows: AnyRow[]) {
  return new Map(activeRows(rows).map((row) => [row.ticker, row]));
}

async function saveSnapshot(admin: any, portfolio: AnyRow, data: Record<string, AnyRow[]>, kind: string, date: string) {
  const snapshotKey = `${kind}-${date}`;
  const sp500 = priceMap(data.market_prices || []).get("^GSPC");
  const snapshot = {
    snapshot_key: snapshotKey,
    snapshot_date: date,
    snapshot_kind: kind,
    accessible_total: portfolio.accessibleTotal,
    invested_total: portfolio.totalPositions,
    cash_total: portfolio.totalCash,
    pension_total: portfolio.pensionTotal,
    net_worth_total: portfolio.netWorthTotal,
    fx_rate: portfolio.fx,
    summary: {
      holding_count: portfolio.combined.length,
      sp500_level: Number(sp500?.price || 0) || null,
      sp500_market_time: sp500?.market_time || null,
    },
  };
  const { error } = await admin.from("portfolio_report_snapshots").upsert(snapshot, { onConflict: "snapshot_key" });
  if (error) throw error;

  const statuses = researchStatusMap(data.research_statuses || []);
  const holdingRows = portfolio.combined.map((item: AnyRow) => ({
    snapshot_key: snapshotKey,
    snapshot_date: date,
    ticker: item.ticker,
    holding: item.holding,
    quantity: item.quantity,
    value_gbp: item.value_gbp,
    weight: portfolio.accessibleTotal ? item.value_gbp / portfolio.accessibleTotal : null,
    gain_gbp_since_purchase: item.gain_gbp,
    gain_pct_since_purchase: item.gain_pct,
    research_status: statuses.get(item.ticker)?.status || "no_signal",
  }));
  if (holdingRows.length) {
    const { error: holdingError } = await admin.from("portfolio_report_holding_snapshots").upsert(holdingRows, { onConflict: "snapshot_key,ticker" });
    if (holdingError) throw holdingError;
  }
  return snapshot;
}

async function findPriorSnapshot(admin: any, reportType: "weekly" | "monthly", currentDate: string) {
  const { data, error } = await admin
    .from("portfolio_report_snapshots")
    .select("*")
    .eq("snapshot_kind", reportType)
    .lt("snapshot_date", currentDate)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function loadHoldingSnapshots(admin: any, snapshotKey: string | null) {
  if (!snapshotKey) return new Map<string, AnyRow>();
  const { data, error } = await admin.from("portfolio_report_holding_snapshots").select("*").eq("snapshot_key", snapshotKey);
  if (error) throw error;
  return new Map((data || []).map((row: AnyRow) => [row.ticker, row]));
}

function flowTime(row: AnyRow, fallback: string) {
  const parsed = Date.parse(String(row.created_at || ""));
  return Number.isFinite(parsed) ? parsed : Date.parse(fallback);
}

function transactionAmountGbp(row: AnyRow, fx: number) {
  const direct = Number(row.amount_gbp);
  if (Number.isFinite(direct) && direct !== 0) return Math.abs(direct);
  const basis = Number(row.cost_basis_gbp);
  if (Number.isFinite(basis) && basis !== 0) return Math.abs(basis);
  const local = Number(row.quantity || 0) * Number(row.price || 0);
  return Math.abs(row.currency === "USD" ? local / Math.max(fx, 0.0001) : local);
}

function modifiedDietz(beginningValue: number, endingValue: number, flows: AnyRow[], startAt: string, endAt: string) {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const duration = Math.max(1, end - start);
  const netFlow = flows.reduce((sum, flow) => sum + Number(flow.amount || 0), 0);
  const weightedFlows = flows.reduce((sum, flow) => {
    const occurred = Math.min(end, Math.max(start, Number(flow.occurred_at || start)));
    const weight = (end - occurred) / duration;
    return sum + (Number(flow.amount || 0) * weight);
  }, 0);
  const gainGbp = endingValue - beginningValue - netFlow;
  const denominator = beginningValue + weightedFlows;
  return {
    gain_gbp: gainGbp,
    gain_pct: denominator > 0 ? gainGbp / denominator : null,
    net_flow: netFlow,
  };
}

async function loadPeriodTransactions(admin: any, startAt: string, endAt: string) {
  const { data, error } = await admin
    .from("portfolio_transactions")
    .select("date,type,ticker,quantity,price,currency,amount_gbp,cost_basis_gbp,created_at")
    .is("deleted_at", null)
    .gt("created_at", startAt)
    .lte("created_at", endAt)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

function portfolioCashFlows(rows: AnyRow[], fx: number, fallbackTime: string) {
  return rows.flatMap((row) => {
    if (row.type !== "deposit" && row.type !== "withdrawal") return [];
    const amount = transactionAmountGbp(row, fx) * (row.type === "deposit" ? 1 : -1);
    return [{ amount, occurred_at: flowTime(row, fallbackTime) }];
  });
}

function holdingCashFlows(rows: AnyRow[], ticker: string, fx: number, fallbackTime: string) {
  return rows.flatMap((row) => {
    if (row.ticker !== ticker || (row.type !== "buy" && row.type !== "sell")) return [];
    const amount = transactionAmountGbp(row, fx) * (row.type === "buy" ? 1 : -1);
    return [{ amount, occurred_at: flowTime(row, fallbackTime) }];
  });
}

function holdingChangeRows(
  current: AnyRow[],
  prior: Map<string, AnyRow>,
  periodTransactions: AnyRow[],
  fx: number,
  startAt: string,
  endAt: string,
) {
  return current.map((item) => {
    const old = prior.get(item.ticker);
    const oldQuantity = Number(old?.quantity || 0);
    const currentQuantity = Number(item.quantity || 0);
    const oldValue = Number(old?.value_gbp || 0);
    const currentValue = Number(item.value_gbp || 0);
    if (!old || oldQuantity <= 0 || currentQuantity <= 0 || oldValue <= 0 || currentValue <= 0) {
      return { ...item, comparable: false, change_gbp: null, change_pct: null };
    }

    const performance = modifiedDietz(
      oldValue,
      currentValue,
      holdingCashFlows(periodTransactions, item.ticker, fx, endAt),
      startAt,
      endAt,
    );
    return {
      ...item,
      comparable: true,
      change_gbp: performance.gain_gbp,
      change_pct: performance.gain_pct,
      quantity_changed: oldQuantity !== currentQuantity,
    };
  });
}

async function fetchYahooHistoricalPoint(symbol: string, targetAt: string) {
  const target = Date.parse(targetAt);
  if (!Number.isFinite(target)) throw new Error("Invalid benchmark timestamp");
  const recentEnoughForIntraday = Date.now() - target < 59 * 86_400_000;
  const interval = recentEnoughForIntraday ? "5m" : "1d";
  const padding = recentEnoughForIntraday ? 4 : 8;
  const period1 = Math.floor((target - padding * 86_400_000) / 1000);
  const period2 = Math.floor((target + 86_400_000) / 1000);
  let lastError = "Yahoo benchmark lookup failed";

  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${interval}&events=history`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 portfolio-report-benchmark" } });
      if (!response.ok) {
        lastError = `Yahoo returned ${response.status}`;
        continue;
      }
      const payload = await response.json();
      const result = payload?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const points = timestamps
        .map((timestamp: number, index: number) => ({ timestamp, value: Number(closes[index]) }))
        .filter((point: AnyRow) => Number.isFinite(point.value) && point.timestamp * 1000 <= target)
        .sort((a: AnyRow, b: AnyRow) => b.timestamp - a.timestamp);
      if (points.length) return { level: points[0].value, market_time: new Date(points[0].timestamp * 1000).toISOString() };
      lastError = "Yahoo returned no benchmark point before the report";
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }
  throw new Error(lastError);
}

async function snapshotBenchmark(snapshot: AnyRow) {
  const storedLevel = Number(snapshot?.summary?.sp500_level || 0);
  if (storedLevel > 0) {
    return { level: storedLevel, market_time: snapshot.summary?.sp500_market_time || snapshot.created_at };
  }
  return fetchYahooHistoricalPoint("^GSPC", snapshot.created_at || `${snapshot.snapshot_date}T14:45:00Z`);
}

function formatHoldingLine(item: AnyRow, includeChange = true) {
  const base = `${item.ticker} ${money(item.value_gbp)} (${pct(item.weight)})`;
  if (!includeChange || !item.comparable) return base;
  return `${base} | ${moneySigned(item.change_gbp)} / ${pctSigned(item.change_pct)}`;
}

async function buildReport(admin: any, type: "weekly" | "monthly" | "test_weekly" | "test_monthly", pricesReady = false) {
  if (!pricesReady) assertCompleteMarketRefresh(await refreshMarketPrices(admin));
  const date = todayUk();
  const reportType = type.includes("monthly") ? "monthly" : "weekly";
  const kind = type.startsWith("test_") ? "manual" : reportType;
  const data = await loadPortfolioData(admin);
  const portfolio = calculatePortfolio(data);
  const snapshot = await saveSnapshot(admin, portfolio, data, kind, date);
  const currentAt = new Date().toISOString();
  const prior = await findPriorSnapshot(admin, reportType, date);
  const priorHoldings = await loadHoldingSnapshots(admin, prior?.snapshot_key || null);
  const periodTransactions = prior ? await loadPeriodTransactions(admin, prior.created_at, currentAt) : [];
  const changedHoldings = holdingChangeRows(portfolio.combined.map((item: AnyRow) => ({
    ...item,
    weight: portfolio.accessibleTotal ? item.value_gbp / portfolio.accessibleTotal : null,
  })), priorHoldings, periodTransactions, portfolio.fx, prior?.created_at || currentAt, currentAt);
  const comparable = changedHoldings.filter((item) => item.comparable);
  const gainers = comparable.filter((item) => Number(item.change_gbp) > 0).sort((a, b) => Number(b.change_gbp) - Number(a.change_gbp)).slice(0, 3);
  const losers = comparable.filter((item) => Number(item.change_gbp) < 0).sort((a, b) => Number(a.change_gbp) - Number(b.change_gbp)).slice(0, 3);
  const largest = changedHoldings.slice(0, 3);
  const newHoldings = changedHoldings.filter((item) => !item.comparable).slice(0, 5);
  const totalChange = prior ? Number(portfolio.accessibleTotal || 0) - Number(prior.accessible_total || 0) : null;
  const pensionChange = prior ? Number(portfolio.pensionTotal || 0) - Number(prior.pension_total || 0) : null;
  const headlineChange = prior ? Number(portfolio.netWorthTotal || 0) - Number(prior.net_worth_total || 0) : null;
  const externalFlows = prior ? portfolioCashFlows(periodTransactions, portfolio.fx, currentAt) : [];
  const portfolioPerformance = prior
    ? modifiedDietz(Number(prior.accessible_total || 0), Number(portfolio.accessibleTotal || 0), externalFlows, prior.created_at, currentAt)
    : null;
  const elapsedDays = prior ? daysBetweenIso(prior.snapshot_date, date) : (reportType === "monthly" ? 30 : 7);
  const comparisonLabel = `${elapsedDays} day${elapsedDays === 1 ? "" : "s"}`;
  const priorDateLabel = prior ? reportDate(prior.snapshot_date) : "";
  let benchmark: AnyRow | null = null;
  if (prior) {
    try {
      const [priorBenchmark, currentBenchmark] = await Promise.all([
        snapshotBenchmark(prior),
        snapshotBenchmark({ ...snapshot, created_at: currentAt }),
      ]);
      const usdChange = currentBenchmark.level / priorBenchmark.level - 1;
      const priorFx = Number(prior.fx_rate || 0);
      const currentFx = Number(portfolio.fx || 0);
      const gbpChange = priorFx > 0 && currentFx > 0
        ? (currentBenchmark.level / currentFx) / (priorBenchmark.level / priorFx) - 1
        : null;
      const priorMarketDate = String(priorBenchmark.market_time || "").slice(0, 10);
      const currentMarketDate = String(currentBenchmark.market_time || "").slice(0, 10);
      benchmark = {
        usd_change: usdChange,
        gbp_change: gbpChange,
        relative_gbp: portfolioPerformance?.gain_pct !== null && gbpChange !== null
          ? Number(portfolioPerformance?.gain_pct) - gbpChange
          : null,
        prior_market_time: priorBenchmark.market_time,
        current_market_time: currentBenchmark.market_time,
        date_note: priorMarketDate && currentMarketDate
          && (priorMarketDate !== prior.snapshot_date || currentMarketDate !== snapshot.snapshot_date)
          ? `S&P data points: ${reportDate(priorMarketDate)} to ${reportDate(currentMarketDate)} (latest available)`
          : "",
      };
    } catch (error) {
      console.error("S&P 500 benchmark unavailable", error);
    }
  }
  const title = type.startsWith("test_")
    ? `Test ${reportType} portfolio report`
    : `${reportType === "monthly" ? "Monthly" : "Weekly"} portfolio report`;
  const lines = [
    `Benji & Angie's Investment Portfolio`,
    title,
    "",
    `Portfolio: ${money(portfolio.accessibleTotal)}${prior ? ` | value change: ${moneySigned(totalChange)} / ${pctSigned(totalChange! / Number(prior.accessible_total || 1))}` : " (baseline started)"}`,
    `Pension: ${money(portfolio.pensionTotal)}${prior ? ` | value change: ${moneySigned(pensionChange)} / ${pctSigned(pensionChange! / Number(prior.pension_total || 1))}` : ""}`,
    `Headline net worth: ${money(portfolio.netWorthTotal)}${prior ? ` | value change: ${moneySigned(headlineChange)} / ${pctSigned(headlineChange! / Number(prior.net_worth_total || 1))}` : ""}`,
    `Cash: ${money(portfolio.totalCash)} | FX: £1 = $${Number(portfolio.fx || 0).toFixed(4)}`,
  ];
  if (prior && portfolioPerformance) {
    lines.push(
      "",
      `Net deposits/withdrawals, ${comparisonLabel}: ${moneySigned(portfolioPerformance.net_flow)}`,
      `Portfolio performance, ${comparisonLabel}: ${moneySigned(portfolioPerformance.gain_gbp)} / ${pctSigned(portfolioPerformance.gain_pct)}`,
      benchmark
        ? `S&P 500, ${comparisonLabel}: ${pctSigned(benchmark.usd_change)} USD | ${pctSigned(benchmark.gbp_change)} GBP`
        : `S&P 500, ${comparisonLabel}: benchmark unavailable`,
      benchmark?.relative_gbp !== null && benchmark?.relative_gbp !== undefined
        ? `Portfolio versus S&P 500 (GBP): ${percentagePointsSigned(benchmark.relative_gbp)}`
        : "Portfolio versus S&P 500 (GBP): unavailable",
    );
    if (benchmark?.date_note) lines.push(benchmark.date_note);
  }
  lines.push(
    "",
    `Top 3 gainers, ${comparisonLabel}`,
    ...(gainers.length ? gainers.map((item) => `- ${formatHoldingLine(item)}`) : ["- No comparable gainers yet."]),
    "",
    `Top 3 losers, ${comparisonLabel}`,
    ...(losers.length ? losers.map((item) => `- ${formatHoldingLine(item)}`) : ["- No comparable losers yet."]),
    "",
    "Largest 3 positions",
    ...largest.map((item) => `- ${formatHoldingLine(item, item.comparable)}`),
  );
  if (newHoldings.length) {
    lines.push("", "New/unranked this period", ...newHoldings.map((item) => `- ${item.ticker}: no prior snapshot yet`));
  }
  lines.push("", prior
    ? `Snapshot: ${reportDate(snapshot.snapshot_date)} versus ${priorDateLabel}`
    : `Snapshot: ${reportDate(snapshot.snapshot_date)} (baseline started)`);
  return { message: lines.join("\n"), snapshot, prior, reportType };
}

async function getSettings(admin: any, userId: string) {
  const { data, error } = await admin.from("portfolio_report_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data || { user_id: userId, data: {} };
}

async function saveTelegramSettings(admin: any, userId: string, telegram: AnyRow) {
  const existing = await getSettings(admin, userId);
  const nextData = { ...(existing.data || {}), telegram: { ...((existing.data || {}).telegram || {}), ...telegram } };
  const row = { user_id: userId, data: nextData, updated_at: new Date().toISOString() };
  const { error } = await admin.from("portfolio_report_settings").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
  return row;
}

async function handleResolveChat(ctx: AnyRow, body: AnyRow) {
  const code = String(body.code || "").trim().toUpperCase();
  if (!/^PF-[A-Z0-9]{6}$/.test(code)) throw new Error("Enter a valid pairing code");
  const updates = await telegramApi("getUpdates", { limit: 100, allowed_updates: ["message"] });
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 60;
  const match = [...updates].reverse().find((update: AnyRow) => {
    const message = update.message;
    return message?.chat?.type === "private"
      && Number(message.date || 0) >= cutoff
      && String(message.text || "").trim().toUpperCase().includes(code);
  });
  if (!match) return { ok: true, status: "waiting" };
  const chat = match.message.chat;
  const label = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "Telegram";
  await saveTelegramSettings(ctx.admin, ctx.user.id, {
    chat_id: String(chat.id),
    chat_label: label,
    username: chat.username ? `@${chat.username}` : "",
    linked_at: new Date().toISOString(),
    enabled: true,
  });
  return { ok: true, status: "linked", chat: { id: String(chat.id), label, username: chat.username ? `@${chat.username}` : "" } };
}

async function handleSendTest(ctx: AnyRow) {
  const settings = await getSettings(ctx.admin, ctx.user.id);
  const telegram = settings.data?.telegram || {};
  if (!telegram.chat_id) throw new Error("Telegram is not linked yet");
  await telegramApi("sendMessage", {
    chat_id: telegram.chat_id,
    text: "Portfolio reports are connected.",
    disable_web_page_preview: true,
  });
  await saveTelegramSettings(ctx.admin, ctx.user.id, { test_sent_at: new Date().toISOString() });
  return { ok: true };
}

async function handleSendReport(ctx: AnyRow, body: AnyRow) {
  const type = body.report_type === "monthly" ? "test_monthly" : "test_weekly";
  const settings = await getSettings(ctx.admin, ctx.user.id);
  const telegram = settings.data?.telegram || {};
  if (!telegram.chat_id) throw new Error("Telegram is not linked yet");
  const report = await buildReport(ctx.admin, type);
  await telegramApi("sendMessage", {
    chat_id: telegram.chat_id,
    text: report.message,
    disable_web_page_preview: true,
  });
  await ctx.admin.from("portfolio_report_runs").insert({
    report_type: type,
    period_end: todayUk(),
    status: "sent",
    message: report.message,
    sent_at: new Date().toISOString(),
  });
  return { ok: true, message: report.message };
}

async function handleRunSchedule(ctx: AnyRow) {
  const today = todayUk();
  if (!isReportWindow()) {
    return { ok: true, status: "outside_report_window", local_time: localReportTimeParts().label };
  }
  const isMonthly = today.endsWith("-01");
  const isWeekly = dayNameUk() === "Monday";
  const type = isMonthly ? "monthly" : isWeekly ? "weekly" : "daily_snapshot";

  const { data: existingRun, error: existingRunError } = await ctx.admin
    .from("portfolio_report_runs")
    .select("id, status, sent_at, created_at")
    .eq("report_type", type)
    .eq("period_end", today)
    .in("status", ["sent", "skipped"])
    .maybeSingle();
  if (existingRunError) throw existingRunError;
  if (existingRun) return { ok: true, status: "already_handled", report_type: type, period_end: today };

  try {
    const refresh = await refreshMarketPrices(ctx.admin);
    assertCompleteMarketRefresh(refresh);
    const data = await loadPortfolioData(ctx.admin);
    const portfolio = calculatePortfolio(data);
    await saveSnapshot(ctx.admin, portfolio, data, "daily", today);
    if (type === "daily_snapshot") {
      await ctx.admin.from("portfolio_report_runs").insert({ report_type: type, period_end: today, status: "skipped", message: "Daily snapshot only." });
      return { ok: true, status: "snapshot_only" };
    }
    const report = await buildReport(ctx.admin, type, true);
    const { data: settingsRows, error } = await ctx.admin.from("portfolio_report_settings").select("*");
    if (error) throw error;
    const reportKey = `${type}-${today}`;
    let sent = 0;
    let alreadySent = 0;
    const deliveryErrors: string[] = [];
    for (const row of settingsRows || []) {
      const telegram = row.data?.telegram || {};
      if (!telegram.enabled || !telegram.chat_id) continue;
      if (telegram.last_report_key === reportKey) {
        alreadySent += 1;
        continue;
      }
      try {
        await telegramApi("sendMessage", { chat_id: telegram.chat_id, text: report.message, disable_web_page_preview: true });
        await saveTelegramSettings(ctx.admin, row.user_id, { last_report_key: reportKey, last_report_sent_at: new Date().toISOString() });
        sent += 1;
      } catch (deliveryError) {
        deliveryErrors.push(deliveryError instanceof Error ? deliveryError.message : String(deliveryError));
      }
    }
    const delivered = sent + alreadySent;
    if (deliveryErrors.length) throw new Error(`${deliveryErrors.length} Telegram delivery failed. A retry will skip recipients already sent.`);
    const status = delivered ? "sent" : "skipped";
    await ctx.admin.from("portfolio_report_runs").insert({
      report_type: type,
      period_end: today,
      status,
      message: report.message,
      error: null,
      sent_at: delivered ? new Date().toISOString() : null,
    });
    return { ok: true, report_type: type, sent, already_sent: alreadySent };
  } catch (error) {
    await ctx.admin.from("portfolio_report_runs").insert({
      report_type: type,
      period_end: today,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "probe");
    if (action === "run_schedule") {
      const ctx = await requireCron(req, body);
      return json(await handleRunSchedule(ctx));
    }
    const ctx = await requireApprovedUser(req);
    if (action === "probe") return json({ ok: true, configured: Boolean(env("PORTFOLIO_TELEGRAM_BOT_TOKEN")) });
    if (action === "resolve_chat") return json(await handleResolveChat(ctx, body));
    if (action === "send_test") return json(await handleSendTest(ctx));
    if (action === "send_report") return json(await handleSendReport(ctx, body));
    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    return json({ ok: false, error: error.message || String(error) }, 500);
  }
});
