"""Core coin-flip logic and statistics. Has no web/Flask dependencies."""

import secrets

HEADS = "H"
TAILS = "T"
HISTORY_SIZE = 20


def flip():
    """Return 'H' or 'T' with equal probability."""
    return secrets.choice((HEADS, TAILS))


class CoinStats:
    """Tracks running totals, streaks, recent history and the heads-% series."""

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
        self.heads_pct_series = []  # running heads % after each flip

    @property
    def total(self):
        return self.heads + self.tails

    @property
    def heads_pct(self):
        return round(self.heads / self.total * 100, 2) if self.total else 0.0

    @property
    def tails_pct(self):
        return round(self.tails / self.total * 100, 2) if self.total else 0.0

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

        self.heads_pct_series.append(self.heads_pct)

    def flip(self):
        result = flip()
        self.record(result)
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
            "heads_pct_series": list(self.heads_pct_series),
        }
