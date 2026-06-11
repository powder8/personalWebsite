"""Offline unit tests for the finances pipeline's pure functions.

Run: FINANCES_NO_NETWORK=1 python3 -m unittest finances/test_build.py
(the env var skips build.py's module-level Yahoo SSL probe so this imports with
no network access).
"""
import os
import math
import random
import unittest
import json as _json
import pathlib as _pathlib

os.environ.setdefault("FINANCES_NO_NETWORK", "1")

import build  # noqa: E402  (env var must be set before import)


class TestLinearAlgebra(unittest.TestCase):
    def test_inverse_identity(self):
        A = [[4.0, 7.0, 2.0], [3.0, 6.0, 1.0], [2.0, 5.0, 3.0]]
        Ai = build._mat_inverse(A)
        prod = [[sum(A[i][k] * Ai[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        for i in range(3):
            for j in range(3):
                self.assertAlmostEqual(prod[i][j], 1.0 if i == j else 0.0, places=9)

    def test_inverse_singular_raises(self):
        with self.assertRaises(ValueError):
            build._mat_inverse([[1.0, 2.0], [2.0, 4.0]])


class TestOLS(unittest.TestCase):
    def _factors(self, n, seed=0):
        rng = random.Random(seed)
        return [[rng.gauss(0, 0.04), rng.gauss(0, 0.03), rng.gauss(0, 0.03)] for _ in range(n)]

    def test_noiseless_recovery(self):
        X = self._factors(120)
        alpha, b = 0.002, [1.05, 0.40, 0.30]
        y = [alpha + sum(b[j] * X[i][j] for j in range(3)) for i in range(120)]
        res = build.ols(y, X)
        self.assertIsNotNone(res)
        self.assertAlmostEqual(res["coef"][0], alpha, places=9)
        for j in range(3):
            self.assertAlmostEqual(res["coef"][1 + j], b[j], places=9)
        self.assertAlmostEqual(res["r2"], 1.0, places=9)

    def test_noisy_recovers_within_tolerance(self):
        X = self._factors(240, seed=3)
        rng = random.Random(7)
        alpha, b = 0.001, [0.95, 0.50, -0.20]
        y = [alpha + sum(b[j] * X[i][j] for j in range(3)) + rng.gauss(0, 0.001) for i in range(240)]
        res = build.ols(y, X)
        for j in range(3):
            self.assertAlmostEqual(res["coef"][1 + j], b[j], places=1)
        self.assertGreater(res["r2"], 0.95)

    def test_singular_regressors_returns_none(self):
        X = [[a, a, b] for a, _, b in self._factors(60)]  # col0 == col1
        y = [random.Random(1).random() for _ in range(60)]
        self.assertIsNone(build.ols(y, X))

    def test_underdetermined_returns_none(self):
        self.assertIsNone(build.ols([1.0, 2.0], [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]))


class TestStats(unittest.TestCase):
    def test_tstat_mean_known(self):
        xs = [1.0, 2.0, 3.0, 4.0, 5.0]  # mean 3, sample sd ~1.5811
        t, n, mean = build.tstat_mean(xs)
        self.assertEqual(n, 5)
        self.assertAlmostEqual(mean, 3.0, places=9)
        self.assertAlmostEqual(t, 3.0 / (statistics_stdev(xs) / math.sqrt(5)), places=6)

    def test_tracking_identical_is_zero(self):
        r = [0.01 * ((i % 5) - 2) for i in range(36)]
        ts = build.tracking_stats(r, list(r))
        self.assertAlmostEqual(ts["te_annual"], 0.0, places=12)
        self.assertAlmostEqual(ts["tstat"], 0.0, places=12)

    def test_tracking_constant_offset(self):
        bench = [0.01 * ((i % 7) - 3) for i in range(48)]
        fund = [b + 0.002 for b in bench]  # +0.2%/mo
        ts = build.tracking_stats(fund, bench)
        self.assertAlmostEqual(ts["mean_excess_annual"], 0.024, places=6)
        self.assertLess(ts["te_annual"], 1e-9)
        self.assertGreater(ts["ir"], 100)

    def test_tracking_too_short_none(self):
        self.assertIsNone(build.tracking_stats([0.01] * 6, [0.0] * 6))


class TestTimeSeries(unittest.TestCase):
    def test_resample_monthly_takes_last(self):
        series = {"2020-01-05": 10.0, "2020-01-31": 12.0, "2020-02-03": 13.0, "2020-02-27": 14.0}
        m = build.resample_monthly(series)
        self.assertEqual(m["2020-01"], 12.0)
        self.assertEqual(m["2020-02"], 14.0)

    def test_align_monthly_intersection(self):
        a = {"2020-01": 1.0, "2020-02": 2.0, "2020-03": 3.0}
        b = {"2020-02": 20.0, "2020-03": 30.0, "2020-04": 40.0}
        months, aligned = build.align_monthly({"A": a, "B": b})
        self.assertEqual(months, ["2020-02", "2020-03"])
        self.assertEqual(aligned["A"], [2.0, 3.0])
        self.assertEqual(aligned["B"], [20.0, 30.0])

    def test_monthly_returns(self):
        r = build.monthly_returns([100.0, 110.0, 99.0])
        self.assertEqual(len(r), 2)
        self.assertAlmostEqual(r[0], 0.10, places=12)
        self.assertAlmostEqual(r[1], -0.10, places=12)

    def test_window_metrics_constant_growth(self):
        g = 0.12
        n = build.TRADING_DAYS * 3
        vals = [100.0 * (1 + g) ** (i / build.TRADING_DAYS) for i in range(n + 1)]
        m = build.window_metrics(vals)
        self.assertAlmostEqual(m["cagr"], g, places=6)
        self.assertAlmostEqual(m["mdd"], 0.0, places=9)

    def test_multi_horizon_inception_recovers_cagr(self):
        g = 0.08
        start = build.datetime(2016, 1, 1)
        series = {}
        for i in range(build.TRADING_DAYS * 4):
            d = (start + build_timedelta(i)).date().isoformat()
            series[d] = 50.0 * (1 + g) ** (i / build.TRADING_DAYS)
        mh = build.multi_horizon(series, [1, 3], as_of_iso=max(series))
        self.assertIn("1y", mh)
        self.assertIn("3y", mh)
        self.assertAlmostEqual(mh["inception"]["cagr"], g, places=6)


class TestTax(unittest.TestCase):
    def test_breakeven_hand_computed(self):
        r = build.tax_switch_breakeven(10000.0, 0.40, 0.238, 0.0137)
        self.assertAlmostEqual(r["tax_cost"], 952.0, places=6)
        self.assertAlmostEqual(r["annual_savings"], 137.0, places=6)
        self.assertAlmostEqual(r["breakeven_years"], 952.0 / 137.0, places=6)

    def test_breakeven_no_savings_none(self):
        r = build.tax_switch_breakeven(10000.0, 0.40, 0.238, 0.0)
        self.assertIsNone(r["breakeven_years"])


class TestFeeValue(unittest.TestCase):
    def test_fee_drag_one_year_hand_computed(self):
        out = build.fee_drag_projection(100000.0, 0.07, 0.014, 0.0005, [1])
        row = out[0]
        self.assertAlmostEqual(row["term_high"], 100000 * 1.07 * 0.986, places=4)
        self.assertAlmostEqual(row["term_low"], 100000 * 1.07 * 0.9995, places=4)
        self.assertGreater(row["term_low"], row["term_high"])
        self.assertGreater(row["gap"], 0)
        self.assertTrue(0 < row["gap_pct"] < 1)

    def test_fee_drag_compounds(self):
        out = build.fee_drag_projection(100000.0, 0.07, 0.014, 0.0005, [10, 30])
        self.assertGreater(out[1]["gap_pct"], out[0]["gap_pct"])  # bigger share lost over 30y

    def test_flat_vs_aum_hand_computed(self):
        r = build.flat_vs_aum(100000.0, 0.07, 0.014, 4000.0, 0.0005, [1])
        row = r["rows"][0]
        self.assertAlmostEqual(row["aum"], 100000 * 1.07 * 0.986, places=4)
        self.assertAlmostEqual(row["flat"], 100000 * 1.07 * 0.9995 - 4000, places=4)
        self.assertAlmostEqual(row["diy"], 100000 * 1.07 * 0.9995, places=4)
        self.assertAlmostEqual(r["breakeven_balance"], 4000 / 0.014, places=4)


class TestRenderGraceful(unittest.TestCase):
    """The deep-analysis cards must vanish when their data is absent, and the full
    page must still render when they're present."""
    DATA = _pathlib.Path(__file__).resolve().parent / "data.json"

    def _base(self):
        if not self.DATA.exists():
            self.skipTest("data.json not present")
        return _json.loads(self.DATA.read_text())

    def test_cards_empty_when_absent(self):
        r = self._base()
        for fn in ("render_multihorizon", "render_factor", "render_significance", "render_tax",
                   "render_fee_drag", "render_replication", "render_flat_fee", "render_services"):
            self.assertEqual(getattr(build, fn)(r), "", fn + " should be empty")
        html = build.render(r, "", build.load_history())
        self.assertIn("Leaderboard", html)
        self.assertIn("Bottom line", html)  # deterministic verdict always present
        self.assertEqual(html.count("<svg"), html.count("</svg>"))

    def test_cards_render_when_present(self):
        r = self._base()
        r["deep_meta"] = {"lookback_years": 10, "horizons": [1, 3, 5, 10]}
        win = {"cagr": 0.12, "vol": 0.15, "mdd": -0.2, "sharpe": 0.8, "years": 5}
        r["multihorizon"] = [{"ticker": "DFEOX", "name": "DFA US Core Equity 2",
                              "role": "manager fund", "horizons": {
                                  "first_date": "2005-01-03", "1y": win, "3y": win,
                                  "5y": win, "10y": None, "inception": win}}]
        r["factor"] = {"target": "DFEOX", "fee": 0.014, "alpha_annual": -0.01,
                       "alpha_t": -1.3, "beta_mkt": 0.99, "beta_smb": 0.2,
                       "beta_hml": 0.1, "r2": 0.97, "n_months": 120}
        r["significance"] = {"target": "DFEOX", "benchmark": "VTI", "te_annual": 0.03,
                             "ir": -0.4, "mean_excess_annual": -0.01, "tstat": -0.9,
                             "n_months": 120}
        r["tax"] = build.tax_switch_breakeven(2800.0, 0.40, 0.238, 0.0137)
        r["illustration_value"] = 500000
        r["fee_drag"] = {"value": 500000, "gross_return": 0.07, "fee_high": 0.014,
                         "fee_low": 0.0005,
                         "rows": build.fee_drag_projection(500000, 0.07, 0.014, 0.0005, [10, 20, 30])}
        r["replication"] = {"target": "DFEOX", "manager_fee": 0.014, "r2": 0.97,
                            "tracking_error": 0.02, "blended_er": 0.0008, "n_months": 120,
                            "components": [{"ticker": "VTI", "weight": 0.7, "expense_ratio": 0.0003},
                                           {"ticker": "AVUV", "weight": 0.3, "expense_ratio": 0.0025}]}
        ff = build.flat_vs_aum(500000, 0.07, 0.014, 4000, 0.0005, [10, 20, 30])
        ff.update({"value": 500000, "flat_fee": 4000, "gross_return": 0.07})
        r["flat_fee"] = ff
        r["services"] = [{"name": "Planning", "note": "x"}, {"name": "Tax", "note": "y"}]
        html = build.render(r, "", build.load_history())
        for marker in ("Across time horizons", "factor view", "significance", "cost of switching",
                       "What the fee costs over time", "replication", "flat-fee advisor",
                       "What does the fee buy"):
            self.assertIn(marker, html)
        self.assertEqual(html.count("<svg"), html.count("</svg>"))
        self.assertNotIn("Alternatives worth researching", html)


# small local helpers so tests stay dependency-free
import statistics as _stats  # noqa: E402
from datetime import timedelta as build_timedelta  # noqa: E402


def statistics_stdev(xs):
    return _stats.stdev(xs)


if __name__ == "__main__":
    unittest.main()
