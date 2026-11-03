"""Law of large numbers demo: plots how the heads % converges to 50%.

Run:  python analysis.py
Output: static/img/convergence.png
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no GUI window needed
import matplotlib.pyplot as plt

from simulator import CoinStats

FLIPS = 10_000
RUNS = 5
OUT = Path(__file__).parent / "static" / "img" / "convergence.png"


def simulate_run(n):
    stats = CoinStats()
    stats.flip_many(n)
    return [stats.heads_pct_at(i) for i in range(n)]


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    plt.style.use("dark_background")
    fig, ax = plt.subplots(figsize=(10, 5.5), dpi=120)
    fig.patch.set_facecolor("#0f1222")
    ax.set_facecolor("#0f1222")

    colors = ["#f5c542", "#5ec8f2", "#f2709c", "#8ee07a", "#b18cf2"]
    for i in range(RUNS):
        series = simulate_run(FLIPS)
        ax.plot(range(1, FLIPS + 1), series, color=colors[i % len(colors)],
                linewidth=1.2, alpha=0.9, label=f"Run {i + 1}")

    ax.axhline(50, color="white", linestyle="--", linewidth=1, alpha=0.6, label="50% (expected)")
    ax.set_xscale("log")
    ax.set_ylim(0, 100)
    ax.set_xlabel("Number of flips (log scale)")
    ax.set_ylabel("Heads %")
    ax.set_title(f"Law of Large Numbers: {RUNS} runs of {FLIPS:,} coin flips")
    ax.grid(alpha=0.15)
    ax.legend(loc="upper right", frameon=False)

    fig.tight_layout()
    fig.savefig(OUT, facecolor=fig.get_facecolor())
    print(f"Saved {OUT}")


if __name__ == "__main__":
    main()
