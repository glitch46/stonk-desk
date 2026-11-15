# STONK / Desk

An independent analytics dashboard for **STONK** on Solana:

`6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx`

**Live:** https://glitch46.github.io/stonk-desk/

Inspired by the VVV dashboard's static site + scheduled JSON collection structure. Plain HTML, CSS, JavaScript, and a Python standard-library collector. No build step, application dependencies, API keys, or wallet connection.

## Preview locally

From this folder:

```powershell
python -m http.server 8766 --bind 127.0.0.1
```

Open **http://127.0.0.1:8766**. A real collected snapshot is included. Opening `index.html` directly as a `file://` URL cannot load JSON in most browsers.

To collect fresh data, run in another terminal:

```powershell
python scripts/refresh.py
```

The page checks for newly published JSON every minute while visible. **Refresh** reloads the published snapshot; it does not trigger collection at the upstream APIs.

## On the desk

- Price, supply-adjusted token value, returned-pool volume and liquidity.
- 7 / 30 / 90-day closing-price chart with pointer and keyboard inspection.
- Lifetime revenue and buybacks; last seven **complete UTC days**, excluding the provider's current day, even if a delayed response crosses midnight locally.
- Daily revenue, buybacks, and tokens burned; today is labeled partial.
- Recent buyback and burn receipts linked to Solscan.
- Current supply, platform-reported burns, mint and freeze authority state.
- Holder count, sample concentration, non-pool owner rankings, optional pool rows.
- Approximately 24-hour observed balance changes once a baseline exists.
- Pool sorting, expandable tables, and 1h / 6h / 24h trade counts.
- Per-source collection timestamps, provider timestamps where supplied, and explicit unavailable/stale states.

## Sources and calculations

| Data | Source | Treatment |
| --- | --- | --- |
| Market snapshot | DexScreener token endpoint | Exact mint and Solana chain filter; deduplicate pair addresses. Price from the returned pool with the highest reported USD liquidity. |
| Price history | GeckoTerminal OHLCV | Daily USD closes for that pool; up to 100 returned daily candles, calendar-based ranges. Missing dates are not fabricated. |
| Current supply | StonkFun `/api/v2/revenue/platform-token` | Falls back to RugCheck supply if unavailable; the fallback is identified in methodology. |
| Revenue | StonkFun `/api/v2/revenue/summary` and `/daily` | `totalRevenueUsd + stonkQuoteRevenueUsd` for lifetime revenue, and `revenueUsd + stonkQuoteRevenueUsd` for each day, following the API's documented exclusions. |
| Buybacks | StonkFun `/api/v2/revenue/buybacks` | USD spent at the time, not marked-to-market token value. |
| Burns | StonkFun token `/burns`, plus daily revenue ledger | Direct fee burns and buyback burns remain distinct in the receipts. The separate ecosystem flywheel is not treated as STONK buybacks. |
| Holder report | RugCheck `/v1/tokens/{mint}/report` | Largest token-account sample. Convert **raw amounts** using decimals, group by owner, match pool addresses/vaults, and retain unattributed labels for other owners. |

**Market cap discrepancy:** some pools report market caps consistent with an older supply basis. The headline is deliberately labeled **supply-adjusted value**: primary-pool price × current **total** supply. It is not represented as a verified circulating market cap. The methodology compares it with the primary pool's own market cap.

**Supply chart:** its basis is current supply + platform-reported lifetime burns. It is not a hardcoded genesis allocation or proof that the platform accounts for every historic burn.

**Holder concentration:** top ten non-pool owners **within the returned largest-account sample**, divided by that report's supply. It is not a full-chain wallet index. A source-reported holder count is not a count of people. Matched pools can include lockers; unmatched accounts can still be custodians or contracts.

**Balance changes:** `data/holder-history.json` stores up to 31 days of hourly observations. A delta needs an observation 20–28 hours earlier, choosing the nearest to 24 hours, and the owner must be in both samples. Missing owners are unknown, never assumed to have sold everything. Before that, the table explicitly says the baseline is building. Collection time does not establish the age of RugCheck's underlying chain scan.

**Freshness and failures:** each source has its own timestamp and status. Successful sources update independently. Failed sources retain their last valid values and are labeled stale; a first failure leaves the dataset unavailable. Snapshots over two hours old are visibly flagged, as are old provider timestamps when supplied. Figures from different sources are not atomic or necessarily simultaneous. USD coverage excludes unpriced ledger entries and is reported on the page.

## GitHub Pages

This repository is already deployed at **https://glitch46.github.io/stonk-desk/** with Pages set to **GitHub Actions** (`build_type: workflow`). `refresh.yml` and `pages.yml` are both active; no secrets are required.

To run it from your own fork or account:

1. Publish the folder as the **root of a repository**.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Run **Deploy dashboard** once, or push to `main` / `master`.

`refresh.yml` collects data at minutes 7 and 37 of every hour and commits the two data files. GitHub can delay scheduled runs. `pages.yml` deploys both on ordinary pushes and after successful refresh workflows: this explicit workflow trigger is needed because bot-token commits do not trigger ordinary push workflows.

The collector-only observation history is kept in the repository for continuity but omitted from the Pages artifact. No secrets are needed. StonkFun's v2 API does not offer browser CORS; the scheduled Python collector handles those requests server-side.

## Files

```text
index.html                    Semantic dashboard layout
styles.css                    Responsive trading-desk design
app.js                        Rendering, SVG charts, filters, snapshot refresh
assets/stonk-ape.svg           Text-free ape and candlestick badge
scripts/refresh.py            Public data collection, validation, last-good cache
scripts/test_refresh.py       Accounting and outage regression checks
data/snapshot.json            Published source data and holder baseline
data/holder-history.json      Rolling holder observations for the collector
.github/workflows/            Collection and Pages deployment
```

Fonts are loaded from Google Fonts with system fallbacks. Charts and graphics are local SVG; the application needs no JavaScript CDN.

## Verification

```powershell
python -m unittest discover -s scripts -p "test_refresh.py" -v
node --check app.js
```

The collector tests cover raw balance accounting, pool exclusion, owner grouping, incorrect-token rejection, last-good preservation, missing data, and the holder-baseline rules.
