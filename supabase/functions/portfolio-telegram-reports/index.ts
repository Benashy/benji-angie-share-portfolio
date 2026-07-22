import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function requireCron(req: Request, body: AnyRow) {
  const expected = env("PORTFOLIO_REPORT_CRON_SECRET");
  const actual = req.headers.get("x-cron-secret") || body.cron_secret || body.secret || "";
  if (!expected || actual !== expected) throw new Error("Cron not authorised");
  return { admin: serviceClient() };
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

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function activeRows(rows: AnyRow[]) {
  return (rows || []).filter((row) => !row.deleted_at);
}

function dateValue(value: string) {
  const raw = String(value || "").trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  match = raw.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{2}|\d{4})$/);
  if (match) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1])).getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function transactionTypeOrder(type: string) {
  return { opening: 0, buy: 1, sell: 2, deposit: 3, withdrawal: 4 }[type] ?? 9;
}

function orderedTransactions(rows: AnyRow[]) {
  return [...rows].sort((a, b) =>
    dateValue(a.date) - dateValue(b.date)
    || transactionTypeOrder(a.type) - transactionTypeOrder(b.type)
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.id || "").localeCompare(String(b.id || ""))
  );
}

function displayHoldingName(ticker: string, holding: string) {
  if (ticker === "Crypto") return "Crypto (Revolut)";
  return holding || holdingNameMap[ticker] || ticker;
}

function latestByKey(rows: AnyRow[], keyFn: (row: AnyRow) => string) {
  const grouped = new Map<string, AnyRow>();
  for (const row of activeRows(rows)) grouped.set(keyFn(row), row);
  return [...grouped.values()];
}

function latestManualValue(rows: AnyRow[], ticker: string, owner: string, account: string) {
  const matches = activeRows(rows).filter((row) => row.ticker === ticker && row.owner === owner && row.account === account);
  return matches[matches.length - 1] || null;
}

function priceMap(rows: AnyRow[]) {
  return new Map(activeRows(rows).map((row) => [row.ticker, row]));
}

function aggregatePositions(positions: AnyRow[]) {
  const grouped = new Map<string, AnyRow>();
  for (const position of positions) {
    const item = grouped.get(position.ticker) || {
      ticker: position.ticker,
      holding: position.holding,
      quantity: 0,
      value_gbp: 0,
      cost_basis_gbp: 0,
      gain_gbp: 0,
      children: [],
    };
    item.quantity += Number(position.quantity || 0);
    item.value_gbp += Number(position.value_gbp || 0);
    item.cost_basis_gbp += Number(position.cost_basis_gbp || 0);
    item.gain_gbp += Number(position.gain_gbp || 0);
    item.children.push(position);
    grouped.set(position.ticker, item);
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    gain_pct: item.cost_basis_gbp ? item.gain_gbp / item.cost_basis_gbp : null,
  })).sort((a, b) => b.value_gbp - a.value_gbp);
}

function calculatePortfolio(data: Record<string, AnyRow[]>) {
  const grouped = new Map<string, AnyRow>();
  const cash = new Map<string, AnyRow>();
  const prices = priceMap(data.market_prices || []);
  const fx = Number(prices.get("GBPUSD=X")?.price || 1.3427);

  for (const tx of orderedTransactions(activeRows(data.portfolio_transactions || []))) {
    const key = `${tx.owner}|${tx.account}`;
    const cashValue = cash.get(key) || { owner: tx.owner, account: tx.account, amount: 0 };
    if (tx.type === "deposit") {
      cashValue.amount += Number(tx.amount_gbp || 0);
      cash.set(key, cashValue);
      continue;
    }
    if (tx.type === "withdrawal") {
      cashValue.amount -= Number(tx.amount_gbp || 0);
      cash.set(key, cashValue);
      continue;
    }
    const positionKey = `${tx.owner}|${tx.account}|${tx.ticker}`;
    const item = grouped.get(positionKey) || {
      owner: tx.owner,
      account: tx.account,
      ticker: tx.ticker,
      holding: tx.holding || tx.ticker,
      quantity: 0,
      cost_basis_gbp: 0,
      opening_value_gbp: 0,
    };
    const quantity = Number(tx.quantity || 0);
    if (tx.type === "opening" || tx.type === "buy") {
      item.quantity += quantity;
      const cost = tx.cost_basis_gbp ?? ((quantity * Number(tx.price || 0)) / (tx.currency === "USD" ? fx : 1));
      const cashCost = tx.amount_gbp ?? cost;
      item.cost_basis_gbp += Number(cost || 0);
      if (tx.type === "opening" && tx.opening_value_gbp !== null && tx.opening_value_gbp !== undefined) {
        item.opening_value_gbp += Number(tx.opening_value_gbp || 0);
      }
      if (tx.type === "buy") {
        cashValue.amount -= Number(cashCost || 0);
        cash.set(key, cashValue);
      }
    } else if (tx.type === "sell") {
      const avgCost = item.quantity ? item.cost_basis_gbp / item.quantity : 0;
      const sellQty = Math.min(quantity, item.quantity);
      item.quantity -= sellQty;
      item.cost_basis_gbp -= avgCost * sellQty;
      cashValue.amount += Number(tx.amount_gbp || 0);
      cash.set(key, cashValue);
    }
    grouped.set(positionKey, item);
  }

  const positions: AnyRow[] = [];
  for (const item of grouped.values()) {
    if (item.quantity <= 0) continue;
    const manual = latestManualValue(data.manual_values || [], item.ticker, item.owner, item.account);
    let valueGbp = Number(item.cost_basis_gbp || 0);
    if (manual) {
      valueGbp = Number(manual.value_gbp || 0);
    } else if (prices.has(item.ticker)) {
      const quote = prices.get(item.ticker);
      const localValue = Number(quote.price || 0) * Number(item.quantity || 0);
      valueGbp = quote.currency === "USD" ? localValue / fx : localValue;
    } else if (item.opening_value_gbp) {
      valueGbp = Number(item.opening_value_gbp);
    }
    const gainGbp = valueGbp - Number(item.cost_basis_gbp || 0);
    const gainPct = item.cost_basis_gbp ? gainGbp / item.cost_basis_gbp : null;
    positions.push({ ...item, holding: displayHoldingName(item.ticker, item.holding), value_gbp: valueGbp, gain_gbp: gainGbp, gain_pct: gainPct });
  }

  const combined = aggregatePositions(positions);
  const totalPositions = positions.reduce((sum, item) => sum + item.value_gbp, 0);
  const totalCash = [...cash.values()].reduce((sum, item) => sum + item.amount, 0);
  const pensionTotal = latestByKey(data.pension_values || [], (row) => row.name).reduce((sum, item) => sum + Number(item.value_gbp || 0), 0);
  return {
    fx,
    positions,
    combined,
    cash: [...cash.values()],
    totalPositions,
    totalCash,
    accessibleTotal: totalPositions + totalCash,
    pensionTotal,
    netWorthTotal: totalPositions + totalCash + pensionTotal,
  };
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
  const tickers = new Set<string>(["GBPUSD=X"]);
  for (const row of transactions || []) {
    const ticker = String(row.ticker || "").trim();
    if (ticker && ticker !== "CASH" && ticker !== "Crypto") tickers.add(ticker);
  }
  const results = await Promise.allSettled([...tickers].map((ticker) => fetchYahooQuote(ticker)));
  const updated: AnyRow[] = [];
  const skipped: string[] = [];
  results.forEach((result, index) => {
    const ticker = [...tickers][index];
    if (result.status === "fulfilled" && result.value) updated.push(result.value);
    if (result.status === "rejected") skipped.push(`${ticker}: ${result.reason?.message || "Yahoo lookup failed"}`);
  });
  if (updated.length) {
    const { error: upsertError } = await admin.from("market_prices").upsert(updated, { onConflict: "ticker" });
    if (upsertError) throw upsertError;
  }
  return { updated: updated.length, skipped };
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
    summary: { holding_count: portfolio.combined.length },
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

async function findPriorSnapshot(admin: any, targetDate: string) {
  const { data, error } = await admin
    .from("portfolio_report_snapshots")
    .select("*")
    .lte("snapshot_date", targetDate)
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

function holdingChangeRows(current: AnyRow[], prior: Map<string, AnyRow>) {
  return current.map((item) => {
    const old = prior.get(item.ticker);
    if (!old || !Number(old.value_gbp)) return { ...item, comparable: false, change_gbp: null, change_pct: null };
    const changeGbp = Number(item.value_gbp || 0) - Number(old.value_gbp || 0);
    return { ...item, comparable: true, change_gbp: changeGbp, change_pct: changeGbp / Number(old.value_gbp || 0) };
  });
}

function formatHoldingLine(item: AnyRow, includeChange = true) {
  const base = `${item.ticker} ${money(item.value_gbp)} (${pct(item.weight)})`;
  if (!includeChange || !item.comparable) return base;
  return `${base} | ${moneySigned(item.change_gbp)} / ${pctSigned(item.change_pct)}`;
}

async function buildReport(admin: any, type: "weekly" | "monthly" | "test_weekly" | "test_monthly") {
  await refreshMarketPrices(admin);
  const date = todayUk();
  const reportType = type.includes("monthly") ? "monthly" : "weekly";
  const kind = type.startsWith("test_") ? "manual" : reportType;
  const comparisonDays = reportType === "monthly" ? 30 : 7;
  const data = await loadPortfolioData(admin);
  const portfolio = calculatePortfolio(data);
  const snapshot = await saveSnapshot(admin, portfolio, data, kind, date);
  const prior = await findPriorSnapshot(admin, addDaysIso(date, -comparisonDays));
  const priorHoldings = await loadHoldingSnapshots(admin, prior?.snapshot_key || null);
  const changedHoldings = holdingChangeRows(portfolio.combined.map((item: AnyRow) => ({
    ...item,
    weight: portfolio.accessibleTotal ? item.value_gbp / portfolio.accessibleTotal : null,
  })), priorHoldings);
  const comparable = changedHoldings.filter((item) => item.comparable);
  const gainers = comparable.filter((item) => Number(item.change_gbp) > 0).sort((a, b) => Number(b.change_gbp) - Number(a.change_gbp)).slice(0, 3);
  const losers = comparable.filter((item) => Number(item.change_gbp) < 0).sort((a, b) => Number(a.change_gbp) - Number(b.change_gbp)).slice(0, 3);
  const largest = changedHoldings.slice(0, 3);
  const newHoldings = changedHoldings.filter((item) => !item.comparable).slice(0, 5);
  const totalChange = prior ? Number(portfolio.accessibleTotal || 0) - Number(prior.accessible_total || 0) : null;
  const pensionChange = prior ? Number(portfolio.pensionTotal || 0) - Number(prior.pension_total || 0) : null;
  const headlineChange = prior ? Number(portfolio.netWorthTotal || 0) - Number(prior.net_worth_total || 0) : null;
  const title = type.startsWith("test_")
    ? `Test ${reportType} portfolio report`
    : `${reportType === "monthly" ? "Monthly" : "Weekly"} portfolio report`;
  const lines = [
    `Benji & Angie's Investment Portfolio`,
    title,
    "",
    `Portfolio: ${money(portfolio.accessibleTotal)}${prior ? ` (${moneySigned(totalChange)} / ${pctSigned(totalChange! / Number(prior.accessible_total || 1))})` : " (baseline started)"}`,
    `Pension: ${money(portfolio.pensionTotal)}${prior ? ` (${moneySigned(pensionChange)} / ${pctSigned(pensionChange! / Number(prior.pension_total || 1))})` : ""}`,
    `Headline net worth: ${money(portfolio.netWorthTotal)}${prior ? ` (${moneySigned(headlineChange)} / ${pctSigned(headlineChange! / Number(prior.net_worth_total || 1))})` : ""}`,
    `Cash: ${money(portfolio.totalCash)} | FX: £1 = $${Number(portfolio.fx || 0).toFixed(4)}`,
    "",
    `Top 3 ${reportType} gainers`,
    ...(gainers.length ? gainers.map((item) => `- ${formatHoldingLine(item)}`) : ["- No comparable gainers yet."]),
    "",
    `Top 3 ${reportType} losers`,
    ...(losers.length ? losers.map((item) => `- ${formatHoldingLine(item)}`) : ["- No comparable losers yet."]),
    "",
    "Largest 3 positions",
    ...largest.map((item) => `- ${formatHoldingLine(item, item.comparable)}`),
  ];
  if (newHoldings.length) {
    lines.push("", "New/unranked this period", ...newHoldings.map((item) => `- ${item.ticker}: no prior snapshot yet`));
  }
  lines.push("", `Snapshot: ${snapshot.snapshot_date}`);
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
  const isMonthly = today.endsWith("-01");
  const isWeekly = dayNameUk() === "Monday";
  const type = isMonthly ? "monthly" : isWeekly ? "weekly" : "daily_snapshot";
  const data = await loadPortfolioData(ctx.admin);
  const portfolio = calculatePortfolio(data);
  await saveSnapshot(ctx.admin, portfolio, data, "daily", today);
  if (type === "daily_snapshot") {
    await ctx.admin.from("portfolio_report_runs").insert({ report_type: type, period_end: today, status: "skipped", message: "Daily snapshot only." });
    return { ok: true, status: "snapshot_only" };
  }
  const report = await buildReport(ctx.admin, type);
  const { data: settingsRows, error } = await ctx.admin.from("portfolio_report_settings").select("*");
  if (error) throw error;
  let sent = 0;
  for (const row of settingsRows || []) {
    const telegram = row.data?.telegram || {};
    if (!telegram.enabled || !telegram.chat_id) continue;
    await telegramApi("sendMessage", { chat_id: telegram.chat_id, text: report.message, disable_web_page_preview: true });
    sent += 1;
  }
  await ctx.admin.from("portfolio_report_runs").insert({ report_type: type, period_end: today, status: sent ? "sent" : "skipped", message: report.message, sent_at: sent ? new Date().toISOString() : null });
  return { ok: true, report_type: type, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "probe");
    if (action === "run_schedule") {
      const ctx = requireCron(req, body);
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
