import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { activeQuotedHoldings, alertSuppressedBySnooze, evaluateThresholds, rollingClosingHigh } from "../../../drawdown-core.js";
import { yahooSymbol, normaliseYahooQuote } from "../../../market-instruments.js";

type Row = Record<string, any>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
};
const TIME_ZONE = "Europe/Lisbon";
const APP_URL = "https://benashy.github.io/benji-angie-share-portfolio/#portfolio-alerts";
const SNOOZE_DAYS = new Set([1, 3, 7, 28]);
const lastTelegramSend = new Map<string, number>();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service environment is unavailable");
  return createClient(url, key, { auth: { persistSession: false } });
}

function dateInZone(value: Date | string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function clockInZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [Number(byType.hour), Number(byType.minute)];
}

function calendarYearBefore(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value.toISOString().slice(0, 10);
}

function ukDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year}`;
}

function priceText(price: number, currency: string) {
  return `${currency === "GBP" ? "£" : "$"}${Number(price).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

async function allRows(admin: any, table: string, columns = "*") {
  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
}

async function requireCron(req: Request) {
  const secret = req.headers.get("x-cron-secret") || "";
  if (!secret) throw new Error("Cron not authorised");
  const admin = serviceClient();
  const { data, error } = await admin.rpc("portfolio_report_cron_secret_matches", { provided_secret: secret });
  if (error || data !== true) throw new Error("Cron not authorised");
  return admin;
}

async function requireMember(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Not signed in");
  const admin = serviceClient();
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Not signed in");
  const { data: member, error } = await admin.from("app_members").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (error || !member) throw new Error("Not authorised");
  return { admin, userId: auth.user.id };
}

async function telegramSend(chatId: string, text: string) {
  const token = Deno.env.get("PORTFOLIO_TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot is not configured");
  const waitMs = Math.max(0, (lastTelegramSend.get(chatId) || 0) + 1100 - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "Review or snooze", url: APP_URL }]] },
    }),
  });
  lastTelegramSend.set(chatId, Date.now());
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.description || `Telegram returned ${response.status}`);
}

async function historicalClose(ticker: string, today: string) {
  const symbol = yahooSymbol(ticker);
  const timeZone = symbol.endsWith(".L") ? "Europe/London" : "America/New_York";
  const cutoffDate = calendarYearBefore(today);
  const from = Date.parse(`${cutoffDate}T00:00:00Z`) - 10 * 86_400_000;
  const until = Date.now() + 86_400_000;
  let lastError = "Market history unavailable";

  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(from / 1000)}&period2=${Math.floor(until / 1000)}&interval=1d&events=history%2Csplits`;
      const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 portfolio-drawdown-check" } });
      if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
      const payload = await response.json();
      const result = payload?.chart?.result?.[0];
      const quote = normaliseYahooQuote(ticker, result?.meta);
      if (dateInZone(quote.market_time, timeZone) !== today) throw new Error("No current closing quote for this market");
      const divisor = quote.metrics?.instrument?.quote_unit === "pence" ? 100 : 1;
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const points = (result?.timestamp || []).map((timestamp: number, index: number) => ({
        date: dateInZone(timestamp * 1000, timeZone),
        close: Number(closes[index]) / divisor,
      }));
      const reading = rollingClosingHigh(points, today, cutoffDate);
      if (!reading) throw new Error("Not enough current daily closing history");
      if (Math.abs(reading.close_price - quote.price) / quote.price > 0.05) {
        throw new Error("Daily close and validated market quote disagree by more than 5%");
      }
      return { ticker, currency: quote.currency, ...reading };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastError);
}

async function mapLimited<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>) {
  const results: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

async function scan(admin: any, persist: boolean) {
  const now = new Date();
  const today = dateInZone(now, TIME_ZONE);
  const tx = await allRows(admin, "portfolio_transactions", "type,ticker,holding,quantity,deleted_at");
  const holdings = activeQuotedHoldings(tx);
  const states = await allRows(admin, "drawdown_threshold_states");
  const outcomes = await mapLimited(holdings, 4, async (holding) => {
    try {
      return { holding, reading: await historicalClose(holding.ticker, today) };
    } catch (error) {
      return { holding, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const readings = outcomes.filter((item) => item.reading).map((item) => ({ ...item.reading, holding: item.holding.holding }));
  const skipped = outcomes.filter((item) => item.error).map((item) => ({ ticker: item.holding.ticker, reason: item.error }));
  const crossed: Row[] = [];
  const stateUpdates: Row[] = [];

  for (const item of readings) {
    const prior = states.filter((row) => row.ticker === item.ticker);
    const result = evaluateThresholds(prior, item.drawdown_pct, item.close_date);
    stateUpdates.push(...result.states.map((row) => ({ ticker: item.ticker, ...row, updated_at: now.toISOString() })));
    if (result.highestCrossed) crossed.push({
      ticker: item.ticker,
      holding: item.holding,
      threshold_pct: result.highestCrossed,
      close_date: item.close_date,
      close_price: item.close_price,
      high_date: item.high_date,
      high_price: item.high_price,
      drawdown_pct: item.drawdown_pct,
      currency: item.currency,
      full_year_history: item.full_year_history,
    });
  }

  if (persist && readings.length) {
    const quoteRows = readings.map((item) => ({ ...item, checked_at: now.toISOString() }));
    const { error: quotesError } = await admin.from("drawdown_quotes").upsert(quoteRows, { onConflict: "ticker" });
    if (quotesError) throw quotesError;
    for (const event of crossed) {
      const { error } = await admin.from("drawdown_alerts").insert(event);
      if (error && error.code !== "23505") throw error;
    }
    const { error: statesError } = await admin.from("drawdown_threshold_states").upsert(stateUpdates, { onConflict: "ticker,threshold_pct" });
    if (statesError) throw statesError;
  }
  return { today, holdings: holdings.length, readings, skipped, crossed, activeTickers: new Set(holdings.map((item) => item.ticker)) };
}

function alertMessage(alert: Row, reminder = false) {
  const highLabel = alert.full_year_history ? "12-month closing high" : "available-history closing high";
  const preface = reminder ? "Snoozed price alert reminder" : "Portfolio price alert";
  return `${preface}: ${alert.holding} (${alert.ticker}) closed ${Number(alert.drawdown_pct).toFixed(1)}% below its ${highLabel}.\n`
    + `${Number(alert.threshold_pct)}% review level. High ${priceText(alert.high_price, alert.currency)} on ${ukDate(alert.high_date)}; `
    + `close ${priceText(alert.close_price, alert.currency)} on ${ukDate(alert.close_date)}.\nReview the holding before considering any purchase.`;
}

async function deliver(admin: any, result: Row) {
  const minDate = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const { data: alerts, error: alertError } = await admin.from("drawdown_alerts").select("*").gte("created_at", minDate).order("created_at", { ascending: false });
  if (alertError) throw alertError;
  const receipts = await allRows(admin, "drawdown_alert_receipts");
  const settings = await allRows(admin, "portfolio_report_settings");
  const members = await allRows(admin, "app_members", "user_id");
  const quoteMap = new Map(result.readings.map((row: Row) => [row.ticker, row]));
  const alertMap = new Map((alerts || []).map((row: Row) => [row.id, row]));
  const now = new Date();
  let sent = 0;
  const failures: Row[] = [];

  for (const member of members) {
    const userId = member.user_id;
    const telegram = settings.find((row) => row.user_id === userId)?.data?.telegram || {};
    const seenTickers = new Set<string>();
    for (const alert of alerts || []) {
      let receipt = receipts.find((row) => row.alert_id === alert.id && row.user_id === userId);
      if (!receipt) {
        const inheritedSnooze = receipts.find((row) => row.user_id === userId
          && alertSuppressedBySnooze(alert, alertMap.get(row.alert_id), row, now.getTime()));
        const suppressed = Boolean(inheritedSnooze);
        const { data, error } = await admin.from("drawdown_alert_receipts").upsert({
          alert_id: alert.id,
          user_id: userId,
          acknowledged_at: suppressed ? now.toISOString() : null,
          updated_at: now.toISOString(),
        }, { onConflict: "alert_id,user_id", ignoreDuplicates: true }).select().maybeSingle();
        if (error) throw error;
        receipt = data || (await admin.from("drawdown_alert_receipts").select("*").eq("alert_id", alert.id).eq("user_id", userId).single()).data;
        if (!receipt) throw new Error("Could not create alert receipt");
        receipts.push(receipt);
      }
      const quote = quoteMap.get(alert.ticker);
      const outdated = seenTickers.has(alert.ticker) || !result.activeTickers.has(alert.ticker)
        || (quote && quote.drawdown_pct < Number(alert.threshold_pct) - 2);
      seenTickers.add(alert.ticker);
      if (outdated && !receipt.acknowledged_at) {
        const { error } = await admin.from("drawdown_alert_receipts").update({ acknowledged_at: now.toISOString(), snoozed_until: null, updated_at: now.toISOString() })
          .eq("alert_id", alert.id).eq("user_id", userId);
        if (error) throw error;
        receipt.acknowledged_at = now.toISOString();
      }
      if (receipt.acknowledged_at || !quote || quote.close_date !== result.today) continue;
      if (Date.parse(receipt.snoozed_until || "") > now.getTime()) continue;
      const reminder = Boolean(receipt.snoozed_until);
      if (receipt.telegram_sent_at && !reminder) continue;
      if (!telegram.enabled || !telegram.chat_id) continue;
      try {
        await telegramSend(String(telegram.chat_id), alertMessage(alert, reminder));
        const { error } = await admin.from("drawdown_alert_receipts").update({
          telegram_sent_at: now.toISOString(),
          telegram_error: null,
          snoozed_until: null,
          updated_at: now.toISOString(),
        }).eq("alert_id", alert.id).eq("user_id", userId);
        if (error) throw error;
        sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ ticker: alert.ticker, user_id: userId, reason: message });
        await admin.from("drawdown_alert_receipts").update({ telegram_error: message.slice(0, 200), updated_at: now.toISOString() })
          .eq("alert_id", alert.id).eq("user_id", userId);
      }
    }
  }
  return { sent, failures };
}

async function updateReceipt(req: Request, body: Row) {
  const { admin, userId } = await requireMember(req);
  const alertId = String(body.alert_id || "");
  const action = String(body.action || "");
  if (!/^[0-9a-f-]{36}$/i.test(alertId)) return json({ error: "Invalid alert" }, 400);
  if (action === "snooze" && !SNOOZE_DAYS.has(Number(body.days))) return json({ error: "Choose 1, 3, 7 or 28 days" }, 400);
  const { data: alert, error: alertError } = await admin.from("drawdown_alerts").select("id").eq("id", alertId).maybeSingle();
  if (alertError) throw alertError;
  if (!alert) return json({ error: "Alert not found" }, 404);
  const { data: receipt, error } = await admin.from("drawdown_alert_receipts").select("alert_id,user_id").eq("alert_id", alertId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!receipt) {
    const { error: createError } = await admin.from("drawdown_alert_receipts").insert({ alert_id: alertId, user_id: userId });
    if (createError && createError.code !== "23505") throw createError;
  }
  const patch = action === "acknowledge"
    ? { acknowledged_at: new Date().toISOString(), snoozed_until: null }
    : action === "resume"
      ? { acknowledged_at: null, snoozed_until: null }
      : { acknowledged_at: null, snoozed_until: new Date(Date.now() + Number(body.days) * 86_400_000).toISOString() };
  const { data, error: updateError } = await admin.from("drawdown_alert_receipts").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("alert_id", alertId).eq("user_id", userId).select().single();
  if (updateError) throw updateError;
  return json({ ok: true, receipt: data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (["acknowledge", "snooze", "resume"].includes(body.action)) return await updateReceipt(req, body);
    if (!["preview", "initialise", "run_schedule"].includes(body.action)) return json({ error: "Unknown action" }, 400);
    const admin = await requireCron(req);
    if (body.action === "initialise") {
      const { count, error } = await admin.from("drawdown_threshold_states").select("*", { count: "exact", head: true });
      if (error) throw error;
      if (count) return json({ error: "Drawdown baseline already exists" }, 409);
    }
    const now = new Date();
    const today = dateInZone(now, TIME_ZONE);
    const [hour, minute] = clockInZone(now, TIME_ZONE);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" }).format(now);
    const inCloseWindow = (hour === 21 && minute >= 45) || (hour === 22 && minute <= 20);
    if (body.action === "run_schedule" && (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) || !inCloseWindow)) {
      return json({ ok: true, skipped: "Outside the after-market window", date: today });
    }
    const result = await scan(admin, body.action !== "preview");
    if (!result.readings.length && result.holdings) return json({ error: "No holdings had a verified closing price", skipped: result.skipped }, 503);
    const delivery = body.action === "run_schedule" ? await deliver(admin, result) : { sent: 0, failures: [] };
    return json({
      ok: true,
      date: result.today,
      monitored: result.holdings,
      verified: result.readings.length,
      skipped: result.skipped,
      crossed: result.crossed.map((item: Row) => ({ ticker: item.ticker, threshold_pct: item.threshold_pct })),
      delivery,
      preview: body.action === "preview",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, /authorised|signed in/i.test(message) ? 401 : 500);
  }
});
