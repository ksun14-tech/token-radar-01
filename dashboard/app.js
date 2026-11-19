// Token Launch Radar: the reader's page.
//
// Data arrives as window.RADAR from ../data.js, written by main.ts from the
// same board that board.json carries. Nothing is fetched. The page re-derives
// every row's implied value from the published fit (intercept, slope, category
// offsets, growth and maturity factors) and flags any row where its arithmetic
// and the board's disagree, so what is on screen is provably the board's math.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v == null) return '—';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageLabel(days) {
    if (days == null) return '—';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.4) + 'mo';
    return days + 'd';
  }

  // --- header and model panel ---------------------------------------------
  el('meta').textContent =
    'Snapshot ' + D.as_of + ' · ' + D.source + ' · board of ' + D.board_size +
    ' pre-token protocols (' + D.watchlist_size + ' on the house watchlist) · model ' + D.model_version;

  var fit = D.fit;
  el('model-panel').innerHTML =
    '<h2>How the number is made</h2>' +
    '<p>The fit runs over the ' + fit.comps + ' protocols in this same snapshot whose token already trades: ' +
    '<code>log10(market cap) = ' + fit.intercept + ' + ' + fit.slope + ' × log10(TVL)</code>. ' +
    'A slope under 1 means size is discounted: ten times the TVL is worth about ' +
    Math.pow(10, fit.slope).toFixed(1) + ' times as much, not ten times. Each category then shifts the line by its own ' +
    'launches\u2019 average miss, shrunk toward zero when the category has few launches, and a protocol\u2019s ' +
    '7-day growth and years live without a token scale the result.</p>' +
    '<div class="fit"><span>comps: ' + fit.comps + '</span><span>slope: ' + fit.slope + '</span>' +
    '<span>intercept: ' + fit.intercept + '</span><span>scatter σ: ' + fit.sigma + ' (log10)</span>' +
    '<span>R²: ' + fit.r2 + '</span><span>median cap/TVL: ' + fit.medianMultiple + '×</span></div>' +
    '<p>The range beside each value is the middle half of comparable launches: half of real launches landed ' +
    'inside an interval this wide. It is a statement about dispersion, not a promise. Protocols the snapshot ' +
    'shows as wrappers of an existing token (bridges, liquid staking, exchange products, versioned pools) are ' +
    'set aside, as the house watchlist sets them aside.</p>';

  el('foot').innerHTML =
    'Implied values are this board\u2019s own arithmetic on a sealed snapshot (' + esc(D.as_of) + '), ' +
    'not a prediction that any protocol will issue a token. Model <code>' + esc(D.model_version) + '</code> · ' +
    'fit published in full above · every row below is recomputed in your browser from that fit and checked against the board.';

  // --- recompute in the page ------------------------------------------------
  function recompute(row) {
    var cat = D.categories[row.category || 'Other'] || { offset: 0, sigma: fit.sigma };
    var logBase = fit.intercept + fit.slope * Math.log10(Math.max(1, row.tvl_usd)) + cat.offset;
    var g = Math.min(D.model.growthMax, Math.max(D.model.growthMin, row.change_7d || 0));
    var growth = Math.exp((D.model.growthBeta * g) / 100);
    var age = row.age_days == null ? D.median_age_days : row.age_days;
    var maturity = D.model.matBase + (Math.min(Math.max(age, 0), D.model.matDays) / D.model.matDays) * D.model.matSpan;
    return Math.max(1, Math.round(Math.pow(10, logBase) * growth * maturity));
  }
  var mismatches = 0;
  D.rows.forEach(function (r) { if (recompute(r) !== r.implied_value_usd) mismatches++; });

  // --- filters ---------------------------------------------------------------
  var cats = {};
  var chains = {};
  D.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  function fillSelect(node, values, anyLabel) {
    node.innerHTML = '<option value="">' + anyLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  fillSelect(el('f-cat'), Object.keys(cats).sort(), 'All categories');
  fillSelect(el('f-chain'), Object.keys(chains).sort(), 'All chains');

  var maxHigh = 0;
  D.rows.forEach(function (r) { if (r.implied_high_usd > maxHigh) maxHigh = r.implied_high_usd; });

  function visibleRows() {
    var q = el('q').value.trim().toLowerCase();
    var cat = el('f-cat').value;
    var chain = el('f-chain').value;
    var tvl = Number(el('f-tvl').value || 0);
    var watchOnly = el('f-watch').checked;
    var rows = D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (tvl && r.tvl_usd < tvl) return false;
      if (watchOnly && !r.on_watchlist) return false;
      return true;
    });
    var sort = el('f-sort').value;
    rows.sort(function (a, b) {
      if (sort === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (sort === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (sort === 'age') return (b.age_days || 0) - (a.age_days || 0);
      return b.implied_value_usd - a.implied_value_usd;
    });
    return rows;
  }

  function rangeCell(r) {
    var lo = (r.implied_low_usd / maxHigh) * 100;
    var hi = (r.implied_high_usd / maxHigh) * 100;
    var at = (r.implied_value_usd / maxHigh) * 100;
    return '<div class="range"><div class="bar" style="left:' + lo + '%;width:' + Math.max(1, hi - lo) + '%"></div>' +
      '<div class="dot" style="left:' + at + '%"></div></div>' +
      '<span class="range-label">' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</span>';
  }

  function renderBoard() {
    var rows = visibleRows();
    el('count').textContent = rows.length + ' of ' + D.board_size + ' shown' +
      (mismatches ? ' · ⚠ ' + mismatches + ' rows fail the in-page recompute' : ' · in-page recompute matches the board');
    var html = '<thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th>' +
      '<th class="num">Implied value</th><th>Range (middle 50%)</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="badge">watchlist</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num">' + money(r.implied_value_usd) + '</td><td>' + rangeCell(r) + '</td></tr>';
    });
    el('board').innerHTML = html + '</tbody>';
    Array.prototype.forEach.call(el('board').querySelectorAll('tbody tr'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  function renderLive() {
    var html = '<thead><tr><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap (actual)</th></tr></thead><tbody>';
    D.live.forEach(function (r) {
      html += '<tr><td><span class="name">' + esc(r.name) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td></tr>';
    });
    el('live').innerHTML = html + '</tbody>';
  }

  // --- detail drawer -----------------------------------------------------------
  function bySlug(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }

  function openDetail(slug) {
    var r = bySlug(slug);
    if (!r) return;
    var cat = D.categories[r.category || 'Other'];
    var base = Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, r.tvl_usd)));
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    el('drawer').innerHTML =
      '<button type="button" class="close" id="d-close" aria-label="Close">×</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p>' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || '—') +
      (r.on_watchlist ? ' · on the house watchlist' : ' · beyond the watchlist floor') + '</p>' +
      '<p class="big">' + money(r.implied_value_usd) + '</p>' +
      '<p>Implied launch value · middle-50% range ' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</p>' +
      '<h3>How this number is built</h3><table>' +
      '<tr><td class="k">Fitted line at this TVL</td><td class="v">' + money(base) + '</td></tr>' +
      '<tr><td class="k">Category offset (' + esc(r.category || 'Other') + ', ' + (cat ? cat.comps : 0) + ' comps)</td><td class="v">×' + (cat ? Math.pow(10, cat.offset).toFixed(2) : '1.00') + '</td></tr>' +
      '<tr><td class="k">7-day growth factor</td><td class="v">×' + r.growth_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td class="k">Maturity factor (' + ageLabel(r.age_days) + ' live, no token)</td><td class="v">×' + r.maturity_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td class="k">Recomputed in this page</td><td class="v">' + money(recompute(r)) + (recompute(r) === r.implied_value_usd ? ' ✓ matches' : ' ✗ differs') + '</td></tr>' +
      '</table>' +
      '<h3>On the record</h3><table>' +
      '<tr><td class="k">TVL</td><td class="v">' + money(r.tvl_usd) + '</td></tr>' +
      '<tr><td class="k">TVL change, 7 days</td><td class="v">' + (r.change_7d == null ? '—' : r.change_7d.toFixed(1) + '%') + '</td></tr>' +
      '<tr><td class="k">Tracked since</td><td class="v">' + esc(r.listed_at || '—') + '</td></tr>' +
      '<tr><td class="k">Token</td><td class="v">none recorded</td></tr>' +
      '</table>' +
      '<h3>Farm plan</h3><ol>' + steps + '</ol>';
    el('drawer').classList.remove('hidden');
    el('scrim').classList.remove('hidden');
    el('d-close').addEventListener('click', closeDetail);
  }
  function closeDetail() {
    el('drawer').classList.add('hidden');
    el('scrim').classList.add('hidden');
  }
  el('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  // --- tabs and filter wiring ---------------------------------------------------
  function showTab(live) {
    el('board').classList.toggle('hidden', live);
    el('live').classList.toggle('hidden', !live);
    el('tab-pre').classList.toggle('active', !live);
    el('tab-live').classList.toggle('active', live);
  }
  el('tab-pre').addEventListener('click', function () { showTab(false); });
  el('tab-live').addEventListener('click', function () { showTab(true); });
  ['q', 'f-cat', 'f-chain', 'f-tvl', 'f-sort'].forEach(function (id) {
    el(id).addEventListener('input', renderBoard);
    el(id).addEventListener('change', renderBoard);
  });
  el('f-watch').addEventListener('change', renderBoard);

  renderBoard();
  renderLive();
})();
