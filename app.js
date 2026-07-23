const config = window.PORTFOLIO_CONFIG || {};
const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.demoMode);
const supabaseClient = await createSupabaseClient();
const APP_VERSION = "2026-07-23-transaction-drafts-2";

const state = {
  session: null,
  member: null,
  members: [],
  ledger: { transactions: [], manual_values: [], pensions: [], audit_log: [], market_prices: [], net_worth_snapshots: [], portfolio_value_snapshots: [], app_status: [], research_statuses: [], holding_name_overrides: [], portfolio_report_settings: [], portfolio_report_runs: [] },
  auditLog: [],
  activeView: "dashboard",
  dirtyCloud: false,
  subscriptions: [],
  presenceChannel: null,
  editingTransaction: null,
  saveMessage: "",
  saveArea: "",
  saveMessages: {},
  saveTimers: {},
  busyForms: {},
  marketRefreshMessage: "",
  marketRefreshTone: "",
  marketMessageTimer: null,
  marketRefreshing: false,
  marketRefreshPromise: null,
  autoRefreshTimer: null,
  marketAgeTimer: null,
  initialPriceRefreshDone: false,
  portfolioValueSnapshotsAvailable: false,
  appStatusAvailable: false,
  researchStatusesAvailable: false,
  holdingNameOverridesAvailable: false,
  reportSettingsAvailable: false,
  reportRunsAvailable: false,
  telegramPairingCode: "",
  reportMessage: "",
  reportMessageTone: "",
  pendingCashConfirm: null,
  lastUndoneTransaction: null
};

const transactionDraftKey = "benji-angie-portfolio-transaction-drafts";
const transactionDraftTtlMs = 10 * 60 * 1000;

const displayNames = ["Benji", "Angie"];
const accountsByOwner = {
  Angie: ["Angie ISA - 2259859", "Angie Trading - 5671056"],
  Benji: ["Benji ISA - 2222586", "Benji ISA - 2222587", "Benji HL Fund & Share - 2156983", "Benji - Revolut - Crypto"]
};

const sectorMap = {
  AAPL: "Technology",
  MSFT: "Technology",
  GOOGL: "Communication Services",
  META: "Communication Services",
  AMZN: "Consumer Discretionary",
  NVDA: "Semiconductors",
  AVGO: "Semiconductors",
  TSM: "Semiconductors",
  TSLA: "Consumer Discretionary",
  IAG: "Industrials",
  MS: "Financials",
  JPM: "Financials",
  V: "Financials",
  MA: "Financials",
  NVO: "Healthcare",
  UNH: "Healthcare",
  MCK: "Healthcare",
  PH: "Industrials",
  HWM: "Industrials",
  VUAA: "Broad Market ETF",
  SGLN: "Commodities / Gold",
  WXBT: "Crypto",
  Crypto: "Crypto"
};

const marketDefinitions = [
  {
    code: "UK",
    name: "UK market",
    exchange: "LSE",
    timeZone: "Europe/London",
    open: [8, 0],
    close: [16, 30],
    holidays: {
      2026: ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28"],
      2027: ["2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28"]
    },
    earlyCloses: {}
  },
  {
    code: "US",
    name: "US market",
    exchange: "NYSE/Nasdaq",
    timeZone: "America/New_York",
    open: [9, 30],
    close: [16, 0],
    holidays: {
      2026: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
      2027: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]
    },
    earlyCloses: {
      "2026-11-27": [13, 0],
      "2026-12-24": [13, 0],
      "2027-11-26": [13, 0]
    }
  }
];

async function createSupabaseClient() {
  if (!isConfigured) return null;
  if (window.supabase?.createClient) {
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  const module = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  return module.createClient(config.supabaseUrl, config.supabaseAnonKey);
}

const el = (id) => document.getElementById(id);
const money = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? "-" : `£${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const moneySigned = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const number = Number(value);
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `${sign}£${Math.abs(number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const usd = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? "-" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${(Number(value) * 100).toFixed(1)}%`;
const pctSigned = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const isoDateAtNoon = (value) => new Date(`${String(value || todayIso()).slice(0, 10)}T12:00:00Z`);
const addDaysIso = (value, days) => {
  const date = isoDateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const autoRefreshMinutes = 15;
const displayDate = (value) => {
  const raw = String(value || "");
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const dotted = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotted) {
    const year = dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3];
    return `${dotted[1].padStart(2, "0")}-${dotted[2].padStart(2, "0")}-${year}`;
  }
  return raw;
};
const displayDateTime = (value) => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).replace(",", "");
};
const displayShortTime = (value, timeZone = "Europe/London") => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
};
const formatDuration = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};
const dateValue = (value) => {
  const raw = String(value || "");
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`).getTime();
  const dotted = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotted) {
    const year = dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3];
    return new Date(`${year}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}T00:00:00`).getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
    key: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(guess, timeZone);
    const currentAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    guess = new Date(guess.getTime() - (currentAsUtc - targetAsUtc));
  }
  return guess;
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function localKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function marketDayInfo(definition, parts) {
  const key = localKey(parts);
  const weekday = zonedParts(zonedTimeToUtc(parts.year, parts.month, parts.day, 12, 0, definition.timeZone), definition.timeZone).weekday;
  const closed = ["Sat", "Sun"].includes(weekday) || (definition.holidays[parts.year] || []).includes(key);
  const close = definition.earlyCloses[key] || definition.close;
  return { key, closed, open: definition.open, close };
}

function findNextMarketEvent(definition, now = new Date()) {
  const nowParts = zonedParts(now, definition.timeZone);
  const today = marketDayInfo(definition, nowParts);
  const openUtc = zonedTimeToUtc(nowParts.year, nowParts.month, nowParts.day, today.open[0], today.open[1], definition.timeZone);
  const closeUtc = zonedTimeToUtc(nowParts.year, nowParts.month, nowParts.day, today.close[0], today.close[1], definition.timeZone);
  if (!today.closed && now >= openUtc && now < closeUtc) {
    return { isOpen: true, label: "Open", eventLabel: "Closes", eventTime: closeUtc, localKey: today.key };
  }
  if (!today.closed && now < openUtc) {
    return { isOpen: false, label: "Closed", eventLabel: "Opens", eventTime: openUtc, localKey: today.key };
  }
  for (let offset = 1; offset <= 14; offset += 1) {
    const local = addLocalDays(nowParts, offset);
    const info = marketDayInfo(definition, local);
    if (!info.closed) {
      const nextOpen = zonedTimeToUtc(local.year, local.month, local.day, info.open[0], info.open[1], definition.timeZone);
      return { isOpen: false, label: "Closed", eventLabel: "Opens", eventTime: nextOpen, localKey: info.key };
    }
  }
  return { isOpen: false, label: "Closed", eventLabel: "Next open unavailable", eventTime: null, localKey: today.key };
}

function buildMarketSessionRows(now = new Date()) {
  return marketDefinitions.map((definition) => {
    const event = findNextMarketEvent(definition, now);
    const eventText = event.eventTime
      ? `${event.eventLabel} ${displayShortTime(event.eventTime, definition.timeZone)} local (${formatDuration(event.eventTime - now)})`
      : event.eventLabel;
    return {
      ...definition,
      ...event,
      eventText
    };
  });
}
const rate = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `$${Number(value).toFixed(4)}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const priceStalenessMinutes = 30;
const researchStatusOptions = [
  { value: "positive", label: "Positive", tone: "green", meaning: "Supportive momentum/commentary. Comfortable holding or reviewing for adding, subject to concentration." },
  { value: "re_entry_watch", label: "Re-entry Watch", tone: "blue", meaning: "Previously weak, now possibly improving. Monitor for confirmation before adding." },
  { value: "no_signal", label: "No Signal", tone: "neutral", meaning: "No useful current research or MACD view. Do nothing based on research status alone." },
  { value: "watch", label: "Watch", tone: "amber", meaning: "Important event or mild uncertainty. Pay attention, especially around results, news, or fresh commentary." },
  { value: "caution", label: "Caution", tone: "amber", meaning: "Weakening signs, but not formally Baby/Mummy/Daddy Bear. Avoid adding without a fresh reason and review size." },
  { value: "baby_bear", label: "Baby Bear", tone: "amber", meaning: "Short-term pullback. Alpesh's framework suggests usually riding it out, perhaps trimming very large winners." },
  { value: "mummy_bear", label: "Mummy Bear", tone: "red", meaning: "Moderate downturn. Consider taking profits or rebalancing weaker/speculative big gainers." },
  { value: "daddy_bear", label: "Daddy Bear", tone: "red", meaning: "Severe/confirmed bear setup. Do not add; review stops/cash and wait for recovery confirmation." }
];
const researchStatusMap = Object.fromEntries(researchStatusOptions.map((item) => [item.value, item]));
const holdingNameMap = {
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
  WXBT: "Bitcoin ETF"
};

function displayHoldingName(ticker, holding) {
  if (ticker === "Crypto") return "Crypto (Revolut)";
  const override = holdingNameOverrideFor(ticker);
  if (override?.display_name) return override.display_name;
  return baseHoldingName(ticker, holding);
}

function baseHoldingName(ticker, holding) {
  return holding || holdingNameMap[ticker] || ticker;
}

function holdingNameOverrideFor(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  return activeRows(state.ledger.holding_name_overrides || []).find((row) => String(row.ticker || "").trim().toUpperCase() === key) || null;
}

function statusBadge(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '<span class="badge neutral">Unknown</span>';
  if (value >= 0.10) return '<span class="badge green">Gain</span>';
  if (value < 0) return '<span class="badge red">Loss</span>';
  return '<span class="badge amber">Watch</span>';
}

function researchStatusFor(ticker) {
  const rows = activeRows(state.ledger.research_statuses || []).filter((row) => row.ticker === ticker);
  return rows.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0] || null;
}

function researchStatusMeta(value) {
  return researchStatusMap[value] || researchStatusMap.no_signal;
}

function researchStatusBadge(row) {
  const meta = researchStatusMeta(row?.status || "no_signal");
  return `<span class="research-pill ${meta.tone}">${escapeHtml(meta.label)}</span>`;
}

function researchDate(row) {
  return row?.selected_date ? displayDate(row.selected_date) : "-";
}

function currentUserName() {
  return state.member?.display_name || "Demo";
}

function actorName(userId) {
  if (!userId) return "-";
  return state.members.find((member) => member.user_id === userId)?.display_name || "-";
}

function activeRows(rows) {
  return (rows || []).filter((row) => !row.deleted_at);
}

function latestByKey(rows, keyFn) {
  const grouped = new Map();
  for (const row of activeRows(rows)) grouped.set(keyFn(row), row);
  return [...grouped.values()];
}

function latestManualValue(ticker, owner, account) {
  const matches = activeRows(state.ledger.manual_values).filter((row) => row.ticker === ticker && row.owner === owner && row.account === account);
  return matches[matches.length - 1] || null;
}

function latestPensions() {
  return latestByKey(state.ledger.pensions, (row) => row.name);
}

function latestManualValueForAccount(account) {
  const matches = activeRows(state.ledger.manual_values).filter((row) => row.account === account);
  return matches[matches.length - 1] || null;
}

function marketPriceMap() {
  return new Map((state.ledger.market_prices || []).map((row) => [row.ticker, row]));
}

function transactionDateValue(value) {
  if (!value) return 0;
  const raw = String(value).trim();
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

function transactionTypeOrder(type) {
  return { opening: 0, buy: 1, sell: 2, deposit: 3, withdrawal: 4 }[type] ?? 9;
}

function orderedTransactions(rows) {
  return [...rows].sort((a, b) =>
    transactionDateValue(a.date) - transactionDateValue(b.date)
    || transactionTypeOrder(a.type) - transactionTypeOrder(b.type)
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.id || "").localeCompare(String(b.id || ""))
  );
}

function priceIsFresh(row) {
  if (!row?.fetched_at) return false;
  return Date.now() - new Date(row.fetched_at).getTime() < priceStalenessMinutes * 60 * 1000;
}

function newestEquityPrice(prices) {
  return [...prices.values()]
    .filter((row) => row.ticker !== "GBPUSD=X" && row.fetched_at)
    .sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at))[0] || null;
}

function oldestMarketRefresh(prices) {
  const rows = [...prices.values()].filter((row) => row.fetched_at);
  if (!rows.length) return null;
  return rows.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at))[0];
}

function marketRefreshIsStale(portfolio, minutes = autoRefreshMinutes) {
  const equity = newestEquityPrice(portfolio.prices);
  const fx = portfolio.prices.get("GBPUSD=X");
  const rows = [equity, fx].filter((row) => row?.fetched_at);
  if (rows.length < 2) return true;
  return rows.some((row) => Date.now() - new Date(row.fetched_at).getTime() > minutes * 60 * 1000);
}

function marketRefreshIsOverHour(portfolio) {
  return marketRefreshIsStale(portfolio, 60);
}

function refreshAgeText(value) {
  if (!value) return "not refreshed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not refreshed";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes >= 60) return "more than an hour ago";
  return `${shortUkTime(date)} UK (${minutes === 0 ? "just now" : `${minutes} min ago`})`;
}

function marketFreshnessText(portfolio) {
  const equity = newestEquityPrice(portfolio.prices);
  const fx = portfolio.prices.get("GBPUSD=X");
  const equityText = `Equities ${refreshAgeText(equity?.fetched_at)}`;
  const fxText = `FX ${refreshAgeText(fx?.fetched_at)}`;
  return `${equityText} · ${fxText}`;
}

function marketSessionMarkup() {
  return buildMarketSessionRows().map((row) => `
    <div class="market-session-item">
      <div class="market-session-top">
        <strong>${escapeHtml(row.name)}</strong>
        <span class="market-state ${row.isOpen ? "open" : "closed"}">${row.label}</span>
      </div>
      <div class="subtle">${escapeHtml(row.exchange)} · ${escapeHtml(row.eventText)}</div>
    </div>
  `).join("");
}

function appStatusValue(key) {
  return (state.ledger.app_status || []).find((row) => row.key === key)?.value || null;
}

function backupStatusText() {
  const backup = appStatusValue("dropbox_backup");
  if (!backup?.timestamp) return "Automatic backup: not recorded yet";
  const destination = backup.daily_backup ? ` · ${backup.daily_backup.split("/").slice(-2).join("/")}` : "";
  return `Automatic backup: ${displayDateTime(backup.timestamp)} UK${destination}`;
}

function updateMarketDataSummary(portfolio) {
  const target = el("marketDataSummary");
  if (target) {
    target.textContent = state.marketRefreshMessage || marketFreshnessText(portfolio);
    target.classList.toggle("market-ok", state.marketRefreshTone === "success");
    target.classList.toggle("market-error", state.marketRefreshTone === "error" || (!state.marketRefreshMessage && marketRefreshIsOverHour(portfolio)));
  }
}

function updateLiveMarketAgeLabels(portfolio = calculatePortfolio()) {
  updateMarketDataSummary(portfolio);
  document.querySelectorAll(".market-session-grid").forEach((node) => {
    node.innerHTML = marketSessionMarkup();
  });
  const fxFetchedAt = portfolio.prices.get("GBPUSD=X")?.fetched_at;
  const fxUpdated = refreshAgeText(fxFetchedAt);
  const fxFreshClass = fxUpdated === "more than an hour ago" ? "market-error" : fxUpdated === "not refreshed" ? "" : "market-ok";
  document.querySelectorAll("[data-refresh-age='fx']").forEach((node) => {
    node.textContent = `FX data refreshed ${fxUpdated}.`;
    node.classList.toggle("market-ok", fxFreshClass === "market-ok");
    node.classList.toggle("market-error", fxFreshClass === "market-error");
  });
}

function setMarketRefreshMessage(text, tone = "", clearAfterMs = null) {
  if (state.marketMessageTimer) window.clearTimeout(state.marketMessageTimer);
  state.marketRefreshMessage = text;
  state.marketRefreshTone = tone;
  updateMarketDataSummary(calculatePortfolio());
  if (clearAfterMs) {
    state.marketMessageTimer = window.setTimeout(() => {
      state.marketRefreshMessage = "";
      state.marketRefreshTone = "";
      updateMarketDataSummary(calculatePortfolio());
    }, clearAfterMs);
  }
}

function shortUkTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function setSaveMessage(area, text, tone = "success") {
  if (state.saveTimers[area]) window.clearTimeout(state.saveTimers[area]);
  state.saveMessages[area] = { text, tone };
  state.saveMessage = text;
  state.saveArea = area;
  state.saveTimers[area] = window.setTimeout(() => {
    delete state.saveMessages[area];
    const banner = document.querySelector(`[data-save-area="${area}"]`);
    if (banner) banner.remove();
  }, 10000);
}

function saveBanner(area) {
  const message = state.saveMessages[area];
  if (!message) return "";
  return `<div class="save-banner ${message.tone === "error" ? "save-error" : message.tone === "warning" ? "save-warning" : ""}" data-save-area="${area}">${escapeHtml(message.text)}</div>`;
}

function readTransactionDrafts() {
  try {
    const raw = localStorage.getItem(transactionDraftKey);
    if (!raw) return {};
    const payload = JSON.parse(raw);
    if (!payload.updated_at || Date.now() - Number(payload.updated_at) > transactionDraftTtlMs) {
      localStorage.removeItem(transactionDraftKey);
      return {};
    }
    return payload.forms || {};
  } catch {
    localStorage.removeItem(transactionDraftKey);
    return {};
  }
}

function writeTransactionDrafts(forms) {
  localStorage.setItem(transactionDraftKey, JSON.stringify({ updated_at: Date.now(), forms }));
}

function saveTransactionDraft(form, key) {
  const forms = readTransactionDrafts();
  forms[key] = Object.fromEntries(new FormData(form).entries());
  writeTransactionDrafts(forms);
}

function clearTransactionDraft(key) {
  const forms = readTransactionDrafts();
  delete forms[key];
  if (Object.keys(forms).length) writeTransactionDrafts(forms);
  else localStorage.removeItem(transactionDraftKey);
}

function restoreTransactionDraft(form, key) {
  const values = readTransactionDrafts()[key];
  if (!values) return false;
  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements[name];
    if (field) field.value = value;
  });
  form.elements.owner?.dispatchEvent(new Event("change", { bubbles: true }));
  if (values.account && form.elements.account) form.elements.account.value = values.account;
  [...form.querySelectorAll("input, select, textarea")].forEach((field) => {
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  form.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function wireTransactionDraft(form, key) {
  ["input", "change"].forEach((eventName) => {
    form.addEventListener(eventName, () => saveTransactionDraft(form, key));
  });
}

function setReportMessage(text, tone = "success") {
  state.reportMessage = text;
  state.reportMessageTone = tone;
  renderReports();
}

function setFormWorking(form, working, label = "Saving...") {
  const button = form?.querySelector("button:not([type]), button[type='submit']");
  if (!button) return;
  if (working) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    delete button.dataset.originalText;
  }
}

function calculatePortfolio() {
  const grouped = new Map();
  const cash = new Map();
  const prices = marketPriceMap();
  const fxRow = prices.get("GBPUSD=X");
  const fx = Number(fxRow?.price || state.ledger.fx || 1.3427);

  for (const tx of orderedTransactions(activeRows(state.ledger.transactions))) {
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
      opening_value_gbp: 0
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

  const positions = [];
  for (const item of grouped.values()) {
    if (item.quantity <= 0) continue;
    const manual = latestManualValue(item.ticker, item.owner, item.account);
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
    const quote = prices.get(item.ticker);
    const source = manual ? "Manual" : quote ? (priceIsFresh(quote) ? "Yahoo" : "Cached Yahoo") : item.opening_value_gbp ? "Opening value" : "Cost basis";
    positions.push({ ...item, value_gbp: valueGbp, gain_gbp: gainGbp, gain_pct: gainPct, source });
  }

  const combined = aggregatePositions(positions);
  const totalPositions = positions.reduce((sum, item) => sum + item.value_gbp, 0);
  const totalCash = [...cash.values()].reduce((sum, item) => sum + item.amount, 0);
  const pensionTotal = latestPensions().reduce((sum, item) => sum + Number(item.value_gbp || 0), 0);
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
    prices
  };
}

function aggregatePositions(positions) {
  const grouped = new Map();
  for (const position of positions) {
    const item = grouped.get(position.ticker) || {
      ticker: position.ticker,
      holding: position.holding,
      quantity: 0,
      value_gbp: 0,
      cost_basis_gbp: 0,
      gain_gbp: 0,
      sources: new Set(),
      children: []
    };
    item.quantity += Number(position.quantity || 0);
    item.value_gbp += Number(position.value_gbp || 0);
    item.cost_basis_gbp += Number(position.cost_basis_gbp || 0);
    item.gain_gbp += Number(position.gain_gbp || 0);
    item.sources.add(position.source || "Unknown");
    item.children.push(position);
    grouped.set(position.ticker, item);
  }
  return [...grouped.values()].map((item) => {
    const owners = [...new Set(item.children.map((child) => child.owner))];
    const accounts = [...new Set(item.children.map((child) => child.account))];
    return {
      ...item,
      owner: owners.length > 1 ? "Both" : owners[0],
      account: accounts.length > 1 ? "Multiple" : accounts[0],
      source: [...item.sources].includes("Yahoo") ? "Yahoo" : [...item.sources].join(", "),
      gain_pct: item.cost_basis_gbp ? item.gain_gbp / item.cost_basis_gbp : null
    };
  }).sort((a, b) => b.value_gbp - a.value_gbp);
}

function accountBreakdown(portfolio) {
  const accounts = new Map();
  const ensure = (owner, account) => {
    const key = `${owner}|${account}`;
    if (!accounts.has(key)) accounts.set(key, { owner, account, invested: 0, cash: 0, total: 0 });
    return accounts.get(key);
  };
  for (const position of portfolio.positions) {
    const item = ensure(position.owner, position.account);
    item.invested += Number(position.value_gbp || 0);
  }
  for (const cash of portfolio.cash) {
    const item = ensure(cash.owner, cash.account);
    item.cash += Number(cash.amount || 0);
  }
  return [...accounts.values()].map((item) => ({
    ...item,
    total: item.invested + item.cash
  })).sort((a, b) => b.total - a.total);
}

async function init() {
  bindNavigation();
  bindAuth();
  if (isConfigured) {
    const { data } = await supabaseClient.auth.getSession();
    state.session = data.session;
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      await loadApp();
    });
  }
  await loadApp();
}

async function loadApp() {
  if (!isConfigured) {
    await loadDemoLedger();
    showDemoMode();
    renderAll();
    return;
  }
  if (!state.session) {
    showAuth();
    return;
  }
  await loadMember();
  await loadCloudLedger();
  const loadedPortfolio = calculatePortfolio();
  if (!marketRefreshIsStale(loadedPortfolio)) {
    await ensureMonthlySnapshot(loadedPortfolio);
    await ensureAccessiblePortfolioSnapshot(loadedPortfolio);
  }
  setupRealtime();
  setupPresence();
  renderAll();
}

async function loadDemoLedger() {
  const response = await fetch("seed-ledger.json");
  const ledger = await response.json();
  state.ledger = {
    transactions: (ledger.transactions || []).map(normalizeRow),
    manual_values: (ledger.manual_values || []).map(normalizeRow),
    pensions: (ledger.pensions || []).map(normalizeRow),
    audit_log: ledger.audit_log || [],
    market_prices: [],
    net_worth_snapshots: [],
    portfolio_value_snapshots: [],
    app_status: [],
    research_statuses: [],
    holding_name_overrides: [],
    portfolio_report_settings: [],
    portfolio_report_runs: [],
    fx: 1.3427
  };
  state.portfolioValueSnapshotsAvailable = false;
}

function normalizeRow(row) {
  return {
    ...row,
    id: row.id || uid(),
    version: row.version || 1,
    is_locked: row.is_locked ?? (row.type === "opening" || String(row.notes || "").startsWith("Opening"))
  };
}

function showDemoMode() {
  hideBootScreen();
  document.body.classList.remove("auth-only");
  document.title = "Benji and Angie's Investment Portfolio";
  el("authCard").classList.add("hidden");
  el("presencePanel").classList.remove("hidden");
  el("benjiPresence").textContent = "Benji demo";
  el("angiePresence").textContent = "Angie demo";
  el("statusLine").textContent = "Demo mode from local seed data. Configure Supabase for shared online access.";
}

function showAuth() {
  hideBootScreen();
  document.body.classList.add("auth-only");
  el("authCard").classList.remove("hidden");
  el("presencePanel").classList.add("hidden");
  el("statusLine").textContent = "Sign in to load the shared cloud portfolio.";
  document.querySelectorAll(".view").forEach((section) => section.classList.add("hidden"));
}

async function loadMember() {
  const userId = state.session.user.id;
  const { data, error } = await supabaseClient.from("app_members").select("*").eq("user_id", userId).single();
  if (error) throw error;
  state.member = data;
  const members = await supabaseClient.from("app_members").select("*");
  if (!members.error) state.members = members.data || [data];
}

async function loadCloudLedger() {
  const [tx, manual, pensions, audit, prices, snapshots, portfolioSnapshots, appStatus, researchStatuses, holdingNameOverrides, reportSettings, reportRuns] = await Promise.all([
    supabaseClient.from("portfolio_transactions").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("manual_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("pension_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("audit_log").select("*").order("event_time", { ascending: false }).limit(100),
    supabaseClient.from("market_prices").select("*").order("fetched_at", { ascending: false }),
    supabaseClient.from("net_worth_snapshots").select("*").order("snapshot_date", { ascending: false }),
    supabaseClient.from("portfolio_value_snapshots").select("*").order("snapshot_date", { ascending: false }),
    supabaseClient.from("app_status").select("*"),
    supabaseClient.from("research_statuses").select("*").order("updated_at", { ascending: false }),
    supabaseClient.from("holding_name_overrides").select("*").order("updated_at", { ascending: false }),
    supabaseClient.from("portfolio_report_settings").select("*"),
    supabaseClient.from("portfolio_report_runs").select("*").order("created_at", { ascending: false }).limit(20)
  ]);
  for (const result of [tx, manual, pensions, audit, prices]) {
    if (result.error) throw result.error;
  }
  const missingSnapshotTable = snapshots.error && ["42P01", "PGRST205"].includes(snapshots.error.code);
  const missingPortfolioSnapshotTable = portfolioSnapshots.error && ["42P01", "PGRST205", "42501"].includes(portfolioSnapshots.error.code);
  const missingAppStatusTable = appStatus.error && ["42P01", "PGRST205", "42501"].includes(appStatus.error.code);
  const missingResearchStatusesTable = researchStatuses.error && ["42P01", "PGRST205", "42501"].includes(researchStatuses.error.code);
  const missingHoldingNameOverridesTable = holdingNameOverrides.error && ["42P01", "PGRST205", "42501"].includes(holdingNameOverrides.error.code);
  const missingReportSettingsTable = reportSettings.error && ["42P01", "PGRST205", "42501"].includes(reportSettings.error.code);
  const missingReportRunsTable = reportRuns.error && ["42P01", "PGRST205", "42501"].includes(reportRuns.error.code);
  if (snapshots.error && !missingSnapshotTable) throw snapshots.error;
  if (portfolioSnapshots.error && !missingPortfolioSnapshotTable) throw portfolioSnapshots.error;
  if (appStatus.error && !missingAppStatusTable) throw appStatus.error;
  if (researchStatuses.error && !missingResearchStatusesTable) throw researchStatuses.error;
  if (holdingNameOverrides.error && !missingHoldingNameOverridesTable) throw holdingNameOverrides.error;
  if (reportSettings.error && !missingReportSettingsTable) throw reportSettings.error;
  if (reportRuns.error && !missingReportRunsTable) throw reportRuns.error;
  state.portfolioValueSnapshotsAvailable = !missingPortfolioSnapshotTable;
  state.appStatusAvailable = !missingAppStatusTable;
  state.researchStatusesAvailable = !missingResearchStatusesTable;
  state.holdingNameOverridesAvailable = !missingHoldingNameOverridesTable;
  state.reportSettingsAvailable = !missingReportSettingsTable;
  state.reportRunsAvailable = !missingReportRunsTable;
  state.ledger = {
    transactions: tx.data || [],
    manual_values: manual.data || [],
    pensions: pensions.data || [],
    audit_log: audit.data || [],
    market_prices: prices.data || [],
    net_worth_snapshots: missingSnapshotTable ? [] : snapshots.data || [],
    portfolio_value_snapshots: missingPortfolioSnapshotTable ? [] : portfolioSnapshots.data || [],
    app_status: missingAppStatusTable ? [] : appStatus.data || [],
    research_statuses: missingResearchStatusesTable ? [] : researchStatuses.data || [],
    holding_name_overrides: missingHoldingNameOverridesTable ? [] : holdingNameOverrides.data || [],
    portfolio_report_settings: missingReportSettingsTable ? [] : reportSettings.data || [],
    portfolio_report_runs: missingReportRunsTable ? [] : reportRuns.data || [],
    fx: 1.3427
  };
  state.auditLog = audit.data || [];
  state.dirtyCloud = false;
  el("refreshCloudButton").classList.add("hidden");
}

function setupRealtime() {
  for (const channel of state.subscriptions) supabaseClient.removeChannel(channel);
  const realtimeTables = ["portfolio_transactions", "manual_values", "pension_values", "market_prices", "net_worth_snapshots"];
  if (state.portfolioValueSnapshotsAvailable) realtimeTables.push("portfolio_value_snapshots");
  if (state.appStatusAvailable) realtimeTables.push("app_status");
  if (state.researchStatusesAvailable) realtimeTables.push("research_statuses");
  if (state.holdingNameOverridesAvailable) realtimeTables.push("holding_name_overrides");
  if (state.reportSettingsAvailable) realtimeTables.push("portfolio_report_settings");
  if (state.reportRunsAvailable) realtimeTables.push("portfolio_report_runs");
  state.subscriptions = realtimeTables.map((tableName) => {
    const channel = supabaseClient.channel(`changes:${tableName}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: tableName },
      (payload) => {
        if (tableName === "market_prices") return;
        const actor = payload.new?.updated_by || payload.new?.created_by || payload.old?.updated_by;
        if (actor !== state.session?.user?.id) {
          state.dirtyCloud = true;
          el("refreshCloudButton").classList.remove("hidden");
          el("refreshCloudButton").textContent = "New data available - refresh";
        }
      }
    ).subscribe();
    return channel;
  });
}

function setupPresence() {
  if (state.presenceChannel) supabaseClient.removeChannel(state.presenceChannel);
  const channel = supabaseClient.channel("portfolio-presence", { config: { presence: { key: state.session.user.id } } });
  channel.on("presence", { event: "sync" }, () => {
    const presence = channel.presenceState();
    const names = Object.values(presence).flat().map((item) => item.display_name);
    renderPresence(names);
  });
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") await channel.track({ display_name: currentUserName(), online_at: new Date().toISOString() });
  });
  state.presenceChannel = channel;
  el("presencePanel").classList.remove("hidden");
}

function renderPresence(onlineNames = []) {
  const current = currentUserName();
  const orderedNames = current === "Angie" ? ["Angie", "Benji"] : ["Benji", "Angie"];
  orderedNames.forEach((name, index) => {
    const presence = el(`${name.toLowerCase()}Presence`);
    const online = onlineNames.includes(name);
    presence.className = `${online ? "presence-online" : "presence-offline"} ${index === 0 ? "presence-primary" : "presence-secondary"}`;
    presence.textContent = `${name} ${online ? "online" : "offline"}`;
    presence.style.order = String(30 + index);
  });
  el("signOutButton").style.order = "32";
}

function renderAll() {
  hideBootScreen();
  document.body.classList.remove("auth-only");
  document.title = "Benji and Angie's Investment Portfolio";
  el("authCard").classList.add("hidden");
  const portfolio = calculatePortfolio();
  el("headlineNetWorth").textContent = money(portfolio.netWorthTotal);
  if (isConfigured && state.session) {
    el("statusLine").textContent = `Signed in as ${currentUserName()} · v${APP_VERSION}`;
  }
  renderDashboard(portfolio);
  renderHoldings(portfolio);
  renderTransaction(portfolio);
  renderLedger(portfolio);
  renderReports();
  renderAudit();
  showView(state.activeView);
  placePresenceInHeader();
  updateLiveMarketAgeLabels(portfolio);
  startMarketAgeTicker();
  startAutoRefresh(portfolio);
}

function startMarketAgeTicker() {
  if (state.marketAgeTimer) return;
  state.marketAgeTimer = window.setInterval(() => {
    if (state.session) updateLiveMarketAgeLabels();
  }, 30000);
}

function placePresenceInHeader() {
  const panel = el("presencePanel");
  const hero = document.querySelector(".hero");
  if (panel && hero && !hero.contains(panel)) hero.appendChild(panel);
}

function renderDashboard(portfolio) {
  const top = portfolio.combined[0];
  const topFiveValue = portfolio.combined.slice(0, 5).reduce((sum, item) => sum + item.value_gbp, 0);
  const cashPct = portfolio.accessibleTotal ? portfolio.totalCash / portfolio.accessibleTotal : 0;
  const investedPct = portfolio.accessibleTotal ? portfolio.totalPositions / portfolio.accessibleTotal : 0;
  const pensions = latestPensions();
  const pensionRows = pensions.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${displayDate(p.date)}</td><td>${money(p.value_gbp)}</td></tr>`).join("");
  const pensionDetails = pensions.length
    ? `<details><summary>View pension lines</summary><table class="compact"><thead><tr><th>Pension</th><th>Date</th><th>Value</th></tr></thead><tbody>${pensionRows}<tr class="total-row"><td colspan="2">Pension total</td><td>${money(portfolio.pensionTotal)}</td></tr></tbody></table></details>`
    : '<p class="subtle">No pension values loaded.</p>';
  const accountRows = accountBreakdown(portfolio).map((item) => `<tr><td data-sort-value="${escapeHtml(item.owner)}">${escapeHtml(item.owner)}</td><td data-sort-value="${escapeHtml(item.account)}">${escapeHtml(item.account)}</td><td data-sort-value="${Number(item.invested || 0)}">${money(item.invested)}</td><td data-sort-value="${Number(item.cash || 0)}">${money(item.cash)}</td><td data-sort-value="${Number(item.total || 0)}">${money(item.total)}</td></tr>`).join("");
  const accountDetails = accountRows
    ? `<details><summary>View portfolio lines</summary><table class="compact sortable"><thead><tr><th data-sort="text">Owner</th><th data-sort="text">Account</th><th data-sort="number">Invested</th><th data-sort="number">Cash</th><th data-sort="number">Total</th></tr></thead><tbody>${accountRows}</tbody><tfoot><tr class="total-row"><td colspan="4">Portfolio total</td><td>${money(portfolio.accessibleTotal)}</td></tr></tfoot></table></details>`
    : '<p class="subtle">No portfolio accounts loaded.</p>';
  const topFiveRows = portfolio.combined.slice(0, 5).map((item) => `<tr><td>${escapeHtml(item.ticker)}</td><td>${escapeHtml(displayHoldingName(item.ticker, item.holding))}</td><td>${money(item.value_gbp)}</td><td>${pct(portfolio.accessibleTotal ? item.value_gbp / portfolio.accessibleTotal : 0)}</td></tr>`).join("");
  const cashRows = portfolio.cash.map((item) => `<tr><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.account)}</td><td>${money(item.amount)}</td></tr>`).join("");
  const fxMetrics = portfolio.prices.get("GBPUSD=X")?.metrics || {};
  const fxRows = [
    ["28 days", fxMetrics.d28],
    ["6 months", fxMetrics.m6],
    ["1 year", fxMetrics.y1],
    ["5 years", fxMetrics.y5],
  ].map(([label, item]) => `<tr><td>${label}</td><td>${rate(item?.rate)}</td><td>${pctSigned(item?.change_pct)}</td></tr>`).join("");
  const sectorMapRows = portfolio.combined.reduce((acc, item) => {
    const sector = sectorMap[item.ticker] || "Other";
    acc[sector] ||= { value: 0, holdings: [] };
    acc[sector].value += item.value_gbp;
    acc[sector].holdings.push(item);
    return acc;
  }, {});
  const sectorRows = Object.entries(sectorMapRows).sort((a, b) => b[1].value - a[1].value).map(([sector, data]) => {
    const holdingRows = data.holdings.map((item) => `<tr><td>${escapeHtml(item.ticker)}</td><td>${escapeHtml(displayHoldingName(item.ticker, item.holding))}</td><td>${money(item.value_gbp)}</td></tr>`).join("");
    return `<tr><td colspan="3"><details class="sector-detail"><summary><span>${sector}</span><span>${money(data.value)}</span><span>${pct(portfolio.accessibleTotal ? data.value / portfolio.accessibleTotal : 0)}</span></summary><table class="compact detail-table"><thead><tr><th>Ticker</th><th>Holding</th><th>Value</th></tr></thead><tbody>${holdingRows}</tbody></table></details></td></tr>`;
  }).join("");
  const accessibleChangeRows = buildAccessibleChangeRows(portfolio).map((row) => {
    if (!row.change) {
      return `<tr><td>${row.label}</td><td colspan="2"><span class="neutral-text">${row.note}</span></td></tr>`;
    }
    const tone = row.change.amount > 0 ? "gain-text" : row.change.amount < 0 ? "loss-text" : "neutral-text";
    return `<tr><td>${row.label}</td><td><span class="${tone}">${moneySigned(row.change.amount)}</span></td><td><span class="${tone}">${pctSigned(row.change.pct)}</span></td></tr>`;
  }).join("");
  const accessibleChangeFootnote = state.portfolioValueSnapshotsAvailable
    ? "Uses daily portfolio snapshots. One-day change uses the latest saved prior day, so after a weekend it may compare with the previous saved trading day."
    : "Daily change tracking is ready in the app and will start once the snapshot setup has been run.";
  const winners = portfolio.combined.filter((item) => item.gain_pct > 0).sort((a, b) => b.gain_pct - a.gain_pct).slice(0, 10);
  const losers = portfolio.combined.filter((item) => item.gain_pct < 0).sort((a, b) => a.gain_pct - b.gain_pct).slice(0, 10);
  const performanceRows = (items, tone) => items.map((item) => `<tr><td data-sort-value="${escapeHtml(item.ticker)}">${escapeHtml(item.ticker)}</td><td data-sort-value="${escapeHtml(displayHoldingName(item.ticker, item.holding))}">${escapeHtml(displayHoldingName(item.ticker, item.holding))}</td><td data-sort-value="${Number(item.value_gbp || 0)}">${money(item.value_gbp)}</td><td data-sort-value="${Number(item.gain_pct || 0)}"><span class="${tone}">${pctSigned(item.gain_pct)}</span></td><td data-sort-value="${Number(item.gain_gbp || 0)}"><span class="${tone}">${moneySigned(item.gain_gbp)}</span></td></tr>`).join("") || '<tr><td colspan="5">None</td></tr>';
  const historyRows = buildNetWorthHistory(portfolio).map((row) => `<tr><td>${displayDate(row.date)}</td><td>${money(row.net_worth_total)}</td><td>${money(row.accessible_total)}</td><td>${money(row.pension_total)}</td><td>${formatHistoryChange(row.change_1m)}</td><td>${formatHistoryChange(row.change_6m)}</td><td>${formatHistoryChange(row.change_12m)}</td></tr>`).join("");
  const topHoldingText = top ? `${escapeHtml(top.ticker)} · ${money(top.value_gbp)} · ${pct(portfolio.accessibleTotal ? top.value_gbp / portfolio.accessibleTotal : 0)}` : "-";
  const fxUpdated = refreshAgeText(portfolio.prices.get("GBPUSD=X")?.fetched_at);
  const fxFreshClass = fxUpdated === "more than an hour ago" ? " market-error" : fxUpdated === "not refreshed" ? "" : " market-ok";
  el("dashboardView").innerHTML = `
    <section class="grid two hero-metrics">
      <div class="card"><div class="subtle">Portfolio</div><div class="metric">${money(portfolio.accessibleTotal)}</div><p class="subtle">Invested ${money(portfolio.totalPositions)} (${pct(investedPct)}) | Cash ${money(portfolio.totalCash)} (${pct(cashPct)})</p>${accountDetails}</div>
      <div class="card"><div class="subtle">Pension</div><div class="metric">${money(portfolio.pensionTotal)}</div>${pensionDetails}</div>
    </section>
    <section class="card market-session-card">
      <h2>Market Status</h2>
      <div class="market-session-grid">${marketSessionMarkup()}</div>
      <p class="footnote">Uses regular LSE and NYSE/Nasdaq sessions, weekends, published holidays and known early closes. Unscheduled market closures are not included.</p>
    </section>
    <section class="card accessible-change-card">
      <h2>Portfolio Change</h2>
      <table class="compact change-table">
        <thead><tr><th>Period</th><th>GBP change</th><th>% change</th></tr></thead>
        <tbody>${accessibleChangeRows}</tbody>
      </table>
      <p class="footnote">${accessibleChangeFootnote}</p>
    </section>
    <section class="grid two">
      <div class="card"><h2>Portfolio Highlights</h2>
        <div class="highlight-list">
          <div class="highlight-row"><span>Top holding</span><strong>${topHoldingText}</strong></div>
          <details class="highlight-detail">
            <summary><span>Top 5 concentration</span><strong>${pct(portfolio.accessibleTotal ? topFiveValue / portfolio.accessibleTotal : 0)}</strong></summary>
            <table class="compact detail-table"><thead><tr><th>Ticker</th><th>Holding</th><th>Value</th><th>Weight</th></tr></thead><tbody>${topFiveRows}</tbody></table>
          </details>
          <div class="highlight-row"><span>Equal-weight guide</span><strong>${pct(portfolio.combined.length ? 1 / portfolio.combined.length : 0)} across ${portfolio.combined.length} holdings</strong></div>
          <details class="highlight-detail">
            <summary><span>Cash</span><strong>${money(portfolio.totalCash)} (${pct(cashPct)})</strong></summary>
            <table class="compact detail-table"><thead><tr><th>Owner</th><th>Account</th><th>Value</th></tr></thead><tbody>${cashRows}<tr class="total-row"><td colspan="2">Cash total</td><td>${money(portfolio.totalCash)}</td></tr></tbody></table>
          </details>
          <details class="highlight-detail">
            <summary><span>FX guide</span><strong>£1 = $${portfolio.fx.toFixed(4)}</strong></summary>
            <table class="compact detail-table"><thead><tr><th>Period</th><th>Rate then</th><th>Change</th></tr></thead><tbody>${fxRows}</tbody></table>
            <p class="footnote fx-freshness${fxFreshClass}" data-refresh-age="fx">FX data refreshed ${fxUpdated}.</p>
            <p class="footnote">A stronger pound improves buying power when investing into US equities; a stronger dollar increases the sterling value of existing US holdings and is beneficial when selling back into pounds.</p>
          </details>
        </div>
      </div>
      <div class="card"><h2>Sector Exposure</h2><table><thead><tr><th colspan="3">Area / Value / Weight</th></tr></thead><tbody>${sectorRows}</tbody></table></div>
    </section>
    <section class="card gain-card"><h2>Top Gainers</h2><div class="table-shell"><table class="sortable performance-table"><thead><tr><th data-sort="text">Ticker</th><th data-sort="text">Holding</th><th data-sort="number">Value</th><th data-sort="number">% change since purchase</th><th data-sort="number">GBP change since purchase</th></tr></thead><tbody>${performanceRows(winners, "gain-text")}</tbody></table></div><p class="footnote">Performance is measured since purchase.</p></section>
    <section class="card loss-card"><h2>Top Losers</h2><div class="table-shell"><table class="sortable performance-table"><thead><tr><th data-sort="text">Ticker</th><th data-sort="text">Holding</th><th data-sort="number">Value</th><th data-sort="number">% change since purchase</th><th data-sort="number">GBP change since purchase</th></tr></thead><tbody>${performanceRows(losers, "loss-text")}</tbody></table></div><p class="footnote">Performance is measured since purchase. Only holdings currently showing a loss are listed.</p></section>
    <section class="card"><details class="history-detail"><summary>Net Worth History</summary><table><thead><tr><th>Date</th><th>Headline</th><th>Portfolio</th><th>Pension</th><th>1 month</th><th>6 months</th><th>12 months</th></tr></thead><tbody>${historyRows}</tbody></table><p class="footnote">${state.ledger.net_worth_snapshots?.length ? `${state.ledger.net_worth_snapshots.length} monthly snapshot saved.` : "No monthly snapshots yet."} The online app saves one snapshot per calendar month on the first signed-in use of that month.</p></details></section>
  `;
  bindRefreshButtons();
  wireSortableTables();
}

function buildNetWorthHistory(portfolio) {
  const snapshots = (state.ledger.net_worth_snapshots || []).map((row) => ({
    date: row.snapshot_date,
    month_key: row.month_key || String(row.snapshot_date || "").slice(0, 7),
    net_worth_total: Number(row.net_worth_total || 0),
    accessible_total: Number(row.accessible_total || 0),
    pension_total: Number(row.pension_total || 0)
  })).sort((a, b) => String(b.month_key).localeCompare(String(a.month_key)));
  const rows = snapshots.length ? snapshots : [{
    date: todayIso(),
    month_key: todayIso().slice(0, 7),
    net_worth_total: portfolio.netWorthTotal,
    accessible_total: portfolio.accessibleTotal,
    pension_total: portfolio.pensionTotal
  }];
  return rows.map((row) => ({
    ...row,
    change_1m: netWorthChange(row, findPreviousSnapshot(rows, row, 1)),
    change_6m: netWorthChange(row, findPreviousSnapshot(rows, row, 6)),
    change_12m: netWorthChange(row, findPreviousSnapshot(rows, row, 12))
  }));
}

function monthIndex(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) ? year * 12 + month : 0;
}

function findPreviousSnapshot(rows, row, monthsBack) {
  const target = monthIndex(row.month_key) - monthsBack;
  return rows
    .filter((candidate) => monthIndex(candidate.month_key) <= target)
    .sort((a, b) => monthIndex(b.month_key) - monthIndex(a.month_key))[0];
}

function netWorthChange(row, previous) {
  if (!previous || !Number(previous.net_worth_total)) return null;
  const amount = Number(row.net_worth_total || 0) - Number(previous.net_worth_total || 0);
  return { amount, pct: amount / Number(previous.net_worth_total || 0) };
}

function formatHistoryChange(change) {
  if (!change) return "-";
  const tone = change.amount > 0 ? "gain-text" : change.amount < 0 ? "loss-text" : "neutral-text";
  return `<span class="${tone}">${moneySigned(change.amount)} / ${pctSigned(change.pct)}</span>`;
}

function buildAccessibleChangeRows(portfolio) {
  const snapshots = (state.ledger.portfolio_value_snapshots || [])
    .map((row) => ({
      date: String(row.snapshot_date || "").slice(0, 10),
      accessible_total: Number(row.accessible_total || 0)
    }))
    .filter((row) => row.date && Number.isFinite(row.accessible_total) && row.accessible_total > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const periods = [
    { label: "1 day", days: 1 },
    { label: "1 week", days: 7 },
    { label: "1 month", days: 30 },
    { label: "1 year", days: 365 }
  ];
  const currentValue = Number(portfolio.accessibleTotal || 0);
  return periods.map((period) => {
    const targetDate = addDaysIso(todayIso(), -period.days);
    const previous = [...snapshots].reverse().find((row) => row.date <= targetDate);
    if (!state.portfolioValueSnapshotsAvailable) {
      return { label: period.label, change: null, note: "Setup required" };
    }
    if (!previous) {
      return { label: period.label, change: null, note: "Collecting data" };
    }
    const amount = currentValue - previous.accessible_total;
    return {
      label: period.label,
      change: {
        amount,
        pct: previous.accessible_total ? amount / previous.accessible_total : null
      }
    };
  });
}

async function ensureMonthlySnapshot(portfolio) {
  if (!isConfigured || !state.session) return;
  const monthKey = todayIso().slice(0, 7);
  if ((state.ledger.net_worth_snapshots || []).some((row) => row.month_key === monthKey)) return;
  const snapshot = {
    month_key: monthKey,
    snapshot_date: todayIso(),
    net_worth_total: portfolio.netWorthTotal,
    accessible_total: portfolio.accessibleTotal,
    invested_total: portfolio.totalPositions,
    cash_total: portfolio.totalCash,
    pension_total: portfolio.pensionTotal,
    fx_rate: portfolio.fx,
    created_by: state.session.user.id,
    updated_by: state.session.user.id
  };
  const { error } = await supabaseClient.from("net_worth_snapshots").insert(snapshot);
  if (error) {
    console.warn("Net worth snapshot skipped", error);
    return;
  }
  state.ledger.net_worth_snapshots = [snapshot, ...(state.ledger.net_worth_snapshots || [])];
}

async function ensureAccessiblePortfolioSnapshot(portfolio) {
  if (!isConfigured || !state.session || !state.portfolioValueSnapshotsAvailable) return;
  const snapshotDate = todayIso();
  if ((state.ledger.portfolio_value_snapshots || []).some((row) => String(row.snapshot_date || "").slice(0, 10) === snapshotDate)) return;
  const snapshot = {
    snapshot_date: snapshotDate,
    accessible_total: portfolio.accessibleTotal,
    invested_total: portfolio.totalPositions,
    cash_total: portfolio.totalCash,
    fx_rate: portfolio.fx,
    created_by: state.session.user.id,
    updated_by: state.session.user.id
  };
  const { error } = await supabaseClient.from("portfolio_value_snapshots").upsert(snapshot, { onConflict: "snapshot_date" });
  if (error) {
    if (["42P01", "PGRST205", "42501"].includes(error.code)) {
      state.portfolioValueSnapshotsAvailable = false;
    }
    console.warn("Portfolio snapshot skipped", error);
    return;
  }
  state.ledger.portfolio_value_snapshots = [snapshot, ...(state.ledger.portfolio_value_snapshots || [])];
}

function renderHoldings(portfolio) {
  const statusOptions = researchStatusOptions.map((option) => `<option value="${option.value}">${option.label}</option>`).join("");
  const rows = portfolio.combined.map((item) => {
    const research = researchStatusFor(item.ticker);
    const researchMeta = researchStatusMeta(research?.status || "no_signal");
    const holdingOverride = holdingNameOverrideFor(item.ticker);
    const preferredName = displayHoldingName(item.ticker, item.holding);
    const originalName = baseHoldingName(item.ticker, item.holding);
    const childRows = item.children.map((child) => `
      <div class="owner-breakdown-row">
        <span>${escapeHtml(child.owner)}</span>
        <span>${escapeHtml(child.account)}</span>
        <span>${Number(child.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
        <span>${money(child.value_gbp)}</span>
        <span>${pctSigned(child.gain_pct)}</span>
      </div>
    `).join("");
    const detailKey = `holding-${escapeHtml(item.ticker)}`;
    const ownerCell = item.children.length > 1
      ? `<button type="button" class="owner-toggle" data-detail="${detailKey}" aria-expanded="false"><span class="toggle-arrow">▸</span> ${escapeHtml(item.owner)}</button>`
      : escapeHtml(item.owner);
    const detailRow = `
      <tr class="details-row holding-detail-row hidden" data-parent="${detailKey}">
        <td colspan="9">
          <div class="holding-detail-grid">
            ${item.children.length > 1 ? `
              <div class="owner-breakdown">
                <div class="owner-breakdown-head"><span>Owner</span><span>Account</span><span>Shares</span><span>Value</span><span>Gain/loss</span></div>
                ${childRows}
                <div class="owner-breakdown-row total"><span>${escapeHtml(item.ticker)} total</span><span></span><span>${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span><span>${money(item.value_gbp)}</span><span>${pctSigned(item.gain_pct)}</span></div>
              </div>
            ` : ""}
            <form class="research-status-form research-quick-form" data-ticker="${escapeHtml(item.ticker)}">
              <label>${escapeHtml(item.ticker)} Research Status<select name="status">${statusOptions}</select></label>
              <button>Save</button>
              <span class="subtle">${escapeHtml(researchMeta.meaning)}</span>
            </form>
            <form class="holding-name-form research-quick-form" data-ticker="${escapeHtml(item.ticker)}">
              <label>${escapeHtml(item.ticker)} Display Name<input name="display_name" value="${escapeHtml(preferredName)}" required></label>
              <div class="button-row compact-actions"><button>Save name</button>${holdingOverride ? `<button type="button" class="secondary" data-reset-holding-name="${escapeHtml(item.ticker)}">Reset</button>` : ""}</div>
              <span class="subtle">Original ledger name: ${escapeHtml(originalName)}</span>
            </form>
          </div>
        </td>
      </tr>
    `;
    const researchCell = `
      <button type="button" class="research-status-toggle" data-detail="${detailKey}" aria-expanded="false">
        <span class="toggle-arrow">▸</span>
        ${researchStatusBadge(research)}
        <span class="research-date">${researchDate(research)}</span>
      </button>
    `;
    return `
      <tr class="holding-main-row" data-key="${detailKey}">
        <td data-sort-value="${escapeHtml(item.ticker)}"><strong>${escapeHtml(item.ticker)}</strong></td>
        <td data-sort-value="${escapeHtml(displayHoldingName(item.ticker, item.holding))}">${escapeHtml(displayHoldingName(item.ticker, item.holding))}</td>
        <td data-sort-value="${escapeHtml(item.owner)}">${ownerCell}</td>
        <td data-sort-value="${escapeHtml(item.account)}">${escapeHtml(item.account)}</td>
        <td data-sort-value="${Number(item.quantity || 0)}">${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td data-sort-value="${Number(item.value_gbp || 0)}">${money(item.value_gbp)}</td>
        <td data-sort-value="${Number(item.gain_pct || 0)}">${pctSigned(item.gain_pct)}</td>
        <td data-sort-value="${escapeHtml(researchMeta.label)}">${researchCell}</td>
        <td>${statusBadge(item.gain_pct)}</td>
      </tr>
      ${detailRow}
    `;
  }).join("");
  const goldilocksRows = researchStatusOptions.map((option) => `<tr><td>${researchStatusBadge({ status: option.value })}</td><td>${escapeHtml(option.meaning)}</td></tr>`).join("");
  el("holdingsView").innerHTML = `<section class="card"><h2>Current Holdings <span class="subtle">${portfolio.combined.length} holdings</span></h2>${saveBanner("holdings")}<div class="table-shell"><table class="sortable holdings-table"><colgroup><col class="col-ticker"><col class="col-holding"><col class="col-owner"><col class="col-account"><col class="col-shares"><col class="col-value"><col class="col-gain"><col class="col-research"><col class="col-status"></colgroup><thead><tr><th data-sort="text">Ticker</th><th data-sort="text">Holding</th><th data-sort="text">Owner</th><th data-sort="text">Account</th><th data-sort="number">Shares</th><th data-sort="number">Value</th><th data-sort="number">Gain/loss</th><th data-sort="text">Research Status</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><p class="footnote">Portfolio status is calculated from gain/loss since purchase. Research Status is manually selected using the Alpesh Patel Goldilocks/MACD framework and should be read as research context, not financial advice.</p></section><section class="card"><details class="history-detail"><summary>Goldilocks / MACD Legend</summary><table class="compact detail-table"><thead><tr><th>Status</th><th>Big-picture meaning</th></tr></thead><tbody>${goldilocksRows}</tbody></table><p class="footnote">Bear labels take precedence: Daddy Bear first, then Mummy Bear, then Baby Bear. Alpesh's public material sometimes uses Mommy Bear; this app uses Mummy Bear.</p></details></section>`;
  wireHoldingDetails();
  wireResearchStatusForms();
  wireHoldingNameForms();
  wireSortableTables();
}

function wireHoldingDetails() {
  document.querySelectorAll(".owner-toggle, .research-status-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const detail = document.querySelector(`[data-parent="${button.dataset.detail}"]`);
      if (!detail) return;
      const isOpen = !detail.classList.contains("hidden");
      detail.classList.toggle("hidden", isOpen);
      button.setAttribute("aria-expanded", String(!isOpen));
      document.querySelectorAll(`[data-detail="${button.dataset.detail}"] .toggle-arrow`).forEach((arrow) => {
        arrow.textContent = isOpen ? "▸" : "▾";
      });
    });
  });
}

function wireResearchStatusForms() {
  document.querySelectorAll(".research-status-form").forEach((form) => {
    const existing = researchStatusFor(form.dataset.ticker);
    if (existing) {
      form.elements.status.value = existing.status || "no_signal";
    }
    form.addEventListener("submit", submitResearchStatus);
  });
}

async function submitResearchStatus(event) {
  event.preventDefault();
  if (!state.researchStatusesAvailable) {
    alert("Research Status storage is not available yet. Please refresh after the database update has been applied.");
    return;
  }
  const form = event.currentTarget;
  const ticker = form.dataset.ticker;
  const data = Object.fromEntries(new FormData(form).entries());
  const existing = researchStatusFor(ticker);
  const selectedDate = existing?.status === data.status ? existing.selected_date || todayIso() : todayIso();
  const patch = {
    ticker,
    status: data.status,
    selected_date: selectedDate,
    source_type: existing?.source_type || "Manual",
    source_title: existing?.source_title || "",
    source_url: existing?.source_url || "",
    notes: existing?.notes || "",
    updated_by: state.session.user.id
  };
  try {
    setFormWorking(form, true);
    if (existing) {
      await updateRowWithVersion("research_statuses", existing, patch, "research_status_update");
    } else {
      await insertRow("research_statuses", { ...patch, created_by: state.session.user.id }, "research_status_add");
    }
    await loadCloudLedger();
    setSaveMessage("holdings", `${ticker} research status saved at ${shortUkTime()} UK.`);
    renderAll();
  } catch (error) {
    alert(`Research status save failed: ${error.message}`);
  } finally {
    setFormWorking(form, false);
  }
}

function wireHoldingNameForms() {
  document.querySelectorAll(".holding-name-form").forEach((form) => {
    form.addEventListener("submit", submitHoldingNameOverride);
  });
  document.querySelectorAll("[data-reset-holding-name]").forEach((button) => {
    button.addEventListener("click", () => resetHoldingNameOverride(button.dataset.resetHoldingName));
  });
}

async function submitHoldingNameOverride(event) {
  event.preventDefault();
  if (!state.holdingNameOverridesAvailable) {
    alert("Holding name storage is not available yet. Please refresh after the database update has been applied.");
    return;
  }
  const form = event.currentTarget;
  const ticker = String(form.dataset.ticker || "").trim().toUpperCase();
  const displayName = String(new FormData(form).get("display_name") || "").trim();
  if (!ticker || !displayName) return;
  const existing = (state.ledger.holding_name_overrides || []).find((row) => String(row.ticker || "").trim().toUpperCase() === ticker);
  const patch = {
    ticker,
    display_name: displayName,
    notes: existing?.notes || "",
    deleted_at: null,
    deleted_by: null,
    updated_by: state.session.user.id,
    updated_at: new Date().toISOString()
  };
  try {
    setFormWorking(form, true);
    let saved = null;
    if (existing) {
      const { data, error } = await supabaseClient.from("holding_name_overrides")
        .update({ ...patch, version: Number(existing.version || 1) + 1 })
        .eq("ticker", existing.ticker)
        .eq("version", existing.version)
        .select()
        .single();
      if (error || !data) throw new Error(error?.message || "This holding name changed after you opened it. Please refresh and review before saving.");
      saved = data;
      await writeAudit("holding_name_update", "holding_name_overrides", null, existing, saved);
    } else {
      const { data, error } = await supabaseClient.from("holding_name_overrides")
        .insert({ ...patch, created_by: state.session.user.id })
        .select()
        .single();
      if (error) throw error;
      saved = data;
      await writeAudit("holding_name_add", "holding_name_overrides", null, null, saved);
    }
    await loadCloudLedger();
    setSaveMessage("holdings", `${ticker} display name saved at ${shortUkTime()} UK.`);
    renderAll();
  } catch (error) {
    alert(`Holding name save failed: ${error.message}`);
  } finally {
    setFormWorking(form, false);
  }
}

async function resetHoldingNameOverride(tickerValue) {
  const ticker = String(tickerValue || "").trim().toUpperCase();
  const existing = holdingNameOverrideFor(ticker);
  if (!existing) return;
  const patch = {
    deleted_at: new Date().toISOString(),
    deleted_by: state.session.user.id,
    version: Number(existing.version || 1) + 1,
    updated_by: state.session.user.id,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabaseClient.from("holding_name_overrides")
    .update(patch)
    .eq("ticker", existing.ticker)
    .select()
    .single();
  if (error || !data) {
    alert(`Holding name reset failed: ${error?.message || "No row was updated."}`);
    return;
  }
  await writeAudit("holding_name_reset", "holding_name_overrides", null, existing, data);
  await loadCloudLedger();
  setSaveMessage("holdings", `${ticker} display name reset at ${shortUkTime()} UK.`);
  renderAll();
}

function bindRefreshButtons() {
  document.querySelectorAll(".refresh-prices-action").forEach((button) => {
    button.onclick = () => refreshMarketPrices();
  });
}

async function refreshMarketPrices(options = {}) {
  const buttons = [...document.querySelectorAll(".refresh-prices-action")];
  if (!supabaseClient || !state.session) return;
  if (state.marketRefreshing) {
    if (!options.quiet) {
      setMarketRefreshMessage("Refreshing market prices...");
      try {
        await state.marketRefreshPromise;
        await loadCloudLedger();
        renderAll();
        setMarketRefreshMessage(`Market prices refreshed · ${marketFreshnessText(calculatePortfolio())}`, "success", 15000);
      } catch (error) {
        setMarketRefreshMessage(`Market refresh failed: ${error.message} · ${marketFreshnessText(calculatePortfolio())}`, "error");
      }
    }
    return;
  }
  state.marketRefreshing = true;
  if (!options.quiet) {
    setMarketRefreshMessage("Refreshing market prices...");
  }
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    const invokePromise = fetch(`${config.supabaseUrl}/functions/v1/refresh-prices`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${state.session.access_token}`,
        "apikey": config.supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ extraTickers: options.extraTickers || [] })
    }).then(async (response) => {
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { error: text };
      }
      if (!response.ok) throw new Error(payload.error || text || `Refresh failed with status ${response.status}`);
      return payload;
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Market refresh is taking too long. Please try again.")), 45000));
    state.marketRefreshPromise = Promise.race([invokePromise, timeoutPromise]);
    const data = await state.marketRefreshPromise;
    try {
      await Promise.race([
        loadCloudLedger(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Market data saved, but the app reload took too long.")), 15000))
      ]);
    } catch (reloadError) {
      console.warn("Market data refresh completed but reload was delayed", reloadError);
    }
    const refreshedPortfolio = calculatePortfolio();
    ensureMonthlySnapshot(refreshedPortfolio).catch((snapshotError) => console.warn("Net worth snapshot skipped after market refresh", snapshotError));
    ensureAccessiblePortfolioSnapshot(refreshedPortfolio).catch((snapshotError) => console.warn("Portfolio snapshot skipped after market refresh", snapshotError));
    const skipped = data?.skipped?.length ? ` ${data.skipped.length} skipped.` : "";
    if (!options.quiet || options.auto) {
      renderAll();
    }
    if (!options.quiet) {
      setMarketRefreshMessage(`Market prices refreshed · ${marketFreshnessText(calculatePortfolio())}${skipped}`, "success", 15000);
    } else if (options.auto) {
      setMarketRefreshMessage(`Market prices refreshed · ${marketFreshnessText(calculatePortfolio())}${skipped}`, "success", 15000);
    }
  } catch (error) {
    if (!options.quiet || options.auto) {
      setMarketRefreshMessage(`Market refresh failed: ${error.message} · ${marketFreshnessText(calculatePortfolio())}`, "error");
    }
  } finally {
    state.marketRefreshing = false;
    state.marketRefreshPromise = null;
    document.querySelectorAll(".refresh-prices-action").forEach((button) => {
      button.disabled = false;
    });
  }
}

function startAutoRefresh(portfolio) {
  if (!isConfigured || !state.session) return;
  if (!state.initialPriceRefreshDone) {
    state.initialPriceRefreshDone = true;
    window.setTimeout(() => refreshMarketPrices({ auto: true, quiet: true }), 1200);
  }
  if (state.autoRefreshTimer) return;
  state.autoRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && state.session) {
      refreshMarketPrices({ auto: true, quiet: true });
    }
  }, autoRefreshMinutes * 60 * 1000);
}

function renderTransaction(portfolio) {
  const disabled = !isConfigured ? "disabled" : "";
  const note = !isConfigured ? '<p class="notice">Demo mode is view-only. Configure Supabase to enable shared edits.</p>' : "";
  const cashConfirm = state.pendingCashConfirm ? renderCashConfirm(portfolio) : "";
  el("transactionView").innerHTML = `
    ${note}
    ${cashConfirm}
    <section class="grid two">
      <div class="card">
        <h2>Buy / Sell Equity</h2>
        ${saveBanner("equity")}
        <form id="equityForm">
          <label>Date</label><input name="date" type="date" value="${todayIso()}" required ${disabled}>
          <label>Owner</label>${ownerSelect(disabled)}
          <label>Account</label><select name="account" required ${disabled}></select>
          <label>Action</label><select name="type" ${disabled}><option value="buy">Buy</option><option value="sell">Sell</option></select>
          <label>Ticker</label><input name="ticker" class="ticker-input" required ${disabled}><div class="lookup-status"></div>
          <label>Holding name</label><input name="holding" required ${disabled}>
          <label>Quantity of shares</label><input name="quantity" type="number" step="any" required ${disabled}>
          <label>Price per share</label><input name="price" type="number" step="any" required ${disabled}>
          <label>Currency</label><select name="currency" ${disabled}><option>USD</option><option>GBP</option></select>
          <label>Notes</label><textarea name="notes" ${disabled}></textarea>
          <div class="transaction-total">Total transaction value: <strong>-</strong></div>
          <button ${disabled}>Add equity transaction</button>
        </form>
      </div>
      <div class="card">
        <h2>Cash Deposit / Withdrawal</h2>
        ${saveBanner("cash")}
        <form id="cashForm">
          <label>Date</label><input name="date" type="date" value="${todayIso()}" required ${disabled}>
          <label>Owner</label>${ownerSelect(disabled)}
          <label>Account</label><select name="account" required ${disabled}></select>
          <label>Action</label><select name="type" ${disabled}><option value="deposit">Deposit cash</option><option value="withdrawal">Withdraw cash</option></select>
          <label>Cash amount</label><input name="amount" type="number" step="any" required ${disabled}>
          <label>Currency</label><select name="currency" ${disabled}><option>GBP</option><option>USD</option></select>
          <label>Notes</label><textarea name="notes" ${disabled}></textarea>
          <div class="transaction-total">Transaction preview: <strong>-</strong></div>
          <button ${disabled}>Add cash transaction</button>
        </form>
      </div>
    </section>
    <section class="card" style="margin-top:18px">
      <h2>Manual Updates</h2>
      ${saveBanner("manual")}
      <form id="manualForm">
        <label>Date</label><input name="date" type="date" value="${todayIso()}" required ${disabled}>
        <label>Type</label><select name="kind" ${disabled}><option value="crypto">Revolut crypto</option><option value="pension">British Airways pension</option></select>
        <label>Account / pension name</label><select name="account" ${disabled}></select>
        <div class="transaction-total">Current value: <strong id="manualCurrent">-</strong> | Difference: <strong id="manualDifference" class="neutral-text">-</strong></div>
        <label>Currency</label><select name="currency" ${disabled}><option>GBP</option><option>USD</option></select>
        <label>New Value</label><input name="value" type="number" step="any" required ${disabled}>
        <button ${disabled}>Save manual value</button>
      </form>
    </section>
  `;
  wireTransactionForms(portfolio);
}

function renderCashConfirm(portfolio) {
  const pending = state.pendingCashConfirm;
  const current = portfolio.cash.find((item) => item.owner === pending.owner && item.account === pending.account)?.amount || 0;
  return `<section class="card cash-confirm-card">
    <h2>Confirm Account Cash</h2>
    <p class="subtle">Can you confirm the remaining cash balance in ${escapeHtml(pending.account)}? The app currently calculates ${money(current)}.</p>
    <form id="cashConfirmForm">
      <label>Remaining cash balance GBP</label><input name="cash_balance_gbp" type="number" step="any" required>
      <div class="confirm-actions"><button>Confirm cash balance</button><button type="button" id="cashConfirmDisregard" class="secondary">Disregard</button></div>
    </form>
  </section>`;
}

function ownerSelect(disabled) {
  return `<select name="owner" required ${disabled}>${displayNames.map((name) => `<option>${name}</option>`).join("")}</select>`;
}

function wireAccountFilter(form) {
  const owner = form.elements.owner;
  const account = form.elements.account;
  const update = () => {
    const selected = account.value;
    account.innerHTML = (accountsByOwner[owner.value] || []).map((name) => `<option>${escapeHtml(name)}</option>`).join("");
    if ([...account.options].some((option) => option.value === selected)) account.value = selected;
  };
  owner.addEventListener("change", update);
  update();
  return update;
}

function wireTransactionForms(portfolio) {
  const equityForm = el("equityForm");
  const cashForm = el("cashForm");
  const manualForm = el("manualForm");
  if (!equityForm || !cashForm || !manualForm || !isConfigured) return;
  wireAccountFilter(equityForm);
  wireAccountFilter(cashForm);
  wireTickerLookup(equityForm, portfolio);
  wireTransactionPreview(equityForm, portfolio);
  wireTransactionPreview(cashForm, portfolio);
  restoreTransactionDraft(equityForm, "equity");
  restoreTransactionDraft(cashForm, "cash");
  wireTransactionDraft(equityForm, "equity");
  wireTransactionDraft(cashForm, "cash");
  equityForm.addEventListener("submit", (event) => submitEquity(event, portfolio));
  cashForm.addEventListener("submit", (event) => submitCash(event, portfolio));
  setupManualForm(manualForm, portfolio);
  restoreTransactionDraft(manualForm, "manual");
  wireTransactionDraft(manualForm, "manual");
  const cashConfirmForm = el("cashConfirmForm");
  if (cashConfirmForm) cashConfirmForm.addEventListener("submit", (event) => submitCashConfirmation(event, portfolio));
  el("cashConfirmDisregard")?.addEventListener("click", () => {
    state.pendingCashConfirm = null;
    setSaveMessage("cash", `Cash confirmation skipped at ${shortUkTime()} UK.`, "warning");
    renderAll();
  });
}

function wireTickerLookup(form, portfolio) {
  const input = form.elements.ticker;
  const holding = form.elements.holding;
  const status = form.querySelector(".lookup-status");
  const update = async () => {
    const ticker = input.value.trim().toUpperCase();
    if (!ticker) return;
    const quote = portfolio.prices.get(ticker);
    const name = holdingNameMap[ticker] || quote?.yahoo_symbol || ticker;
    if (!holding.value || holding.value === holdingNameMap[input.dataset.lastTicker]) holding.value = name;
    input.dataset.lastTicker = ticker;
    status.textContent = quote
      ? `${name} · ${quote.currency} ${Number(quote.price).toLocaleString(undefined, { maximumFractionDigits: 4 })}`
      : name;
    status.className = quote ? "lookup-status ok" : "lookup-status warn";
    if (!quote && supabaseClient && state.session) {
      status.textContent = `${name} · looking up price...`;
      await refreshMarketPrices({ extraTickers: [ticker], quiet: true });
      const refreshedPortfolio = calculatePortfolio();
      const refreshedQuote = refreshedPortfolio.prices.get(ticker);
      status.textContent = refreshedQuote
        ? `${name} · ${refreshedQuote.currency} ${Number(refreshedQuote.price).toLocaleString(undefined, { maximumFractionDigits: 4 })}`
        : name;
      status.className = refreshedQuote ? "lookup-status ok" : "lookup-status warn";
    }
  };
  input.addEventListener("blur", () => update());
  input.addEventListener("change", () => update());
  form.querySelector(".lookup-button")?.addEventListener("click", update);
}

function wireTransactionPreview(form, portfolio) {
  const target = form.querySelector(".transaction-total strong");
  const update = () => {
    if (!target) return;
    if (form.id === "equityForm") {
      const qty = Number(form.elements.quantity.value || 0);
      const price = Number(form.elements.price.value || 0);
      const ccy = form.elements.currency.value;
      const ticker = form.elements.ticker.value.trim().toUpperCase() || "shares";
      const local = qty * price;
      const gbp = ccy === "USD" ? local / portfolio.fx : local;
      const dollars = ccy === "USD" ? local : local * portfolio.fx;
      target.textContent = `${qty.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${ticker} · ${ccy} ${local.toLocaleString(undefined, { maximumFractionDigits: 2 })} · approx ${money(gbp)} / ${usd(dollars)}`;
    } else {
      const amount = Number(form.elements.amount.value || 0);
      const ccy = form.elements.currency.value;
      const gbp = ccy === "USD" ? amount / portfolio.fx : amount;
      const dollars = ccy === "USD" ? amount : amount * portfolio.fx;
      target.textContent = `${ccy} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} · approx ${money(gbp)} / ${usd(dollars)}`;
    }
  };
  ["input", "change"].forEach((eventName) => form.addEventListener(eventName, update));
  update();
}

function setupManualForm(form, portfolio) {
  const update = () => {
    const previousAccount = form.elements.account.value;
    let currentGbp = 0;
    if (form.elements.kind.value === "crypto") {
      form.elements.account.innerHTML = '<option>Benji - Revolut - Crypto</option>';
      const current = latestManualValue("Crypto", "Benji", "Benji - Revolut - Crypto");
      currentGbp = Number(current?.value_gbp || 0);
      el("manualCurrent").textContent = `${money(currentGbp)} / ${usd(currentGbp * portfolio.fx)}`;
    } else {
      form.elements.account.innerHTML = latestPensions().map((row) => `<option>${escapeHtml(row.name)}</option>`).join("");
      if ([...form.elements.account.options].some((option) => option.value === previousAccount)) {
        form.elements.account.value = previousAccount;
      }
      const row = latestPensions().find((p) => p.name === form.elements.account.value);
      currentGbp = Number(row?.value_gbp || 0);
      el("manualCurrent").textContent = money(row?.value_gbp || 0);
    }
    const entered = Number(form.elements.value.value || 0);
    const newValueGbp = form.elements.currency.value === "USD" ? entered / portfolio.fx : entered;
    const difference = entered ? newValueGbp - currentGbp : 0;
    const differenceTarget = el("manualDifference");
    differenceTarget.textContent = entered ? moneySigned(difference) : "-";
    differenceTarget.className = difference > 0 ? "gain-text" : difference < 0 ? "loss-text" : "neutral-text";
  };
  form.elements.kind.addEventListener("change", update);
  form.elements.account.addEventListener("change", update);
  form.elements.currency.addEventListener("change", update);
  form.elements.value.addEventListener("input", update);
  form.addEventListener("submit", (event) => submitManual(event, portfolio));
  update();
}

async function submitEquity(event, portfolio) {
  event.preventDefault();
  if (state.busyForms.equity) return;
  state.busyForms.equity = true;
  const form = event.currentTarget;
  setFormWorking(form, true);
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const local = Number(data.quantity) * Number(data.price);
    const amountGbp = data.currency === "USD" ? local / portfolio.fx : local;
    const row = {
      date: data.date,
      type: data.type,
      owner: data.owner,
      account: data.account,
      ticker: data.ticker.toUpperCase().trim(),
      holding: data.holding.trim(),
      quantity: Number(data.quantity),
      price: Number(data.price),
      currency: data.currency,
      amount_gbp: amountGbp,
      cost_basis_gbp: null,
      notes: data.notes || "",
      fees_gbp: 0,
      is_locked: false,
      created_by: state.session.user.id,
      updated_by: state.session.user.id
    };
    await insertRow("portfolio_transactions", row, "add");
    setSaveMessage("equity", `${data.type === "buy" ? "Buy" : "Sell"} saved: ${row.ticker} ${money(amountGbp)} at ${shortUkTime()} UK.`);
    state.pendingCashConfirm = { owner: data.owner, account: data.account };
    form.reset();
    clearTransactionDraft("equity");
    await loadCloudLedger();
    renderAll();
  } catch (error) {
    setSaveMessage("equity", `Equity save failed: ${error.message}`, "error");
    renderTransaction(portfolio);
  } finally {
    state.busyForms.equity = false;
    setFormWorking(form, false);
  }
}

async function submitCashConfirmation(event, portfolio) {
  event.preventDefault();
  if (!state.pendingCashConfirm) return;
  const form = event.currentTarget;
  const target = Number(new FormData(form).get("cash_balance_gbp") || 0);
  const pending = state.pendingCashConfirm;
  const current = portfolio.cash.find((item) => item.owner === pending.owner && item.account === pending.account)?.amount || 0;
  const adjustment = target - current;
  if (Math.abs(adjustment) > 0.005) {
    await insertRow("portfolio_transactions", {
      date: todayIso(),
      type: adjustment >= 0 ? "deposit" : "withdrawal",
      owner: pending.owner,
      account: pending.account,
      ticker: "CASH",
      holding: "Cash",
      quantity: 0,
      price: 0,
      currency: "GBP",
      amount_gbp: Math.abs(adjustment),
      cost_basis_gbp: null,
      fees_gbp: 0,
      notes: "Cash balance confirmation adjustment",
      is_locked: false,
      created_by: state.session.user.id,
      updated_by: state.session.user.id
    }, "cash_reconcile");
  }
  state.pendingCashConfirm = null;
  setSaveMessage("cash", `Cash balance confirmed at ${shortUkTime()} UK.`);
  await loadCloudLedger();
  renderAll();
}

async function submitCash(event, portfolio) {
  event.preventDefault();
  if (state.busyForms.cash) return;
  state.busyForms.cash = true;
  const form = event.currentTarget;
  setFormWorking(form, true);
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const amountGbp = data.currency === "USD" ? Number(data.amount) / portfolio.fx : Number(data.amount);
    const row = {
      date: data.date,
      type: data.type,
      owner: data.owner,
      account: data.account,
      ticker: "CASH",
      holding: "Cash",
      quantity: 0,
      price: 0,
      currency: data.currency,
      amount_gbp: amountGbp,
      cost_basis_gbp: null,
      fees_gbp: 0,
      notes: data.notes || "",
      is_locked: false,
      created_by: state.session.user.id,
      updated_by: state.session.user.id
    };
    await insertRow("portfolio_transactions", row, "add");
    setSaveMessage("cash", `${data.type === "deposit" ? "Cash deposit" : "Cash withdrawal"} saved: ${money(amountGbp)} to ${data.account} at ${shortUkTime()} UK.`);
    form.reset();
    clearTransactionDraft("cash");
    await loadCloudLedger();
    renderAll();
  } catch (error) {
    setSaveMessage("cash", `Cash save failed: ${error.message}`, "error");
    renderTransaction(portfolio);
  } finally {
    state.busyForms.cash = false;
    setFormWorking(form, false);
  }
}

async function submitManual(event, portfolio) {
  event.preventDefault();
  if (state.busyForms.manual) return;
  state.busyForms.manual = true;
  const form = event.currentTarget;
  setFormWorking(form, true);
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const entered = Number(data.value);
    const valueGbp = data.currency === "USD" ? entered / portfolio.fx : entered;
    const currentGbp = data.kind === "crypto"
      ? Number(latestManualValueForAccount(data.account)?.value_gbp || 0)
      : Number(latestPensions().find((row) => row.name === data.account)?.value_gbp || 0);
    const differenceGbp = valueGbp - currentGbp;
    if (currentGbp && Math.abs(valueGbp - currentGbp) / currentGbp > 0.10) {
      const ok = confirm(`Just be aware this manual value changes by more than 10%. Current value is ${money(currentGbp)}. Save anyway?`);
      if (!ok) return;
    }
    if (data.kind === "crypto") {
      await insertRow("manual_values", {
        date: data.date,
        ticker: "Crypto",
        holding: "Crypto (Revolut)",
        owner: "Benji",
        account: "Benji - Revolut - Crypto",
        value_gbp: valueGbp,
        currency_entered: data.currency,
        value_entered: entered,
        notes: "Manual value entered in web app",
        created_by: state.session.user.id,
        updated_by: state.session.user.id
      }, "manual_update");
    } else {
      await insertRow("pension_values", {
        date: data.date,
        name: data.account,
        value_gbp: valueGbp,
        cost_gbp: latestPensions().find((row) => row.name === data.account)?.cost_gbp || null,
        created_by: state.session.user.id,
        updated_by: state.session.user.id
      }, "manual_update");
    }
    setSaveMessage("manual", `Manual value saved: ${money(valueGbp)} for ${data.account} at ${shortUkTime()} UK | Change ${moneySigned(differenceGbp)}.`);
    form.reset();
    clearTransactionDraft("manual");
    await loadCloudLedger();
    renderAll();
  } catch (error) {
    setSaveMessage("manual", `Manual value save failed: ${error.message}`, "error");
    renderTransaction(portfolio);
  } finally {
    state.busyForms.manual = false;
    setFormWorking(form, false);
  }
}

async function insertRow(tableName, row, action) {
  const { data, error } = await supabaseClient.from(tableName).insert(row).select().single();
  if (error) throw error;
  await writeAudit(action, tableName, data.id, null, data);
}

async function updateRowWithVersion(tableName, row, patch, action) {
  const next = { ...patch, version: Number(row.version || 1) + 1, updated_by: state.session.user.id, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseClient.from(tableName).update(next).eq("id", row.id).eq("version", row.version).select().single();
  if (error || !data) {
    alert(error?.message || "This entry changed after you opened it. Please refresh and review before saving.");
    return null;
  }
  await writeAudit(action, tableName, row.id, row, data);
  return data;
}

async function softDeleteRow(tableName, row, action) {
  const patch = {
    deleted_at: new Date().toISOString(),
    deleted_by: state.session.user.id,
    version: Number(row.version || 1) + 1,
    updated_by: state.session.user.id,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabaseClient.from(tableName).update(patch).eq("id", row.id).select().single();
  if (error || !data) {
    alert(`Delete failed: ${error?.message || "No row was updated."}`);
    return null;
  }
  await writeAudit(action, tableName, row.id, row, data);
  return data;
}

async function softDeleteTransaction(id, trigger) {
  const row = state.ledger.transactions.find((item) => item.id === id);
  if (!row || row.is_locked) return;
  if (!confirm("Are you sure you want to delete this ledger entry?")) return;
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = "Deleting...";
  }
  state.lastUndoneTransaction = row;
  const deleted = await softDeleteRow("portfolio_transactions", row, "soft_delete");
  if (!deleted) {
    if (trigger) {
      trigger.disabled = false;
      trigger.textContent = "Delete";
    }
    return;
  }
  setSaveMessage("ledger", `Deleted: ${row.ticker} ${row.type} ${money(row.amount_gbp)} at ${shortUkTime()} UK.`);
  await loadCloudLedger();
  renderAll();
}

async function undoLatestTransaction() {
  const row = [...activeRows(state.ledger.transactions)].reverse().find((item) => !item.is_locked);
  if (!row) return;
  state.lastUndoneTransaction = row;
  await softDeleteTransaction(row.id);
}

async function redoLatestTransaction() {
  if (!state.lastUndoneTransaction) return;
  const { id, deleted_at, deleted_by, created_at, updated_at, ...row } = state.lastUndoneTransaction;
  await insertRow("portfolio_transactions", { ...row, is_locked: false, created_by: state.session.user.id, updated_by: state.session.user.id }, "redo");
  state.lastUndoneTransaction = null;
  state.saveMessage = "Latest transaction restored.";
  state.saveArea = "cash";
  await loadCloudLedger();
  renderAll();
}

function downloadLedgerBackup() {
  const data = JSON.stringify(state.ledger, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `portfolio-ledger-backup-${todayIso()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function writeAudit(action, tableName, recordId, oldValue, newValue) {
  await supabaseClient.from("audit_log").insert({
    user_id: state.session.user.id,
    display_name: currentUserName(),
    action,
    table_name: tableName,
    record_id: recordId,
    old_value: oldValue,
    new_value: newValue
  });
}

function renderLedger() {
  const editCard = state.editingTransaction ? renderEditTransactionCard(state.editingTransaction) : "";
  const backupText = backupStatusText();
  const renderTransactionRow = (tx) => {
    const isCash = tx.type === "deposit" || tx.type === "withdrawal";
    const actionButtons = tx.is_locked || !isConfigured
      ? '<span class="subtle">Locked</span>'
      : `<div class="inline-row"><button class="secondary small" data-edit="${tx.id}">Edit</button><button class="danger small" data-delete="${tx.id}">Delete</button></div>`;
    const noteDetail = tx.notes ? `<details class="ledger-note-detail"><summary>Notes</summary><p>${escapeHtml(tx.notes)}</p></details>` : "";
    const actions = `<div class="ledger-action-stack">${actionButtons}${noteDetail}</div>`;
    return `
      <tr>
        <td>${displayDate(tx.date)}</td>
        <td>${displayDateTime(tx.updated_at || tx.created_at)}</td>
        <td>${escapeHtml(actorName(tx.created_by || tx.updated_by))}</td>
        <td>${escapeHtml(tx.type)}</td>
        <td>${escapeHtml(tx.owner)}</td>
        <td>${escapeHtml(tx.account)}</td>
        <td>${escapeHtml(tx.ticker)}</td>
        <td>${isCash ? "-" : Number(tx.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td>${isCash ? "-" : escapeHtml(tx.price)}</td>
        <td>${escapeHtml(tx.currency)}</td>
        <td>${money(tx.amount_gbp)}</td>
        <td>${actions}</td>
      </tr>
    `;
  };
  const renderValuationRow = (row) => `
    <tr class="valuation-row"><td>${displayDate(row.date)}</td><td>${displayDateTime(row.created_at)}</td><td>${escapeHtml(actorName(row.created_by || row.updated_by))}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.ticker)}</td><td>${row.quantity}</td><td>${row.price}</td><td>${escapeHtml(row.currency)}</td><td>${money(row.amount)}</td><td><span class="subtle">Audit</span></td></tr>
  `;
  const ledgerItems = [
    ...activeRows(state.ledger.transactions).map((row) => ({
      date: row.date,
      created_at: row.updated_at || row.created_at,
      html: renderTransactionRow(row)
    })),
    ...activeRows(state.ledger.manual_values).map((row) => ({
      date: row.date,
      created_at: row.updated_at || row.created_at,
      html: renderValuationRow({ date: row.date, created_at: row.updated_at || row.created_at, created_by: row.created_by, updated_by: row.updated_by, type: "manual valuation", owner: row.owner, account: row.account, ticker: row.ticker, quantity: "-", price: "-", amount: row.value_gbp, currency: row.currency_entered || "GBP" })
    })),
    ...activeRows(state.ledger.pensions).map((row) => ({
      date: row.date,
      created_at: row.updated_at || row.created_at,
      html: renderValuationRow({ date: row.date, created_at: row.updated_at || row.created_at, created_by: row.created_by, updated_by: row.updated_by, type: "pension valuation", owner: "Benji", account: row.name, ticker: "PENSION", quantity: "-", price: "-", amount: row.value_gbp, currency: "GBP" })
    }))
  ].sort((a, b) => {
    const dateDiff = dateValue(b.date) - dateValue(a.date);
    if (dateDiff) return dateDiff;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  const visibleRows = ledgerItems.slice(0, 5).map((item) => item.html).join("");
  const olderRows = ledgerItems.slice(5).map((item) => item.html).join("");
  const olderLedger = olderRows ? `
    <details class="ledger-history-detail">
      <summary>Older ledger entries (${ledgerItems.length - 5})</summary>
      <div class="table-shell"><table><thead><tr><th>Date</th><th>Timestamp</th><th>Entered by</th><th>Type</th><th>Owner</th><th>Account</th><th>Ticker</th><th>Qty</th><th>Price</th><th>Currency</th><th>Amount GBP</th><th>Actions</th></tr></thead><tbody>${olderRows}</tbody></table></div>
    </details>
  ` : "";
  el("ledgerView").innerHTML = `${editCard}<section class="card"><h2>Ledger</h2>${saveBanner("ledger")}<p class="subtle">Opening balances are locked to protect the imported baseline. New transactions can be edited or deleted here.</p><div class="button-row ledger-backup-row"><button id="downloadLedgerButton" class="secondary small">Download ledger backup</button><span class="backup-status">${escapeHtml(backupText)}</span></div><div class="table-shell"><table class="ledger-table"><thead><tr><th>Date</th><th>Timestamp</th><th>Entered by</th><th>Type</th><th>Owner</th><th>Account</th><th>Ticker</th><th>Qty</th><th>Price</th><th>Currency</th><th>Amount GBP</th><th>Actions</th></tr></thead><tbody>${visibleRows}</tbody></table></div>${olderLedger}</section>`;
  el("downloadLedgerButton")?.addEventListener("click", downloadLedgerBackup);
  el("ledgerView").querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    state.editingTransaction = state.ledger.transactions.find((item) => item.id === button.dataset.edit);
    renderLedger();
  }));
  el("ledgerView").querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => softDeleteTransaction(button.dataset.delete, button)));
  const editForm = el("editTransactionForm");
  if (editForm) editForm.addEventListener("submit", submitTransactionEdit);
  const cancel = el("cancelEditButton");
  if (cancel) cancel.addEventListener("click", () => {
    state.editingTransaction = null;
    renderLedger();
  });
}

function renderEditTransactionCard(tx) {
  const isCash = tx.type === "deposit" || tx.type === "withdrawal";
  return `
    <section class="card" style="margin-bottom:18px">
      <h2>Edit Ledger Entry</h2>
      <form id="editTransactionForm">
        <input type="hidden" name="id" value="${escapeHtml(tx.id)}">
        <input type="hidden" name="version" value="${escapeHtml(tx.version)}">
        <label>Date</label><input name="date" type="date" value="${escapeHtml(tx.date)}" required>
        <label>Owner</label><select name="owner">${displayNames.map((name) => `<option ${name === tx.owner ? "selected" : ""}>${name}</option>`).join("")}</select>
        <label>Account</label><input name="account" value="${escapeHtml(tx.account)}" required>
        <label>Type</label><select name="type">${["buy", "sell", "deposit", "withdrawal"].map((type) => `<option value="${type}" ${type === tx.type ? "selected" : ""}>${type}</option>`).join("")}</select>
        <label>Ticker</label><input name="ticker" value="${escapeHtml(tx.ticker)}" required>
        <label>Holding</label><input name="holding" value="${escapeHtml(tx.holding)}" required>
        <label>Quantity</label><input name="quantity" type="number" step="any" value="${isCash ? 0 : escapeHtml(tx.quantity)}">
        <label>Price</label><input name="price" type="number" step="any" value="${isCash ? 0 : escapeHtml(tx.price)}">
        <label>Amount GBP</label><input name="amount_gbp" type="number" step="any" value="${escapeHtml(tx.amount_gbp || 0)}">
        <label>Currency</label><select name="currency"><option ${tx.currency === "GBP" ? "selected" : ""}>GBP</option><option ${tx.currency === "USD" ? "selected" : ""}>USD</option></select>
        <label>Notes</label><textarea name="notes">${escapeHtml(tx.notes || "")}</textarea>
        <div class="button-row"><button>Save ledger entry</button><button type="button" id="cancelEditButton" class="secondary">Cancel</button></div>
      </form>
      <p class="footnote">If this entry has been changed by the other user since you opened it, the save will be rejected and you will be asked to refresh.</p>
    </section>
  `;
}

async function submitTransactionEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (state.busyForms.ledgerEdit) return;
  state.busyForms.ledgerEdit = true;
  setFormWorking(form, true);
  const data = Object.fromEntries(new FormData(form).entries());
  const row = state.ledger.transactions.find((item) => item.id === data.id);
  if (!row) {
    state.busyForms.ledgerEdit = false;
    setFormWorking(form, false);
    return;
  }
  const nextType = data.type;
  const nextAmount = Number(data.amount_gbp || 0);
  const nextQuantity = Number(data.quantity || 0);
  const nextPrice = Number(data.price || 0);
  if ((nextType === "deposit" || nextType === "withdrawal") && nextAmount <= 0) {
    alert("Cash transactions need an amount greater than zero.");
    state.busyForms.ledgerEdit = false;
    setFormWorking(form, false);
    return;
  }
  if ((nextType === "buy" || nextType === "sell") && (nextQuantity <= 0 || nextPrice <= 0 || nextAmount <= 0)) {
    alert("Equity transactions need quantity, price and amount greater than zero.");
    state.busyForms.ledgerEdit = false;
    setFormWorking(form, false);
    return;
  }
  const patch = {
    date: data.date,
    owner: data.owner,
    account: data.account,
    type: nextType,
    ticker: data.ticker.toUpperCase().trim(),
    holding: data.holding.trim(),
    quantity: nextQuantity,
    price: nextPrice,
    amount_gbp: nextAmount,
    cost_basis_gbp: null,
    currency: data.currency,
    notes: data.notes || ""
  };
  const saved = await updateRowWithVersion("portfolio_transactions", row, patch, "edit");
  if (saved) {
    state.editingTransaction = null;
    await loadCloudLedger();
    renderAll();
  } else {
    setFormWorking(form, false);
  }
  state.busyForms.ledgerEdit = false;
}

function reportSettings() {
  return (state.ledger.portfolio_report_settings || [])[0]?.data || {};
}

function telegramSettings() {
  return reportSettings().telegram || {};
}

function generateTelegramPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "PF-";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  state.telegramPairingCode = code;
  return code;
}

async function invokeReportFunction(action, body = {}) {
  const { data, error } = await supabaseClient.functions.invoke("portfolio-telegram-reports", {
    body: { action, ...body }
  });
  if (error) {
    if (typeof error.context?.json === "function") {
      try {
        const detail = await error.context.json();
        throw new Error(detail?.error || error.message || "Report action failed");
      } catch (detailError) {
        if (detailError?.message && detailError.message !== "Body is unusable") throw detailError;
      }
    }
    throw error;
  }
  if (data?.ok === false) throw new Error(data.error || "Report action failed");
  return data;
}

function renderReports() {
  const telegram = telegramSettings();
  const isLinked = Boolean(telegram.chat_id);
  const pairingCode = state.telegramPairingCode || "";
  const latestRun = (state.ledger.portfolio_report_runs || [])[0];
  const reportMessage = state.reportMessage
    ? `<div class="save-banner ${state.reportMessageTone === "error" ? "save-error" : state.reportMessageTone === "warning" ? "save-warning" : ""}">${escapeHtml(state.reportMessage)}</div>`
    : "";
  const setupNotice = state.reportSettingsAvailable
    ? ""
    : `<p class="notice">Report storage is not active yet. Apply the portfolio reports database update first.</p>`;
  const linkedText = isLinked
    ? `Linked to ${escapeHtml(telegram.chat_label || "Telegram")} ${telegram.username ? `(${escapeHtml(telegram.username)})` : ""}`
    : "Not linked yet";
  const enabledText = isLinked && telegram.enabled !== false ? "Enabled" : "Not enabled";
  const recentRuns = (state.ledger.portfolio_report_runs || []).slice(0, 5).map((row) => `
    <tr><td>${displayDateTime(row.created_at)}</td><td>${escapeHtml(row.report_type)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.error || row.message?.slice(0, 80) || "-")}</td></tr>
  `).join("");
  el("reportsView").innerHTML = `
    <section class="grid two">
      <div class="card report-card">
        <h2>Telegram Reports</h2>
        ${setupNotice}
        ${reportMessage}
        <div class="highlight-row"><span>Status</span><strong>${linkedText}</strong></div>
        <div class="highlight-row"><span>Delivery</span><strong>${enabledText}</strong></div>
        <p class="subtle">Reports are sent from Supabase, so the bot token stays server-side and the MacBook does not need to be on. Pairing will work once the portfolio Telegram bot token has been added as a Supabase secret.</p>
        <div class="button-row">
          <button id="generateTelegramCode" class="secondary">Generate pairing code</button>
          <button id="checkTelegramCode" ${pairingCode ? "" : "disabled"}>Check pairing</button>
          <button id="sendTelegramTest" class="secondary" ${isLinked ? "" : "disabled"}>Send test</button>
        </div>
        ${pairingCode ? `<div class="pairing-code"><span>Send this to the Telegram bot</span><strong>${escapeHtml(pairingCode)}</strong></div>` : ""}
      </div>
      <div class="card report-card">
        <h2>Send Test Report</h2>
        <p class="subtle">Weekly reports compare against the closest snapshot at least 7 days old. Monthly reports compare against the closest snapshot at least 30 days old. New holdings without a prior snapshot are listed separately and excluded from winners/losers.</p>
        <div class="button-row">
          <button id="sendWeeklyReport" ${isLinked ? "" : "disabled"}>Send weekly test</button>
          <button id="sendMonthlyReport" class="secondary" ${isLinked ? "" : "disabled"}>Send monthly test</button>
        </div>
        <p class="footnote">Schedule: weekly Monday 14:45 UK/Lisbon; monthly on the 1st at 14:45 UK/Lisbon. Monthly supersedes weekly when both fall on the same day.</p>
      </div>
    </section>
    <section class="card">
      <details class="history-detail">
        <summary>Report Activity</summary>
        <table><thead><tr><th>When</th><th>Type</th><th>Status</th><th>Detail</th></tr></thead><tbody>${recentRuns || `<tr><td colspan="4">No report activity yet.</td></tr>`}</tbody></table>
        <p class="footnote">${latestRun ? `Latest report activity: ${displayDateTime(latestRun.created_at)}.` : "No report has been sent from this app yet."}</p>
      </details>
    </section>
  `;
  wireReportButtons();
}

function wireReportButtons() {
  el("generateTelegramCode")?.addEventListener("click", () => {
    generateTelegramPairingCode();
    setReportMessage("Pairing code generated. Send it to the Telegram bot, then press Check pairing.", "success");
  });
  el("checkTelegramCode")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Checking...";
    try {
      const result = await invokeReportFunction("resolve_chat", { code: state.telegramPairingCode });
      if (result.status === "linked") {
        state.telegramPairingCode = "";
        await loadCloudLedger();
        setReportMessage(`Telegram linked to ${result.chat?.label || "your chat"}.`, "success");
      } else {
        setReportMessage("No matching Telegram message found yet. Send the code to the bot and try again.", "warning");
      }
    } catch (error) {
      setReportMessage(`Telegram pairing failed: ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Check pairing";
    }
  });
  el("sendTelegramTest")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Sending...";
    try {
      await invokeReportFunction("send_test");
      await loadCloudLedger();
      setReportMessage("Telegram test message sent.", "success");
    } catch (error) {
      setReportMessage(`Telegram test failed: ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Send test";
    }
  });
  el("sendWeeklyReport")?.addEventListener("click", () => sendReportTest("weekly"));
  el("sendMonthlyReport")?.addEventListener("click", () => sendReportTest("monthly"));
}

async function sendReportTest(reportType) {
  const button = reportType === "monthly" ? el("sendMonthlyReport") : el("sendWeeklyReport");
  button.disabled = true;
  button.textContent = reportType === "monthly" ? "Sending monthly..." : "Sending weekly...";
  try {
    await invokeReportFunction("send_report", { report_type: reportType });
    await loadCloudLedger();
    setReportMessage(`${reportType === "monthly" ? "Monthly" : "Weekly"} test report sent.`, "success");
  } catch (error) {
    setReportMessage(`Report send failed: ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = reportType === "monthly" ? "Send monthly test" : "Send weekly test";
  }
}

function renderAudit() {
  const rows = (state.ledger.audit_log || state.auditLog || []).slice(0, 100).map((row) => {
    const summary = auditSummary(row);
    return `
      <tr>
        <td>${displayDateTime(row.event_time || row.created_at || Date.now())}</td>
        <td>${escapeHtml(row.display_name || "")}</td>
        <td>${escapeHtml(auditActionLabel(row.action))}</td>
        <td>${escapeHtml(auditAreaLabel(row.table_name))}</td>
        <td>${escapeHtml(summary)}</td>
      </tr>
      <tr class="details-row audit-detail-row">
        <td colspan="5"><details><summary>View detail</summary><pre>${escapeHtml(JSON.stringify({ before: row.old_value, after: row.new_value }, null, 2))}</pre></details></td>
      </tr>
    `;
  }).join("");
  el("auditView").innerHTML = `<section class="card"><h2>Audit Log</h2><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Area</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function auditActionLabel(action) {
  return {
    add: "Added",
    edit: "Edited",
    soft_delete: "Deleted",
    manual_update: "Manual update",
    cash_reconcile: "Cash reconciled",
    broker_average_baseline: "Broker baseline",
    research_status_add: "Research status added",
    research_status_update: "Research status updated",
    holding_name_add: "Holding name added",
    holding_name_update: "Holding name updated",
    holding_name_reset: "Holding name reset",
    redo: "Restored",
    seed: "Imported"
  }[action] || action || "";
}

function auditAreaLabel(tableName) {
  return {
    portfolio_transactions: "Ledger",
    manual_values: "Manual values",
    pension_values: "Pension values",
    market_prices: "Market prices",
    net_worth_snapshots: "Net worth history",
    portfolio_value_snapshots: "Portfolio history",
    app_status: "App status",
    research_statuses: "Research status",
    holding_name_overrides: "Holding names",
    portfolio: "Portfolio"
  }[tableName] || tableName || "";
}

function auditSummary(row) {
  const next = row.new_value || {};
  const old = row.old_value || {};
  if (row.action === "broker_average_baseline") {
    return `${next.owner || ""} ${next.account || ""} ${next.ticker || ""}: ${old.price ?? "-"} ${old.currency || ""} to ${next.price ?? "-"} ${next.currency || ""}`.trim();
  }
  if (row.action === "cash_reconcile") {
    return `${next.owner || ""} ${next.account || ""}: cash adjusted by ${money(next.amount_gbp)}`.trim();
  }
  if (row.action === "edit") {
    const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(old[key]) && !["updated_at", "updated_by", "version"].includes(key));
    return changed.length ? `Changed ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? "..." : ""}` : "Edited";
  }
  if (row.action === "soft_delete") return `Deleted ${next.ticker || ""} ${next.type || ""}`.trim();
  if (row.table_name === "portfolio_transactions") {
    const quantity = next.quantity ? `${Number(next.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })} ` : "";
    return `${next.type || row.action} ${quantity}${next.ticker || ""} ${money(next.amount_gbp)}`.trim();
  }
  if (row.table_name === "manual_values") return `${next.account || "Manual value"} ${money(next.value_gbp)}`;
  if (row.table_name === "pension_values") return `${next.name || "Pension"} ${money(next.value_gbp)}`;
  if (row.table_name === "app_status") return `${next.key || "Status"} updated`;
  if (row.table_name === "research_statuses") return `${next.ticker || "Research"}: ${researchStatusMeta(next.status).label}`;
  if (row.table_name === "holding_name_overrides") return `${next.ticker || "Holding"}: ${next.display_name || "name reset"}`;
  return row.action || "";
}

function bindNavigation() {
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      showView(state.activeView);
    });
  });
  el("refreshCloudButton").addEventListener("click", async () => {
    if (state.marketMessageTimer) window.clearTimeout(state.marketMessageTimer);
    state.marketRefreshMessage = "";
    state.marketRefreshTone = "";
    state.telegramPairingCode = "";
    state.reportMessage = "";
    state.reportMessageTone = "";
    await loadCloudLedger();
    renderAll();
  });
}

function showView(view) {
  document.querySelectorAll(".view").forEach((section) => section.classList.add("hidden"));
  document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  el(`${view}View`).classList.remove("hidden");
}

function wireSortableTables() {
  document.querySelectorAll("table.sortable th[data-sort]").forEach((th) => {
    th.onclick = () => {
      const table = th.closest("table");
      const tbody = table.querySelector("tbody");
      const columnIndex = th.cellIndex;
      const rows = [...tbody.querySelectorAll("tr.holding-main-row, tr:not(.details-row):not(.holding-main-row)")].filter((row) => !row.classList.contains("details-row") && !row.classList.contains("total-row"));
      const totalRows = [...tbody.querySelectorAll("tr.total-row")];
      const detailRows = new Map([...tbody.querySelectorAll("tr.details-row")].map((row) => [row.dataset.parent, row]));
      const type = th.dataset.sort;
      const direction = th.dataset.direction === "asc" ? "desc" : "asc";
      table.querySelectorAll("th").forEach((header) => delete header.dataset.direction);
      th.dataset.direction = direction;
      rows.sort((a, b) => {
        const left = a.children[columnIndex]?.dataset.sortValue || a.children[columnIndex]?.innerText || "";
        const right = b.children[columnIndex]?.dataset.sortValue || b.children[columnIndex]?.innerText || "";
        const leftValue = type === "number" ? Number(left.replace(/[^0-9.-]/g, "")) : left.toLowerCase();
        const rightValue = type === "number" ? Number(right.replace(/[^0-9.-]/g, "")) : right.toLowerCase();
        if (leftValue < rightValue) return direction === "asc" ? -1 : 1;
        if (leftValue > rightValue) return direction === "asc" ? 1 : -1;
        return 0;
      });
      rows.forEach((row) => {
        tbody.appendChild(row);
        if (row.dataset.key && detailRows.has(row.dataset.key)) tbody.appendChild(detailRows.get(row.dataset.key));
      });
      totalRows.forEach((row) => tbody.appendChild(row));
    };
  });
}

function bindAuth() {
  el("signInButton").addEventListener("click", async () => {
    const email = el("emailInput").value.trim();
    const password = el("passwordInput").value;
    if (!email || !password) {
      el("authMessage").textContent = "Enter email and password.";
      return;
    }
    el("authMessage").textContent = "Checking sign-in...";
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      el("authMessage").textContent = error ? error.message : "Signed in. Loading...";
    } catch (error) {
      el("authMessage").textContent = `Sign-in failed: ${error.message}`;
    }
  });
  el("magicLinkButton").addEventListener("click", async () => {
    const email = el("emailInput").value.trim();
    if (!email) {
      el("authMessage").textContent = "Enter email first.";
      return;
    }
    el("authMessage").textContent = "Sending magic link...";
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo }
      });
      el("authMessage").textContent = error ? error.message : "Magic link sent.";
    } catch (error) {
      el("authMessage").textContent = `Magic link failed: ${error.message}`;
    }
  });
  el("signOutButton").addEventListener("click", async () => {
    state.saveMessage = "";
    state.saveArea = "";
    state.saveMessages = {};
    Object.values(state.saveTimers).forEach((timer) => window.clearTimeout(timer));
    state.saveTimers = {};
    state.busyForms = {};
    state.pendingCashConfirm = null;
    state.marketRefreshMessage = "";
    state.marketRefreshTone = "";
    if (state.marketMessageTimer) {
      window.clearTimeout(state.marketMessageTimer);
      state.marketMessageTimer = null;
    }
    state.initialPriceRefreshDone = false;
    if (state.autoRefreshTimer) {
      window.clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
    if (state.marketAgeTimer) {
      window.clearInterval(state.marketAgeTimer);
      state.marketAgeTimer = null;
    }
    if (supabaseClient) await supabaseClient.auth.signOut();
  });
}

function hideBootScreen() {
  const boot = el("bootScreen");
  if (boot) boot.classList.add("hidden");
}

init().catch((error) => {
  console.error(error);
  hideBootScreen();
  el("statusLine").textContent = `App error: ${error.message}`;
});
