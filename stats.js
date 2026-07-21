/* ============================================
   stats.js — 통계 (구분별/기간별/장르별 + 히트맵)
   ============================================ */

let _charts = [];

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch {} });
  _charts = [];
}

const PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
  "#a855f7", "#0ea5e9", "#eab308", "#f43f5e", "#22c55e"
];

function renderStats() {
  destroyCharts();
  const items = State.items;
  const wrap = $("#tab-stats");

  if (!items.length) {
    wrap.innerHTML = `<div class="text-center py-16 text-slate-400">
      <i class="fa-solid fa-chart-pie text-4xl mb-3"></i>
      <p class="font-medium">데이터가 없습니다</p></div>`;
    return;
  }

  /* --- 집계 --- */
  const byType = countBy(items, i => i.type || "기타");
  const byCountry = countBy(items, i => i.country || "미상");
  const byOtt = countBy(items, i => i.ott || "기타");
  const byGenre = countBy(items.flatMap(i => i.genres || []), g => g);
  const byYear = countBy(items.filter(i => i.startDate), i => i.startDate.slice(0, 4));

  const rated = items.filter(i => i.rating);
  const avgRating = rated.length ? (rated.reduce((s, i) => s + i.rating, 0) / rated.length).toFixed(2) : "-";
  const totalWatch = items.reduce((s, i) => s + (i.watchCount || 1), 0);
  const rewatched = items.filter(i => (i.watchCount || 1) > 1).length;

  const years = Object.keys(byYear).sort();
  const currentYear = new Date().getFullYear();

  wrap.innerHTML = `
    <!-- 요약 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="stat-box"><div class="stat-label">총 작품</div><div class="stat-value">${items.length}</div></div>
      <div class="stat-box"><div class="stat-label">총 시청 횟수</div><div class="stat-value">${totalWatch}</div></div>
      <div class="stat-box"><div class="stat-label">평균 별점</div><div class="stat-value">${avgRating}</div></div>
      <div class="stat-box"><div class="stat-label">재시청 작품</div><div class="stat-value">${rewatched}</div></div>
    </div>

    <!-- 연도별 막대 -->
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <h3 class="font-semibold text-slate-800 mb-4"><i class="fa-solid fa-chart-column mr-2 text-indigo-500"></i>연도별 시청</h3>
      <div style="height:260px"><canvas id="chartYear"></canvas></div>
    </div>

    <!-- 히트맵 -->
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-slate-800"><i class="fa-solid fa-calendar-days mr-2 text-indigo-500"></i>시청 히트맵</h3>
        <select id="heatYear" class="filter-select">
          ${years.slice().reverse().map(y => `<option value="${y}" ${y == currentYear ? "selected" : ""}>${y}년</option>`).join("")}
        </select>
      </div>
      <div id="heatmapArea" class="overflow-x-auto"></div>
    </div>

    <!-- 장르 + 구분 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h3 class="font-semibold text-slate-800 mb-4"><i class="fa-solid fa-chart-pie mr-2 text-indigo-500"></i>장르별</h3>
        <div style="height:280px"><canvas id="chartGenre"></canvas></div>
        ${!Object.keys(byGenre).length ? `<p class="text-sm text-amber-600 font-medium text-center mt-3">
          TMDB 정보를 채우면 장르 통계가 표시됩니다</p>` : ""}
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h3 class="font-semibold text-slate-800 mb-4"><i class="fa-solid fa-shapes mr-2 text-indigo-500"></i>구분별</h3>
        <div style="height:280px"><canvas id="chartType"></canvas></div>
      </div>
    </div>

    <!-- 국가 + OTT -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h3 class="font-semibold text-slate-800 mb-4"><i class="fa-solid fa-earth-asia mr-2 text-indigo-500"></i>국가별</h3>
        <div style="height:260px"><canvas id="chartCountry"></canvas></div>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h3 class="font-semibold text-slate-800 mb-4"><i class="fa-solid fa-tv mr-2 text-indigo-500"></i>OTT별</h3>
        <div style="height:260px"><canvas id="chartOtt"></canvas></div>
      </div>
    </div>

    <!-- 별점 분포 -->
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <h3 class="font-semibold text-slate-800 mb-4"><i class="fa-solid fa-star mr-2 text-indigo-500"></i>별점 분포</h3>
      <div style="height:220px"><canvas id="chartRating"></canvas></div>
    </div>
  `;

  /* --- 차트 그리기 --- */
  const commonOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { font: { size: 12, weight: 500 } } } }
  };

  // 연도별
  _charts.push(new Chart($("#chartYear"), {
    type: "bar",
    data: {
      labels: years.map(y => y + "년"),
      datasets: [{ label: "작품 수", data: years.map(y => byYear[y]), backgroundColor: "#6366f1", borderRadius: 6 }]
    },
    options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  // 장르 파이
  const gTop = topN(byGenre, 12);
  if (gTop.labels.length) {
    _charts.push(new Chart($("#chartGenre"), {
      type: "doughnut",
      data: { labels: gTop.labels, datasets: [{ data: gTop.values, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }] },
      options: { ...commonOpts, plugins: { legend: { position: "right", labels: { font: { size: 11, weight: 500 }, boxWidth: 12 } } } }
    }));
  }

  // 구분 파이
  const tTop = topN(byType, 8);
  _charts.push(new Chart($("#chartType"), {
    type: "doughnut",
    data: { labels: tTop.labels, datasets: [{ data: tTop.values, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }] },
    options: { ...commonOpts, plugins: { legend: { position: "right", labels: { font: { size: 11, weight: 500 }, boxWidth: 12 } } } }
  }));

  // 국가
  const cTop = topN(byCountry, 10);
  _charts.push(new Chart($("#chartCountry"), {
    type: "bar",
    data: { labels: cTop.labels, datasets: [{ data: cTop.values, backgroundColor: "#10b981", borderRadius: 6 }] },
    options: { ...commonOpts, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  // OTT
  const oTop = topN(byOtt, 10);
  _charts.push(new Chart($("#chartOtt"), {
    type: "bar",
    data: { labels: oTop.labels, datasets: [{ data: oTop.values, backgroundColor: "#f59e0b", borderRadius: 6 }] },
    options: { ...commonOpts, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  // 별점
  const rCount = [1, 2, 3, 4, 5].map(n => items.filter(i => i.rating === n).length);
  _charts.push(new Chart($("#chartRating"), {
    type: "bar",
    data: { labels: ["★1", "★2", "★3", "★4", "★5"], datasets: [{ data: rCount, backgroundColor: "#fbbf24", borderRadius: 6 }] },
    options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  // 히트맵
  const heatSel = $("#heatYear");
  if (heatSel) {
    const draw = () => renderHeatmap(parseInt(heatSel.value));
    heatSel.addEventListener("change", draw);
    draw();
  }
}

/* ---------- 집계 헬퍼 ---------- */
function countBy(arr, keyFn) {
  const m = {};
  arr.forEach(x => {
    const k = keyFn(x);
    if (k) m[k] = (m[k] || 0) + 1;
  });
  return m;
}

function topN(obj, n) {
  const sorted = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  const labels = top.map(x => x[0]);
  const values = top.map(x => x[1]);
  if (rest.length) {
    labels.push("기타");
    values.push(rest.reduce((s, x) => s + x[1], 0));
  }
  return { labels, values };
}

/* ---------- 히트맵 ---------- */
function renderHeatmap(year) {
  const counts = {};
  State.items.forEach(i => {
    const ranges = [[i.startDate, i.endDate], [i.lastWatchStart, i.lastWatchEnd]];
    ranges.forEach(([s, e]) => {
      if (!s) return;
      let cur = new Date(s + "T00:00:00");
      const end = new Date((e || s) + "T00:00:00");
      let guard = 0;
      while (cur <= end && guard++ < 400) {
        const key = cur.toISOString().slice(0, 10);
        if (key.startsWith(String(year))) counts[key] = (counts[key] || 0) + 1;
        cur.setDate(cur.getDate() + 1);
      }
    });
  });

  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const startOffset = jan1.getDay();
  const totalDays = Math.round((dec31 - jan1) / 86400000) + 1;
  const weeks = Math.ceil((startOffset + totalDays) / 7);

  const level = (c) => c === 0 ? 0 : c === 1 ? 1 : c <= 2 ? 2 : c <= 4 ? 3 : 4;
  const monthLabels = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

  let cols = "";
  let monthRow = "";
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    let firstDayOfWeek = null;
    let cells = "";
    for (let d = 0; d < 7; d++) {
      const dayIdx = w * 7 + d - startOffset;
      if (dayIdx < 0 || dayIdx >= totalDays) {
        cells += `<div class="w-3 h-3"></div>`;
        continue;
      }
      const date = new Date(year, 0, 1 + dayIdx);
      const key = `${year}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
      const c = counts[key] || 0;
      if (firstDayOfWeek === null) firstDayOfWeek = date;
      cells += `<div class="heat-cell ${c ? "heat-" + level(c) : ""}" title="${key} — ${c}편"></div>`;
    }
    cols += `<div class="flex flex-col gap-[3px]">${cells}</div>`;

    const m = firstDayOfWeek ? firstDayOfWeek.getMonth() : lastMonth;
    if (m !== lastMonth && firstDayOfWeek && firstDayOfWeek.getDate() <= 7) {
      monthRow += `<div class="w-3 text-[10px] font-semibold text-slate-400 relative"><span class="absolute left-0 whitespace-nowrap">${monthLabels[m]}</span></div>`;
      lastMonth = m;
    } else {
      monthRow += `<div class="w-3"></div>`;
    }
  }

  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  const activeDays = Object.keys(counts).length;

  $("#heatmapArea").innerHTML = `
    <div class="min-w-max">
      <div class="flex gap-[3px] mb-1 h-4">${monthRow}</div>
      <div class="flex gap-[3px]">${cols}</div>
      <div class="flex items-center justify-between mt-3 text-xs font-medium text-slate-500">
        <span>${year}년 · 시청한 날 ${activeDays}일 · 총 ${total}편</span>
        <span class="flex items-center gap-1">
          적음
          <span class="heat-cell"></span>
          <span class="heat-cell heat-1"></span>
          <span class="heat-cell heat-2"></span>
          <span class="heat-cell heat-3"></span>
          <span class="heat-cell heat-4"></span>
          많음
        </span>
      </div>
    </div>`;
}
