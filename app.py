"""Flask server for the Coin Flip Simulator."""

from flask import Flask, jsonify, render_template, request

from simulator import CoinStats

app = Flask(__name__)
stats = CoinStats()  # in-memory; fine for a single-user portfolio app


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/flip")
def api_flip():
    """Flip once, or `count` times when JSON body {"count": n} is sent."""
    body = request.get_json(silent=True) or {}
    count = body.get("count", 1)
    try:
        result, batch_heads, batch_tails = stats.flip_many(count)
    except ValueError as err:
        return jsonify(error=str(err)), 400
    return jsonify(
        result=result,
        batch={"count": count, "heads": batch_heads, "tails": batch_tails},
        stats=stats.to_dict(),
    )


@app.get("/api/analyze")
def api_analyze():
    """Analyze flips ?start=a&end=b (1-based, inclusive)."""
    start = request.args.get("start", type=int)
    end = request.args.get("end", type=int)
    try:
        return jsonify(analysis=stats.analyze(start, end))
    except ValueError as err:
        return jsonify(error=str(err)), 400


@app.get("/api/stats")
def api_stats():
    return jsonify(stats=stats.to_dict())


@app.post("/api/reset")
def api_reset():
    stats.reset()
    return jsonify(stats=stats.to_dict())


if __name__ == "__main__":
    app.run(debug=True)
