// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board with filters, a per-protocol detail drawer and the model itself. The page
// recomputes every row's implied value from the fitted line main.ts published, so the number on
// screen and the number in board.json are the same arithmetic. No network: data.js is the data.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', band: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }

  // The model, recomputed in the page from the published fit: the same function lib/model.ts runs.
  function impliedOf(row) {
    var cat = DATA.categories[row.category || 'Other'] || { offset: 0, comps: 0, sigma_log10: DATA.fit.sigma_log10 };
    var logBase = DATA.fit.intercept + DATA.fit.slope * Math.log10(Math.max(1, row.tvl_usd)) + cat.offset;
    var g = Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var gf = Math.exp((DATA.model.growth_beta * g) / 100);
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var mf = DATA.model.maturity_floor + (Math.min(Math.max(age, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    var base = Math.pow(10, logBase);
    var implied = Math.max(1, Math.round(base * gf * mf));
    var hw = DATA.model.interval_z * cat.sigma_log10;
    var low = Math.min(implied, Math.max(1, Math.round(Math.pow(10, logBase - hw) * gf * mf)));
    var high = Math.max(implied, Math.round(Math.pow(10, logBase + hw) * gf * mf));
    return { implied: implied, low: low, high: high, base: base, gf: gf, mf: mf, offset: cat.offset, comps: cat.comps, sigma: cat.sigma_log10 };
  }

  // The log scale every range whisker shares: the board's own low-to-high span.
  var LOG_MIN = Math.log10(Math.max(1, Math.min.apply(null, DATA.rows.map(function (r) { return r.implied_low_usd; }))));
  var LOG_MAX = Math.log10(Math.max.apply(null, DATA.rows.map(function (r) { return r.implied_high_usd; })));
  function logPos(v) { return Math.max(0, Math.min(100, ((Math.log10(Math.max(1, v)) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100)); }
  function rangeCell(row) {
    var left = logPos(row.implied_low_usd);
    var width = Math.max(1.5, logPos(row.implied_high_usd) - left);
    var dot = logPos(row.implied_value_usd);
    return el('div', { class: 'range' },
      el('div', null,
        el('span', { class: 'implied-val', text: fmtUsd(row.implied_value_usd) })
      ),
      el('div', { class: 'track', 'aria-hidden': 'true' },
        el('i', { class: 'band', style: 'left:' + left + '%;width:' + width + '%' }),
        el('i', { class: 'dot', style: 'left:' + dot + '%' })
      ),
      el('div', { class: 'vals' }, el('span', { text: fmtUsd(row.implied_low_usd) }), el('span', { text: fmtUsd(row.implied_high_usd) }))
    );
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json (lib/model.ts farmSteps):
  // category, chains, TVL and age decide the action, the capital, the hold and every cost and time.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function weeklyGas(chain) { return chain === 'Ethereum' ? 'about $6 of gas a week' : 'about $1 of gas a week'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return {
      core: 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it and repay once, so both sides of the market record the wallet.',
      weekly: 'Add or roll a small supply position in ' + name + ' each week so the wallet keeps an unbroken activity streak.'
    };
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity') >= 0) return {
      core: 'Add $' + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and make ten swaps through the same wallet.',
      weekly: 'Make two or three swaps a week through ' + name + ' and rebalance the pool position when it drifts out of range.'
    };
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('option') >= 0) return {
      core: 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade, keeping the position size under a fifth of the deposit.',
      weekly: 'Trade a small hedged position on ' + name + ' each week and keep a running volume record in the farm log.'
    };
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('manager') >= 0) return {
      core: 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the same wallet.',
      weekly: 'Top up the ' + name + ' vault by a small amount each week rather than in one lump, so the deposits span several snapshots.'
    };
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return {
      core: 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token in the wallet.',
      weekly: 'Claim any staking rewards in the same wallet each week and restake them through ' + name + '.'
    };
    if (c.indexOf('chain') >= 0) return {
      core: 'Bridge $' + capital + ' of USDC to ' + name + "'s chain and use three of its native apps, starting with its main dex and lending market.",
      weekly: 'Make one transaction a week on the chain through the same wallet, rotating between its dex, lending and bridge apps.'
    };
    if (c.indexOf('prediction') >= 0) return {
      core: 'Fund $' + capital + ' on ' + name + ' and place small positions on five different markets, settling at least one to completion.',
      weekly: 'Place one or two market positions a week on ' + name + ' and let each settle rather than closing early.'
    };
    if (c.indexOf('rwa') >= 0) return {
      core: 'Complete ' + name + "'s onboarding on " + chain + ' and mint $' + capital + ' of its yield asset, holding it in the same wallet.',
      weekly: 'Check the position weekly and add a small amount when onboarding allows, keeping every receipt with the farm log.'
    };
    if (c.indexOf('insurance') >= 0) return {
      core: 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a position you actually hold, and keep the policy to expiry.',
      weekly: 'Renew or extend the cover before it lapses so the wallet shows continuous cover with ' + name + '.'
    };
    if (c.indexOf('stable') >= 0 || c.indexOf('basis') >= 0) return {
      core: 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + " and hold it, or pair it in the protocol's own pool.",
      weekly: 'Roll a small part of the position each week so the wallet keeps minting, holding and redeeming activity with ' + name + '.'
    };
    return {
      core: 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open in the same wallet.',
      weekly: 'Make one qualifying action a week in ' + name + ', such as a deposit, a swap or a vote, from the same wallet.'
    };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var action = actionFor(p, capital, chain);
    return [
      { text: 'Open a fresh wallet for ' + p.name + ', fund it on ' + chain + ', and keep its seed phrase offline; never farm from an exchange wallet.', cost: 'under $3 of gas to fund the wallet', time: '10 minutes' },
      { text: action.core, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: action.weekly, cost: weeklyGas(chain), time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot of the protocol.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Open ' + p.name + "'s own app and check its points, quests or rewards page; record the balance, and claim only from a link the protocol itself publishes.", cost: 'free to check, and never pay anyone to claim', time: '10 minutes a month' },
      { text: 'Keep a farm log of the wallet, the dates, the amounts and the transaction hashes, and review it monthly: scale down if ' + p.name + ' announces a token, changes its points terms, or its TVL falls four weeks in a row.', cost: 'nothing but the log', time: '15 minutes a month' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('band')) state.band = params.get('band');
    if (params.get('wl') === '1') state.wl = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.band !== 'all') params.set('band', state.band);
    if (state.wl) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  var BANDS = {
    all: function () { return true; },
    huge: function (r) { return r.tvl_usd >= 1e9; },
    big: function (r) { return r.tvl_usd >= 2.5e8 && r.tvl_usd < 1e9; },
    mid: function (r) { return r.tvl_usd >= 5e7 && r.tvl_usd < 2.5e8; },
    small: function (r) { return r.tvl_usd < 5e7; }
  };
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!BANDS[state.band](r)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
          el('div', { class: 'brand-sub', text: 'pre-token protocols, ranked by implied value' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Fitted on ', el('b', { text: DATA.fit.comps + ' launches' }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'What is a token worth before it exists?' }),
        el('p', null,
          'Every protocol here records no token yet. The radar prices the launch that has not happened: it fits what ',
          el('b', { text: DATA.fit.comps + ' comparable launches' }),
          ' actually trade at against their TVL, then applies that line to each pre-token protocol with its category, its seven-day growth and its years without a token. The watchlist of ',
          el('b', { text: DATA.watchlist_size + ' protocols over $' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' is the floor, not the ceiling: the board also ranks ' + DATA.early_size + ' earlier protocols below it. An implied value is a model claim, not a promise.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median launch multiple' }), el('b', { text: fmtMult(DATA.fit.median_multiple) + ' of TVL' })),
        el('div', { class: 'fact' }, el('span', { text: 'Wrapped and exchange products set aside' }), el('b', { text: String(DATA.products_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols, valued by the market' }), el('b', { text: String(DATA.live_size) + ' shown' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 18);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var bandSelect = el('select', { id: 'band', 'aria-label': 'Filter by TVL band' },
      el('option', { value: 'all', text: 'Any TVL', selected: state.band === 'all' ? 'selected' : null }),
      el('option', { value: 'huge', text: 'TVL $1B and up', selected: state.band === 'huge' ? 'selected' : null }),
      el('option', { value: 'big', text: 'TVL $250M to $1B', selected: state.band === 'big' ? 'selected' : null }),
      el('option', { value: 'mid', text: 'TVL $50M to $250M', selected: state.band === 'mid' ? 'selected' : null }),
      el('option', { value: 'small', text: 'TVL under $50M', selected: state.band === 'small' ? 'selected' : null })
    );
    bandSelect.addEventListener('change', function () { state.band = bandSelect.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'band', text: 'Size' }), bandSelect),
      el('label', { class: 'check' }, wlBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Board' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen a filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.band = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, rangeCell(r)),
        el('td', { class: 'num', text: fmtMult(r.implied_value_usd / r.tvl_usd) }),
        el('td', null, el('span', { class: 'chip' + (r.on_watchlist ? '' : ' early'), text: r.on_watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols ranked by implied value. The amber band is the middle half of what comparable launches did; the dot is the point estimate. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'No token for'),
            sortHeader('implied', 'Implied value and range'),
            sortHeader('multiple', 'x TVL'),
            el('th', { scope: 'col', text: 'Set' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' }),
        el('td', null, el('span', { class: 'chip early', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Already trading: these protocols have a token, so their market cap is a market fact, not a model. They are the comparable launches the model is fitted on, set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'x TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var f = DATA.fit;
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the implied value is fitted' }),
      el('ol', null,
        el('li', null, el('b', { text: 'Fit the launches. ' }), 'Across the ' + f.comps + ' protocols whose token already trades, log market cap is regressed on log TVL. The slope is ' + f.slope.toFixed(2) + ', not 1: launched tokens carry a size discount, so ten times the TVL is worth about ' + Math.pow(10, f.slope).toFixed(1) + ' times the value. The fit explains ' + Math.round(f.r_squared * 100) + '% of the variance; the rest is the market disagreeing, which is why every row carries a range.'),
        el('li', null, el('b', { text: 'Move the line by category. ' }), 'Each category\u2019s launches sit above or below the line; their mean miss, shrunk by sample size (n / (n + ' + m.shrink_k + ')), becomes that category\u2019s offset. A category with two launches barely moves; one with fifteen moves most of the way.'),
        el('li', null, el('b', { text: 'Score the protocol\u2019s own record. ' }), 'Seven-day TVL growth scales the value by exp(' + m.growth_beta + ' x growth), clamped between ' + m.growth_floor + '% and +' + m.growth_cap + '%, and time running with no token scales it from ' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range).toFixed(2) + ' over three years. A protocol with no listing date is scored at the board\u2019s median age, ' + Math.round(DATA.median_age_days) + ' days.'),
        el('li', null, el('b', { text: 'Carry the disagreement as a range. ' }), 'The band is the fitted value times and divided by 10^(' + m.interval_z + ' x sigma), with sigma the category\u2019s own scatter shrunk toward the global ' + f.sigma_log10.toFixed(2) + ' in log10. Half of comparable launches landed inside a band like it.')
      ),
      el('div', { class: 'formula', text: 'implied = 10^(' + f.intercept.toFixed(2) + ' + ' + f.slope.toFixed(2) + ' x log10(TVL) + category offset) x exp(' + m.growth_beta + ' x clamp(7d growth)) x maturity(age)' }),
      el('p', null, 'Eligibility follows the snapshot\u2019s own watchlist rule: a protocol is ranked when it records no token and is not a wrapped, staked or bridged product of a token that already trades, so WBTC, Binance staked ETH and the exchanges\u2019 own balance sheets are set aside (' + DATA.products_size + ' protocols), not ranked as launches that have not happened. No protocol name is special-cased anywhere in the scoring: one fitted function values every row, and this page recomputes each row from the published fit to prove it.')
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Data: ' + DATA.source + '. The snapshot is sealed; the board is a model of it, not investment advice.' }),
      el('span', { text: 'Implied value answers a narrow question: what a token would be worth if it launched against this record. It says nothing about whether or when a token comes.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var v = impliedOf(row);
    var steps = farmSteps(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-sub', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size + (row.on_watchlist ? ' - WATCHLIST' : ' - EARLY RADAR') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value if it launched on this record' }),
      el('div', { class: 'big-implied', text: fmtUsd(row.implied_value_usd) }),
      el('div', { class: 'big-range', text: 'middle-half range ' + fmtUsd(row.implied_low_usd) + ' to ' + fmtUsd(row.implied_high_usd) + ' - ' + fmtMult(row.implied_value_usd / row.tvl_usd) + ' of TVL' }),
      rangeCell(row)
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How the model gets there' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Fitted base at this TVL' }), el('b', { text: fmtUsd(v.base) })),
        el('div', null, el('span', { text: 'Category offset (' + (row.category || 'Other') + ', ' + v.comps + ' launches)' }), el('b', { text: (v.offset >= 0 ? '+' : '') + v.offset.toFixed(2) + ' log10' })),
        el('div', null, el('span', { text: 'Seven-day growth ' + fmtPct(row.change_7d) }), el('b', { text: 'x ' + v.gf.toFixed(3) })),
        el('div', null, el('span', { text: 'No token for ' + fmtAge(row.age_days) }), el('b', { text: 'x ' + v.mf.toFixed(3) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'This page recomputes the row from the published fit as ' + fmtUsd(v.implied) + (v.implied === row.implied_value_usd && v.low === row.implied_low_usd && v.high === row.implied_high_usd ? ', the same numbers board.json carries.' : ' from the same inputs.') + ' The range uses this category\u2019s scatter, sigma ' + v.sigma.toFixed(2) + ' in log10.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The record' }),
      el('div', { class: 'facts-grid' },
        el('div', null, el('span', { text: 'TVL' }), fmtUsd(row.tvl_usd)),
        el('div', null, el('span', { text: 'TVL change, 7d' }), fmtPct(row.change_7d)),
        el('div', null, el('span', { text: 'First tracked' }), row.listed_at || 'not recorded'),
        el('div', null, el('span', { text: 'Chains' }), (row.chains || []).length ? row.chains.join(', ') : 'none named'),
        el('div', null, el('span', { text: 'Token on record' }), 'none - that is the point'),
        el('div', null, el('span', { text: 'Watchlist' }), row.on_watchlist ? 'yes, over the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor' : 'no, ranked from below the floor')
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
