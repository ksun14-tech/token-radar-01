// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks protocols that record no token yet by an implied value: what a token would be
// worth if it launched against the record the snapshot holds. The number is not a flat multiple
// of TVL. It is fitted from the snapshot's own comparable launches — the protocols whose token
// already trades — in three steps:
//
//   1. Fit. Over every protocol with a token and a market cap, regress log10(market cap) on
//      log10(TVL). Launched tokens trade at a size discount: the fitted slope is well under 1,
//      so a protocol ten times larger is worth roughly three times more, not ten times.
//   2. Category offset. Each category's launches sit above or below the fitted line (dexes
//      above, liquid staking below). A category's mean residual, shrunk toward zero by its
//      sample size (offset x n / (n + SHRINK_K)), moves the line for that category's rows.
//   3. The protocol's own record. Seven-day TVL growth scales the value by
//      exp(GROWTH_BETA x clamped growth), and time running with no token scales it by a
//      maturity factor from MATURITY_FLOOR to MATURITY_FLOOR + MATURITY_RANGE over three years.
//
// The interval is the middle half of what comparable launches actually did: plus and minus
// 0.6745 residual standard deviations in log10 space (the category's own dispersion, shrunk
// toward the global one), carried through the same growth and maturity factors.
//
// Eligibility follows the snapshot's own watchlist rule, applied to the fields the snapshot
// carries: a protocol is rankable when it records no token and is not a wrapped, staked or
// bridged product of a token that already trades — its category is not Bridge, Canonical
// Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no whole
// word wrapped, staked or staking, does not begin with an exchange's name and does not end in
// a version marker. WBTC, Binance staked ETH and the exchanges' balance sheets record no token
// of their own on DefiLlama, but each is a product of a token that trades, so the radar sets
// them aside like the watchlist does. No protocol name is ever special-cased in the scoring:
// the same fitted function values every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_k: number;
  growth_beta: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  interval_z: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  growth_beta: 0.5,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.85,
  maturity_range: 0.3,
  maturity_days: 1095,
  interval_z: 0.6745,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'comps-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The fitted line and dispersion from the comparable launches. */
export interface CompFit {
  comps: number;
  intercept: number;
  slope: number;
  sigma_log10: number;
  r_squared: number;
  median_multiple: number;
}

/** One category's offset from the fitted line, and the dispersion of its launches. */
export interface CategoryFit {
  offset: number;
  comps: number;
  sigma_log10: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
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

/** The dashboard's compact view of one row. */
export interface RadarRow {
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
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: CompFit;
  categories: Record<string, CategoryFit>;
  median_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  products_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories whose members are products of another protocol's token, per the snapshot's own rule. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped or custodial product may begin with, per the snapshot's own rule. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name marks a product of a token that trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not a wrapped,
 * staked or bridged product of a token that already trades, judged by the snapshot's fields.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** The comparable launches: protocols whose token trades with a recorded market cap. */
function compSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Fit log10(market cap) on log10(TVL) over the comparable launches, with category offsets. */
export function fitComps(snapshot: Snapshot, model: ModelConstants = MODEL): { fit: CompFit; categories: Record<string, CategoryFit> } {
  const comps = compSet(snapshot);
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(p.mcap_usd!));
  const n = comps.length;
  const mx = xs.reduce((t, v) => t + v, 0) / n;
  const my = ys.reduce((t, v) => t + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = comps.map((p, i) => ys[i]! - (intercept + slope * xs[i]!));
  const ssRes = residuals.reduce((t, r) => t + r * r, 0);
  const ssTot = ys.reduce((t, y) => t + (y - my) ** 2, 0);
  const sigma = Math.sqrt(ssRes / Math.max(1, n - 2));
  const multiples = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const fit: CompFit = {
    comps: n,
    intercept: round4(intercept),
    slope: round4(slope),
    sigma_log10: round4(sigma),
    r_squared: round4(1 - ssRes / ssTot),
    median_multiple: round4(multiples[Math.floor(multiples.length / 2)]!),
  };
  const byCategory = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(residuals[i]!);
    byCategory.set(key, list);
  });
  const categories: Record<string, CategoryFit> = {};
  for (const [key, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const mean = list.reduce((t, r) => t + r, 0) / list.length;
    const variance = list.length > 1 ? list.reduce((t, r) => t + (r - mean) ** 2, 0) / (list.length - 1) : sigma ** 2;
    categories[key] = {
      offset: round4(mean * (list.length / (list.length + model.shrink_k))),
      comps: list.length,
      sigma_log10: round4(Math.sqrt((list.length * variance + model.shrink_k * sigma ** 2) / (list.length + model.shrink_k))),
    };
  }
  return { fit, categories };
}

/** The median known age, in days, of the rankable protocols: the age an unlisted protocol is scored with. */
function medianAgeDays(snapshot: Snapshot): number {
  const ages = snapshot.protocols
    .filter((p) => isRankable(p))
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  return ages.length > 0 ? ages[Math.floor(ages.length / 2)]! : 365;
}

/** A protocol's valuation under the fitted model: the implied value and its interval. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompFit,
  categories: Record<string, CategoryFit>,
  medianAge: number,
  model: ModelConstants = MODEL,
): { implied: number; low: number; high: number; base: number; offset: number; categoryComps: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const cat = categories[protocol.category ?? 'Other'] ?? { offset: 0, comps: 0, sigma_log10: fit.sigma_log10 };
  const logBase = fit.intercept + fit.slope * Math.log10(Math.max(1, protocol.tvl_usd)) + cat.offset;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, protocol.change_7d ?? 0));
  const growthMult = Math.exp((model.growth_beta * growthPct) / 100);
  const ageForModel = age ?? medianAge;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const factors = growthMult * maturityMult;
  const base = 10 ** logBase;
  const halfWidth = model.interval_z * cat.sigma_log10;
  const implied = Math.max(1, Math.round(base * factors));
  const low = Math.min(implied, Math.max(1, Math.round(10 ** (logBase - halfWidth) * factors)));
  const high = Math.max(implied, Math.round(10 ** (logBase + halfWidth) * factors));
  return { implied, low, high, base, offset: cat.offset, categoryComps: cat.comps, growthMult, maturityMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { fit, categories } = fitComps(snapshot, model);
  const medianAge = medianAgeDays(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, fit, categories, medianAge, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    model: {
      base_value_usd: Math.round(s.v.base),
      category_offset: s.v.offset,
      category_comps: s.v.categoryComps,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Weekly gas on the protocol's main chain: Ethereum mainnet is dear, the rest are cheap. */
function weeklyGas(chain: string): string {
  return chain === 'Ethereum' ? 'about $6 of gas a week' : 'about $1 of gas a week';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action and its weekly repeat, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): { core: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay once, so both sides of the market record the wallet.`,
      weekly: `Add or roll a small supply position in ${name} each week so the wallet keeps an unbroken activity streak.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return {
      core: `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and make ten swaps through the same wallet.`,
      weekly: `Make two or three swaps a week through ${name} and rebalance the pool position when it drifts out of range.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, keeping the position size under a fifth of the deposit.`,
      weekly: `Trade a small hedged position on ${name} each week and keep a running volume record in the farm log.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('manager')) {
    return {
      core: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`,
      weekly: `Top up the ${name} vault by a small amount each week rather than in one lump, so the deposits span several snapshots.`,
    };
  }
  if (c.includes('restak') || c.includes('staking')) {
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet.`,
      weekly: `Claim any staking rewards in the same wallet each week and restake them through ${name}.`,
    };
  }
  if (c.includes('chain')) {
    return {
      core: `Bridge $${capital} of USDC to ${name}'s chain and use three of its native apps, starting with its main dex and lending market.`,
      weekly: `Make one transaction a week on the chain through the same wallet, rotating between its dex, lending and bridge apps.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${name} and place small positions on five different markets, settling at least one to completion.`,
      weekly: `Place one or two market positions a week on ${name} and let each settle rather than closing early.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      core: `Complete ${name}'s onboarding on ${chain} and mint $${capital} of its yield asset, holding it in the same wallet.`,
      weekly: `Check the position weekly and add a small amount when onboarding allows, keeping every receipt with the farm log.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy to expiry.`,
      weekly: `Renew or extend the cover before it lapses so the wallet shows continuous cover with ${name}.`,
    };
  }
  if (c.includes('stable') || c.includes('basis')) {
    return {
      core: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it, or pair it in the protocol's own pool.`,
      weekly: `Roll a small part of the position each week so the wallet keeps minting, holding and redeeming activity with ${name}.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open in the same wallet.`,
    weekly: `Make one qualifying action a week in ${name}, such as a deposit, a swap or a vote, from the same wallet.`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet for ${p.name}, fund it on ${chain}, and keep its seed phrase offline; never farm from an exchange wallet.`,
      cost: 'under $3 of gas to fund the wallet',
      time: '10 minutes',
    },
    {
      text: action.core,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: action.weekly,
      cost: weeklyGas(chain),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open ${p.name}'s own app and check its points, quests or rewards page; record the balance, and claim only from a link the protocol itself publishes.`,
      cost: 'free to check, and never pay anyone to claim',
      time: '10 minutes a month',
    },
    {
      text: `Keep a farm log of the wallet, the dates, the amounts and the transaction hashes, and review it monthly: scale down if ${p.name} announces a token, changes its points terms, or its TVL falls four weeks in a row.`,
      cost: 'nothing but the log',
      time: '15 minutes a month',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
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

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
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
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { fit, categories } = fitComps(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const products = snapshot.protocols.filter((p) => isPreToken(p) && !isRankable(p) && !watchlist.has(p.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    categories,
    median_age_days: medianAgeDays(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    products_size: products,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, intervals, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.implied_low_usd >= 1 && r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd)) return `${r.slug} has a broken interval`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
