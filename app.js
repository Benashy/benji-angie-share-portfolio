const config = window.PORTFOLIO_CONFIG || {};
const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.demoMode);
const supabaseClient = await createSupabaseClient();

const state = {
  session: null,
  member: null,
  ledger: { transactions: [], manual_values: [], pensions: [], audit_log: [], market_prices: [] },
  auditLog: [],
  activeView: "dashboard",
  dirtyCloud: false,
  subscriptions: [],
  presenceChannel: null,
  editingTransaction: null,
  saveMessage: "",
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
const usd = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? "-" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${(Number(value) * 100).toFixed(1)}%`;
const pctSigned = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;
const todayIso = () => new Date().toISOString().slice(0, 10);
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
  const [tx, manual, pensions, audit, prices] = await Promise.all([
    supabaseClient.from("portfolio_transactions").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("manual_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("pension_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("audit_log").select("*").order("event_time", { ascending: false }).limit(100),
    supabaseClient.from("market_prices").select("*").order("fetched_at", { ascending: false })
  ]);
  for (const result of [tx, manual, pensions, audit, prices]) {
    if (result.error) throw result.error;
  }
  state.ledger = {
    transactions: tx.data || [],
    manual_values: manual.data || [],
    pensions: pensions.data || [],
    audit_log: audit.data || [],
    market_prices: prices.data || [],
    fx: 1.3427
  };
  state.auditLog = audit.data || [];
  state.dirtyCloud = false;
  el("refreshCloudButton").classList.add("hidden");
}

function setupRealtime() {
  for (const channel of state.subscriptions) supabaseClient.removeChannel(channel);
  state.subscriptions = ["portfolio_transactions", "manual_values", "pension_values", "market_prices"].map((tableName) => {
    const channel = supabaseClient.channel(`changes:${tableName}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: tableName },
      (payload) => {
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
    el("benjiPresence").textContent = `Benji ${names.includes("Benji") ? "online" : "offline"}`;
    el("angiePresence").textContent = `Angie ${names.includes("Angie") ? "online" : "offline"}`;
  });
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") await channel.track({ display_name: currentUserName(), online_at: new Date().toISOString() });
  });
  state.presenceChannel = channel;
  el("presencePanel").classList.remove("hidden");
}

function renderAll() {
  hideBootScreen();
  document.body.classList.remove("auth-only");
  document.title = "Benji and Angie's Investment Portfolio";
  el("authCard").classList.add("hidden");
  const portfolio = calculatePortfolio();
  el("headlineNetWorth").textContent = money(portfolio.netWorthTotal);
  if (isConfigured && state.session) {
    el("statusLine").textContent = `Signed in as ${currentUserName()} · Shared cloud portfolio · ${new Date().toLocaleString()}`;
  }
  renderDashboard(portfolio);
  renderHoldings(portfolio);
  renderTransaction(portfolio);
  renderLedger(portfolio);
  renderAudit();
  showView(state.activeView);
  placePresenceInHeader();
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
    ? `<details><summary>View pension lines</summary><table class="compact"><thead><tr><th>Pension</th><th>Date</th><th>Value</th></tr></thead><tbody>${pensionRows}<tr class="total-row"><td colspan="2">British Airways pension total</td><td>${money(portfolio.pensionTotal)}</td></tr></tbody></table></details>`
    : '<p class="subtle">No pension values loaded.</p>';
  const topFiveRows = portfolio.combined.slice(0, 5).map((item) => `<tr><td>${escapeHtml(item.ticker)}</td><td>${money(item.value_gbp)}</td><td>${pct(portfolio.accessibleTotal ? item.value_gbp / portfolio.accessibleTotal : 0)}</td></tr>`).join("");
  const cashRows = portfolio.cash.map((item) => `<tr><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.account)}</td><td>${money(item.amount)}</td></tr>`).join("");
  const newestPrice = [...portfolio.prices.values()]
    .filter((row) => row.ticker !== "GBPUSD=X" && row.fetched_at)
    .sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at))[0];
  const priceStatus = newestPrice
    ? `Prices refreshed ${new Date(newestPrice.fetched_at).toLocaleString(undefined, { hour12: false })}`
    : "Market prices not refreshed yet";
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
    return `<tr><td colspan="3"><details class="sector-detail"><summary><span>${sector}</span><span>${money(data.value)}</span><span>${pct(portfolio.accessibleTotal ? data.value / portfolio.accessibleTotal : 0)}</span></summary><table class="compact"><tbody>${holdingRows}</tbody></table></details></td></tr>`;
  }).join("");
  const winners = portfolio.combined.filter((item) => item.gain_pct > 0).sort((a, b) => b.gain_pct - a.gain_pct).slice(0, 10);
  const losers = portfolio.combined.filter((item) => item.gain_pct < 0).sort((a, b) => a.gain_pct - b.gain_pct).slice(0, 10);
  const performanceRows = (items) => items.map((item) => `<tr><td>${escapeHtml(item.ticker)}</td><td>${escapeHtml(item.holding)}</td><td>${money(item.value_gbp)}</td><td>${pctSigned(item.gain_pct)}</td></tr>`).join("") || '<tr><td colspan="4">None</td></tr>';
  const historyRows = buildNetWorthHistory(portfolio).map((row) => `<tr><td>${displayDate(row.date)}</td><td>${money(row.net_worth_total)}</td><td>${money(row.accessible_total)}</td><td>${money(row.pension_total)}</td></tr>`).join("");

  el("dashboardView").innerHTML = `
    <section class="grid">
      <div class="card"><div class="subtle">Accessible portfolio</div><div class="metric">${money(portfolio.accessibleTotal)}</div><p class="subtle">Invested ${money(portfolio.totalPositions)} (${pct(investedPct)}) / Cash ${money(portfolio.totalCash)} (${pct(cashPct)})</p></div>
      <div class="card"><div class="subtle">British Airways pension</div><div class="metric">${money(portfolio.pensionTotal)}</div>${pensionDetails}</div>
      <div class="card"><div class="subtle">Top holding</div><div class="metric">${top ? escapeHtml(top.ticker) : "-"}</div><p class="subtle">${top ? `${money(top.value_gbp)} / ${pct(portfolio.accessibleTotal ? top.value_gbp / portfolio.accessibleTotal : 0)}` : "-"}</p></div>
    </section>
    <section class="grid two">
      <div class="card"><h2>Portfolio Highlights</h2><table><tbody>
        <tr><td colspan="2"><details><summary><span>Top 5 concentration</span><span>${pct(portfolio.accessibleTotal ? topFiveValue / portfolio.accessibleTotal : 0)}</span></summary><table class="compact"><tbody>${topFiveRows}</tbody></table></details></td></tr>
        <tr><td>Equal-weight guide</td><td>${pct(portfolio.combined.length ? 1 / portfolio.combined.length : 0)} across ${portfolio.combined.length} holdings</td></tr>
        <tr><td colspan="2"><details><summary><span>Cash</span><span>${money(portfolio.totalCash)} (${pct(cashPct)})</span></summary><table class="compact"><tbody>${cashRows}<tr class="total-row"><td colspan="2">Cash total</td><td>${money(portfolio.totalCash)}</td></tr></tbody></table></details></td></tr>
        <tr><td colspan="2"><details><summary><span>FX guide</span><span>£1 = $${portfolio.fx.toFixed(4)}</span></summary><table class="compact"><thead><tr><th>Period</th><th>Rate then</th><th>Change</th></tr></thead><tbody>${fxRows}</tbody></table></details></td></tr>
      </tbody></table>
      </div>
      <div class="card"><h2>Sector Exposure</h2><table><thead><tr><th colspan="3">Area / Value / Weight</th></tr></thead><tbody>${sectorRows}</tbody></table></div>
    </section>
    <section class="card market-card">
      <div>
        <h2>Market Data</h2>
        <p id="priceRefreshStatus" class="subtle">${priceStatus}</p>
      </div>
      <button id="refreshPricesButton" class="secondary small">Refresh market prices</button>
    </section>
    <section class="grid two">
      <div class="card gain-card"><h2>Top Gainers</h2><table><thead><tr><th>Ticker</th><th>Holding</th><th>Value</th><th>Since purchase</th></tr></thead><tbody>${performanceRows(winners)}</tbody></table><p class="footnote">Performance is measured since purchase using the ledger cost basis.</p></div>
      <div class="card loss-card"><h2>Top Losers</h2><table><thead><tr><th>Ticker</th><th>Holding</th><th>Value</th><th>Since purchase</th></tr></thead><tbody>${performanceRows(losers)}</tbody></table><p class="footnote">Only holdings currently showing a loss are listed.</p></div>
    </section>
    <section class="card"><h2>Net Worth History</h2><table><thead><tr><th>Date</th><th>Headline</th><th>Accessible</th><th>Pension</th></tr></thead><tbody>${historyRows}</tbody></table><p class="footnote">Online history currently records the latest cloud snapshot; scheduled monthly snapshots can be added next.</p></section>
  `;
  const refreshButton = el("refreshPricesButton");
  if (refreshButton) refreshButton.addEventListener("click", refreshMarketPrices);
}

function buildNetWorthHistory(portfolio) {
  return [{
    date: todayIso(),
    net_worth_total: portfolio.netWorthTotal,
    accessible_total: portfolio.accessibleTotal,
    pension_total: portfolio.pensionTotal
  }];
}

function renderHoldings(portfolio) {
  const rows = portfolio.combined.map((item) => {
    const childRows = item.children.map((child) => `<tr class="child-row"><td></td><td>${escapeHtml(child.holding)}</td><td>${escapeHtml(child.owner)}</td><td>${escapeHtml(child.account)}</td><td>${Number(child.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td>${money(child.value_gbp)}</td><td>${pctSigned(child.gain_pct)}</td><td>${escapeHtml(child.source || "-")}</td><td></td></tr>`).join("");
    const ownerCell = item.children.length > 1 ? `<details class="owner-detail"><summary>${escapeHtml(item.owner)}</summary><table class="compact"><tbody>${childRows}<tr class="total-row"><td colspan="4">${escapeHtml(item.ticker)} total</td><td>${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td>${money(item.value_gbp)}</td><td>${pctSigned(item.gain_pct)}</td><td colspan="2"></td></tr></tbody></table></details>` : escapeHtml(item.owner);
    return `
      <tr>
        <td><strong>${escapeHtml(item.ticker)}</strong></td>
        <td>${escapeHtml(item.holding)}</td>
        <td>${ownerCell}</td>
        <td>${escapeHtml(item.account)}</td>
        <td>${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td>${money(item.value_gbp)}</td>
        <td>${pctSigned(item.gain_pct)}</td>
        <td>${escapeHtml(item.source || "-")}</td>
        <td>${statusBadge(item.gain_pct)}</td>
      </tr>
    `;
  }).join("");
  el("holdingsView").innerHTML = `<section class="card"><h2>Current Holdings <span class="subtle">${portfolio.combined.length} holdings</span></h2><table class="sortable"><thead><tr><th data-sort="text">Ticker</th><th data-sort="text">Holding</th><th data-sort="text">Owner</th><th data-sort="text">Account</th><th data-sort="number">Shares</th><th data-sort="number">Value</th><th data-sort="number">Gain/loss</th><th data-sort="text">Source</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><p class="footnote">Watch means the holding is currently up by less than 10% since purchase. Gain is 10% or more; Loss is below purchase cost.</p></section>`;
  wireSortableTables();
}

async function refreshMarketPrices() {
  const status = el("priceRefreshStatus");
  const button = el("refreshPricesButton");
  if (!supabaseClient || !state.session) return;
  if (status) status.textContent = "Refreshing market prices...";
  if (button) button.disabled = true;
  try {
    const invokePromise = fetch(`${config.supabaseUrl}/functions/v1/refresh-prices`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${state.session.access_token}`,
        "apikey": config.supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: "{}"
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
    renderAll();
    const refreshed = data?.updated ?? 0;
    const skipped = data?.skipped?.length ? ` ${data.skipped.length} skipped.` : "";
    const nextStatus = el("priceRefreshStatus");
    if (nextStatus) nextStatus.textContent = `Market prices refreshed. ${refreshed} updated.${skipped}`;
  } catch (error) {
    const nextStatus = el("priceRefreshStatus");
    if (nextStatus) nextStatus.textContent = `Market refresh failed: ${error.message}`;
  } finally {
    const nextButton = el("refreshPricesButton");
    if (nextButton) nextButton.disabled = false;
  }
}

function renderTransaction(portfolio) {
  const disabled = !isConfigured ? "disabled" : "";
  const note = !isConfigured ? '<p class="notice">Demo mode is view-only. Configure Supabase to enable shared edits.</p>' : "";
  const saved = state.saveMessage ? `<div class="save-banner">${escapeHtml(state.saveMessage)}</div>` : "";
  const cashConfirm = state.pendingCashConfirm ? renderCashConfirm(portfolio) : "";
  el("transactionView").innerHTML = `
    ${note}
    ${saved}
    ${cashConfirm}
    <section class="grid two">
      <div class="card">
        <h2>Buy / Sell Equity</h2>
        <form id="equityForm">
          <label>Date</label><input name="date" type="date" value="${todayIso()}" required ${disabled}>
          <label>Owner</label>${ownerSelect(disabled)}
          <label>Account</label><select name="account" required ${disabled}></select>
          <label>Action</label><select name="type" ${disabled}><option value="buy">Buy</option><option value="sell">Sell</option></select>
          <label>Ticker</label><div class="lookup-row"><input name="ticker" class="ticker-input" required ${disabled}><button type="button" class="lookup-button" ${disabled}>Check</button></div><div class="lookup-status"></div>
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
    state.saveMessage = "Cash confirmation skipped.";
    renderAll();
  });
}

function wireTickerLookup(form, portfolio) {
  const input = form.elements.ticker;
  const holding = form.elements.holding;
  const status = form.querySelector(".lookup-status");
  const update = () => {
    const ticker = input.value.trim().toUpperCase();
    if (!ticker) return;
    const quote = portfolio.prices.get(ticker);
    const name = holdingNameMap[ticker] || quote?.yahoo_symbol || ticker;
    if (!holding.value || holding.value === holdingNameMap[input.dataset.lastTicker]) holding.value = name;
    input.dataset.lastTicker = ticker;
    status.textContent = quote
      ? `Checked: ${name} at ${quote.currency} ${Number(quote.price).toLocaleString(undefined, { maximumFractionDigits: 4 })}`
      : `Auto-filled ${name}. Refresh market prices if this is a new ticker.`;
    status.className = quote ? "lookup-status ok" : "lookup-status warn";
  };
  input.addEventListener("blur", update);
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
  const form = event.currentTarget;
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
  state.saveMessage = "Equity transaction added. Your accounts have been updated.";
  state.pendingCashConfirm = { owner: data.owner, account: data.account };
  form.reset();
  await loadCloudLedger();
  renderAll();
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
  state.saveMessage = "Cash balance confirmed.";
  await loadCloudLedger();
  renderAll();
}

async function submitCash(event, portfolio) {
  event.preventDefault();
  const form = event.currentTarget;
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
  state.saveMessage = "Cash transaction added. Your accounts have been updated.";
  form.reset();
  await loadCloudLedger();
  renderAll();
}

async function submitManual(event, portfolio) {
  event.preventDefault();
  const form = event.currentTarget;
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
  state.saveMessage = "Manual value saved. Your accounts have been updated.";
  form.reset();
  await loadCloudLedger();
  renderAll();
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
    alert("This entry changed after you opened it. Please refresh and review before saving.");
    return null;
  }
  await writeAudit(action, tableName, row.id, row, data);
  return data;
}

async function softDeleteTransaction(id) {
  const row = state.ledger.transactions.find((item) => item.id === id);
  if (!row || row.is_locked) return;
  state.lastUndoneTransaction = row;
  await updateRowWithVersion("portfolio_transactions", row, { deleted_at: new Date().toISOString(), deleted_by: state.session.user.id }, "soft_delete");
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
  const transactionRows = [...state.ledger.transactions].sort((a, b) => {
    const dateDiff = dateValue(b.date) - dateValue(a.date);
    if (dateDiff) return dateDiff;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  }).map((tx) => {
    const isCash = tx.type === "deposit" || tx.type === "withdrawal";
    const actions = tx.is_locked || !isConfigured
      ? '<span class="subtle">Locked</span>'
      : `<div class="inline-row"><button class="secondary small" data-edit="${tx.id}">Edit</button><button class="danger small" data-delete="${tx.id}">Delete</button></div>`;
    return `
      <tr class="${tx.deleted_at ? "deleted" : ""}">
        <td>${displayDate(tx.date)}</td>
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
  }).join("");
  const manualRows = [
    ...activeRows(state.ledger.manual_values).map((row) => ({ date: row.date, type: "manual valuation", owner: row.owner, account: row.account, ticker: row.ticker, quantity: "-", price: "-", amount: row.value_gbp, currency: row.currency_entered || "GBP" })),
    ...activeRows(state.ledger.pensions).map((row) => ({ date: row.date, type: "pension valuation", owner: "Benji", account: row.name, ticker: "PENSION", quantity: "-", price: "-", amount: row.value_gbp, currency: "GBP" }))
  ].sort((a, b) => dateValue(b.date) - dateValue(a.date)).map((row) => `
    <tr class="valuation-row"><td>${displayDate(row.date)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.ticker)}</td><td>${row.quantity}</td><td>${row.price}</td><td>${money(row.amount)}</td><td>${escapeHtml(row.currency)}</td><td><span class="subtle">Audit</span></td></tr>
  `).join("");
  el("ledgerView").innerHTML = `${editCard}<section class="card"><h2>Ledger</h2><p class="subtle">Opening balances are locked to protect the imported baseline. New transactions can be edited or deleted here.</p><div class="button-row"><button id="downloadLedgerButton" class="secondary small">Download ledger backup</button><button id="undoLatestButton" class="secondary small">Undo latest transaction</button><button id="redoLatestButton" class="secondary small">Redo latest transaction</button></div><table style="margin-top:12px"><thead><tr><th>Date</th><th>Type</th><th>Owner</th><th>Account</th><th>Ticker</th><th>Qty</th><th>Price</th><th>Amount</th><th>Currency</th><th>Actions</th></tr></thead><tbody>${transactionRows}${manualRows}</tbody></table></section>`;
  el("downloadLedgerButton")?.addEventListener("click", downloadLedgerBackup);
  el("undoLatestButton")?.addEventListener("click", undoLatestTransaction);
  el("redoLatestButton")?.addEventListener("click", redoLatestTransaction);
  el("ledgerView").querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    state.editingTransaction = state.ledger.transactions.find((item) => item.id === button.dataset.edit);
    renderLedger();
  }));
  el("ledgerView").querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => softDeleteTransaction(button.dataset.delete)));
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
  const data = Object.fromEntries(new FormData(form).entries());
  const row = state.ledger.transactions.find((item) => item.id === data.id);
  if (!row) return;
  const patch = {
    date: data.date,
    owner: data.owner,
    account: data.account,
    type: data.type,
    ticker: data.ticker.toUpperCase().trim(),
    holding: data.holding.trim(),
    quantity: Number(data.quantity || 0),
    price: Number(data.price || 0),
    amount_gbp: Number(data.amount_gbp || 0),
    currency: data.currency,
    notes: data.notes || ""
  };
  const saved = await updateRowWithVersion("portfolio_transactions", row, patch, "edit");
  if (saved) {
    state.editingTransaction = null;
    await loadCloudLedger();
    renderAll();
  }
}

function renderAudit() {
  const rows = (state.ledger.audit_log || state.auditLog || []).slice(0, 100).map((row) => `
    <tr><td>${new Date(row.event_time || row.created_at || Date.now()).toLocaleString()}</td><td>${escapeHtml(row.display_name || "")}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.table_name)}</td></tr>
  `).join("");
  el("auditView").innerHTML = `<section class="card"><h2>Audit Log</h2><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Area</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function bindNavigation() {
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      showView(state.activeView);
    });
  });
  el("refreshCloudButton").addEventListener("click", async () => {
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
      const rows = [...tbody.querySelectorAll("tr")].filter((row) => !row.classList.contains("details-row"));
      const type = th.dataset.sort;
      const direction = th.dataset.direction === "asc" ? "desc" : "asc";
      table.querySelectorAll("th").forEach((header) => delete header.dataset.direction);
      th.dataset.direction = direction;
      rows.sort((a, b) => {
        const left = a.children[index]?.innerText || "";
        const right = b.children[index]?.innerText || "";
        const leftValue = type === "number" ? Number(left.replace(/[^0-9.-]/g, "")) : left.toLowerCase();
        const rightValue = type === "number" ? Number(right.replace(/[^0-9.-]/g, "")) : right.toLowerCase();
        if (leftValue < rightValue) return direction === "asc" ? -1 : 1;
        if (leftValue > rightValue) return direction === "asc" ? 1 : -1;
        return 0;
      });
      rows.forEach((row) => tbody.appendChild(row));
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
    state.pendingCashConfirm = null;
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
