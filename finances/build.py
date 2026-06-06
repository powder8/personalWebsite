#!/usr/bin/env python3
"""
Manager-vs-Index — builds finances/index.html for badoo.net/finances/.

Compares the money manager's actual positions ($1,200 AMZN + $1,600 DFEOX, today's
values) against passive Vanguard strategies, seeding every strategy a year ago with the
same starting capital, then projects the coming quarters and writes an analyst memo.

No dependencies beyond the Python 3.10+ standard library. Reads config from
strategies.json; writes index.html + data.json next to this script.
"""

import json
import math
import os
import ssl
import statistics
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, date
from html import escape as html_esc
from pathlib import Path

DIR = Path(__file__).parent
CONFIG = json.loads((DIR / "strategies.json").read_text())

# ─── SSL shim (macOS Python often lacks certs; fall back to unverified) ───────
SSL_CTX = ssl.create_default_context()
try:
    urllib.request.urlopen("https://query1.finance.yahoo.com", timeout=5, context=SSL_CTX)
except urllib.error.URLError as e:
    if "CERTIFICATE_VERIFY_FAILED" in str(e):
        SSL_CTX = ssl._create_unverified_context()
except Exception:
    pass

TRADING_DAYS = CONFIG["assumptions"]["trading_days_per_year"]
RF = CONFIG["assumptions"]["risk_free"]
ERP = CONFIG["assumptions"]["equity_risk_premium"]
Z80 = 1.2816  # z for P10/P90 (80% band)


# ─── Data layer: Yahoo Finance v8 chart API (keyless) ────────────────────────

def fetch_series(ticker):
    """Return {date_iso: adjusted_close} of daily total-return prices, or {} on failure."""
    start = datetime.strptime(CONFIG["start_date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    # pad start a few weeks earlier so we can locate the first trading day >= start_date
    p1 = int(start.timestamp()) - 30 * 86400
    p2 = int(datetime.now(timezone.utc).timestamp()) + 86400
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?period1={p1}&period2={p2}&interval=1d&events=div,splits&includeAdjustedClose=true"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (badoo.net finances)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
                payload = json.load(r)
            res = payload["chart"]["result"][0]
            ts = res["timestamp"]
            adj = res["indicators"]["adjclose"][0]["adjclose"]
            out = {}
            for t, a in zip(ts, adj):
                if a is None:
                    continue
                d = datetime.fromtimestamp(t, timezone.utc).date().isoformat()
                out[d] = float(a)  # later dates overwrite; fine for daily bars
            return out
        except Exception as e:
            sys.stderr.write(f"  fetch {ticker} attempt {attempt+1} failed: {e}\n")
    return {}


# ─── Math helpers ────────────────────────────────────────────────────────────

def daily_log_returns(values):
    return [math.log(values[i] / values[i - 1]) for i in range(1, len(values))
            if values[i] > 0 and values[i - 1] > 0]


def annualized_vol(values):
    rets = daily_log_returns(values)
    if len(rets) < 2:
        return 0.0
    return statistics.pstdev(rets) * math.sqrt(TRADING_DAYS)


def cagr(v_start, v_end, years):
    if v_start <= 0 or years <= 0:
        return 0.0
    return (v_end / v_start) ** (1 / years) - 1


def max_drawdown(values):
    peak, mdd = values[0], 0.0
    for v in values:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return mdd


def beta(strategy_values, bench_values):
    sr = daily_log_returns(strategy_values)
    br = daily_log_returns(bench_values)
    n = min(len(sr), len(br))
    if n < 2:
        return 1.0
    sr, br = sr[-n:], br[-n:]
    var_b = statistics.pvariance(br)
    if var_b == 0:
        return 1.0
    mean_s, mean_b = statistics.fmean(sr), statistics.fmean(br)
    cov = sum((sr[i] - mean_s) * (br[i] - mean_b) for i in range(n)) / n
    return cov / var_b


def project_fan(v0, mu, sigma, quarters):
    """Analytic lognormal fan: P10/P50/P90 of value at each quarter horizon."""
    fan = []
    for q in range(1, quarters + 1):
        T = q / 4.0
        drift = (mu - 0.5 * sigma * sigma) * T
        spread = Z80 * sigma * math.sqrt(T)
        fan.append({
            "quarter": q,
            "p10": v0 * math.exp(drift - spread),
            "p50": v0 * math.exp(drift),
            "p90": v0 * math.exp(drift + spread),
        })
    return fan


# ─── Build the comparison ────────────────────────────────────────────────────

def build():
    pos_tickers = [p["ticker"] for p in CONFIG["positions"]]
    passive = CONFIG["passive_strategies"]
    bench = CONFIG["benchmark"]
    need = sorted(set(pos_tickers + [s["ticker"] for s in passive] + [bench]))

    print("Fetching market data…")
    series = {t: fetch_series(t) for t in need}
    missing = [t for t in need if not series[t]]
    if missing:
        sys.stderr.write(f"WARNING: no data for {missing}; continuing without them.\n")

    available = [t for t in need if series[t]]
    if not all(series[t] for t in pos_tickers):
        sys.exit("FATAL: missing data for a manager position; cannot build.")

    # Common trading days across everything we actually have, on/after start_date.
    common = set.intersection(*[set(series[t]) for t in available])
    start_date = CONFIG["start_date"]
    dates = sorted(d for d in common if d >= start_date)
    if len(dates) < 30:
        sys.exit(f"FATAL: only {len(dates)} common trading days found; check tickers/start_date.")

    def vals(t):
        return [series[t][d] for d in dates]

    years = (datetime.strptime(dates[-1], "%Y-%m-%d") -
             datetime.strptime(dates[0], "%Y-%m-%d")).days / 365.25

    # Manager cohort: shares derived from TODAY's price → value backward to start.
    shares, invested_today = {}, 0.0
    for p in CONFIG["positions"]:
        last = series[p["ticker"]][dates[-1]]
        shares[p["ticker"]] = p["value_today"] / last
        invested_today += p["value_today"]

    manager_gross = [sum(shares[t] * series[t][d] for t in pos_tickers) for d in dates]
    start_capital = manager_gross[0]  # the common seed for every strategy a year ago

    strategies = []

    # 1) Manager (gross + net of advisory fee band)
    mgr_cfg = CONFIG["manager"]
    fee_c = mgr_cfg["advisory_fee_central"]

    def net_series(gross, fee):
        out = []
        d0 = datetime.strptime(dates[0], "%Y-%m-%d")
        for i, d in enumerate(dates):
            yrs = (datetime.strptime(d, "%Y-%m-%d") - d0).days / 365.25
            out.append(gross[i] * math.exp(-fee * yrs))
        return out

    manager_net_central = net_series(manager_gross, fee_c)
    mgr_b = beta(manager_gross, vals(bench))
    strategies.append({
        "key": "manager",
        "name": mgr_cfg["name"],
        "is_manager": True,
        "values": manager_net_central,
        "values_gross": manager_gross,
        "current_gross": manager_gross[-1],
        "current": manager_net_central[-1],
        "fee_central": fee_c,
        "fee_low": mgr_cfg["advisory_fee_low"],
        "fee_high": mgr_cfg["advisory_fee_high"],
        "current_fee_low": net_series(manager_gross, mgr_cfg["advisory_fee_low"])[-1],
        "current_fee_high": net_series(manager_gross, mgr_cfg["advisory_fee_high"])[-1],
        "holdings": [{"ticker": p["ticker"], "name": p.get("name", p["ticker"]),
                      "value_today": p["value_today"]} for p in CONFIG["positions"]],
        "cagr_gross": cagr(start_capital, manager_gross[-1], years),
        "cagr": cagr(start_capital, manager_net_central[-1], years),
        "vol": annualized_vol(manager_gross),
        "mdd": max_drawdown(manager_gross),
        "beta": mgr_b,
    })

    # 2) Passive strategies — same start_capital, units bought at start.
    for s in passive:
        t = s["ticker"]
        if not series.get(t):
            continue
        pv = vals(t)
        units = start_capital / pv[0]
        gv = [units * x for x in pv]
        strategies.append({
            "key": t,
            "name": s["name"],
            "ticker": t,
            "is_manager": False,
            "expense_ratio": s.get("expense_ratio", 0.0),
            "values": gv,
            "current": gv[-1],
            "cagr": cagr(start_capital, gv[-1], years),
            "vol": annualized_vol(pv),
            "mdd": max_drawdown(pv),
            "beta": beta(pv, vals(bench)),
        })

    # Sharpe + forward projection for every strategy
    for s in strategies:
        s["sharpe"] = (s["cagr"] - RF) / s["vol"] if s["vol"] > 0 else 0.0
        mu = RF + s["beta"] * ERP                      # CAPM expected annual return
        sigma = s["vol"]
        s["exp_return"] = mu
        s["fan"] = project_fan(s["current"], mu, sigma, CONFIG["horizon_quarters"])

    # Break-even fee: advisory fee at which manager net == best passive today.
    best_passive = max((s for s in strategies if not s["is_manager"]),
                       key=lambda x: x["current"])
    ratio = best_passive["current"] / manager_gross[-1]
    breakeven_fee = 1 - ratio ** (1 / years) if years > 0 and ratio > 0 else 0.0

    # Rotating watchlist of alternatives: discover + backtest + rank + diff vs last week.
    alternatives, rotated_out = build_alternatives(
        start_capital, dates[0], dates[-1], set(need))

    result = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "start_date": dates[0],
        "as_of": dates[-1],
        "years": years,
        "dates": dates,
        "start_capital": start_capital,
        "invested_today": invested_today,
        "benchmark": bench,
        "assumptions": {"risk_free": RF, "equity_risk_premium": ERP},
        "horizon_quarters": CONFIG["horizon_quarters"],
        "strategies": strategies,
        "best_passive_key": best_passive["key"],
        "breakeven_fee": breakeven_fee,
        "alternatives": alternatives,
        "alt_rotated_out": rotated_out,
        "alt_rank_by": CONFIG.get("alternatives", {}).get("rank_by", "sharpe"),
        "alt_intro": "",
        "missing": missing,
    }
    return result


# ─── Analyst memo via Anthropic Messages API (urllib, no SDK) ─────────────────

def load_api_key():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    envf = DIR / ".env"
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.strip().startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def call_claude(prompt, model, max_tokens, search_uses=0):
    """POST to the Anthropic Messages API over urllib; return text or None.

    If search_uses > 0, attaches the server-side web_search tool so the model can
    look up current fund ideas before answering (only its text blocks are returned).
    """
    key = load_api_key()
    if not key:
        sys.stderr.write("No ANTHROPIC_API_KEY found; skipping Claude call.\n")
        return None
    msg = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if search_uses > 0:
        msg["tools"] = [{"type": "web_search_20250305", "name": "web_search",
                         "max_uses": search_uses}]
    body = json.dumps(msg).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=240 if search_uses else 120, context=SSL_CTX) as r:
            data = json.load(r)
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    except Exception as e:
        sys.stderr.write(f"Claude call failed: {e}\n")
        return None


def write_memo(result):
    cfg = CONFIG.get("memo", {})
    if not cfg.get("enabled", True):
        return None

    def line(s):
        extra = ""
        if s["is_manager"]:
            extra = f", advisory fee {s['fee_central']*100:.2f}% (band {s['fee_low']*100:.2f}–{s['fee_high']*100:.2f}%)"
        return (f"- {s['name']}: now ${s['current']:,.0f} "
                f"(CAGR {s['cagr']*100:+.1f}%, vol {s['vol']*100:.1f}%, "
                f"maxDD {s['mdd']*100:.1f}%, Sharpe {s['sharpe']:.2f}, beta {s['beta']:.2f}, "
                f"CAPM exp {s['exp_return']*100:.1f}%/yr){extra}")

    facts = "\n".join(line(s) for s in result["strategies"])
    prompt = f"""You are a buy-side investment analyst writing a concise weekly memo for a retail \
client deciding whether to keep their money manager or self-manage in passive index funds.

The client currently holds (today's values) $1,200 AMZN + $1,600 DFEOX via a money manager. \
Each strategy below was seeded with the SAME starting capital of ${result['start_capital']:,.0f} \
on {result['start_date']}; figures are total-return (dividends reinvested) as of {result['as_of']} \
({result['years']:.2f} years). Manager values are NET of the advisory fee.

Strategies:
{facts}

Key numbers:
- Best passive alternative: {next(s['name'] for s in result['strategies'] if s['key']==result['best_passive_key'])}
- Break-even advisory fee (manager would have to charge BELOW this to beat the best passive): {result['breakeven_fee']*100:.2f}%/yr
- Assumptions for the forward view: risk-free {RF*100:.1f}%, equity risk premium {ERP*100:.1f}%. \
Forward projections use CAPM expected return + a lognormal P10/P50/P90 fan over the next {result['horizon_quarters']} quarters.

Write a memo of 3–4 short paragraphs:
1) What the past year shows (winners/losers, risk-adjusted, the role of fees).
2) An educated outlook on the coming quarters — name the macro forces you're weighing \
(rates, growth, concentration risk in mega-cap tech via AMZN, breadth) and what would change your mind.
3) A clear, explicit recommendation: KEEP the manager or SELF-MANAGE, tied to the break-even fee and \
the client's likely risk tolerance. Hedge appropriately but DO take a position.
Plain text, no markdown headers, no preamble. End with one italic-free sentence reminding this is \
informational, not personalized financial advice."""

    return call_claude(prompt, cfg.get("model", "claude-sonnet-4-5-20250929"),
                       cfg.get("max_tokens", 1800))


# ─── Alternatives to research (validated + backtested + Claude rationale) ─────

def backtest_ticker(ticker, start_capital, start_date, as_of):
    """Grow start_capital through one ticker over [start_date, as_of] using real data."""
    s = fetch_series(ticker)
    if not s:
        return None
    ds = sorted(d for d in s if start_date <= d <= as_of)
    if len(ds) < 30:
        return None
    pv = [s[d] for d in ds]
    units = start_capital / pv[0]
    gv = [units * x for x in pv]
    yrs = (datetime.strptime(ds[-1], "%Y-%m-%d") -
           datetime.strptime(ds[0], "%Y-%m-%d")).days / 365.25
    return {
        "current": gv[-1],
        "cagr": cagr(start_capital, gv[-1], yrs),
        "vol": annualized_vol(pv),
        "mdd": max_drawdown(pv),
        "first_date": ds[0],
        "partial": ds[0] > start_date,
    }


def score_metrics(m, rank_by):
    """A single comparable score for ranking the watchlist. Higher = better."""
    if not m:
        return float("-inf")
    if rank_by == "cagr":
        return m["cagr"]
    if rank_by == "return_per_drawdown":
        return m["cagr"] / max(abs(m["mdd"]), 0.01)
    # default: Sharpe-like, risk-adjusted
    return (m["cagr"] - RF) / m["vol"] if m["vol"] > 0 else float("-inf")


def load_prev_roster():
    """Read last run's watchlist from the committed data.json (durable 'last week')."""
    f = DIR / "data.json"
    if not f.exists():
        return {"exists": False, "tickers": [], "first_seen": {}}
    try:
        prev = json.loads(f.read_text())
    except Exception:
        return {"exists": False, "tickers": [], "first_seen": {}}
    first_seen = {}
    for a in (prev.get("alternatives") or []) + (prev.get("alt_rotated_out") or []):
        if a.get("ticker"):
            first_seen[a["ticker"]] = a.get("first_seen") or prev.get("as_of")
    roster_tickers = [a["ticker"] for a in (prev.get("alternatives") or []) if a.get("ticker")]
    return {"exists": bool(prev.get("alternatives")), "tickers": roster_tickers,
            "first_seen": first_seen}


def discover_alternatives(exclude, cfg):
    """Web-search for fresh fund ideas to consider. Returns a list of candidate dicts."""
    dcfg = cfg.get("discover", {})
    if not dcfg.get("enabled", True):
        return []
    prompt = f"""You are an investment analyst maintaining a rotating watchlist of low-cost \
funds a retail investor could use to self-manage instead of paying a money manager. Search \
the web for strong, currently-available fund/ETF ideas worth adding to the watchlist — favour \
broad, low-cost, durable options across roles (core, dividend/quality, international, factor, \
sector/growth, bonds, balanced/all-in-one), and feel free to surface newer or less-obvious \
funds. Suggest up to {dcfg.get('max_new', 8)} real, US-listed tickers.

Do NOT suggest any of these already-tracked tickers: {', '.join(sorted(exclude))}.
Only funds/ETFs (or index mutual funds) — no single stocks.

After searching, respond with ONLY valid JSON, no markdown fences, exactly:
{{"candidates": [{{"ticker": "XXXX", "name": "...", "source": "Vanguard|Fidelity|Schwab|iShares|...", "role": "...", "expense_ratio": 0.0003}}]}}
Use a decimal for expense_ratio (e.g. 0.0003 for 3 bps); omit or use null if unknown."""
    txt = call_claude(prompt, dcfg.get("model", cfg.get("model", "claude-sonnet-4-5-20250929")),
                      1500, search_uses=dcfg.get("max_search_uses", 5))
    if not txt:
        return []
    try:
        obj = json.loads(txt[txt.find("{"):txt.rfind("}") + 1])
        out = []
        for c in obj.get("candidates", []):
            t = (c.get("ticker") or "").strip().upper()
            if t and t not in exclude:
                out.append({"ticker": t, "name": c.get("name", t),
                            "source": c.get("source", "—"), "role": c.get("role", "—"),
                            "expense_ratio": c.get("expense_ratio")})
        return out
    except Exception as e:
        sys.stderr.write(f"Could not parse discovery JSON: {e}\n")
        return []


def build_alternatives(start_capital, start_iso, as_of, exclude_tracked):
    """Discover + backtest + rank a rotating watchlist; diff against last week."""
    cfg = CONFIG.get("alternatives", {})
    if not cfg.get("enabled", True):
        return [], []
    rank_by = cfg.get("rank_by", "sharpe")
    size = cfg.get("roster_size", 8)
    prev = load_prev_roster()

    print("Searching for new alternatives…")
    discovered = discover_alternatives(exclude_tracked | set(prev["tickers"]), cfg)
    if discovered:
        print(f"  discovered: {', '.join(c['ticker'] for c in discovered)}")

    # Assemble the candidate pool: last week's roster + config seeds + new finds.
    # Earlier entries win on metadata when tickers repeat.
    seeds = cfg.get("candidates", [])
    seed_by_t = {c["ticker"]: c for c in seeds}
    pool, seen = [], set()
    # last week's roster first (so we keep their metadata if present in seeds)
    for t in prev["tickers"]:
        if t in exclude_tracked or t in seen:
            continue
        meta = seed_by_t.get(t, {"ticker": t, "name": t, "source": "—", "role": "—",
                                 "expense_ratio": None})
        pool.append(dict(meta)); seen.add(t)
    for c in seeds + discovered:
        t = c["ticker"]
        if t in exclude_tracked or t in seen:
            continue
        pool.append(dict(c)); seen.add(t)

    print(f"Backtesting {len(pool)} watchlist candidates…")
    scored = []
    for c in pool:
        m = backtest_ticker(c["ticker"], start_capital, start_iso, as_of)
        if not m:
            continue
        c["metrics"] = m
        c["score"] = score_metrics(m, rank_by)
        c["rationale"] = ""
        scored.append(c)
    scored.sort(key=lambda x: x["score"], reverse=True)

    roster = scored[:size]
    dropped = scored[size:]

    roster_tickers = {c["ticker"] for c in roster}
    prev_set = set(prev["tickers"])
    for c in roster:
        c["status"] = "held" if (not prev["exists"] or c["ticker"] in prev_set) else "new"
        c["first_seen"] = prev["first_seen"].get(c["ticker"]) or as_of

    # Rotated out: were in last week's roster, not in this week's.
    rotated_out = []
    for c in dropped:
        if prev["exists"] and c["ticker"] in prev_set:
            c["first_seen"] = prev["first_seen"].get(c["ticker"]) or as_of
            rotated_out.append(c)

    if prev["exists"]:
        rin = [c["ticker"] for c in roster if c["status"] == "new"]
        print(f"  rotated in: {rin or '—'} | rotated out: {[c['ticker'] for c in rotated_out] or '—'}")
    return roster, rotated_out


def write_alt_rationale(result):
    """Mutate result['alternatives'] with a Claude rationale per fund + a section intro."""
    cfg = CONFIG.get("alternatives", {})
    alts = result.get("alternatives") or []
    if not cfg.get("enabled", True) or not alts:
        return
    lines = []
    for a in alts:
        m = a.get("metrics")
        perf = (f"same ${result['start_capital']:,.0f} -> ${m['current']:,.0f} "
                f"({m['cagr']*100:+.1f}%/yr, vol {m['vol']*100:.1f}%, maxDD {m['mdd']*100:.1f}%)"
                if m else "price data unavailable")
        er = f"{a['expense_ratio']*100:.2f}%" if a.get("expense_ratio") is not None else "n/a"
        lines.append(f"- {a['ticker']} ({a['name']}, {a['source']}, role: {a['role']}, "
                     f"ER {er}): {perf}")
    prompt = f"""You are an investment analyst helping a retail investor RESEARCH self-managed \
alternatives to their money manager, who currently concentrates them in AMZN plus a US \
core-equity fund. Below is a shortlist of real funds, each backtested over the past year on \
the same ${result['start_capital']:,.0f} basis.

{chr(10).join(lines)}

For EACH ticker, write a 1–2 sentence rationale: the role it plays in a portfolio, who it \
suits, and one honest caveat. Do NOT predict prices or future returns. Then write a 1–2 \
sentence section intro on how to think about combining these (a low-cost core plus \
diversifiers and ballast) rather than chasing the past year's winner.

Respond with ONLY valid JSON, no markdown fences, exactly this shape:
{{"intro": "...", "funds": {{"FZROX": "...", "FXAIX": "...", ...}}}}"""
    txt = call_claude(prompt, cfg.get("model", "claude-sonnet-4-5-20250929"),
                      cfg.get("max_tokens", 1600))
    if not txt:
        return
    try:
        start, end = txt.find("{"), txt.rfind("}")
        obj = json.loads(txt[start:end + 1])
    except Exception as e:
        sys.stderr.write(f"Could not parse alternatives JSON: {e}\n")
        return
    result["alt_intro"] = obj.get("intro", "")
    funds = obj.get("funds", {})
    for a in alts:
        a["rationale"] = funds.get(a["ticker"], "")


# ─── Rendering ───────────────────────────────────────────────────────────────

def money(x):
    return f"${x:,.0f}"


def pct(x, signed=False, decimals=1):
    return f"{x*100:+.{decimals}f}%" if signed else f"{x*100:.{decimals}f}%"


def fee_pct(x):
    """Fees can be sub-1%; show 2 decimals so a 0.05% break-even doesn't round to 0.1%."""
    return f"{x*100:.2f}%"


def svg_growth(result):
    """Multi-line growth-of-capital chart (inline SVG)."""
    W, H, PAD = 720, 320, 44
    dates = result["dates"]
    n = len(dates)
    series = result["strategies"]
    all_vals = [v for s in series for v in s["values"]]
    lo, hi = min(all_vals), max(all_vals)
    pad_v = (hi - lo) * 0.08 or 1
    lo, hi = lo - pad_v, hi + pad_v
    colors = ["#cbd5e1", "#a855f7", "#22d3ee", "#34d399", "#fbbf24", "#db2777"]

    def x(i):
        return PAD + (W - 2 * PAD) * i / max(n - 1, 1)

    def y(v):
        return H - PAD - (H - 2 * PAD) * (v - lo) / (hi - lo)

    parts = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Growth of starting capital">']
    # gridlines + y labels
    for g in range(5):
        gv = lo + (hi - lo) * g / 4
        gy = y(gv)
        parts.append(f'<line x1="{PAD}" y1="{gy:.1f}" x2="{W-PAD}" y2="{gy:.1f}" stroke="rgba(255,255,255,0.08)"/>')
        parts.append(f'<text x="{PAD-6}" y="{gy+4:.1f}" text-anchor="end" class="ax">{money(gv)}</text>')
    # x labels (start + end)
    parts.append(f'<text x="{PAD}" y="{H-14}" class="ax">{dates[0]}</text>')
    parts.append(f'<text x="{W-PAD}" y="{H-14}" text-anchor="end" class="ax">{dates[-1]}</text>')
    legend = []
    for idx, s in enumerate(series):
        c = colors[idx % len(colors)]
        pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(s["values"]))
        dash = ' stroke-dasharray="5 3"' if s.get("is_manager") else ""
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{c}" stroke-width="2"{dash}/>')
        legend.append((c, s["name"], s["current"]))
    parts.append("</svg>")
    leg = '<div class="legend">' + "".join(
        f'<span class="lg"><i style="background:{c}"></i>{html_esc(nm)} '
        f'<b>{money(cv)}</b></span>' for c, nm, cv in legend) + "</div>"
    return "".join(parts) + leg


def svg_fan(result):
    """Forward fan chart for the manager vs the best passive alternative."""
    W, H, PAD = 720, 300, 44
    q = result["horizon_quarters"]
    mgr = next(s for s in result["strategies"] if s.get("is_manager"))
    best = next(s for s in result["strategies"] if s["key"] == result["best_passive_key"])
    show = [(mgr, "#cbd5e1"), (best, "#a855f7")]
    pts = [mgr["current"], best["current"]]
    for s, _ in show:
        for f in s["fan"]:
            pts += [f["p10"], f["p90"]]
    lo, hi = min(pts), max(pts)
    pad_v = (hi - lo) * 0.08 or 1
    lo, hi = lo - pad_v, hi + pad_v

    def x(i):
        return PAD + (W - 2 * PAD) * i / q

    def y(v):
        return H - PAD - (H - 2 * PAD) * (v - lo) / (hi - lo)

    parts = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Forward projection">']
    for g in range(5):
        gv = lo + (hi - lo) * g / 4
        gy = y(gv)
        parts.append(f'<line x1="{PAD}" y1="{gy:.1f}" x2="{W-PAD}" y2="{gy:.1f}" stroke="rgba(255,255,255,0.08)"/>')
        parts.append(f'<text x="{PAD-6}" y="{gy+4:.1f}" text-anchor="end" class="ax">{money(gv)}</text>')
    parts.append(f'<text x="{PAD}" y="{H-14}" class="ax">today</text>')
    parts.append(f'<text x="{W-PAD}" y="{H-14}" text-anchor="end" class="ax">+{q} quarters</text>')
    for s, c in show:
        top = [(x(0), y(s["current"]))] + [(x(f["quarter"]), y(f["p90"])) for f in s["fan"]]
        bot = [(x(f["quarter"]), y(f["p10"])) for f in reversed(s["fan"])] + [(x(0), y(s["current"]))]
        band = " ".join(f"{px:.1f},{py:.1f}" for px, py in top + bot)
        parts.append(f'<polygon points="{band}" fill="{c}" fill-opacity="0.10"/>')
        mid = " ".join([f"{x(0):.1f},{y(s['current']):.1f}"] +
                       [f"{x(f['quarter']):.1f},{y(f['p50']):.1f}" for f in s["fan"]])
        parts.append(f'<polyline points="{mid}" fill="none" stroke="{c}" stroke-width="2"/>')
    parts.append("</svg>")
    leg = ('<div class="legend">'
           f'<span class="lg"><i style="background:#cbd5e1"></i>{html_esc(mgr["name"])}</span>'
           f'<span class="lg"><i style="background:#a855f7"></i>{html_esc(best["name"])}</span>'
           '<span class="lg muted">shaded = P10–P90 range</span></div>')
    return "".join(parts) + leg


RANK_LABEL = {"sharpe": "risk-adjusted return (Sharpe)", "cagr": "trailing return",
              "return_per_drawdown": "return per unit of drawdown"}


def _er_str(a):
    return f"{a['expense_ratio']*100:.2f}%" if a.get("expense_ratio") is not None else "n/a"


def render_alternatives(result):
    alts = result.get("alternatives") or []
    if not alts:
        return ""
    rank_by = result.get("alt_rank_by", "sharpe")
    intro = result.get("alt_intro") or (
        "Educated starting points for your own research. A durable portfolio is usually a "
        "low-cost core plus a few diversifiers and some ballast — not a bet on last year's winner.")
    cards = []
    for a in alts:
        m = a.get("metrics")
        if m:
            partial = (f' <span class="muted">(data since {m["first_date"]})</span>'
                       if m.get("partial") else "")
            cls = "pos" if m["cagr"] >= 0 else "neg"
            perf = (f'<div class="altperf">Same {money(result["start_capital"])} → '
                    f'<b>{money(m["current"])}</b> '
                    f'<span class="{cls}">{pct(m["cagr"], True)}/yr</span> · '
                    f'vol {pct(m["vol"])} · maxDD {pct(m["mdd"])}{partial}</div>')
        else:
            perf = '<div class="altperf muted">price data unavailable this run</div>'
        rat = f'<p class="altrat">{html_esc(a["rationale"])}</p>' if a.get("rationale") else ""
        is_new = a.get("status") == "new"
        badge = '<span class="badge new">NEW</span>' if is_new else ""
        since = (f'<span class="since">in watchlist since {a["first_seen"]}</span>'
                 if a.get("first_seen") and not is_new else "")
        cards.append(
            f'<div class="altcard{ " isnew" if is_new else "" }">'
            f'<div class="althead"><span class="altname">{html_esc(a["name"])}{badge}</span>'
            f'<span class="pill">{html_esc(a["ticker"])}</span></div>'
            f'<div class="altmeta">{html_esc(a["role"])} · {html_esc(a["source"])} · '
            f'ER {_er_str(a)} {since}</div>'
            f'{perf}{rat}</div>')

    # Rotated-out note
    out = result.get("alt_rotated_out") or []
    rotated_html = ""
    if out:
        items = []
        for a in out:
            m = a.get("metrics") or {}
            ret = pct(m["cagr"], True) + "/yr" if m else "—"
            items.append(f'<li><b>{html_esc(a["ticker"])}</b> {html_esc(a["name"])} '
                         f'<span class="muted">({ret}, dropped below the top {len(alts)} '
                         f'by {html_esc(RANK_LABEL.get(rank_by, rank_by))})</span></li>')
        rotated_html = (
            '<div class="rotout"><h3>Rotated out this week</h3>'
            f'<ul>{"".join(items)}</ul></div>')
    new_count = sum(1 for a in alts if a.get("status") == "new")
    rotated_summary = (f' <strong>{new_count} rotated in</strong> and '
                       f'{len(out)} rotated out since last week.' if (new_count or out) else "")

    return (
        '<section class="card"><h2>Alternatives worth researching</h2>'
        f'<p class="sub">A watchlist that refreshes weekly: each run web-searches for new fund '
        f'ideas, backtests them against last week’s roster on the same dollar basis, and keeps '
        f'the top {len(alts)} ranked by {html_esc(RANK_LABEL.get(rank_by, rank_by))}.{rotated_summary}</p>'
        f'<p class="sub" style="margin-top:-4px;">{html_esc(intro)}</p>'
        f'<div class="altgrid">{"".join(cards)}</div>'
        f'{rotated_html}'
        '<p class="src">Real funds across sources, validated and backtested on the same dollar '
        'basis as the leaderboard; ideas surfaced by web search, per-fund rationale by Claude. '
        'These are research starting points — <strong>not</strong> recommendations or predictions. '
        'Past returns shown for context only; verify expense ratios and suitability yourself.</p>'
        '</section>')


def render(result, memo):
    s_manager = next(s for s in result["strategies"] if s.get("is_manager"))
    best = next(s for s in result["strategies"] if s["key"] == result["best_passive_key"])
    be = result["breakeven_fee"]
    fee_c = s_manager["fee_central"]
    delta = best["current"] - s_manager["current"]
    leaning_self = best["current"] > s_manager["current"]

    if leaning_self:
        verdict = "Lean: self-manage"
        banner_sub = (f"Over the past year the best passive option "
                      f"(<b>{html_esc(best['name'])}</b>) is worth {money(abs(delta))} more than your "
                      f"fee-adjusted managed portfolio. The manager would need to charge below "
                      f"<b>{fee_pct(be)}</b>/yr just to break even — versus the assumed "
                      f"{pct(fee_c)}.")
        banner_cls = "self"
    else:
        verdict = "Lean: the manager is earning their fee — for now"
        banner_sub = (f"Even after the {pct(fee_c)} fee, the managed portfolio is ahead of the best "
                      f"passive option by {money(abs(delta))}. Break-even fee is <b>{fee_pct(be)}</b>/yr.")
        banner_cls = "manager"

    # leaderboard rows sorted by current value
    rows = sorted(result["strategies"], key=lambda x: x["current"], reverse=True)
    tbody = []
    for s in rows:
        tag = '<span class="pill mgr">manager</span>' if s.get("is_manager") else \
              f'<span class="pill">{html_esc(s.get("ticker",""))}</span>'
        feecol = (f'{pct(s["fee_central"])}' if s.get("is_manager")
                  else f'{s.get("expense_ratio",0)*100:.2f}%')
        winner = " win" if s["key"] == best["key"] or (s.get("is_manager") and not leaning_self) else ""
        tbody.append(
            f'<tr class="{ "mgrrow" if s.get("is_manager") else "" }{winner}">'
            f'<td class="nm">{html_esc(s["name"])} {tag}</td>'
            f'<td class="num big">{money(s["current"])}</td>'
            f'<td class="num">{pct(s["cagr"], True)}</td>'
            f'<td class="num">{pct(s["vol"])}</td>'
            f'<td class="num">{pct(s["mdd"])}</td>'
            f'<td class="num">{s["sharpe"]:.2f}</td>'
            f'<td class="num">{s["beta"]:.2f}</td>'
            f'<td class="num">{feecol}</td>'
            f'<td class="num">{pct(s["exp_return"])}</td>'
            f'</tr>')

    # manager net-of-fee band
    fee_band = (
        f'<div class="feebox">'
        f'<h3>Fee drag on the managed portfolio</h3>'
        f'<p>Same gross holdings, net of the advisory fee. The fee compounds against you every year, '
        f'win or lose.</p>'
        f'<table class="mini"><tr><th>Advisory fee</th><th>Value today</th><th>Cost of the fee</th></tr>'
        f'<tr><td>Gross (no fee)</td><td class="num">{money(s_manager["current_gross"])}</td><td class="num">—</td></tr>'
        f'<tr><td>{pct(s_manager["fee_low"])}/yr</td><td class="num">{money(s_manager["current_fee_low"])}</td>'
        f'<td class="num">−{money(s_manager["current_gross"]-s_manager["current_fee_low"])}</td></tr>'
        f'<tr class="hl"><td>{pct(s_manager["fee_central"])}/yr (central)</td><td class="num">{money(s_manager["current"])}</td>'
        f'<td class="num">−{money(s_manager["current_gross"]-s_manager["current"])}</td></tr>'
        f'<tr><td>{pct(s_manager["fee_high"])}/yr</td><td class="num">{money(s_manager["current_fee_high"])}</td>'
        f'<td class="num">−{money(s_manager["current_gross"]-s_manager["current_fee_high"])}</td></tr>'
        f'</table></div>')

    memo_html = ""
    if memo:
        paras = "".join(f"<p>{html_esc(p.strip())}</p>" for p in memo.split("\n") if p.strip())
        memo_html = (f'<section class="card"><h2>Analyst view</h2>'
                     f'<div class="memo">{paras}</div>'
                     f'<p class="src">Generated by Claude ({html_esc(CONFIG["memo"]["model"])}) from the figures above.</p>'
                     f'</section>')
    else:
        memo_html = ('<section class="card"><h2>Analyst view</h2>'
                     '<p class="muted">Memo unavailable this run (no API key or generation skipped). '
                     'The quantitative comparison above stands on its own.</p></section>')

    miss = ""
    if result["missing"]:
        miss = (f'<p class="muted">Note: no data returned for '
                f'{html_esc(", ".join(result["missing"]))} this run; excluded from the comparison.</p>')

    gen = result["generated"].replace("T", " ").replace("+00:00", " UTC")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Manager vs. Index — badoo.net</title>
<meta name="description" content="Should I fire my money manager? A weekly, analyst-grade comparison of the manager's actual positions against passive Vanguard index strategies.">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../style.css">
<style>
  /* This report carries its own dark palette so it stays readable and on-brand
     regardless of the site-wide stylesheet. */
  :root {{
    --bg: #0b0b12; --text: #f4f4f8; --muted: #9aa0b5;
    --accent: #a855f7; --accent-light: rgba(168,85,247,0.16);
    --card-bg: #14141d; --card-border: rgba(255,255,255,0.10);
  }}
  body {{ padding-top: 0; background: var(--bg); color: var(--text); }}
  .fin-wrap {{ max-width: 860px; margin: 0 auto; padding: 90px 20px 80px; }}
  .fin-head h1 {{ font-size: clamp(28px,5vw,40px); letter-spacing:-.02em; }}
  .fin-head p.lede {{ color: var(--muted); max-width: 60ch; margin-top: 8px; }}
  .banner {{ border-radius: var(--radius); padding: 22px 24px; margin: 26px 0; border:1px solid var(--card-border); }}
  .banner.self {{ background:rgba(52,211,153,0.10); border-color:rgba(52,211,153,0.40); }}
  .banner.manager {{ background:var(--accent-light); border-color:rgba(168,85,247,0.40); }}
  .banner .v {{ font-size: 13px; text-transform:uppercase; letter-spacing:.08em; font-weight:700; color:var(--accent); }}
  .banner.self .v {{ color:#34d399; }}
  .banner h2 {{ font-size: 22px; margin:4px 0 8px; }}
  .banner p {{ color: var(--text); margin:0; }}
  .card {{ background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius); padding:24px; margin:22px 0; }}
  .card h2 {{ font-size:20px; margin-bottom:6px; }}
  .card > p.sub {{ color:var(--muted); margin-bottom:14px; font-size:14px; }}
  table.board {{ width:100%; border-collapse:collapse; font-size:14px; }}
  table.board th {{ text-align:right; color:var(--muted); font-weight:600; padding:8px 8px; border-bottom:2px solid var(--card-border); font-size:12px; text-transform:uppercase; letter-spacing:.03em; }}
  table.board th:first-child {{ text-align:left; }}
  table.board td {{ padding:11px 8px; border-bottom:1px solid var(--card-border); }}
  table.board td.nm {{ text-align:left; font-weight:600; }}
  table.board td.num {{ text-align:right; font-variant-numeric: tabular-nums; }}
  table.board td.big {{ font-weight:700; }}
  table.board tr.win {{ background:rgba(52,211,153,0.10); }}
  table.board tr.mgrrow td.nm {{ }}
  .pill {{ display:inline-block; font-size:11px; font-weight:600; color:var(--muted); background:rgba(255,255,255,0.08); border-radius:6px; padding:1px 7px; margin-left:6px; vertical-align:middle; }}
  .pill.mgr {{ background:var(--accent-light); color:var(--accent); }}
  .chart {{ width:100%; height:auto; display:block; margin-top:6px; }}
  .chart .ax {{ font-size:11px; fill:var(--muted); }}
  .legend {{ display:flex; flex-wrap:wrap; gap:14px; margin-top:12px; font-size:13px; }}
  .legend .lg {{ display:inline-flex; align-items:center; gap:6px; color:var(--text); }}
  .legend .lg.muted {{ color:var(--muted); }}
  .legend .lg i {{ width:12px; height:12px; border-radius:3px; display:inline-block; }}
  .feebox h3 {{ font-size:16px; margin-bottom:4px; }}
  .feebox p {{ color:var(--muted); font-size:14px; margin-bottom:12px; }}
  table.mini {{ width:100%; border-collapse:collapse; font-size:14px; }}
  table.mini th {{ text-align:left; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.03em; padding:6px 8px; border-bottom:2px solid var(--card-border); }}
  table.mini th:not(:first-child) {{ text-align:right; }}
  table.mini td {{ padding:8px; border-bottom:1px solid var(--card-border); }}
  table.mini td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
  table.mini tr.hl {{ background:var(--accent-light); font-weight:600; }}
  .breakeven {{ font-size:15px; }}
  .breakeven b {{ color:var(--accent); font-size:18px; }}
  .memo p {{ margin-bottom:12px; }}
  .src {{ color:var(--muted); font-size:12px; margin-top:10px; }}
  .altgrid {{ display:grid; grid-template-columns:repeat(2,1fr); gap:14px; margin-top:6px; }}
  .altcard {{ border:1px solid var(--card-border); border-radius:12px; padding:14px 16px; background:rgba(255,255,255,0.03); }}
  .althead {{ display:flex; align-items:center; justify-content:space-between; gap:8px; }}
  .altname {{ font-weight:700; font-size:15px; }}
  .altmeta {{ color:var(--muted); font-size:12px; margin-top:2px; }}
  .altperf {{ font-size:13px; margin-top:8px; font-variant-numeric:tabular-nums; }}
  .altperf .pos {{ color:#34d399; font-weight:600; }}
  .altperf .neg {{ color:#f87171; font-weight:600; }}
  .altrat {{ font-size:13.5px; color:var(--text); margin-top:8px; line-height:1.55; }}
  .altcard.isnew {{ border-color:rgba(52,211,153,0.40); background:rgba(52,211,153,0.07); box-shadow:0 0 0 1px rgba(52,211,153,0.40) inset; }}
  .badge {{ display:inline-block; font-size:10px; font-weight:700; letter-spacing:.05em; border-radius:5px; padding:1px 6px; margin-left:8px; vertical-align:middle; }}
  .badge.new {{ background:#047857; color:#fff; }}
  .since {{ color:var(--muted); font-size:11px; }}
  .rotout {{ margin-top:18px; padding-top:14px; border-top:1px dashed var(--card-border); }}
  .rotout h3 {{ font-size:14px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:8px; }}
  .rotout ul {{ list-style:none; padding:0; margin:0; }}
  .rotout li {{ font-size:13.5px; padding:3px 0; }}
  @media (max-width:620px) {{ .altgrid {{ grid-template-columns:1fr; }} }}
  .grid2 {{ display:grid; grid-template-columns:1fr; gap:0; }}
  .disclaim {{ color:var(--muted); font-size:12px; line-height:1.6; margin-top:28px; border-top:1px solid var(--card-border); padding-top:18px; }}
  .stamp {{ color:var(--muted); font-size:13px; }}
  .backlink {{ font-size:14px; color:var(--accent); text-decoration:none; }}
  @media (max-width:560px) {{
    table.board th.opt, table.board td.opt {{ display:none; }}
  }}
</style>
</head>
<body>
<div class="fin-wrap">
  <a href="/" class="backlink">← badoo.net</a>
  <div class="fin-head" style="margin-top:14px;">
    <h1>Should I fire my money manager?</h1>
    <p class="lede">A weekly, analyst-grade comparison of the manager's actual positions
      ({money(result["invested_today"])} across {html_esc(", ".join(p["ticker"] for p in CONFIG["positions"]))})
      against passive Vanguard strategies. Every strategy was seeded a year ago with the same
      {money(result["start_capital"])} so the only thing that differs is the strategy — and the fees.</p>
  </div>

  <div class="banner {banner_cls}">
    <div class="v">{html_esc(verdict)}</div>
    <h2>The numbers, in one line</h2>
    <p>{banner_sub}</p>
  </div>

  <section class="card">
    <h2>Leaderboard</h2>
    <p class="sub">Same {money(result["start_capital"])} invested on {result["start_date"]}, total return (dividends reinvested), as of {result["as_of"]}. Manager value is net of the {pct(fee_c)} advisory fee.</p>
    <div style="overflow-x:auto;">
    <table class="board">
      <thead><tr>
        <th>Strategy</th><th>Value now</th><th>Return/yr</th>
        <th class="opt">Volatility</th><th class="opt">Max DD</th><th class="opt">Sharpe</th>
        <th class="opt">Beta</th><th>Fee</th><th class="opt">Exp.&nbsp;return</th>
      </tr></thead>
      <tbody>{''.join(tbody)}</tbody>
    </table>
    </div>
    {miss}
  </section>

  <section class="card">
    <h2>Growth of {money(result["start_capital"])}</h2>
    <p class="sub">Each line is what the same starting capital became under that strategy. Dashed = manager (net of fee).</p>
    {svg_growth(result)}
  </section>

  <section class="card">
    {fee_band}
    <div class="breakeven" style="margin-top:18px;">
      <h3 style="font-size:16px;">Break-even fee</h3>
      <p>To have matched <b style="font-size:15px;">{html_esc(best["name"])}</b> over this period, the manager could have charged at most
      <b>{fee_pct(be)}</b>/yr. The assumed fee is {pct(fee_c)}/yr.</p>
    </div>
  </section>

  <section class="card">
    <h2>Next {result["horizon_quarters"]} quarters — projection</h2>
    <p class="sub">Educated estimate only: CAPM expected return (risk-free {pct(RF)} + beta × {pct(ERP)} equity premium) with a lognormal P10–P90 fan. Not a forecast of certainty.</p>
    {svg_fan(result)}
  </section>

  {memo_html}

  {render_alternatives(result)}

  <p class="stamp">Last updated {gen}. Data: Yahoo Finance (adjusted close). Rebuilds weekly.</p>
  <p class="disclaim">
    This page uses stand-in dollar amounts, not real balances. It is a personal research tool for
    informational purposes only and is <strong>not</strong> investment advice, a recommendation, or an
    offer to buy or sell any security. Past performance does not predict future results. Forward
    projections are model-based estimates under stated assumptions and will be wrong to some degree.
    Fund expense ratios are reflected in fund prices; the advisory fee is modeled as an additional drag
    on the managed portfolio. Verify all figures independently before acting.
  </p>
</div>
</body>
</html>
"""


def main():
    result = build()
    memo = write_memo(result)
    write_alt_rationale(result)
    (DIR / "index.html").write_text(render(result, memo))
    # Trim the heavy date/series arrays out of the committed data.json? Keep them — small.
    (DIR / "data.json").write_text(json.dumps(result, indent=2))
    print(f"Wrote index.html and data.json — start_capital {money(result['start_capital'])}, "
          f"as of {result['as_of']}, break-even fee {pct(result['breakeven_fee'])}.")


if __name__ == "__main__":
    main()
