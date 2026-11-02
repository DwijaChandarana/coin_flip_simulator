import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from simulator import HEADS, HISTORY_SIZE, TAILS, CoinStats, flip  # noqa: E402


def test_flip_returns_valid_side():
    for _ in range(100):
        assert flip() in (HEADS, TAILS)


def test_counts_add_up():
    s = CoinStats()
    for _ in range(500):
        s.flip()
    assert s.heads + s.tails == s.total == 500
    assert len(s.heads_pct_series) == 500


def test_percentages():
    s = CoinStats()
    for r in "HHHT":
        s.record(r)
    assert s.heads_pct == 75.0
    assert s.tails_pct == 25.0
    assert s.heads_pct_series == [100.0, 100.0, 100.0, 75.0]


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
    assert s.heads_pct_series == []
    assert s.current_streak == 0


def test_invalid_result_rejected():
    with pytest.raises(ValueError):
        CoinStats().record("X")
