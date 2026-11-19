// Token launch radar: the valuation model and everything the board is built from.
//
// Question the board answers: if a protocol that has not issued a token were to
// launch one against the record in this snapshot, what would that token be worth,
// and what should a reader do to be positioned for it? The answer is fitted, not
// asserted. Protocols whose tokens already trade inside the same snapshot are the
// evidence: a regression of log market cap on log TVL over those launches gives
// the typical size relationship, each category's launches are allowed to sit
// above or below that line by a shrunken amount, and a candidate's own growth
// and time live move it from there. The published range is the middle half of
// the comparable launches' outcomes, so half of real launches landed inside it.
//
// Who gets ranked follows the snapshot's own watchlist logic, re-derived from
// the fields the snapshot carries: no token recorded, and not a wrapped, staked
// or bridged wrapper of somebody else's token (category, name and exchange
// prefix tests below). The house watchlist itself is always included in full.

/** One protocol record, exactly as the sealed snapshot stores it. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed input document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** Tunable constants of the model; the dashboard prints them next to the fit. */
export interface Params {
  shrink: number;
  growthBeta: number;
  growthMin: number;
  growthMax: number;
  matBase: number;
  matSpan: number;
  matDays: number;
  z: number;
}

export const PARAMS: Params = {
  shrink: 6,
  growthBeta: 0.5,
  growthMin: -40,
  growthMax: 80,
  matBase: 0.85,
  matSpan: 0.3,
  matDays: 1095,
  z: 0.6745,
};

/** Label the dashboard gives the model. */
export const MODEL_VERSION = 'comps-2';

/** Rows in the dashboard's already-trading view. */
export const LIVE_COUNT = 24;

/** The regression line plus how widely real launches scattered around it. */
export interface FitResult {
  comps: number;
  intercept: number;
  slope: number;
  sigma: number;
  r2: number;
  medianMultiple: number;
}

/** One category's displacement from the line and its own scatter. */
export interface CatStat {
  offset: number;
  comps: number;
  sigma: number;
}

/** A single farm instruction with its price tag and its clock. */
export interface Step {
  text: string;
  cost: string;
  time: string;
}

/** A board.json row: the ranked entry in full, model workings included. */
export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    base_value_usd: number;
    category_offset: number;
    category_comps: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The slim per-row shape the dashboard renders. */
export interface DashRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  category_offset: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown at the market's value. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The complete payload data.js hands to the dashboard. */
export interface DashData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Params;
  model_version: string;
  fit: FitResult;
  categories: Record<string, CatStat>;
  median_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  products_size: number;
  rows: DashRow[];
  live: LiveEntry[];
}

/** Raised when the input is not a snapshot this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const DAY = 86_400_000;
const r4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Whole days between the snapshot date and a listing date; null if either is unusable. */
export function daysLive(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(asOf + 'T00:00:00Z');
  const start = Date.parse(listedAt + 'T00:00:00Z');
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY));
}

/** True when the record shows no token: no cap, no gecko id, no symbol. */
export function hasNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// Categories that are, by construction, claims on another protocol's token.
const WRAPPER_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// Exchange brands whose names head custodial or wrapped products.
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

// A trailing release marker means this entry is one version of another protocol.
const RELEASE_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Whole-word giveaways that the product wraps or stakes an existing token.
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** Rankable = pre-token and not a wrapper of a token that already trades. */
export function eligible(p: Proto): boolean {
  if (!hasNoToken(p)) return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (RELEASE_TAIL.test(p.name) || WRAPPER_WORD.test(p.name)) return false;
  return !EXCHANGE_HEADS.some((head) => p.name.startsWith(head));
}

/** The evidence set: launched protocols with both a cap and TVL on record. */
function launchedSet(snap: Snap): Proto[] {
  return snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * Regress log10(cap) on log10(TVL) across the launched set, then summarise each
 * category's residuals: the mean, pulled toward zero by shrink / (n + shrink),
 * is the category's offset, and its scatter is blended with the global scatter.
 */
export function regress(snap: Snap, par: Params = PARAMS): { fit: FitResult; categories: Record<string, CatStat> } {
  const comps = launchedSet(snap);
  const n = comps.length;
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(p.mcap_usd as number));
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] as number - meanX) * (ys[i] as number - meanY);
    varX += (xs[i] as number - meanX) ** 2;
  }
  const slope = cov / varX;
  const intercept = meanY - slope * meanX;
  const resid = ys.map((y, i) => y - (intercept + slope * (xs[i] as number)));
  const ssR = resid.reduce((a, r) => a + r * r, 0);
  const ssT = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
  const sigma = Math.sqrt(ssR / Math.max(1, n - 2));
  const mults = comps.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const fit: FitResult = {
    comps: n,
    intercept: r4(intercept),
    slope: r4(slope),
    sigma: r4(sigma),
    r2: r4(1 - ssR / ssT),
    medianMultiple: r4(mults[Math.floor(mults.length / 2)] as number),
  };
  const grouped = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const bucket = grouped.get(key);
    if (bucket) bucket.push(resid[i] as number);
    else grouped.set(key, [resid[i] as number]);
  });
  const categories: Record<string, CatStat> = {};
  for (const key of [...grouped.keys()].sort()) {
    const list = grouped.get(key) as number[];
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    const own = list.length > 1 ? list.reduce((a, r) => a + (r - mean) ** 2, 0) / (list.length - 1) : sigma * sigma;
    categories[key] = {
      offset: r4(mean * (list.length / (list.length + par.shrink))),
      comps: list.length,
      sigma: r4(Math.sqrt((list.length * own + par.shrink * sigma * sigma) / (list.length + par.shrink))),
    };
  }
  return { fit, categories };
}

/** Median age of the rankable set; stands in for protocols with no listing date. */
function typicalAge(snap: Snap): number {
  const ages = snap.protocols
    .filter(eligible)
    .map((p) => daysLive(snap.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  return ages.length === 0 ? 365 : (ages[Math.floor(ages.length / 2)] as number);
}

/** One protocol priced by the fitted model: point value, range, and the workings. */
export function valueFor(
  p: Proto,
  asOf: string,
  fit: FitResult,
  categories: Record<string, CatStat>,
  medianAge: number,
  par: Params = PARAMS,
): { value: number; low: number; high: number; base: number; offset: number; catComps: number; growth: number; maturity: number; age: number | null } {
  const age = daysLive(asOf, p.listed_at);
  const cat = categories[p.category ?? 'Other'] ?? { offset: 0, comps: 0, sigma: fit.sigma };
  const logBase = fit.intercept + fit.slope * Math.log10(Math.max(1, p.tvl_usd)) + cat.offset;
  const g = Math.min(par.growthMax, Math.max(par.growthMin, p.change_7d ?? 0));
  const growth = Math.exp((par.growthBeta * g) / 100);
  const effectiveAge = age ?? medianAge;
  const maturity = par.matBase + (Math.min(Math.max(effectiveAge, 0), par.matDays) / par.matDays) * par.matSpan;
  const mult = growth * maturity;
  const base = 10 ** logBase;
  const half = par.z * cat.sigma;
  const value = Math.max(1, Math.round(base * mult));
  const low = Math.min(value, Math.max(1, Math.round(10 ** (logBase - half) * mult)));
  const high = Math.max(value, Math.round(10 ** (logBase + half) * mult));
  return { value, low, high, base, offset: cat.offset, catComps: cat.comps, growth, maturity, age };
}

/** Score and sort the whole board: watchlist in full, plus every eligible protocol. */
export function rankProtocols(snap: Snap, par: Params = PARAMS): Row[] {
  const { fit, categories } = regress(snap, par);
  const medianAge = typicalAge(snap);
  const watch = new Set(snap.watchlist);
  const picked = snap.protocols.filter((p) => watch.has(p.slug) || eligible(p));
  const scored = picked.map((p) => ({ p, v: valueFor(p, snap.as_of, fit, categories, medianAge, par) }));
  scored.sort((a, b) => b.v.value - a.v.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.value,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    model: {
      base_value_usd: Math.round(s.v.base),
      category_offset: s.v.offset,
      category_comps: s.v.catComps,
      growth_multiplier: r4(s.v.growth),
      maturity_multiplier: r4(s.v.maturity),
      age_days: s.v.age,
    },
    farm_steps: planFor(s.p, s.v.age).map(stepLine),
  }));
}

/** Flatten a step into the board's single-string form, inside the length limits. */
export function stepLine(step: Step): string {
  let out = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (out.length > 600) out = out.slice(0, 596) + '...';
  if (out.length < 20) out += ' Keep the position open and recheck monthly.';
  return out;
}

/** The chain a plan should name first. */
function mainChain(p: Proto): string {
  return p.chains.length > 0 ? (p.chains[0] as string) : 'its main chain';
}

/** Recurring gas for a week of small actions on that chain. */
function gasLine(chain: string): string {
  return chain === 'Ethereum' ? 'about $6 of gas a week' : 'about $1 of gas a week';
}

/** Position size for a farm wallet, scaled to the protocol's depth. */
function stakeFor(p: Proto): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Days a position should season before it plausibly counts. */
function seasonDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The opening move and the weekly habit, phrased for the protocol's category. */
function movesFor(p: Proto, stake: number, chain: string): { open: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      open: `Supply $${stake} of USDC to ${n} on ${chain}, borrow a little against it and repay, so the wallet shows up on both sides of the market.`,
      weekly: `Roll or top up a small supply position in ${n} every week, keeping the activity streak unbroken.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return {
      open: `Put $${stake} into ${n}'s deepest pool on ${chain} and route ten swaps through the same wallet.`,
      weekly: `Swap two or three times a week through ${n} and rebalance the pool position when it drifts.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option')) {
    return {
      open: `Post $${stake} of USDC as margin on ${n} and open one small hedged trade, sized under a fifth of the deposit.`,
      weekly: `Run one small hedged trade a week on ${n} and keep the volume trail in the farm log.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('manager')) {
    return {
      open: `Deposit $${stake} into a ${n} vault on ${chain} and leave the shares sitting in the same wallet.`,
      weekly: `Add a little to the ${n} vault each week instead of one lump sum, so deposits span several snapshots.`,
    };
  }
  if (c.includes('restak') || c.includes('staking')) {
    return {
      open: `Stake $${stake} of the chain's staking asset through ${n} on ${chain} and hold the receipt token.`,
      weekly: `Claim rewards in the same wallet weekly and restake them through ${n}.`,
    };
  }
  if (c.includes('chain')) {
    return {
      open: `Bridge $${stake} of USDC over to ${n}'s chain and use three native apps, its main dex and lending market first.`,
      weekly: `Send one transaction a week on the chain from the same wallet, rotating dex, lending and bridge.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      open: `Fund $${stake} on ${n}, take small positions in five different markets, and let at least one settle.`,
      weekly: `Place one or two positions a week on ${n} and hold each to settlement.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      open: `Finish ${n}'s onboarding on ${chain} and mint $${stake} of its yield asset into the same wallet.`,
      weekly: `Review the position weekly and add small amounts when onboarding allows, keeping receipts in the log.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      open: `Buy $${stake} of cover from ${n} on ${chain} against a position you really hold, and keep it to expiry.`,
      weekly: `Renew or extend the cover before it lapses so coverage with ${n} reads as continuous.`,
    };
  }
  if (c.includes('stable') || c.includes('basis')) {
    return {
      open: `Mint or deposit $${stake} of the stable asset through ${n} on ${chain} and hold it, or pair it in the house pool.`,
      weekly: `Cycle a small slice of the position weekly so mint, hold and redeem activity all show for ${n}.`,
    };
  }
  return {
    open: `Deposit $${stake} of USDC into ${n} on ${chain} and keep the position open in the same wallet.`,
    weekly: `Take one qualifying action a week in ${n} (a deposit, a swap, a vote) from the same wallet.`,
  };
}

/**
 * Six steps per protocol, all derived from its own record: a clean wallet, the
 * category's opening move, the weekly habit, a seasoning period, a points
 * check, and a written log with exit triggers.
 */
export function planFor(p: Proto, age: number | null): Step[] {
  const chain = mainChain(p);
  const stake = stakeFor(p);
  const season = seasonDays(age);
  const moves = movesFor(p, stake, chain);
  return [
    {
      text: `Set up a fresh wallet for ${p.name}, fund it on ${chain}, and store the seed phrase offline; never farm from an exchange account.`,
      cost: 'under $3 of gas to fund the wallet',
      time: '10 minutes',
    },
    {
      text: moves.open,
      cost: `$${stake} of capital and about $${stake >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: moves.weekly,
      cost: gasLine(chain),
      time: '10 minutes a week',
    },
    {
      text: `Leave the position in place for at least ${season} days so it appears in more than one snapshot of the protocol.`,
      cost: `the $${stake} stays committed`,
      time: `${season} days`,
    },
    {
      text: `Open ${p.name}'s own app, find its points, quests or rewards page, note the balance, and only ever claim through links the protocol itself posts.`,
      cost: 'free to check; never pay a third party to claim',
      time: '10 minutes a month',
    },
    {
      text: `Keep a written log (wallet, dates, amounts, transaction hashes) and review it monthly; scale back if ${p.name} announces a token, rewrites its points terms, or its TVL falls four weeks running.`,
      cost: 'nothing but the log',
      time: '15 minutes a month',
    },
  ];
}

/** The already-trading set for the dashboard's second view, biggest caps first. */
export function liveList(snap: Snap): LiveEntry[] {
  return snap.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_COUNT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A full board row squeezed into the dashboard's per-row shape. */
export function toDashRow(row: Row): DashRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    category_offset: row.model.category_offset,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Build the board and the dashboard payload from one snapshot. */
export function assemble(snap: Snap, par: Params = PARAMS): { board: Row[]; dash: DashData } {
  const { fit, categories } = regress(snap, par);
  const board = rankProtocols(snap, par);
  const live = liveList(snap);
  const watch = new Set(snap.watchlist);
  const dash: DashData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: par,
    model_version: MODEL_VERSION,
    fit,
    categories,
    median_age_days: typicalAge(snap),
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    products_size: snap.protocols.filter((p) => hasNoToken(p) && !eligible(p) && !watch.has(p.slug)).length,
    rows: board.map(toDashRow),
    live,
  };
  return { board, dash };
}

/** Parse and validate the sealed input; anything off-shape is a SnapError. */
export function readSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('snapshot.json has no watchlist of slugs');
  const protocols: Proto[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Null when the board is one the gate accepts; otherwise the reason it is not. */
export function validateBoard(board: Row[], snap: Snap): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snap.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if ((board[i] as Row).implied_value_usd > (board[i - 1] as Row).implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]?.implied_value_usd === board[board.length - 1]?.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (!(r.implied_low_usd >= 1 && r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd)) {
      return `${r.slug} has a broken interval`;
    }
  }
  return null;
}

/** The dashboard's data as a single script assignment: no fetch, no network. */
export function dashScript(dash: DashData): string {
  return 'window.RADAR=' + JSON.stringify(dash) + ';\n';
}
