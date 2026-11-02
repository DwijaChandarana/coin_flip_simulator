"""Flask server for the Coin Flip Simulator."""

from flask import Flask, jsonify, render_template

from simulator import CoinStats

app = Flask(__name__)
stats = CoinStats()  # in-memory; fine for a single-user portfolio app


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/flip")
def api_flip():
    result = stats.flip()
    return jsonify(result=result, stats=stats.to_dict())


@app.get("/api/stats")
def api_stats():
    return jsonify(stats=stats.to_dict())


@app.post("/api/reset")
def api_reset():
    stats.reset()
    return jsonify(stats=stats.to_dict())


if __name__ == "__main__":
    app.run(debug=True)
