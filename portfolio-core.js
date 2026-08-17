const EPSILON = 1e-8;

export function activeRows(rows = []) {
  return rows.filter((row) => !row.deleted_at);
}

export function transactionDateValue(value) {
  const raw = String(value || "").trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = raw.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{2}|\d{4})$/);
  if (match) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return Date.UTC(year, Number(match[2]) - 1, Number(match[1]));
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function openingRank(type) {
  return type === "opening" ? 0 : 1;
}

export function orderedTransactions(rows = []) {
  return [...rows].sort((a, b) =>
    transactionDateValue(a.date) - transactionDateValue(b.date)
    || openingRank(a.type) - openingRank(b.type)
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.id || a.client_request_id || "").localeCompare(String(b.id || b.client_request_id || ""))
  );
}

export function validateTransactionInput(row) {
  const errors = [];
  const type = String(row.type || "");
  const quantity = Number(row.quantity);
  const price = Number(row.price);
  const amount = Number(row.amount_gbp);
  if (!row.date) errors.push("Choose a transaction date.");
  if (!row.owner) errors.push("Choose an owner.");
  if (!row.account) errors.push("Choose an account.");
  if (["opening", "buy", "sell"].includes(type)) {
    if (!String(row.ticker || "").trim()) errors.push("Enter a ticker.");
    if (!String(row.holding || "").trim()) errors.push("Enter a holding name.");
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push("Quantity must be greater than zero.");
    if (!Number.isFinite(price) || price <= 0) errors.push("Price per share must be greater than zero.");
    if (["buy", "sell"].includes(type) && (!Number.isFinite(amount) || amount <= 0)) {
      errors.push("Transaction value must be greater than zero.");
    }
  } else if (["deposit", "withdrawal"].includes(type)) {
    if (!Number.isFinite(amount) || amount <= 0) errors.push("Cash amount must be greater than zero.");
  } else {
    errors.push("Choose a valid transaction type.");
  }
  return errors;
}

export function availableQuantityForSale(transactions, candidate) {
  const candidateKey = candidate.id || candidate.client_request_id || "candidate-sale";
  const candidateRow = {
    ...candidate,
    id: candidateKey,
    created_at: candidate.created_at || new Date().toISOString(),
  };
  const rows = activeRows(transactions)
    .filter((row) => row.id !== candidate.id)
    .concat(candidateRow);
  let quantity = 0;
  for (const row of orderedTransactions(rows)) {
    if (row.owner !== candidate.owner || row.account !== candidate.account || row.ticker !== candidate.ticker) continue;
    if (row.id === candidateKey) return Math.max(0, quantity);
    if (row.type === "opening" || row.type === "buy") quantity += Number(row.quantity || 0);
    if (row.type === "sell") quantity -= Number(row.quantity || 0);
  }
  return Math.max(0, quantity);
}

function latestByKey(rows, keyFn) {
  const grouped = new Map();
  for (const row of activeRows(rows)) {
    const key = keyFn(row);
    const current = grouped.get(key);
    const dateDifference = transactionDateValue(row.date) - transactionDateValue(current?.date);
    const timeDifference = String(row.created_at || row.updated_at || "").localeCompare(String(current?.created_at || current?.updated_at || ""));
    if (!current || dateDifference > 0 || (dateDifference === 0 && timeDifference >= 0)) grouped.set(key, row);
  }
  return [...grouped.values()];
}

function latestManualValue(rows, ticker, owner, account) {
  const matches = activeRows(rows).filter((row) => row.ticker === ticker && row.owner === owner && row.account === account);
  return latestByKey(matches, () => `${ticker}|${owner}|${account}`)[0] || null;
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
      children: [],
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
      sources: [...item.sources],
      owner: owners.length > 1 ? "Both" : owners[0],
      account: accounts.length > 1 ? "Multiple" : accounts[0],
      source: [...item.sources].includes("Yahoo") ? "Yahoo" : [...item.sources].join(", "),
      gain_pct: item.cost_basis_gbp ? item.gain_gbp / item.cost_basis_gbp : null,
    };
  }).sort((a, b) => b.value_gbp - a.value_gbp);
}

export function calculatePortfolioCore({
  transactions = [],
  manualValues = [],
  pensions = [],
  marketPrices = [],
  fxFallback = 1.3427,
  isPriceFresh = () => true,
} = {}) {
  const grouped = new Map();
  const cash = new Map();
  const prices = new Map(activeRows(marketPrices).map((row) => [row.ticker, row]));
  const fx = Number(prices.get("GBPUSD=X")?.price || fxFallback);

  for (const tx of orderedTransactions(activeRows(transactions))) {
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
      const calculatedCost = (quantity * Number(tx.price || 0)) / (tx.currency === "USD" ? Number(tx.fx_rate_used || fx) : 1);
      const cost = tx.cost_basis_gbp ?? (tx.type === "buy" && tx.amount_gbp !== null && tx.amount_gbp !== undefined ? tx.amount_gbp : calculatedCost);
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
      if (quantity > item.quantity + EPSILON) {
        throw new Error(`${tx.ticker} sale exceeds the available holding in ${tx.account}.`);
      }
      const averageCost = item.quantity ? item.cost_basis_gbp / item.quantity : 0;
      item.quantity -= quantity;
      item.cost_basis_gbp = Math.max(0, item.cost_basis_gbp - averageCost * quantity);
      cashValue.amount += Number(tx.amount_gbp || 0);
      cash.set(key, cashValue);
    }
    grouped.set(positionKey, item);
  }

  const positions = [];
  for (const item of grouped.values()) {
    if (item.quantity <= EPSILON) continue;
    const manual = latestManualValue(manualValues, item.ticker, item.owner, item.account);
    const quote = prices.get(item.ticker);
    let valueGbp = Number(item.cost_basis_gbp || 0);
    let source = "Cost basis";
    if (manual) {
      valueGbp = Number(manual.value_gbp || 0);
      source = "Manual";
    } else if (quote) {
      const localValue = Number(quote.price || 0) * Number(item.quantity || 0);
      valueGbp = quote.currency === "USD" ? localValue / fx : localValue;
      source = isPriceFresh(quote) ? "Yahoo" : "Cached Yahoo";
    } else if (item.opening_value_gbp) {
      valueGbp = Number(item.opening_value_gbp);
      source = "Opening value";
    }
    const gainGbp = valueGbp - Number(item.cost_basis_gbp || 0);
    const gainPct = item.cost_basis_gbp ? gainGbp / item.cost_basis_gbp : null;
    positions.push({ ...item, value_gbp: valueGbp, gain_gbp: gainGbp, gain_pct: gainPct, source });
  }

  const combined = aggregatePositions(positions);
  const totalPositions = positions.reduce((sum, item) => sum + item.value_gbp, 0);
  const totalCash = [...cash.values()].reduce((sum, item) => sum + item.amount, 0);
  const pensionTotal = latestByKey(pensions, (row) => row.name).reduce((sum, item) => sum + Number(item.value_gbp || 0), 0);
  return {
    fx,
    prices,
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
