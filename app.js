const config = window.PORTFOLIO_CONFIG || {};
const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.demoMode);
const supabaseClient = await createSupabaseClient();

const state = {
  session: null,
  member: null,
  ledger: { transactions: [], manual_values: [], pensions: [], audit_log: [], market_prices: [], net_worth_snapshots: [] },
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
  autoRefreshTimer: null,
  initialPriceRefreshDone: false,
  pendingCashConfirm: null,
  lastUndoneTransaction: null
};

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
  WXBT: "Bitcoin ETF",
  Crypto: "Crypto"
};

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
const rate = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `$${Number(value).toFixed(4)}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const priceStalenessMinutes = 30;
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

function statusBadge(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '<span class="badge neutral">Unknown</span>';
  if (value >= 0.10) return '<span class="badge green">Gain</span>';
  if (value < 0) return '<span class="badge red">Loss</span>';
  return '<span class="badge amber">Watch</span>';
}

function currentUserName() {
  return state.member?.display_name || "Demo";
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

function updateMarketDataSummary(portfolio) {
  const target = el("marketDataSummary");
  if (target) {
    target.textContent = state.marketRefreshMessage || marketFreshnessText(portfolio);
    target.classList.toggle("market-ok", state.marketRefreshTone === "success");
    target.classList.toggle("market-error", state.marketRefreshTone === "error" || (!state.marketRefreshMessage && marketRefreshIsOverHour(portfolio)));
  }
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

  for (const tx of activeRows(state.ledger.transactions)) {
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
      item.cost_basis_gbp += Number(cost || 0);
      if (tx.type === "opening" && tx.opening_value_gbp !== null && tx.opening_value_gbp !== undefined) {
        item.opening_value_gbp += Number(tx.opening_value_gbp || 0);
      }
      if (tx.type === "buy") {
        cashValue.amount -= Number(cost || 0);
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
  if (!marketRefreshIsStale(loadedPortfolio)) await ensureMonthlySnapshot(loadedPortfolio);
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
    fx: 1.3427
  };
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
}

async function loadCloudLedger() {
  const [tx, manual, pensions, audit, prices, snapshots] = await Promise.all([
    supabaseClient.from("portfolio_transactions").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("manual_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("pension_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("audit_log").select("*").order("event_time", { ascending: false }).limit(100),
    supabaseClient.from("market_prices").select("*").order("fetched_at", { ascending: false }),
    supabaseClient.from("net_worth_snapshots").select("*").order("snapshot_date", { ascending: false })
  ]);
  for (const result of [tx, manual, pensions, audit, prices]) {
    if (result.error) throw result.error;
  }
  const missingSnapshotTable = snapshots.error && ["42P01", "PGRST205"].includes(snapshots.error.code);
  if (snapshots.error && !missingSnapshotTable) throw snapshots.error;
  state.ledger = {
    transactions: tx.data || [],
    manual_values: manual.data || [],
    pensions: pensions.data || [],
    audit_log: audit.data || [],
    market_prices: prices.data || [],
    net_worth_snapshots: missingSnapshotTable ? [] : snapshots.data || [],
    fx: 1.3427
  };
  state.auditLog = audit.data || [];
  state.dirtyCloud = false;
  el("refreshCloudButton").classList.add("hidden");
}

function setupRealtime() {
  for (const channel of state.subscriptions) supabaseClient.removeChannel(channel);
  state.subscriptions = ["portfolio_transactions", "manual_values", "pension_values", "market_prices", "net_worth_snapshots"].map((tableName) => {
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
    el("statusLine").textContent = `Signed in as ${currentUserName()}`;
  }
  renderDashboard(portfolio);
  renderHoldings(portfolio);
  renderTransaction(portfolio);
  renderLedger(portfolio);
  renderAudit();
  showView(state.activeView);
  placePresenceInHeader();
  updateMarketDataSummary(portfolio);
  startAutoRefresh(portfolio);
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
  const topFiveRows = portfolio.combined.slice(0, 5).map((item) => `<tr><td>${escapeHtml(item.ticker)}</td><td>${escapeHtml(item.holding)}</td><td>${money(item.value_gbp)}</td><td>${pct(portfolio.accessibleTotal ? item.value_gbp / portfolio.accessibleTotal : 0)}</td></tr>`).join("");
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
    const holdingRows = data.holdings.map((item) => `<tr><td>${escapeHtml(item.ticker)}</td><td>${escapeHtml(item.holding)}</td><td>${money(item.value_gbp)}</td></tr>`).join("");
    return `<tr><td colspan="3"><details class="sector-detail"><summary><span>${sector}</span><span>${money(data.value)}</span><span>${pct(portfolio.accessibleTotal ? data.value / portfolio.accessibleTotal : 0)}</span></summary><table class="compact detail-table"><thead><tr><th>Ticker</th><th>Holding</th><th>Value</th></tr></thead><tbody>${holdingRows}</tbody></table></details></td></tr>`;
  }).join("");
  const winners = portfolio.combined.filter((item) => item.gain_pct > 0).sort((a, b) => b.gain_pct - a.gain_pct).slice(0, 10);
  const losers = portfolio.combined.filter((item) => item.gain_pct < 0).sort((a, b) => a.gain_pct - b.gain_pct).slice(0, 10);
  const performanceRows = (items, tone) => items.map((item) => `<tr><td>${escapeHtml(item.ticker)}</td><td>${escapeHtml(item.holding)}</td><td>${money(item.value_gbp)}</td><td><span class="${tone}">${pctSigned(item.gain_pct)}</span></td></tr>`).join("") || '<tr><td colspan="4">None</td></tr>';
  const historyRows = buildNetWorthHistory(portfolio).map((row) => `<tr><td>${displayDate(row.date)}</td><td>${money(row.net_worth_total)}</td><td>${money(row.accessible_total)}</td><td>${money(row.pension_total)}</td><td>${formatHistoryChange(row.change_1m)}</td><td>${formatHistoryChange(row.change_6m)}</td><td>${formatHistoryChange(row.change_12m)}</td></tr>`).join("");
  const topHoldingText = top ? `${escapeHtml(top.ticker)} · ${money(top.value_gbp)} · ${pct(portfolio.accessibleTotal ? top.value_gbp / portfolio.accessibleTotal : 0)}` : "-";
  const fxUpdated = refreshAgeText(portfolio.prices.get("GBPUSD=X")?.fetched_at);
  const fxFreshClass = fxUpdated === "more than an hour ago" ? " market-error" : fxUpdated === "not refreshed" ? "" : " market-ok";

  el("dashboardView").innerHTML = `
    <section class="grid two hero-metrics">
      <div class="card"><div class="subtle">Accessible portfolio</div><div class="metric">${money(portfolio.accessibleTotal)}</div><p class="subtle">Invested ${money(portfolio.totalPositions)} (${pct(investedPct)}) | Cash ${money(portfolio.totalCash)} (${pct(cashPct)})</p></div>
      <div class="card"><div class="subtle">Pension</div><div class="metric">${money(portfolio.pensionTotal)}</div>${pensionDetails}</div>
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
            <p class="footnote fx-freshness${fxFreshClass}">FX data refreshed ${fxUpdated}.</p>
            <p class="footnote">A stronger pound improves buying power when investing into US equities; a stronger dollar increases the sterling value of existing US holdings and is beneficial when selling back into pounds.</p>
          </details>
        </div>
      </div>
      <div class="card"><h2>Sector Exposure</h2><table><thead><tr><th colspan="3">Area / Value / Weight</th></tr></thead><tbody>${sectorRows}</tbody></table></div>
    </section>
    <section class="grid two">
      <div class="card gain-card"><h2>Top Gainers</h2><table><thead><tr><th>Ticker</th><th>Holding</th><th>Value</th><th>Since purchase</th></tr></thead><tbody>${performanceRows(winners, "gain-text")}</tbody></table><p class="footnote">Performance is measured since purchase.</p></div>
      <div class="card loss-card"><h2>Top Losers</h2><table><thead><tr><th>Ticker</th><th>Holding</th><th>Value</th><th>Since purchase</th></tr></thead><tbody>${performanceRows(losers, "loss-text")}</tbody></table><p class="footnote">Performance is measured since purchase. Only holdings currently showing a loss are listed.</p></div>
    </section>
    <section class="card"><details class="history-detail"><summary>Net Worth History</summary><table><thead><tr><th>Date</th><th>Headline</th><th>Accessible</th><th>Pension</th><th>1 month</th><th>6 months</th><th>12 months</th></tr></thead><tbody>${historyRows}</tbody></table><p class="footnote">${state.ledger.net_worth_snapshots?.length ? `${state.ledger.net_worth_snapshots.length} monthly snapshot saved.` : "No monthly snapshots yet."} The online app saves one snapshot per calendar month on first signed-in use.</p></details></section>
  `;
  bindRefreshButtons();
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

function renderHoldings(portfolio) {
  const rows = portfolio.combined.map((item) => {
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
    const detailRow = item.children.length > 1 ? `
      <tr class="details-row holding-detail-row hidden" data-parent="${detailKey}">
        <td colspan="9">
          <div class="owner-breakdown">
            <div class="owner-breakdown-head"><span>Owner</span><span>Account</span><span>Shares</span><span>Value</span><span>Gain/loss</span></div>
            ${childRows}
            <div class="owner-breakdown-row total"><span>${escapeHtml(item.ticker)} total</span><span></span><span>${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span><span>${money(item.value_gbp)}</span><span>${pctSigned(item.gain_pct)}</span></div>
          </div>
        </td>
      </tr>
    ` : "";
    return `
      <tr class="holding-main-row" data-key="${detailKey}">
        <td data-sort-value="${escapeHtml(item.ticker)}"><strong>${escapeHtml(item.ticker)}</strong></td>
        <td data-sort-value="${escapeHtml(item.holding)}">${escapeHtml(item.holding)}</td>
        <td data-sort-value="${escapeHtml(item.owner)}">${ownerCell}</td>
        <td data-sort-value="${escapeHtml(item.account)}">${escapeHtml(item.account)}</td>
        <td data-sort-value="${Number(item.quantity || 0)}">${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td data-sort-value="${Number(item.value_gbp || 0)}">${money(item.value_gbp)}</td>
        <td data-sort-value="${Number(item.gain_pct || 0)}">${pctSigned(item.gain_pct)}</td>
        <td data-sort-value="${escapeHtml(item.source || "-")}">${escapeHtml(item.source || "-")}</td>
        <td>${statusBadge(item.gain_pct)}</td>
      </tr>
      ${detailRow}
    `;
  }).join("");
  el("holdingsView").innerHTML = `<section class="card"><h2>Current Holdings <span class="subtle">${portfolio.combined.length} holdings</span></h2><div class="table-shell"><table class="sortable holdings-table"><colgroup><col class="col-ticker"><col class="col-holding"><col class="col-owner"><col class="col-account"><col class="col-shares"><col class="col-value"><col class="col-gain"><col class="col-source"><col class="col-status"></colgroup><thead><tr><th data-sort="text">Ticker</th><th data-sort="text">Holding</th><th data-sort="text">Owner</th><th data-sort="text">Account</th><th data-sort="number">Shares</th><th data-sort="number">Value</th><th data-sort="number">Gain/loss</th><th data-sort="text">Source</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><p class="footnote">Watch means the holding is currently up by less than 10% since purchase. Gain is 10% or more; Loss is below purchase cost.</p></section>`;
  wireHoldingDetails();
  wireSortableTables();
}

function wireHoldingDetails() {
  document.querySelectorAll(".owner-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const detail = document.querySelector(`[data-parent="${button.dataset.detail}"]`);
      if (!detail) return;
      const isOpen = !detail.classList.contains("hidden");
      detail.classList.toggle("hidden", isOpen);
      button.setAttribute("aria-expanded", String(!isOpen));
      const arrow = button.querySelector(".toggle-arrow");
      if (arrow) arrow.textContent = isOpen ? "▸" : "▾";
    });
  });
}

function bindRefreshButtons() {
  document.querySelectorAll(".refresh-prices-action").forEach((button) => {
    button.onclick = () => refreshMarketPrices();
  });
}

async function refreshMarketPrices(options = {}) {
  const buttons = [...document.querySelectorAll(".refresh-prices-action")];
  if (!supabaseClient || !state.session) return;
  if (state.marketRefreshing) return;
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
    const data = await Promise.race([invokePromise, timeoutPromise]);
    await loadCloudLedger();
    await ensureMonthlySnapshot(calculatePortfolio());
    const skipped = data?.skipped?.length ? ` ${data.skipped.length} skipped.` : "";
    if (!options.quiet) {
      setMarketRefreshMessage(`Market prices refreshed · ${marketFreshnessText(calculatePortfolio())}${skipped}`, "success", 15000);
      renderAll();
    }
  } catch (error) {
    if (!options.quiet) {
      setMarketRefreshMessage(`Market refresh failed: ${error.message} · ${marketFreshnessText(calculatePortfolio())}`, "error");
    }
  } finally {
    state.marketRefreshing = false;
    document.querySelectorAll(".refresh-prices-action").forEach((button) => {
      button.disabled = false;
    });
  }
}

function startAutoRefresh(portfolio) {
  if (!isConfigured || !state.session) return;
  if (!state.initialPriceRefreshDone && marketRefreshIsStale(portfolio)) {
    state.initialPriceRefreshDone = true;
    window.setTimeout(() => refreshMarketPrices({ auto: true }), 1200);
  }
  if (state.autoRefreshTimer) return;
  state.autoRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && state.session) {
      refreshMarketPrices({ auto: true });
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
        <div class="transaction-total">Current value: <strong id="manualCurrent">-</strong></div>
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
    account.innerHTML = (accountsByOwner[owner.value] || []).map((name) => `<option>${escapeHtml(name)}</option>`).join("");
  };
  owner.addEventListener("change", update);
  update();
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
  equityForm.addEventListener("submit", (event) => submitEquity(event, portfolio));
  cashForm.addEventListener("submit", (event) => submitCash(event, portfolio));
  setupManualForm(manualForm, portfolio);
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
    if (form.elements.kind.value === "crypto") {
      form.elements.account.innerHTML = '<option>Benji - Revolut - Crypto</option>';
      const current = latestManualValue("Crypto", "Benji", "Benji - Revolut - Crypto");
      const currentGbp = Number(current?.value_gbp || 0);
      el("manualCurrent").textContent = `${money(currentGbp)} / ${usd(currentGbp * portfolio.fx)}`;
    } else {
      form.elements.account.innerHTML = latestPensions().map((row) => `<option>${escapeHtml(row.name)}</option>`).join("");
      const row = latestPensions().find((p) => p.name === form.elements.account.value);
      el("manualCurrent").textContent = money(row?.value_gbp || 0);
    }
  };
  form.elements.kind.addEventListener("change", update);
  form.elements.account.addEventListener("change", update);
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
      cost_basis_gbp: data.type === "buy" ? amountGbp : null,
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
    if (currentGbp && Math.abs(valueGbp - currentGbp) / currentGbp > 0.10) {
      const ok = confirm(`Just be aware this manual value changes by more than 10%. Current value is ${money(currentGbp)}. Save anyway?`);
      if (!ok) return;
    }
    if (data.kind === "crypto") {
      await insertRow("manual_values", {
        date: data.date,
        ticker: "Crypto",
        holding: "Crypto",
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
    setSaveMessage("manual", `Manual value saved: ${money(valueGbp)} for ${data.account} at ${shortUkTime()} UK.`);
    form.reset();
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
        <td>${escapeHtml(tx.type)}</td>
        <td>${escapeHtml(tx.owner)}</td>
        <td>${escapeHtml(tx.account)}</td>
        <td>${escapeHtml(tx.ticker)}</td>
        <td>${isCash ? "-" : Number(tx.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td>${isCash ? "-" : escapeHtml(tx.price)}</td>
        <td>${money(tx.amount_gbp)}</td>
        <td>${escapeHtml(tx.currency)}</td>
        <td>${actions}</td>
      </tr>
    `;
  };
  const renderValuationRow = (row) => `
    <tr class="valuation-row"><td>${displayDate(row.date)}</td><td>${displayDateTime(row.created_at)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.ticker)}</td><td>${row.quantity}</td><td>${row.price}</td><td>${money(row.amount)}</td><td>${escapeHtml(row.currency)}</td><td><span class="subtle">Audit</span></td></tr>
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
      html: renderValuationRow({ date: row.date, created_at: row.updated_at || row.created_at, type: "manual valuation", owner: row.owner, account: row.account, ticker: row.ticker, quantity: "-", price: "-", amount: row.value_gbp, currency: row.currency_entered || "GBP" })
    })),
    ...activeRows(state.ledger.pensions).map((row) => ({
      date: row.date,
      created_at: row.updated_at || row.created_at,
      html: renderValuationRow({ date: row.date, created_at: row.updated_at || row.created_at, type: "pension valuation", owner: "Benji", account: row.name, ticker: "PENSION", quantity: "-", price: "-", amount: row.value_gbp, currency: "GBP" })
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
      <div class="table-shell"><table><thead><tr><th>Date</th><th>Timestamp</th><th>Type</th><th>Owner</th><th>Account</th><th>Ticker</th><th>Qty</th><th>Price</th><th>Amount</th><th>Currency</th><th>Actions</th></tr></thead><tbody>${olderRows}</tbody></table></div>
    </details>
  ` : "";
  el("ledgerView").innerHTML = `${editCard}<section class="card"><h2>Ledger</h2>${saveBanner("ledger")}<p class="subtle">Opening balances are locked to protect the imported baseline. New transactions can be edited or deleted here.</p><div class="button-row"><button id="downloadLedgerButton" class="secondary small">Download ledger backup</button></div><div class="table-shell"><table class="ledger-table"><thead><tr><th>Date</th><th>Timestamp</th><th>Type</th><th>Owner</th><th>Account</th><th>Ticker</th><th>Qty</th><th>Price</th><th>Amount</th><th>Currency</th><th>Actions</th></tr></thead><tbody>${visibleRows}</tbody></table></div>${olderLedger}</section>`;
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

function renderAudit() {
  const rows = (state.ledger.audit_log || state.auditLog || []).slice(0, 100).map((row) => {
    const summary = auditSummary(row);
    return `
      <tr>
        <td>${displayDateTime(row.event_time || row.created_at || Date.now())}</td>
        <td>${escapeHtml(row.display_name || "")}</td>
        <td>${escapeHtml(row.action)}</td>
        <td>${escapeHtml(row.table_name)}</td>
        <td>${escapeHtml(summary)}</td>
      </tr>
      <tr class="details-row audit-detail-row">
        <td colspan="5"><details><summary>View detail</summary><pre>${escapeHtml(JSON.stringify({ before: row.old_value, after: row.new_value }, null, 2))}</pre></details></td>
      </tr>
    `;
  }).join("");
  el("auditView").innerHTML = `<section class="card"><h2>Audit Log</h2><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Area</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function auditSummary(row) {
  const next = row.new_value || {};
  const old = row.old_value || {};
  if (row.action === "edit") {
    const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(old[key]) && !["updated_at", "updated_by", "version"].includes(key));
    return changed.length ? `Changed ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? "..." : ""}` : "Edited";
  }
  if (row.action === "soft_delete") return `Deleted ${next.ticker || ""} ${next.type || ""}`.trim();
  if (row.table_name === "portfolio_transactions") return `${next.type || row.action} ${next.ticker || ""} ${money(next.amount_gbp)}`.trim();
  if (row.table_name === "manual_values") return `${next.account || "Manual value"} ${money(next.value_gbp)}`;
  if (row.table_name === "pension_values") return `${next.name || "Pension"} ${money(next.value_gbp)}`;
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
  document.querySelectorAll("table.sortable th[data-sort]").forEach((th, index) => {
    th.addEventListener("click", () => {
      const table = th.closest("table");
      const tbody = table.querySelector("tbody");
      const rows = [...tbody.querySelectorAll("tr.holding-main-row, tr:not(.details-row):not(.holding-main-row)")].filter((row) => !row.classList.contains("details-row"));
      const detailRows = new Map([...tbody.querySelectorAll("tr.details-row")].map((row) => [row.dataset.parent, row]));
      const type = th.dataset.sort;
      const direction = th.dataset.direction === "asc" ? "desc" : "asc";
      table.querySelectorAll("th").forEach((header) => delete header.dataset.direction);
      th.dataset.direction = direction;
      rows.sort((a, b) => {
        const left = a.children[index]?.dataset.sortValue || a.children[index]?.innerText || "";
        const right = b.children[index]?.dataset.sortValue || b.children[index]?.innerText || "";
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
    });
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
