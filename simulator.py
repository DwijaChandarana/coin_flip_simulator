"""Core coin-flip logic and statistics. Has no web/Flask dependencies."""

import math
import secrets
from array import array

HEADS = "H"
TAILS = "T"
HISTORY_SIZE = 20
MAX_BATCH = 100_000      # most flips allowed in one request
CHART_POINTS = 1_000     # max points sent to the browser chart
SEQUENCE_LIMIT = 200     # ranges up to this size also return the raw H/T sequence


def flip():
    """Return 'H' or 'T' with equal probability."""
    return secrets.choice((HEADS, TAILS))


def _sample_indices(start, end, max_points):
    """Evenly spaced indices in [start, end] (0-based, inclusive), always keeping both ends."""
    n = end - start + 1
    if n <= max_points:
        return list(range(start, end + 1))
    step = n / max_points
    return sorted({start + int(i * step) for i in range(max_points)} | {end})


class CoinStats:
    """Tracks every flip plus running totals, streaks and recent history.

    Every flip is kept compactly so any range can be analyzed later:
      - self.flips      bytearray, 1 = heads, 0 = tails (1 byte per flip)
      - self.cum_heads  array, heads count after each flip (O(1) range counts)
    """

    def __init__(self):
        self.reset()

    def reset(self):
        self.heads = 0
        self.tails = 0
        self.current_side = None
        self.current_streak = 0
        self.longest_heads_streak = 0
        self.longest_tails_streak = 0
        self.history = []          # most recent last, capped at HISTORY_SIZE
        self.flips = bytearray()
        self.cum_heads = array("L")
        self.last_batch = None     # (start, end), 1-based inclusive

    @property
    def total(self):
        return self.heads + self.tails

    @property
    def heads_pct(self):
        return round(self.heads / self.total * 100, 2) if self.total else 0.0

    @property
    def tails_pct(self):
        return round(self.tails / self.total * 100, 2) if self.total else 0.0

    def heads_pct_at(self, i):
        """Running heads % after flip number i+1 (i is 0-based)."""
        return round(self.cum_heads[i] / (i + 1) * 100, 2)

    def record(self, result):
        if result not in (HEADS, TAILS):
            raise ValueError(f"Invalid result: {result!r}")

        if result == HEADS:
            self.heads += 1
        else:
            self.tails += 1

        if result == self.current_side:
            self.current_streak += 1
        else:
            self.current_side = result
            self.current_streak = 1

        if result == HEADS:
            self.longest_heads_streak = max(self.longest_heads_streak, self.current_streak)
        else:
            self.longest_tails_streak = max(self.longest_tails_streak, self.current_streak)

        self.history.append(result)
        if len(self.history) > HISTORY_SIZE:
            self.history.pop(0)

        self.flips.append(1 if result == HEADS else 0)
        self.cum_heads.append(self.heads)

    def flip(self):
        result = flip()
        self.record(result)
        self.last_batch = (self.total, self.total)
        return result

    def flip_many(self, count):
        """Flip `count` coins. Returns (last_result, batch_heads, batch_tails)."""
        if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= MAX_BATCH:
            raise ValueError(f"count must be a whole number from 1 to {MAX_BATCH:,}")
        start = self.total + 1
        batch_heads = 0
        result = None
        for _ in range(count):
            result = flip()
            self.record(result)
            if result == HEADS:
                batch_heads += 1
        self.last_batch = (start, self.total)
        return result, batch_heads, count - batch_heads

    def chart_points(self, max_points=CHART_POINTS):
        """Evenly sampled (flip_number, heads_pct) points, always including the latest."""
        if not self.total:
            return {"x": [], "y": []}
        idx = _sample_indices(0, self.total - 1, max_points)
        return {"x": [i + 1 for i in idx], "y": [self.heads_pct_at(i) for i in idx]}

    def analyze(self, start, end, max_points=CHART_POINTS):
        """Analyze flips number `start` to `end` (1-based, inclusive)."""
        for name, v in (("start", start), ("end", end)):
            if not isinstance(v, int) or isinstance(v, bool):
                raise ValueError(f"{name} must be a whole number")
        if not self.total:
            raise ValueError("There are no flips to analyze yet")
        if not 1 <= start <= end <= self.total:
            raise ValueError(f"Choose a range between 1 and {self.total:,} where 'from' is not after 'to'")

        a, b = start - 1, end - 1                       # 0-based
        before = self.cum_heads[a - 1] if a > 0 else 0
        count = end - start + 1
        heads = self.cum_heads[b] - before
        tails = count - heads

        # Streaks and number of runs (switches between H and T) inside the range
        seg = self.flips[a:b + 1]
        best = {1: (0, 0), 0: (0, 0)}                   # side -> (length, start flip number)
        runs, run_len, run_side, run_start = 0, 0, None, start
        for offset, v in enumerate(seg):
            if v == run_side:
                run_len += 1
            else:
                run_side, run_len, run_start = v, 1, start + offset
                runs += 1
            if run_len > best[v][0]:
                best[v] = (run_len, run_start)

        # Fairness check: how far is heads from count/2, in standard deviations?
        expected = count / 2
        sd = math.sqrt(count) / 2
        z = (heads - expected) / sd
        if count < 10:
            verdict = "Too few flips to judge fairness. Try a range of at least 10."
        elif abs(z) <= 2:
            verdict = "Looks like a fair coin: the result is well within normal random variation."
        elif abs(z) <= 3:
            verdict = "A bit unusual, but this happens by chance about 1 time in 20."
        else:
            verdict = "Very unusual for a fair coin: this would happen less than 1 time in 300."

        idx = _sample_indices(a, b, max_points)
        chart = {
            "x": [i + 1 for i in idx],
            "y": [round((self.cum_heads[i] - before) / (i - a + 1) * 100, 2) for i in idx],
        }

        result = {
            "start": start,
            "end": end,
            "count": count,
            "heads": heads,
            "tails": tails,
            "heads_pct": round(heads / count * 100, 2),
            "tails_pct": round(tails / count * 100, 2),
            "longest_heads_streak": {"length": best[1][0], "start": best[1][1] if best[1][0] else None},
            "longest_tails_streak": {"length": best[0][0], "start": best[0][1] if best[0][0] else None},
            "runs": runs,
            "expected_runs": round((count + 1) / 2, 1),
            "expected_heads": expected,
            "z_score": round(z, 2),
            "verdict": verdict,
            "chart": chart,
        }
        if count <= SEQUENCE_LIMIT:
            result["sequence"] = "".join("H" if v else "T" for v in seg)
        return result

    def to_dict(self):
        return {
            "heads": self.heads,
            "tails": self.tails,
            "total": self.total,
            "heads_pct": self.heads_pct,
            "tails_pct": self.tails_pct,
            "current_side": self.current_side,
            "current_streak": self.current_streak,
            "longest_heads_streak": self.longest_heads_streak,
            "longest_tails_streak": self.longest_tails_streak,
            "history": list(self.history),
            "last_batch": list(self.last_batch) if self.last_batch else None,
            "chart": self.chart_points(),
        }
