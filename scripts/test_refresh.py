"""Regression checks for financial source handling; no network requests."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import refresh


class SourceAccountingTests(unittest.TestCase):
    def report(self):
        return {"mint": refresh.MINT, "token": {"supply": 1000000000000, "decimals": 9,
                "mintAuthority": None, "freezeAuthority": None}, "totalHolders": 100,
                "topHolders": [
                    {"address": "account1", "owner": "owner1", "amount": "100000000000", "uiAmount": 9999, "decimals": 9},
                    {"address": "account2", "owner": "owner1", "amount": "50000000000", "decimals": 9},
                    {"address": "vault", "owner": "pool", "amount": "300000000000", "decimals": 9},
                ], "markets": [{"pubkey": "pool", "liquidityA": "vault"}], "knownAccounts": {}}

    def test_raw_balances_group_by_owner_and_exclude_pool_from_concentration(self):
        value = refresh.normalize_holders(self.report())
        self.assertEqual(value["supply"], 1000)
        self.assertEqual(value["sampleAccountCount"], 3)
        self.assertEqual(len(value["rows"]), 2)
        self.assertEqual(value["topTenNonPoolShare"], 15)
        self.assertEqual(value["samplePoolShare"], 30)
        self.assertEqual(value["sampleNonPoolShare"], 15)
        self.assertEqual(value["rows"][1]["tokens"], 150)

    def test_wrong_mint_and_incomplete_holder_report_are_rejected(self):
        report = self.report()
        report["mint"] = "different-token"
        with self.assertRaises(ValueError):
            refresh.validate("holders", report)
        report["mint"] = refresh.MINT
        report["topHolders"] = []
        with self.assertRaises(ValueError):
            refresh.validate("holders", report)

    def test_failed_source_retains_previous_value_and_timestamp(self):
        previous = {"revenue": {"data": {"totals": {"totalBuybackUsd": 123}}, "fetchedAt": "2026-11-13T00:00:00+00:00"}}
        with patch.object(refresh, "fetch", side_effect=TimeoutError("test timeout")):
            key, value = refresh.collect("revenue", "https://example.com", previous)
        self.assertEqual(key, "revenue")
        self.assertEqual(value["status"], "stale")
        self.assertEqual(value["data"], previous["revenue"]["data"])
        self.assertEqual(value["fetchedAt"], previous["revenue"]["fetchedAt"])

    def test_first_source_failure_is_unknown_not_zero(self):
        with patch.object(refresh, "fetch", side_effect=TimeoutError("test timeout")):
            _, value = refresh.collect("revenue", "https://example.com", {})
        self.assertEqual(value["status"], "unavailable")
        self.assertNotIn("data", value)

    def test_baseline_requires_20_to_28_hours_and_never_fills_missing_owners(self):
        current = datetime(2026, 11, 14, 18, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory, patch.object(refresh, "DATA", Path(directory)):
            path = Path(directory) / "holder-history.json"
            history = {"snapshots": [{"at": (current - timedelta(hours=24)).isoformat(), "balances": {"existing": 100}},
                                      {"at": (current - timedelta(hours=1)).isoformat(), "balances": {"new": 50}}]}
            path.write_text(json.dumps(history), encoding="utf-8")
            result = refresh.update_holder_history({"status": "ok", "fetchedAt": current.isoformat(),
                     "data": {"rows": [{"owner": "existing", "tokens": 90}, {"owner": "new", "tokens": 60}]}})
            self.assertEqual(result["balances"], {"existing": 100})
            self.assertNotIn("new", result["balances"])

    def test_first_observation_has_no_fabricated_baseline(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(refresh, "DATA", Path(directory)):
            result = refresh.update_holder_history({"status": "ok", "fetchedAt": "2026-11-14T18:00:00+00:00",
                     "data": {"rows": [{"owner": "one", "tokens": 100}]}})
        self.assertIsNone(result["baselineAt"])
        self.assertEqual(result["balances"], {})


if __name__ == "__main__":
    unittest.main()
