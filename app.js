'use strict';

const MINT = '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx';
const $ = id => document.getElementById(id);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const fmt = (value, digits = 0) => finite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
const compact = value => finite(value) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value) : '—';
const money = (value, full = false) => finite(value) ? '$' + (full ? fmt(value, 2) : compact(value)) : '—';
const price = value => finite(value) ? '$' + value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : '—';
const percent = value => finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = value => value ? `${value.slice(0, 5)}…${value.slice(-5)}` : '—';
const dayMs = 86400000;
const utcDate = value => new Date(value).toISOString().slice(0, 10);
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) : 'Not supplied';
const monthDay = value => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
let snapshot = null;
let priceDays = 30;
let revenueDays = 30;
let activityWindow = 'h24';
let allHolders = false;
let allMarkets = false;
let loading = false;
let toastTimer;

function put(id, text) { $(id).textContent = text; }
function source(key) { return snapshot?.sources?.[key]; }
function data(key) { return source(key)?.data ?? null; }
function sourceDay(key) {
  const timestamp = source(key)?.sourceAsOf;
  return utcDate(timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : snapshot.generatedAt);
}
function signed(id, value, suffix = '%') {
  const element = $(id);
  element.textContent = finite(value) ? `${value > 0 ? '+' : ''}${fmt(value, 2)}${suffix}` : '—';
  element.classList.remove('positive', 'negative');
  if (finite(value) && value !== 0) element.classList.add(value > 0 ? 'positive' : 'negative');
}
function sum(rows, key) { return rows.reduce((total, row) => total + (number(row[key]) ?? 0), 0); }
function reportedTotal(rows, read) {
  const values = rows.map(row => number(read(row))).filter(finite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}
function sourceIsOld(s) {
  const timestamp = s.sourceAsOf || s.fetchedAt;
  return !timestamp || !Number.isFinite(Date.parse(timestamp)) || Date.now() - Date.parse(timestamp) > 2 * 3600000;
}
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '#'; } catch { return '#'; }
}
function link(url, label, className = '') { return `<a class="${esc(className)}" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`; }
function receipt(signature) {
  return typeof signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature) ? link(`https://solscan.io/tx/${signature}`, 'TX ↗', 'receipt') : '—';
}
function emptyRows(id, columns, text) { $(id).innerHTML = `<tr><td colspan="${columns}" class="empty-row">${esc(text)}</td></tr>`; }
function toast(text) { put('toast', text); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600); }

function marketPairs() {
  const seen = new Set();
  return (data('markets')?.pairs ?? []).filter(pair => {
    if (pair.chainId !== 'solana' || pair.baseToken?.address !== MINT || !pair.pairAddress || seen.has(pair.pairAddress)) return false;
    seen.add(pair.pairAddress);
    return true;
  });
}

function primaryPool() { return marketPairs().sort((a, b) => (number(b.liquidity?.usd) ?? 0) - (number(a.liquidity?.usd) ?? 0))[0]; }
function currentSupply() { return number(data('platformToken')?.supplyTokens) ?? number(data('holders')?.supply); }

function renderStatus() {
  const names = { markets: 'DEX markets', priceHistory: 'price history', revenue: 'revenue totals', daily: 'daily revenue', platformToken: 'supply', buybacks: 'buybacks', burns: 'burns', holders: 'holders' };
  const issues = Object.entries(snapshot.sources).filter(([, s]) => s.status !== 'ok' || sourceIsOld(s));
  const age = Date.now() - Date.parse(snapshot.generatedAt);
  const stale = age > 2 * 3600000;
  const okay = !issues.length && !stale;
  $('statusDot').className = `status-dot ${okay ? 'ok' : 'warn'}`;
  put('dataStatus', `${okay ? 'BOOKS UPDATED' : 'CHECK DATA AGE'} · ${stamp(snapshot.generatedAt).slice(0, 16)} UTC`);
  const notices = [];
  if (stale) notices.push('This published snapshot is over two hours old.');
  if (issues.length) notices.push(`Delayed or unavailable: ${issues.map(([key]) => names[key] || key).join(', ')}. Last collected values are retained when available; timestamps are below.`);
  $('notice').hidden = notices.length === 0;
  put('notice', notices.join(' '));
  $('sourceRows').innerHTML = Object.entries(snapshot.sources).sort(([a], [b]) => a.localeCompare(b)).map(([key, s]) => {
    const aged = sourceIsOld(s);
    return `<tr><td>${esc(names[key] || key)}</td><td>${esc(stamp(s.fetchedAt))}</td><td>${esc(stamp(s.sourceAsOf))}</td><td class="${s.status !== 'ok' || aged ? 'source-stale' : 'green'}">${esc(s.status === 'ok' ? aged ? 'OLD SNAPSHOT' : 'COLLECTED' : s.status.toUpperCase())}</td><td>${s.url ? link(s.url, 'API ↗', 'receipt') : '—'}</td></tr>`;
  }).join('');
}

function renderMarketSummary() {
  const primary = primaryPool();
  const pairs = marketPairs();
  const quote = number(primary?.priceUsd);
  const supply = currentSupply();
  put('price', price(quote));
  put('marketCap', money(quote !== null && supply !== null ? quote * supply : null));
  signed('priceChange', number(primary?.priceChange?.h24));
  put('volume', money(reportedTotal(pairs, p => p.volume?.h24)));
  put('liquidity', money(reportedTotal(pairs, p => p.liquidity?.usd)));
  put('poolCount', `${pairs.length} RETURNED STONK POOLS`);
  if (primary) $('chartLink').href = safeUrl(primary.url);
  const reportedCap = number(primary?.marketCap);
  put('supplyDiscrepancy', reportedCap && quote && supply
    ? `The primary pool reports ${money(reportedCap)} market cap; the desk computes ${money(quote * supply)} using ${compact(supply)} current supply (${data('platformToken')?.supplyTokens ? 'StonkFun' : 'RugCheck fallback'}). Pool metadata can use a different supply basis.`
    : 'Supply-adjusted value requires both a valid market quote and a current supply observation. Missing values are shown as dashes.');
}

function renderSupply() {
  const supply = currentSupply();
  const burned = number(data('burns')?.totals?.amountTokens) ?? number(data('revenue')?.totals?.stonkBurnedTokens);
  const basis = supply !== null && burned !== null ? supply + burned : null;
  put('supply', compact(supply));
  put('burnedTokens', compact(burned));
  put('supplyBasis', compact(basis));
  put('remainingPct', basis ? `${(supply / basis * 100).toFixed(1)}%` : '—');
  put('burnedPct', basis ? `${(burned / basis * 100).toFixed(1)}%` : '—');
  $('remainingBar').style.width = basis ? `${supply / basis * 100}%` : '0';
  $('burnedBar').style.width = basis ? `${burned / basis * 100}%` : '0';
  $('supplyTrack').setAttribute('aria-label', basis ? `${fmt(supply)} STONK remaining, ${fmt(burned)} platform-reported burns. Basis is remaining supply plus reported burns.` : 'Supply breakdown unavailable');
  const holders = data('holders');
  const authority = value => value === null ? 'Revoked' : value && value !== 'unknown' ? 'Active' : '—';
  put('mintAuthority', holders ? authority(holders.mintAuthority) : '—');
  put('freezeAuthority', holders ? authority(holders.freezeAuthority) : '—');
}

function chooseRange(id, value, attribute = 'days') {
  $(id).querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(String(button.dataset[attribute]) === String(value))));
}

/** Dependency-free SVG charts. One focus stop; arrow keys inspect data points. */
function drawChart(id, rows, series, options = {}) {
  const container = $(id);
  if (!rows.length) {
    container.innerHTML = `<p class="empty">${esc(options.empty || 'This dataset is unavailable.')}</p>`;
    container.setAttribute('aria-label', options.empty || 'Dataset unavailable');
    return;
  }
  const width = Math.max(container.clientWidth, 250);
  const height = container.clientHeight || 220;
  const partialDate = options.partialDate ?? utcDate(snapshot.generatedAt);
  const left = 4, right = 64, top = 16, bottom = 31;
  const plotW = width - left - right, plotH = height - top - bottom;
  const values = rows.flatMap(row => series.map(s => number(row[s.key]))).filter(finite);
  if (!values.length) { container.innerHTML = '<p class="empty">No valid values in this range.</p>'; return; }
  const rawMax = Math.max(...values);
  const rawMin = options.line ? Math.min(...values) : 0;
  const padding = (rawMax - rawMin || rawMax || 1) * .13;
  const low = options.line ? Math.max(0, rawMin - padding) : 0;
  const high = rawMax + padding;
  const y = value => top + plotH - (value - low) / (high - low || 1) * plotH;
  const dates = rows.map(row => Date.parse(row.date));
  const minDate = Math.min(...dates), maxDate = Math.max(...dates);
  const slots = Math.max(1, Math.round((maxDate - minDate) / dayMs) + 1);
  const slotW = plotW / slots;
  const x = index => options.line
    ? left + (maxDate === minDate ? plotW / 2 : (dates[index] - minDate) / (maxDate - minDate) * plotW)
    : left + ((dates[index] - minDate) / dayMs + .5) * slotW;
  let svg = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
  for (let i = 0; i <= 3; i++) {
    const value = low + (high - low) * i / 3;
    const yy = y(value);
    const label = options.price ? price(value) : `${options.currency ? '$' : ''}${compact(value)}`;
    svg += `<line class="gridline" x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}"/><text x="${width - right + 9}" y="${yy + 3}">${esc(label)}</text>`;
  }
  const labelIndices = [...new Set([0, Math.floor((rows.length - 1) / 3), Math.floor((rows.length - 1) * 2 / 3), rows.length - 1])];
  for (const index of labelIndices) {
    const anchor = index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle';
    svg += `<text x="${x(index)}" y="${height - 5}" text-anchor="${anchor}">${esc(monthDay(rows[index].date))}</text>`;
  }
  if (options.line) {
    const s = series[0];
    const points = rows.map((row, i) => [x(i), y(row[s.key])]);
    const line = points.map((point, i) => `${i ? 'L' : 'M'}${point.join(',')}`).join(' ');
    const fill = `${line} L${points.at(-1)[0]},${top + plotH} L${points[0][0]},${top + plotH} Z`;
    svg += `<defs><linearGradient id="${id}Fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${s.color}" stop-opacity=".13"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs><path d="${fill}" fill="url(#${id}Fill)"/><path d="${line}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/><circle cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="3.5" fill="${s.color}"/>`;
  } else {
    const groupWidth = Math.min(slotW * .68, 38);
    const barWidth = Math.max(.7, groupWidth / series.length - (series.length > 1 ? 1 : 0));
    rows.forEach((row, i) => series.forEach((s, j) => {
      const value = number(row[s.key]);
      if (value === null) return;
      svg += `<rect x="${x(i) - groupWidth / 2 + j * groupWidth / series.length}" y="${y(value)}" width="${barWidth}" height="${Math.max(0, top + plotH - y(value))}" fill="${s.color}" opacity="${row.date === partialDate ? '.5' : '1'}"/>`;
    }));
  }
  svg += `<line id="${id}Crosshair" x1="0" x2="0" y1="${top}" y2="${top + plotH}" stroke="#a2aa98" stroke-dasharray="3 4" visibility="hidden"/><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg>`;
  container.innerHTML = svg + '<div class="chart-tooltip" hidden></div>';
  container.tabIndex = 0;
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `${options.label}. ${rows.length} observations, ${rows[0].date} to ${rows.at(-1).date}. Use left and right arrow keys to inspect values.`);
  const tooltip = container.querySelector('.chart-tooltip');
  const crosshair = $(`${id}Crosshair`);
  let selected = rows.length - 1;
  function inspect(index) {
    selected = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[selected];
    tooltip.innerHTML = `<b>${esc(row.date)}${row.date === partialDate ? ' · partial' : ''}</b>` + series.map(s => `<div><span style="color:${s.color}">${esc(s.name)}</span> ${esc(s.format ? s.format(row[s.key]) : options.currency ? money(row[s.key], true) : fmt(row[s.key], 2))}</div>`).join('');
    tooltip.hidden = false;
    const xx = x(selected);
    tooltip.style.left = `${Math.max(0, Math.min(xx + 12, width - tooltip.offsetWidth - 2))}px`;
    tooltip.style.top = '8px';
    crosshair.setAttribute('x1', xx); crosshair.setAttribute('x2', xx); crosshair.setAttribute('visibility', 'visible');
    container.setAttribute('aria-label', `${options.label}. ${row.date}. ${series.map(s => `${s.name}: ${s.format ? s.format(row[s.key]) : fmt(row[s.key], 2)}`).join('. ')}. Left and right arrows change date.`);
  }
  function hide() { tooltip.hidden = true; crosshair.setAttribute('visibility', 'hidden'); }
  container.onpointermove = event => {
    const xx = event.clientX - container.getBoundingClientRect().left;
    let nearest = 0;
    rows.forEach((row, i) => { if (Math.abs(x(i) - xx) < Math.abs(x(nearest) - xx)) nearest = i; });
    inspect(nearest);
  };
  container.onpointerleave = hide;
  container.onfocus = () => inspect(selected);
  container.onblur = hide;
  container.onkeydown = event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); inspect(selected + (event.key === 'ArrowLeft' ? -1 : 1)); }
    if (event.key === 'Escape') hide();
  };
}

function renderPriceChart() {
  const history = data('priceHistory');
  const candles = history?.candles ?? [];
  const lastTime = candles.at(-1)?.[0];
  const cutoff = lastTime - (priceDays - 1) * 86400;
  const rows = candles.filter(c => c[0] >= cutoff && c.length === 6 && finite(c[4])).map(c => ({ date: utcDate(c[0] * 1000), close: c[4] }));
  const first = rows[0]?.close, last = rows.at(-1)?.close;
  put('chartPrice', price(last));
  const change = finite(first) && first > 0 && finite(last) ? (last / first - 1) * 100 : null;
  signed('chartChange', change);
  if (finite(change)) $('chartChange').append(document.createTextNode(` · ${priceDays}D DAILY CLOSES`));
  else put('chartChange', 'Daily closes · USD');
  chooseRange('priceRange', priceDays);
  const pool = marketPairs().find(p => p.pairAddress === history?.pool);
  put('priceChartSource', history ? `GeckoTerminal · ${pool ? `${pool.dexId} / ${pool.quoteToken.symbol}` : short(history.pool)} · daily UTC` : 'GeckoTerminal · price history unavailable');
  drawChart('priceChart', rows, [{ key: 'close', name: 'Close', color: '#c5f467', format: price }], { line: true, price: true, label: 'STONK daily closing price in USD', empty: 'Price history is unavailable. The market summary uses a separate source.' });
}

function completeDays(count, offset = 0) {
  const daily = data('daily')?.days;
  if (!daily) return null;
  const today = Date.parse(sourceDay('daily'));
  const dates = Array.from({ length: count }, (_, i) => utcDate(today - (i + 1 + offset) * dayMs));
  const rows = dates.map(date => daily.find(row => row.date === date));
  return rows.every(Boolean) ? rows : null;
}

function revenueValue(row) {
  const revenue = number(row.revenueUsd), quote = number(row.stonkQuoteRevenueUsd);
  return revenue !== null && quote !== null ? revenue + quote : null;
}

function renderBusiness() {
  const revenue = data('revenue');
  const totals = revenue?.totals;
  const lifetime = totals && finite(totals.totalRevenueUsd) && finite(totals.stonkQuoteRevenueUsd) ? totals.totalRevenueUsd + totals.stonkQuoteRevenueUsd : null;
  put('revenueTotal', money(lifetime));
  put('buybackTotal', money(number(totals?.totalBuybackUsd)));
  put('buybackShare', finite(revenue?.config?.buybackShare) ? `${fmt(revenue.config.buybackShare * 100)}%` : '60%');
  const week = completeDays(7), prior = completeDays(7, 7);
  const weekRevenue = week && week.every(row => revenueValue(row) !== null) ? week.reduce((total, row) => total + revenueValue(row), 0) : null;
  const priorRevenue = prior && prior.every(row => revenueValue(row) !== null) ? prior.reduce((total, row) => total + revenueValue(row), 0) : null;
  put('revenue7d', money(weekRevenue));
  put('buyback7d', money(week && week.every(row => finite(row.buybackUsd)) ? sum(week, 'buybackUsd') : null));
  if (finite(priorRevenue) && priorRevenue > 0 && finite(weekRevenue)) {
    signed('revenueTrend', (weekRevenue / priorRevenue - 1) * 100);
    $('revenueTrend').append(document.createTextNode(' vs preceding 7 days'));
  } else put('revenueTrend', 'Needs 14 complete UTC days');
  put('burn7d', week && week.every(row => finite(row.stonkBurnedTokens)) ? `${compact(sum(week, 'stonkBurnedTokens'))} STONK burned in the same period` : 'Burn history unavailable');
  const coverage = revenue?.coverage;
  put('coverageNote', coverage ? `Pricing coverage: ${fmt(coverage.revenueRowsUnpriced)} of ${fmt(coverage.revenueRows)} revenue rows and ${fmt(coverage.buybackRowsUnpriced)} of ${fmt(coverage.buybackRows)} buyback rows are unpriced. Unpriced entries are not included in USD totals.` : 'Ledger pricing coverage is unavailable.');
  renderBusinessCharts();
  renderReceipts();
}

function renderBusinessCharts() {
  const partialDate = sourceDay('daily');
  const cutoff = Date.parse(partialDate) - (revenueDays - 1) * dayMs;
  const rows = (data('daily')?.days ?? []).filter(row => Date.parse(row.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ ...row, revenueTotal: revenueValue(row) }));
  chooseRange('revenueRange', revenueDays);
  drawChart('revenueChart', rows, [{ key: 'revenueTotal', name: 'Revenue', color: '#cccbb7' }, { key: 'buybackUsd', name: 'Buybacks', color: '#c5f467' }], { currency: true, partialDate, label: 'Daily platform revenue and buybacks in USD' });
  drawChart('burnChart', rows, [{ key: 'stonkBurnedTokens', name: 'Burned', color: '#c5f467' }], { partialDate, label: 'Daily STONK token burns' });
}

function renderReceipts() {
  const buybacks = data('buybacks')?.rows;
  const burns = data('burns')?.burns;
  if (!buybacks?.length) emptyRows('buybackRows', 4, buybacks ? 'No recent buybacks returned.' : 'Buyback ledger unavailable.');
  else $('buybackRows').innerHTML = buybacks.slice(0, 8).map(row => `<tr><td>${esc(stamp(row.createdAt).slice(5, 16))}</td><td>${esc(money(number(row.spentValueUsd), true))}</td><td>${esc(fmt(number(row.boughtTokens), 1))}</td><td>${receipt(row.signature)}</td></tr>`).join('');
  if (!burns?.length) emptyRows('burnRows', 4, burns ? 'No recent burns returned.' : 'Burn ledger unavailable.');
  else $('burnRows').innerHTML = burns.slice(0, 8).map(row => `<tr><td>${esc(stamp(row.burnedAt).slice(5, 16))}</td><td>${esc(row.source === 'buyback' ? 'Buyback' : row.source === 'quote-revenue' ? 'Direct fee' : row.source)}</td><td>${esc(fmt(number(row.amountTokens), 1))}</td><td>${receipt(row.signature)}</td></tr>`).join('');
}

function renderHolders() {
  const holders = data('holders');
  put('holderCount', fmt(number(holders?.totalHolders)));
  put('topTenShare', finite(holders?.topTenNonPoolShare) ? `${holders.topTenNonPoolShare.toFixed(2)}%` : '—');
  if (!holders) {
    emptyRows('holderRows', 4, 'Holder data unavailable. No concentration or balances have been assumed.');
    $('distributionBar').replaceChildren(); $('distributionKey').replaceChildren();
    put('holderShown', 'No holder sample');
    $('moreHolders').hidden = true;
    return;
  }
  const distribution = [{ name: 'Non-pool owners in sample', share: holders.sampleNonPoolShare, color: '#c5f467' }, { name: 'Matched pools in sample', share: holders.samplePoolShare, color: '#dba266' }, { name: 'Outside the sample', share: Math.max(0, 100 - holders.sampleNonPoolShare - holders.samplePoolShare), color: '#535d49' }];
  $('distributionBar').innerHTML = distribution.map(item => `<span style="width:${item.share}%;background:${item.color}"></span>`).join('');
  $('distributionBar').setAttribute('aria-label', distribution.map(item => `${item.name}: ${item.share.toFixed(2)}%`).join('. '));
  $('distributionKey').innerHTML = distribution.map(item => `<li><span><i class="key" style="background:${item.color}"></i>${esc(item.name)}</span><b>${item.share.toFixed(2)}%</b></li>`).join('');
  put('holderCoverage', `${holders.sampleAccountCount} largest token accounts, grouped by owner. This is a sample of supply, not a full holder index.`);
  const includePools = $('showPools').checked;
  const rows = holders.rows.filter(row => includePools || !row.isPool);
  const visible = allHolders ? rows : rows.slice(0, 7);
  const baseline = snapshot.holderBaseline;
  $('holderRows').innerHTML = visible.map((row, index) => {
    const old = baseline?.balances?.[row.owner];
    const delta = finite(old) ? row.tokens - old : null;
    const change = finite(delta) ? `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${compact(Math.abs(delta))}` : '—';
    const type = row.isPool ? row.label || 'Matched liquidity pool' : 'Unattributed owner';
    return `<tr><td><div class="owner-cell"><span class="rank">${String(index + 1).padStart(2, '0')}</span><div>${link(`https://solscan.io/account/${row.owner}`, `${short(row.owner)} ↗`, 'owner-link')}<span class="account-kind">${esc(type)}</span></div></div></td><td>${compact(row.tokens)}</td><td><span class="share-cell"><span class="share-track"><i style="width:${Math.min(100, row.share / 6 * 100)}%"></i></span>${row.share.toFixed(2)}%</span></td><td class="${delta > 0 ? 'green' : delta < 0 ? 'red' : 'muted'}">${esc(change)}</td></tr>`;
  }).join('');
  put('holderShown', `${visible.length} / ${rows.length} ${includePools ? 'observed owners' : 'non-pool owners in sample'}`);
  $('moreHolders').hidden = rows.length <= 7;
  put('moreHolders', allHolders ? 'SHOW LESS ↑' : 'SHOW ALL ↓');
  put('holderBaseline', baseline?.baselineAt ? `Balance Δ compares observations at ${stamp(baseline.baselineAt).slice(0, 16)} and ${stamp(source('holders').fetchedAt).slice(0, 16)} UTC. A transfer is not a trade.` : `24h balance Δ is building a baseline${baseline?.firstObservationAt ? ` · first collected ${stamp(baseline.firstObservationAt).slice(0, 16)} UTC` : ''}. Missing owners are never treated as zero balances.`);
}

function renderActivity() {
  const pairs = marketPairs();
  const available = pairs.filter(p => p.txns?.[activityWindow] && finite(p.txns[activityWindow].buys) && finite(p.txns[activityWindow].sells));
  const buys = available.length ? available.reduce((total, p) => total + p.txns[activityWindow].buys, 0) : null;
  const sells = available.length ? available.reduce((total, p) => total + p.txns[activityWindow].sells, 0) : null;
  const total = buys !== null && sells !== null ? buys + sells : null;
  put('buys', fmt(buys)); put('sells', fmt(sells));
  const share = total ? buys / total * 100 : null;
  put('buyRatio', share !== null ? `${share.toFixed(1)}% / ${(100 - share).toFixed(1)}%` : total === 0 ? 'No trades in this window' : 'Unavailable');
  $('buyBar').style.width = share !== null ? `${share}%` : '0';
  $('sellBar').style.width = share !== null ? `${100 - share}%` : '0';
  $('tradeTrack').setAttribute('aria-label', `${fmt(buys)} buy trades and ${fmt(sells)} sell trades in ${activityWindow.slice(1)} hours, across ${available.length} returned pools with activity data`);
  chooseRange('activityRange', activityWindow, 'window');
}

function renderMarkets() {
  const pairs = marketPairs();
  const sort = $('marketSort').value;
  pairs.sort((a, b) => (sort === 'volume' ? number(b.volume?.h24) - number(a.volume?.h24) : number(b.liquidity?.usd) - number(a.liquidity?.usd)) || 0);
  if (!pairs.length) {
    emptyRows('marketRows', 6, 'Market data unavailable.');
    put('marketShown', 'No pools returned'); $('moreMarkets').hidden = true; return;
  }
  const visible = allMarkets ? pairs : pairs.slice(0, 6);
  $('marketRows').innerHTML = visible.map(p => {
    const change = number(p.priceChange?.h24);
    return `<tr><td><span class="venue-name">${esc(p.dexId)}</span><span class="venue-pair">STONK / ${esc(p.quoteToken?.symbol)}</span><span class="venue-type">${esc((p.labels ?? []).join(' · ') || 'AMM')} · ${esc(short(p.pairAddress))}</span></td><td>${esc(price(number(p.priceUsd)))}</td><td>${esc(money(number(p.liquidity?.usd)))}</td><td>${esc(money(number(p.volume?.h24)))}</td><td class="${change > 0 ? 'green' : change < 0 ? 'red' : 'muted'}">${esc(percent(change))}</td><td>${link(p.url, 'VIEW ↗', 'receipt')}</td></tr>`;
  }).join('');
  put('marketShown', `${visible.length} / ${pairs.length} returned pools · ${sort === 'volume' ? 'volume' : 'liquidity'} descending`);
  $('moreMarkets').hidden = pairs.length <= 6;
  put('moreMarkets', allMarkets ? 'SHOW LESS ↑' : 'SHOW ALL ↓');
}

function render() {
  renderStatus(); renderMarketSummary(); renderSupply(); renderPriceChart(); renderBusiness(); renderHolders(); renderActivity(); renderMarkets();
}

async function load(manual = false) {
  if (loading) return;
  loading = true;
  $('refreshButton').disabled = true;
  try {
    const response = await fetch(`data/snapshot.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    const next = await response.json();
    if (next.mint !== MINT || next.schemaVersion !== 1 || !next.sources || !Number.isFinite(Date.parse(next.generatedAt))) throw new Error('Snapshot schema or mint mismatch');
    const changed = snapshot?.generatedAt !== next.generatedAt;
    snapshot = next;
    if (changed || manual) render(); else renderStatus();
    if (manual) toast(changed ? 'Latest published books loaded.' : 'You have the latest published snapshot.');
  } catch (error) {
    console.error('STONK data load failed:', error);
    $('statusDot').className = 'status-dot warn';
    put('dataStatus', snapshot ? 'RELOAD FAILED · SHOWING PREVIOUS SNAPSHOT' : 'THE BOOKS ARE UNAVAILABLE');
    $('notice').hidden = false;
    put('notice', snapshot ? 'The published data could not be reloaded. The previous snapshot is still displayed; check its source timestamps below.' : 'Could not load data/snapshot.json. Serve this folder over HTTP and run python scripts/refresh.py to collect the public data, then press Refresh.');
  } finally { loading = false; $('refreshButton').disabled = false; }
}

function wireRange(id, callback, attribute = 'days') {
  $(id).addEventListener('click', event => { const button = event.target.closest('button'); if (button && snapshot) callback(button.dataset[attribute]); });
}
wireRange('priceRange', days => { priceDays = Number(days); renderPriceChart(); });
wireRange('revenueRange', days => { revenueDays = Number(days); renderBusinessCharts(); });
wireRange('activityRange', window => { activityWindow = window; renderActivity(); }, 'window');
$('showPools').addEventListener('change', () => { if (snapshot) renderHolders(); });
$('moreHolders').addEventListener('click', () => { allHolders = !allHolders; renderHolders(); });
$('moreMarkets').addEventListener('click', () => { allMarkets = !allMarkets; renderMarkets(); });
$('marketSort').addEventListener('change', () => { if (snapshot) renderMarkets(); });
$('refreshButton').addEventListener('click', () => load(true));
$('copyMint').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(MINT); toast('Contract copied. Check the address, always.'); }
  catch { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents($('mint')); selection.removeAllRanges(); selection.addRange(range); toast('Address selected. Press Ctrl+C or use Copy.'); }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (snapshot) { renderPriceChart(); renderBusinessCharts(); } }, 150); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(() => { if (!document.hidden) load(); }, 60000);
load();
