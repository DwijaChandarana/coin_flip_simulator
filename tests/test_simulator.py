import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from simulator import CHART_POINTS, HEADS, HISTORY_SIZE, MAX_BATCH, TAILS, CoinStats, flip  # noqa: E402


def test_flip_returns_valid_side():
    for _ in range(100):
        assert flip() in (HEADS, TAILS)


def test_counts_add_up():
    s = CoinStats()
    for _ in range(500):
        s.flip()
    assert s.heads + s.tails == s.total == 500
    assert len(s.flips) == len(s.cum_heads) == 500
    assert sum(s.flips) == s.heads == s.cum_heads[-1]


def test_percentages():
    s = CoinStats()
    for r in "HHHT":
        s.record(r)
    assert s.heads_pct == 75.0
    assert s.tails_pct == 25.0
    assert [s.heads_pct_at(i) for i in range(4)] == [100.0, 100.0, 100.0, 75.0]


def test_streaks():
    s = CoinStats()
    for r in "HHTTTHH":
        s.record(r)
    assert s.longest_heads_streak == 2
    assert s.longest_tails_streak == 3
    assert s.current_side == HEADS
    assert s.current_streak == 2


def test_history_is_capped():
    s = CoinStats()
    for _ in range(HISTORY_SIZE + 10):
        s.record(HEADS)
    s.record(TAILS)
    assert len(s.history) == HISTORY_SIZE
    assert s.history[-1] == TAILS


def test_reset():
    s = CoinStats()
    for r in "HTHT":
        s.record(r)
    s.reset()
    assert s.total == 0
    assert s.heads_pct == 0.0
    assert s.history == []
    assert len(s.flips) == 0 and len(s.cum_heads) == 0
    assert s.last_batch is None
    assert s.current_streak == 0


def test_invalid_result_rejected():
    with pytest.raises(ValueError):
        CoinStats().record("X")


def test_flip_many_counts():
    s = CoinStats()
    last, h, t = s.flip_many(1000)
    assert last in (HEADS, TAILS)
    assert h + t == 1000
    assert s.heads == h and s.tails == t
    assert s.history[-1] == last
    # a second batch adds to the totals
    s.flip_many(500)
    assert s.total == 1500


@pytest.mark.parametrize("bad", [0, -5, MAX_BATCH + 1, 2.5, "10", None, True])
def test_flip_many_rejects_bad_counts(bad):
    s = CoinStats()
    with pytest.raises(ValueError):
        s.flip_many(bad)
    assert s.total == 0


def test_chart_points_small_series_is_complete():
    s = CoinStats()
    for r in "HTH":
        s.record(r)
    assert s.chart_points() == {"x": [1, 2, 3], "y": [100.0, 50.0, 66.67]}


def test_chart_points_large_series_is_sampled():
    s = CoinStats()
    s.flip_many(25_000)
    pts = s.chart_points()
    assert len(pts["x"]) <= CHART_POINTS + 1
    assert pts["x"][0] == 1
    assert pts["x"][-1] == 25_000          # always ends at the latest flip
    assert pts["y"][-1] == s.heads_pct
    assert pts["x"] == sorted(pts["x"])


def test_api_flip_count():
    from app import app, stats

    stats.reset()
    client = app.test_client()
    r = client.post("/api/flip", json={"count": 250})
    assert r.status_code == 200
    data = r.get_json()
    assert data["batch"]["count"] == 250
    assert data["batch"]["heads"] + data["batch"]["tails"] == 250
    assert data["stats"]["total"] == 250

    assert client.post("/api/flip").get_json()["stats"]["total"] == 251   # no body = 1 flip
    assert client.post("/api/flip", json={"count": 0}).status_code == 400
    assert client.post("/api/flip", json={"count": "abc"}).status_code == 400
    stats.reset()


# ---------- range analysis ----------

def make(seq):
    s = CoinStats()
    for r in seq:
        s.record(r)
    return s


def test_analyze_counts_and_streaks():
    #           1234567890
    s = make("HHTTTHHHHT")
    a = s.analyze(3, 9)                       # T T T H H H H
    assert (a["count"], a["heads"], a["tails"]) == (7, 4, 3)
    assert a["heads_pct"] == 57.14
    assert a["longest_heads_streak"] == {"length": 4, "start": 6}
    assert a["longest_tails_streak"] == {"length": 3, "start": 3}
    assert a["runs"] == 2
    assert a["sequence"] == "TTTHHHH"


def test_analyze_range_chart_is_relative_to_range():
    s = make("TTTTHH")
    a = s.analyze(5, 6)                       # only the two heads
    assert a["chart"] == {"x": [5, 6], "y": [100.0, 100.0]}


def test_analyze_single_flip_and_whole_range():
    s = make("HTHT")
    one = s.analyze(2, 2)
    assert (one["heads"], one["tails"]) == (0, 1)
    assert one["longest_heads_streak"] == {"length": 0, "start": None}
    whole = s.analyze(1, 4)
    assert whole["heads"] == s.heads and whole["runs"] == 4


def test_analyze_large_range_is_sampled_without_sequence():
    s = CoinStats()
    s.flip_many(50_000)
    a = s.analyze(10_001, 50_000)
    assert a["count"] == 40_000
    assert a["heads"] == sum(s.flips[10_000:50_000])
    assert len(a["chart"]["x"]) <= CHART_POINTS + 1
    assert a["chart"]["x"][0] == 10_001 and a["chart"]["x"][-1] == 50_000
    assert "sequence" not in a


def test_fairness_verdict():
    assert "fair" in make("HT" * 50).analyze(1, 100)["verdict"]
    assert "Very unusual" in make("H" * 100).analyze(1, 100)["verdict"]
    assert "Too few" in make("HHH").analyze(1, 3)["verdict"]


@pytest.mark.parametrize("start,end", [(0, 3), (2, 1), (1, 5), (None, 2), (1.5, 2), (True, 2)])
def test_analyze_rejects_bad_ranges(start, end):
    with pytest.raises(ValueError):
        make("HTHT").analyze(start, end)


def test_analyze_with_no_flips():
    with pytest.raises(ValueError):
        CoinStats().analyze(1, 1)


def test_last_batch_tracking():
    s = CoinStats()
    s.flip_many(10)
    assert s.last_batch == (1, 10)
    s.flip_many(5)
    assert s.last_batch == (11, 15)
    s.flip()
    assert s.last_batch == (16, 16)


def test_api_analyze():
    from app import app, stats

    stats.reset()
    client = app.test_client()
    client.post("/api/flip", json={"count": 300})
    r = client.get("/api/analyze?start=101&end=200")
    assert r.status_code == 200
    a = r.get_json()["analysis"]
    assert a["count"] == 100 and a["heads"] + a["tails"] == 100
    assert client.get("/api/analyze?start=0&end=10").status_code == 400
    assert client.get("/api/analyze?start=1&end=301").status_code == 400
    assert client.get("/api/analyze?start=abc&end=5").status_code == 400
    assert client.get("/api/analyze").status_code == 400
    stats.reset()
