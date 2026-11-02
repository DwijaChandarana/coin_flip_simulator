// Coin Flip Simulator: front-end logic
(() => {
  const $ = (id) => document.getElementById(id);
  const coin = $("coin");
  const coinWrap = $("coinWrap");
  const flipBtn = $("flipBtn");
  const resetBtn = $("resetBtn");
  const resultEl = $("result");
  const soundToggle = $("soundToggle");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FLIP_MS = reduceMotion ? 50 : 1600;
  coinWrap.style.setProperty("--dur", `${FLIP_MS}ms`);

  let rotation = 0;   // cumulative rotateX in degrees
  let busy = false;
  let prevTotal = 0;

  // ---------- API ----------
  async function api(path, method = "GET") {
    const res = await fetch(path, { method });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
    return res.json();
  }

  // ---------- Sound (tiny synthesized "ting", no audio files needed) ----------
  let audioCtx;
  function ting(freq = 1200) {
    if (!soundToggle.checked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch { /* audio not available, ignore */ }
  }

  // ---------- Chart ----------
  const chart = new Chart($("chart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Heads %",
          data: [],
          borderColor: "#f5c542",
          backgroundColor: "rgba(245, 197, 66, 0.12)",
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "50% (expected)",
          data: [],
          borderColor: "rgba(255, 255, 255, 0.45)",
          borderDash: [6, 6],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { color: "#9aa1c2", callback: (v) => `${v}%` },
          grid: { color: "rgba(255, 255, 255, 0.06)" },
        },
        x: {
          title: { display: true, text: "Flip number", color: "#9aa1c2" },
          ticks: { color: "#9aa1c2", maxTicksLimit: 10 },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { labels: { color: "#eef0fa", usePointStyle: true, pointStyle: "line" } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y}%` } },
      },
    },
  });

  function updateChart(series) {
    chart.data.labels = series.map((_, i) => i + 1);
    chart.data.datasets[0].data = series;
    chart.data.datasets[1].data = series.map(() => 50);
    chart.update();
  }

  // ---------- Stats UI ----------
  function setValue(id, value) {
    const el = $(id);
    if (el.textContent !== String(value)) {
      el.textContent = value;
      el.classList.remove("bump");
      void el.offsetWidth; // restart animation
      el.classList.add("bump");
    }
  }

  function renderStats(s) {
    setValue("heads", s.heads);
    setValue("tails", s.tails);
    setValue("total", s.total);
    setValue("bestHeads", s.longest_heads_streak);
    setValue("bestTails", s.longest_tails_streak);
    $("headsPct").textContent = `${s.heads_pct}%`;
    $("tailsPct").textContent = `${s.tails_pct}%`;
    $("streak").textContent = s.current_side
      ? `${s.current_streak}× ${s.current_side === "H" ? "Heads" : "Tails"}`
      : "–";
    $("ratioFill").style.width = s.total ? `${s.heads_pct}%` : "50%";

    renderHistory(s.history, s.total > prevTotal);
    updateChart(s.heads_pct_series);
    prevTotal = s.total;
  }

  function renderHistory(history, animateNewest) {
    const box = $("history");
    box.innerHTML = "";
    if (!history.length) {
      box.innerHTML = '<span class="empty">No flips yet</span>';
      return;
    }
    // newest first
    [...history].reverse().forEach((r, i) => {
      const chip = document.createElement("span");
      chip.className = `chip ${r}${i === 0 && animateNewest ? " new" : ""}`;
      chip.textContent = r;
      chip.title = r === "H" ? "Heads" : "Tails";
      box.appendChild(chip);
    });
  }

  // ---------- Flip ----------
  function spinTo(result) {
    // Heads shows at rotateX ≡ 0 (mod 360), tails at ≡ 180.
    const spins = reduceMotion ? 0 : 4 + Math.floor(Math.random() * 3); // 4–6 full turns
    const target = result === "H" ? 0 : 180;
    const current = ((rotation % 360) + 360) % 360;
    let delta = target - current;
    if (delta < 0) delta += 360;
    rotation += spins * 360 + delta;
    coin.style.transform = `rotateX(${rotation}deg)`;

    coinWrap.classList.remove("tossing");
    void coinWrap.offsetWidth; // restart toss animation
    coinWrap.classList.add("tossing");
  }

  async function doFlip() {
    if (busy) return;
    busy = true;
    flipBtn.disabled = true;
    resetBtn.disabled = true;
    resultEl.className = "result";
    resultEl.textContent = "Flipping…";
    ting(900);

    try {
      const { result, stats } = await api("/api/flip", "POST");
      spinTo(result);
      setTimeout(() => {
        const isHeads = result === "H";
        resultEl.textContent = isHeads ? "Heads!" : "Tails!";
        resultEl.className = `result ${isHeads ? "heads" : "tails"} pop`;
        ting(isHeads ? 1320 : 1050);
        renderStats(stats);
        busy = false;
        flipBtn.disabled = false;
        resetBtn.disabled = false;
        flipBtn.focus();
      }, FLIP_MS);
    } catch (err) {
      console.error(err);
      resultEl.textContent = "Could not reach the server";
      busy = false;
      flipBtn.disabled = false;
      resetBtn.disabled = false;
    }
  }

  async function doReset() {
    if (busy) return;
    const { stats } = await api("/api/reset", "POST");
    resultEl.className = "result";
    resultEl.textContent = "Press flip to start";
    prevTotal = 0;
    renderStats(stats);
  }

  flipBtn.addEventListener("click", doFlip);
  resetBtn.addEventListener("click", doReset);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") {
      e.preventDefault();
      doFlip();
    }
  });

  // Load existing stats (survives page refresh while server runs)
  api("/api/stats")
    .then(({ stats }) => {
      prevTotal = stats.total;
      renderStats(stats);
    })
    .catch(console.error);
})();
