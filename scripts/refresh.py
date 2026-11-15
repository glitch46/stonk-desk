"""Collect public STONK data for a static site. Python standard library only."""

import concurrent.futures
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MINT = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx"
API = "https://www.stonkfun.xyz/api/v2/revenue"
ENDPOINTS = {
    "markets": f"https://api.dexscreener.com/latest/dex/tokens/{MINT}",
    "revenue": f"{API}/summary",
    "daily": f"{API}/daily?limit=100&order=desc",
    "platformToken": f"{API}/platform-token",
    "buybacks": f"{API}/buybacks?limit=12&order=desc",
    "burns": f"https://www.stonkfun.xyz/api/public/v1/tokens/{MINT}/burns?limit=12",
    "holders": f"https://api.rugcheck.xyz/v1/tokens/{MINT}/report",
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "STONKDashboard/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=35) as response:
                result = json.load(response)
            if not isinstance(result, dict) or result.get("error"):
                raise ValueError("Source returned an invalid response")
            return result
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def token_amount(raw, decimals):
    return float(Decimal(str(raw)) / (Decimal(10) ** int(decimals)))


def normalize_holders(report):
    if report.get("mint") != MINT:
        raise ValueError("Holder report mint mismatch")
    token = report["token"]
    supply = token_amount(token["supply"], token["decimals"])
    if supply <= 0 or not isinstance(report.get("topHolders"), list) or not report["topHolders"]:
        raise ValueError("Holder report is incomplete")
    known = report.get("knownAccounts", {})
    pools = set()
    for market in report.get("markets", []):
        for key in ("pubkey", "liquidityA", "liquidityB"):
            if market.get(key):
                pools.add(market[key])
    owners = {}
    for holder in report["topHolders"]:
        owner = holder.get("owner") or holder["address"]
        account = holder["address"]
        label = known.get(account) or known.get(owner) or {}
        is_pool = owner in pools or account in pools or label.get("type") == "AMM"
        row = owners.setdefault(owner, {"owner": owner, "accounts": [], "tokens": 0, "isPool": is_pool,
                                        "label": label.get("name") if is_pool else None})
        row["accounts"].append(account)
        # RugCheck's uiAmount can disagree with its raw amount. Use raw integers.
        row["tokens"] += token_amount(holder["amount"], holder["decimals"])
        row["isPool"] = row["isPool"] or is_pool
    rows = sorted(owners.values(), key=lambda row: row["tokens"], reverse=True)
    for row in rows:
        row["share"] = row["tokens"] / supply * 100
    wallets = [row for row in rows if not row["isPool"]]
    return {"supply": supply, "totalHolders": report.get("totalHolders"), "rows": rows,
            "sampleAccountCount": len(report["topHolders"]),
            "topTenNonPoolShare": sum(row["share"] for row in wallets[:10]),
            "samplePoolShare": sum(row["share"] for row in rows if row["isPool"]),
            "sampleNonPoolShare": sum(row["share"] for row in wallets),
            "mintAuthority": token.get("mintAuthority", "unknown"), "freezeAuthority": token.get("freezeAuthority", "unknown"),
            "metadataMutable": report.get("tokenMeta", {}).get("mutable")}


def validate(key, raw):
    if key == "markets":
        pairs = raw.get("pairs")
        if not isinstance(pairs, list) or not any(p.get("baseToken", {}).get("address") == MINT for p in pairs):
            raise ValueError("No STONK markets returned")
    elif key == "holders":
        return normalize_holders(raw)
    elif key == "revenue":
        if raw.get("config", {}).get("platformTokenMint") != MINT or not isinstance(raw.get("totals"), dict):
            raise ValueError("Revenue response is incomplete or has a different mint")
    elif key == "platformToken":
        if raw.get("platformTokenMint") != MINT or not raw.get("supplyTokens"):
            raise ValueError("Platform supply is unavailable")
    elif key == "daily":
        if not raw.get("days") or not raw.get("generatedAt"):
            raise ValueError("Revenue history is unavailable")
    elif key == "buybacks":
        if not isinstance(raw.get("rows"), list):
            raise ValueError("Buyback ledger is unavailable")
    elif key == "burns":
        if raw.get("data", {}).get("mint") != MINT or not raw["data"].get("totals"):
            raise ValueError("Burn response is incomplete or has a different mint")
        return raw["data"]
    return raw


def collect(key, url, previous):
    try:
        raw = fetch(url)
        value = validate(key, raw)
        return key, {"status": "ok", "fetchedAt": now(),
                     "sourceAsOf": raw.get("generatedAt") or raw.get("meta", {}).get("generatedAt"),
                     "url": url, "data": value}
    except Exception as error:
        print(f"  {key}: {type(error).__name__}: {error}")
        cached = previous.get(key, {})
        return key, {**cached, "status": "stale" if cached.get("data") is not None else "unavailable",
                     "url": url, "error": str(error), "lastAttemptAt": now()}


def update_holder_history(source):
    path = DATA / "holder-history.json"
    history = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"snapshots": []}
    if source["status"] == "ok":
        rows = source["data"]["rows"]
        snapshot = {"at": source["fetchedAt"], "balances": {row["owner"]: row["tokens"] for row in rows}}
        # Store at most one observation per UTC hour. Missing owners are unknown, never zero.
        if history["snapshots"] and history["snapshots"][-1]["at"][:13] == snapshot["at"][:13]:
            history["snapshots"][-1] = snapshot
        else:
            history["snapshots"].append(snapshot)
        history["snapshots"] = history["snapshots"][-24 * 31:]
        write_json(path, history)
    snapshots = history["snapshots"]
    current_time = datetime.fromisoformat(source["fetchedAt"]) if source.get("fetchedAt") else None
    candidates = [s for s in snapshots if current_time and
                  20 * 3600 <= (current_time - datetime.fromisoformat(s["at"])).total_seconds() <= 28 * 3600]
    baseline = min(candidates, key=lambda s: abs((current_time - datetime.fromisoformat(s["at"])).total_seconds() - 86400)) if candidates else None
    return {"firstObservationAt": snapshots[0]["at"] if snapshots else None,
            "baselineAt": baseline["at"] if baseline else None, "balances": baseline["balances"] if baseline else {}}


def write_json(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def main():
    DATA.mkdir(exist_ok=True)
    destination = DATA / "snapshot.json"
    previous = json.loads(destination.read_text(encoding="utf-8")).get("sources", {}) if destination.exists() else {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(collect, key, url, previous) for key, url in ENDPOINTS.items()]
        sources = dict(future.result() for future in concurrent.futures.as_completed(futures))
    markets = sources["markets"].get("data", {}).get("pairs", [])
    qualifying = [p for p in markets if p.get("chainId") == "solana" and p.get("baseToken", {}).get("address") == MINT]
    primary = max(qualifying, key=lambda p: p.get("liquidity", {}).get("usd", 0), default=None)
    if primary:
        pool = primary["pairAddress"]
        url = f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/day?aggregate=1&limit=100&currency=usd&token=base"
        _, chart = collect("priceHistory", url, previous)
        if chart["status"] == "ok":
            try:
                if chart["data"]["meta"]["base"]["address"] != MINT:
                    raise ValueError("Chart mint mismatch")
                candles = chart["data"]["data"]["attributes"]["ohlcv_list"]
                if not candles or not all(len(c) == 6 and all(isinstance(v, (float, int)) for v in c) for c in candles):
                    raise ValueError("Invalid price candles")
                chart["data"] = {"pool": pool, "candles": sorted(candles, key=lambda c: c[0])}
            except (KeyError, TypeError, ValueError) as error:
                cached = previous.get("priceHistory", {})
                chart = {**cached, "url": url, "status": "stale" if cached.get("data") else "unavailable", "error": str(error)}
        sources["priceHistory"] = chart
    else:
        cached = previous.get("priceHistory", {})
        sources["priceHistory"] = {**cached, "status": "stale" if cached.get("data") else "unavailable"}
    baseline = update_holder_history(sources["holders"])
    snapshot = {"schemaVersion": 1, "mint": MINT, "generatedAt": now(), "sources": sources, "holderBaseline": baseline}
    if not any(source.get("data") for source in sources.values()):
        raise SystemExit("No source data available; snapshot was not written")
    write_json(destination, snapshot)
    for key, source in sorted(sources.items()):
        print(f"  {key}: {source['status']}")
    print(f"Saved {destination}")


if __name__ == "__main__":
    main()
