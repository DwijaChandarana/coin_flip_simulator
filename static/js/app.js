// Coin Flip Simulator: front-end logic
(() => {
  const $ = (id) => document.getElementById(id);
  const coin = $("coin");
  const coinWrap = $("coinWrap");
  const flipBtn = $("flipBtn");
  const resetBtn = $("resetBtn");
  const resultEl = $("result");
  const soundToggle = $("soundToggle");
  const bulkForm = $("bulkForm");
  const flipCount = $("flipCount");
  const bulkError = $("bulkError");
  const rangeForm = $("rangeForm");
  const rangeStart = $("rangeStart");
  const rangeEnd = $("rangeEnd");
  const rangeError = $("rangeError");
  const MAX_FLIPS = 100000;
  const fmt = (n) => Number(n).toLocaleString();

  const flipControls = () => [flipBtn, resetBtn, $("bulkBtn"), ...document.querySelectorAll(".bulk .preset")];
  const rangeControls = () => [rangeStart, rangeEnd, $("rangeBtn"), ...document.querySelectorAll(".range-preset")];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FLIP_MS = reduceMotion ? 50 : 1600;
  coinWrap.style.setProperty("--dur", `${FLIP_MS}ms`);

  let rotation = 0;   // cumulative rotateX in degrees
  let busy = false;
  let prevTotal = 0;
  let current = null; // latest stats from the server

  // ---------- API ----------
  async function api(path, method = "GET", body) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `${method} ${path} failed: ${res.status}`);
      err.fromServer = Boolean(data.error);
      throw err;
    }
    return data;
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

  // ---------- Charts ----------
  function makeLineChart(canvas, label) {
    return new Chart(canvas, {
      type: "line",
      data: {
        datasets: [
          {
            label,
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
            type: "linear",
            title: { display: true, text: "Flip number", color: "#9aa1c2" },
            ticks: { color: "#9aa1c2", maxTicksLimit: 10, precision: 0, callback: (v) => fmt(v) },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { labels: { color: "#eef0fa", usePointStyle: true, pointStyle: "line" } },
          tooltip: {
            callbacks: {
              title: (items) => items.length ? `Flip #${fmt(items[0].parsed.x)}` : "",
              label: (c) => ` ${c.dataset.label}: ${c.parsed.y}%`,
            },
          },
        },
      },
    });
  }

  function updateChart(c, { x, y }) {
    const first = x.length ? x[0] : 1;
    const last = x.length ? x[x.length - 1] : 1;
    c.data.datasets[0].data = x.map((xi, i) => ({ x: xi, y: y[i] }));
    c.data.datasets[1].data = x.length ? [{ x: first, y: 50 }, { x: last, y: 50 }] : [];
    c.options.scales.x.min = first;
    c.options.scales.x.max = Math.max(last, first + 1);
    c.update();
  }

  const chart = makeLineChart($("chart"), "Heads %");
  const rangeChart = makeLineChart($("rangeChart"), "Heads % within range");

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
    current = s;
    setValue("heads", fmt(s.heads));
    setValue("tails", fmt(s.tails));
    setValue("total", fmt(s.total));
    setValue("bestHeads", s.longest_heads_streak);
    setValue("bestTails", s.longest_tails_streak);
    $("headsPct").textContent = `${s.heads_pct}%`;
    $("tailsPct").textContent = `${s.tails_pct}%`;
    $("streak").textContent = s.current_side
      ? `${s.current_streak}× ${s.current_side === "H" ? "Heads" : "Tails"}`
      : "–";
    $("ratioFill").style.width = s.total ? `${s.heads_pct}%` : "50%";

    renderHistory(s.history, s.total > prevTotal);
    updateChart(chart, s.chart);
    updateRangeControls(s);
    prevTotal = s.total;
  }

  function makeChip(r, extraClass = "") {
    const chip = document.createElement("span");
    chip.className = `chip ${r}${extraClass}`;
    chip.textContent = r;
    chip.title = r === "H" ? "Heads" : "Tails";
    return chip;
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
      box.appendChild(makeChip(r, i === 0 && animateNewest ? " new" : ""));
    });
  }

  // ---------- Flip ----------
  function spinTo(result) {
    // Heads shows at rotateX ≡ 0 (mod 360), tails at ≡ 180.
    const spins = reduceMotion ? 0 : 4 + Math.floor(Math.random() * 3); // 4–6 full turns
    const target = result === "H" ? 0 : 180;
    const cur = ((rotation % 360) + 360) % 360;
    let delta = target - cur;
    if (delta < 0) delta += 360;
    rotation += spins * 360 + delta;
    coin.style.transform = `rotateX(${rotation}deg)`;

    coinWrap.classList.remove("tossing");
    void coinWrap.offsetWidth; // restart toss animation
    coinWrap.classList.add("tossing");
  }

  function setBusy(on) {
    busy = on;
    flipControls().forEach((el) => { el.disabled = on; });
    const noFlips = !current || current.total === 0;
    rangeControls().forEach((el) => { el.disabled = on || noFlips; });
  }

  async function doFlip(count = 1) {
    if (busy) return;
    setBusy(true);
    resultEl.className = "result";
    resultEl.textContent = count === 1 ? "Flipping…" : `Flipping ${fmt(count)} coins…`;
    ting(900);

    try {
      const { result, batch, stats } = await api("/api/flip", "POST", { count });
      spinTo(result);
      setTimeout(() => {
        if (count === 1) {
          const isHeads = result === "H";
          resultEl.textContent = isHeads ? "Heads!" : "Tails!";
          resultEl.className = `result ${isHeads ? "heads" : "tails"} pop`;
          ting(isHeads ? 1320 : 1050);
        } else {
          const pct = ((batch.heads / batch.count) * 100).toFixed(1);
          resultEl.innerHTML =
            `Flipped ${fmt(batch.count)} times!` +
            `<span class="batch">${fmt(batch.heads)} heads (${pct}%) · ${fmt(batch.tails)} tails</span>`;
          resultEl.className = "result pop";
          ting(1320);
        }
        renderStats(stats);
        setBusy(false);
      }, FLIP_MS);
    } catch (err) {
      console.error(err);
      resultEl.textContent = err.fromServer ? err.message : "Could not reach the server";
      setBusy(false);
    }
  }

  // ---------- Flip-many form ----------
  function readCount() {
    const raw = flipCount.value.trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1 || n > MAX_FLIPS) {
      bulkError.textContent = `Enter a whole number from 1 to ${fmt(MAX_FLIPS)}.`;
      flipCount.classList.add("invalid");
      return null;
    }
    bulkError.textContent = "";
    flipCount.classList.remove("invalid");
    return n;
  }

  bulkForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = readCount();
    if (n) doFlip(n);
  });

  flipCount.addEventListener("input", () => {
    if (flipCount.classList.contains("invalid")) readCount();
  });

  document.querySelectorAll(".bulk .preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      flipCount.value = btn.dataset.count;
      readCount();
      doFlip(Number(btn.dataset.count));
    });
  });

  // ---------- Range analysis ----------
  function updateRangeControls(s) {
    const has = s.total > 0;
    rangeControls().forEach((el) => { el.disabled = busy || !has; });
    $("rangeEmpty").hidden = has;
    rangeStart.max = rangeEnd.max = s.total || 1;

    if (!has) {
      rangeStart.value = rangeEnd.value = "";
      $("rangeResults").hidden = true;
      rangeError.textContent = "";
      return;
    }
    // Default to the latest batch so the user can analyze it straight away
    if (s.total !== prevTotal && s.last_batch) {
      [rangeStart.value, rangeEnd.value] = s.last_batch;
      rangeStart.classList.remove("invalid");
      rangeEnd.classList.remove("invalid");
      rangeError.textContent = "";
    }
  }

  function presetRange(kind) {
    const total = current ? current.total : 0;
    const half = Math.floor(total / 2);
    switch (kind) {
      case "last": return current.last_batch || [1, total];
      case "first-half": return [1, Math.max(half, 1)];
      case "second-half": return [Math.min(half + 1, total), total];
      default: return [1, total];
    }
  }

  function readRange() {
    const total = current ? current.total : 0;
    const a = Number(rangeStart.value.trim());
    const b = Number(rangeEnd.value.trim());
    const okA = rangeStart.value.trim() !== "" && Number.isInteger(a) && a >= 1 && a <= total;
    const okB = rangeEnd.value.trim() !== "" && Number.isInteger(b) && b >= 1 && b <= total;
    rangeStart.classList.toggle("invalid", !okA);
    rangeEnd.classList.toggle("invalid", !okB);
    if (!okA || !okB) {
      rangeError.textContent = `Enter whole numbers from 1 to ${fmt(total)}.`;
      return null;
    }
    if (a > b) {
      rangeStart.classList.add("invalid");
      rangeEnd.classList.add("invalid");
      rangeError.textContent = "'From' must not be after 'To'.";
      return null;
    }
    rangeError.textContent = "";
    return [a, b];
  }

  async function analyzeRange() {
    const range = readRange();
    if (!range) return;
    try {
      const { analysis } = await api(`/api/analyze?start=${range[0]}&end=${range[1]}`);
      renderAnalysis(analysis);
    } catch (err) {
      console.error(err);
      rangeError.textContent = err.fromServer ? err.message : "Could not reach the server";
    }
  }

  function streakText(s) {
    if (!s.length) return "none";
    return s.length === 1 ? `at flip #${fmt(s.start)}` : `flips #${fmt(s.start)}–${fmt(s.start + s.length - 1)}`;
  }

  function renderAnalysis(a) {
    const box = $("rangeResults");
    box.hidden = false;
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.animation = "";

    $("rangeTitle").textContent = a.start === a.end
      ? `Flip #${fmt(a.start)}`
      : `Flips #${fmt(a.start)} to #${fmt(a.end)}`;
    setValue("rHeads", fmt(a.heads));
    setValue("rTails", fmt(a.tails));
    setValue("rCount", fmt(a.count));
    $("rHeadsPct").textContent = `${a.heads_pct}%`;
    $("rTailsPct").textContent = `${a.tails_pct}%`;
    $("rExpected").textContent = `expected ≈ ${fmt(a.expected_heads)} heads`;
    setValue("rBestHeads", a.longest_heads_streak.length);
    setValue("rBestTails", a.longest_tails_streak.length);
    $("rBestHeadsAt").textContent = streakText(a.longest_heads_streak);
    $("rBestTailsAt").textContent = streakText(a.longest_tails_streak);
    setValue("rRuns", fmt(a.runs));
    $("rRunsExpected").textContent = `expected ≈ ${fmt(a.expected_runs)}`;
    $("rRatioFill").style.width = `${a.heads_pct}%`;

    const v = $("rVerdict");
    const z = Math.abs(a.z_score);
    v.className = `verdict ${a.count < 10 ? "" : z <= 2 ? "fair" : z <= 3 ? "unusual" : "rare"}`;
    const off = a.heads - a.expected_heads;
    v.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = a.count < 10
      ? "Fairness check"
      : `Fairness check: ${off === 0 ? "exactly" : `${fmt(Math.abs(off))} ${off > 0 ? "more" : "fewer"} heads than`} expected (z = ${a.z_score})`;
    v.append(title, document.createTextNode(a.verdict));

    updateChart(rangeChart, a.chart);

    const seqWrap = $("rSequenceWrap");
    const seq = $("rSequence");
    seq.innerHTML = "";
    if (a.sequence) {
      seqWrap.hidden = false;
      [...a.sequence].forEach((r) => seq.appendChild(makeChip(r)));
    } else {
      seqWrap.hidden = true;
    }
  }

  rangeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    analyzeRange();
  });

  [rangeStart, rangeEnd].forEach((el) => el.addEventListener("input", () => {
    if (el.classList.contains("invalid")) readRange();
  }));

  document.querySelectorAll(".range-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!current || !current.total) return;
      [rangeStart.value, rangeEnd.value] = presetRange(btn.dataset.range);
      analyzeRange();
    });
  });

  // ---------- Reset & keyboard ----------
  async function doReset() {
    if (busy) return;
    const { stats } = await api("/api/reset", "POST");
    resultEl.className = "result";
    resultEl.textContent = "Press flip to start";
    prevTotal = 0;
    renderStats(stats);
  }

  flipBtn.addEventListener("click", () => doFlip(1));
  resetBtn.addEventListener("click", doReset);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") {
      e.preventDefault();
      doFlip(1);
    }
  });

  // Load existing stats (survives page refresh while server runs)
  api("/api/stats")
    .then(({ stats }) => {
      prevTotal = -1; // force range inputs to pick up the last batch
      renderStats(stats);
    })
    .catch(console.error);
})();
