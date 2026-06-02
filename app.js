import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.PORTFOLIO_CONFIG || {};
const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.demoMode);
const supabaseClient = isConfigured ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null;

const state = {
  session: null,
  member: null,
  ledger: { transactions: [], manual_values: [], pensions: [], audit_log: [] },
  auditLog: [],
  activeView: "dashboard",
  dirtyCloud: false,
  subscriptions: [],
  presenceChannel: null,
  editingTransaction: null
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

const el = (id) => document.getElementById(id);
const money = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? "-" : `£${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const usd = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? "-" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${(Number(value) * 100).toFixed(1)}%`;
const pctSigned = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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

function calculatePortfolio() {
  const grouped = new Map();
  const cash = new Map();
  const fx = Number(state.ledger.fx || 1.3427);

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
      cost_basis_gbp: 0
    };
    const quantity = Number(tx.quantity || 0);
    if (tx.type === "opening" || tx.type === "buy") {
      item.quantity += quantity;
      const cost = tx.cost_basis_gbp ?? ((quantity * Number(tx.price || 0)) / (tx.currency === "USD" ? fx : 1));
      item.cost_basis_gbp += Number(cost || 0);
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
    } else if (item.opening_value_gbp) {
      valueGbp = Number(item.opening_value_gbp);
    }
    const gainGbp = valueGbp - Number(item.cost_basis_gbp || 0);
    const gainPct = item.cost_basis_gbp ? gainGbp / item.cost_basis_gbp : null;
    positions.push({ ...item, value_gbp: valueGbp, gain_gbp: gainGbp, gain_pct: gainPct });
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
    netWorthTotal: totalPositions + totalCash + pensionTotal
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
      children: []
    };
    item.quantity += Number(position.quantity || 0);
    item.value_gbp += Number(position.value_gbp || 0);
    item.cost_basis_gbp += Number(position.cost_basis_gbp || 0);
    item.gain_gbp += Number(position.gain_gbp || 0);
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
  el("authCard").classList.add("hidden");
  el("presencePanel").classList.remove("hidden");
  el("benjiPresence").textContent = "Benji demo";
  el("angiePresence").textContent = "Angie demo";
  el("statusLine").textContent = "Demo mode from local seed data. Configure Supabase for shared online access.";
}

function showAuth() {
  el("authCard").classList.remove("hidden");
  el("presencePanel").classList.add("hidden");
  el("statusLine").textContent = "Sign in to load the shared cloud portfolio.";
}

async function loadMember() {
  const userId = state.session.user.id;
  const { data, error } = await supabaseClient.from("app_members").select("*").eq("user_id", userId).single();
  if (error) throw error;
  state.member = data;
}

async function loadCloudLedger() {
  const [tx, manual, pensions, audit] = await Promise.all([
    supabaseClient.from("portfolio_transactions").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("manual_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("pension_values").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("audit_log").select("*").order("event_time", { ascending: false }).limit(100)
  ]);
  for (const result of [tx, manual, pensions, audit]) {
    if (result.error) throw result.error;
  }
  state.ledger = {
    transactions: tx.data || [],
    manual_values: manual.data || [],
    pensions: pensions.data || [],
    audit_log: audit.data || [],
    fx: 1.3427
  };
  state.auditLog = audit.data || [];
  state.dirtyCloud = false;
  el("refreshCloudButton").classList.add("hidden");
}

function setupRealtime() {
  for (const channel of state.subscriptions) supabaseClient.removeChannel(channel);
  state.subscriptions = ["portfolio_transactions", "manual_values", "pension_values"].map((tableName) => {
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
}

function renderDashboard(portfolio) {
  const top = portfolio.combined[0];
  const topFiveValue = portfolio.combined.slice(0, 5).reduce((sum, item) => sum + item.value_gbp, 0);
  const cashPct = portfolio.accessibleTotal ? portfolio.totalCash / portfolio.accessibleTotal : 0;
  const sectorRows = Object.entries(portfolio.combined.reduce((acc, item) => {
    const sector = sectorMap[item.ticker] || "Other";
    acc[sector] = (acc[sector] || 0) + item.value_gbp;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).map(([sector, value]) => `<tr><td>${sector}</td><td>${money(value)}</td><td>${pct(portfolio.accessibleTotal ? value / portfolio.accessibleTotal : 0)}</td></tr>`).join("");

  el("dashboardView").innerHTML = `
    <section class="grid">
      <div class="card"><div class="subtle">Accessible portfolio</div><div class="metric">${money(portfolio.accessibleTotal)}</div><p class="subtle">Invested ${money(portfolio.totalPositions)} / Cash ${money(portfolio.totalCash)} (${pct(cashPct)})</p></div>
      <div class="card"><div class="subtle">British Airways pension</div><div class="metric">${money(portfolio.pensionTotal)}</div><p class="subtle">${latestPensions().map((p) => `${escapeHtml(p.name)} ${money(p.value_gbp)}`).join("<br>")}</p></div>
      <div class="card"><div class="subtle">Top holding</div><div class="metric">${top ? escapeHtml(top.ticker) : "-"}</div><p class="subtle">${top ? `${money(top.value_gbp)} / ${pct(portfolio.accessibleTotal ? top.value_gbp / portfolio.accessibleTotal : 0)}` : "-"}</p></div>
    </section>
    <section class="grid two">
      <div class="card"><h2>Portfolio Highlights</h2><table><tbody>
        <tr><td>Top 5 concentration</td><td>${pct(portfolio.accessibleTotal ? topFiveValue / portfolio.accessibleTotal : 0)}</td></tr>
        <tr><td>Equal-weight guide</td><td>${pct(portfolio.combined.length ? 1 / portfolio.combined.length : 0)} across ${portfolio.combined.length} holdings</td></tr>
        <tr><td>FX guide</td><td>£1 = $${portfolio.fx.toFixed(4)}</td></tr>
      </tbody></table></div>
      <div class="card"><h2>Sector Exposure</h2><table><thead><tr><th>Area</th><th>Value</th><th>Weight</th></tr></thead><tbody>${sectorRows}</tbody></table></div>
    </section>
  `;
}

function renderHoldings(portfolio) {
  const rows = portfolio.combined.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.ticker)}</strong></td>
      <td>${escapeHtml(item.holding)}</td>
      <td>${escapeHtml(item.owner)}</td>
      <td>${escapeHtml(item.account)}</td>
      <td>${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
      <td>${money(item.value_gbp)}</td>
      <td>${pctSigned(item.gain_pct)}</td>
      <td>${statusBadge(item.gain_pct)}</td>
    </tr>
  `).join("");
  el("holdingsView").innerHTML = `<section class="card"><h2>Current Holdings <span class="subtle">${portfolio.combined.length} holdings</span></h2><table><thead><tr><th>Ticker</th><th>Holding</th><th>Owner</th><th>Account</th><th>Shares</th><th>Value</th><th>Gain/loss</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderTransaction(portfolio) {
  const disabled = !isConfigured ? "disabled" : "";
  const note = !isConfigured ? '<p class="notice">Demo mode is view-only. Configure Supabase to enable shared edits.</p>' : "";
  el("transactionView").innerHTML = `
    ${note}
    <section class="grid two">
      <div class="card">
        <h2>Buy / Sell Equity</h2>
        <form id="equityForm">
          <label>Date</label><input name="date" type="date" value="${todayIso()}" required ${disabled}>
          <label>Owner</label>${ownerSelect(disabled)}
          <label>Account</label><select name="account" required ${disabled}></select>
          <label>Action</label><select name="type" ${disabled}><option value="buy">Buy</option><option value="sell">Sell</option></select>
          <label>Ticker</label><input name="ticker" required ${disabled}>
          <label>Holding name</label><input name="holding" required ${disabled}>
          <label>Quantity of shares</label><input name="quantity" type="number" step="any" required ${disabled}>
          <label>Price per share</label><input name="price" type="number" step="any" required ${disabled}>
          <label>Currency</label><select name="currency" ${disabled}><option>USD</option><option>GBP</option></select>
          <label>Notes</label><textarea name="notes" ${disabled}></textarea>
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
  equityForm.addEventListener("submit", (event) => submitEquity(event, portfolio));
  cashForm.addEventListener("submit", (event) => submitCash(event, portfolio));
  setupManualForm(manualForm, portfolio);
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
  form.reset();
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
  await updateRowWithVersion("portfolio_transactions", row, { deleted_at: new Date().toISOString(), deleted_by: state.session.user.id }, "soft_delete");
  await loadCloudLedger();
  renderAll();
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
  const rows = [...state.ledger.transactions].reverse().map((tx) => {
    const isCash = tx.type === "deposit" || tx.type === "withdrawal";
    const actions = tx.is_locked || !isConfigured
      ? '<span class="subtle">Locked</span>'
      : `<div class="inline-row"><button class="secondary small" data-edit="${tx.id}">Edit</button><button class="danger small" data-delete="${tx.id}">Delete</button></div>`;
    return `
      <tr class="${tx.deleted_at ? "deleted" : ""}">
        <td>${escapeHtml(tx.date)}</td>
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
  el("ledgerView").innerHTML = `${editCard}<section class="card"><h2>Ledger</h2><table><thead><tr><th>Date</th><th>Type</th><th>Owner</th><th>Account</th><th>Ticker</th><th>Qty</th><th>Price</th><th>Amount</th><th>Currency</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></section>`;
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

function bindAuth() {
  el("signInButton").addEventListener("click", async () => {
    const email = el("emailInput").value.trim();
    const password = el("passwordInput").value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    el("authMessage").textContent = error ? error.message : "Signed in.";
  });
  el("magicLinkButton").addEventListener("click", async () => {
    const email = el("emailInput").value.trim();
    const { error } = await supabaseClient.auth.signInWithOtp({ email });
    el("authMessage").textContent = error ? error.message : "Magic link sent.";
  });
  el("signOutButton").addEventListener("click", async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
  });
}

init().catch((error) => {
  console.error(error);
  el("statusLine").textContent = `App error: ${error.message}`;
});
