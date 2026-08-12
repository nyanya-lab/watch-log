/* ============================================
   stats.js — 통계 (구분별/기간별/장르별 + 히트맵)
   ============================================ */

let _charts = [];

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch {} });
  _charts = [];
}

const PALETTE = [
  "#5f9235", "#10b981", "#f59e0b", "#ef4444", "#7bad48",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
  "#8fbf63", "#0ea5e9", "#eab308", "#f43f5e", "#22c55e"
];

/* Chart.js는 캔버스에 글자를 직접 그리므로 CSS font-family를 물려받지 않는다.
   기본값이 Helvetica라 차트 안 글씨만 딴 폰트로 나온다 → 여기서 맞춰준다. */
function applyChartFont() {
  if (!window.Chart) return;
  Chart.defaults.font.family = "'Gowun Dodum', 'Pretendard Variable', Pretendard, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#6f7468";
}

function renderStats() {
  applyChartFont();
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
  /* OTT는 한 작품이 여러 곳에 있을 수 있어 `countBy`(값 하나)로는 못 센다.
     **필터·카드와 같은 기준(`ottList`)을 쓴다** — 예전엔 `i.ott`(내가 본 곳)만 세서,
     그 필드를 비우고 나니 통계가 거의 "기타"가 됐다. */
  const byOtt = {};
  items.forEach(i => {
    const list = ottList(i);
    if (!list.length) { byOtt["정보 없음"] = (byOtt["정보 없음"] || 0) + 1; return; }
    list.forEach(o => { byOtt[o] = (byOtt[o] || 0) + 1; });
  });
  const byGenre = countBy(items.flatMap(i => visibleGenres(i.genres)), g => g);
  const byYear = countBy(items.filter(i => i.startDate), i => i.startDate.slice(0, 4));
  const byActor = countBy(items.flatMap(i => (i.cast || []).map(c => c.name)), n => n);
  const byDirector = countBy(items.map(i => i.director).filter(Boolean), d => d);

  // 월별(1~12월) — 처음 본 날 + 마지막 시청 시작월 집계
  const byMonth = {};
  items.forEach(i => {
    [i.startDate, i.lastWatchStart].forEach(d => {
      if (d) { const m = +d.slice(5, 7); if (m) byMonth[m] = (byMonth[m] || 0) + 1; }
    });
  });

  // 시즌 묶음 기준 작품 수 (표시 전용 그룹핑 — watchlog.js의 groupItems 사용)
  const totalWorks = (typeof groupItems === "function") ? groupItems(items).length : items.length;

  const rated = items.filter(i => i.rating);
  const avgRating = rated.length ? (rated.reduce((s, i) => s + i.rating, 0) / rated.length).toFixed(2) : "-";

  /* 내 별점 ↔ TMDB 평점 비교.
     **둘 다 있는 기록만** 쓴다 — 내 별점은 일부에만 있고 TMDB 평점은 거의 전부에 있어서,
     각자 전체를 세면 막대 높이가 모집단 차이로 벌어져 비교가 성립하지 않는다. */
  const pairs = items.filter(i => i.rating && i.voteAverage);
  const avgOf = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
  let gapNote = "";
  if (pairs.length) {
    const myAvg = avgOf(pairs, i => i.rating), tmAvg = avgOf(pairs, i => i.voteAverage);
    const gap = myAvg - tmAvg;
    gapNote = `평균 ♥${myAvg.toFixed(1)} · ★${tmAvg.toFixed(1)} — ` +
      (Math.abs(gap) < 0.2 ? "거의 같습니다"
        : `내가 ${Math.abs(gap).toFixed(1)}점 ${gap > 0 ? "후합니다" : "박합니다"}`);
  }
  const totalWatch = items.reduce((s, i) => s + (i.watchCount || 1), 0);
  const rewatched = items.filter(i => (i.watchCount || 1) > 1).length;

  const years = Object.keys(byYear).sort();
  const currentYear = new Date().getFullYear();
  const thisYearCount = items.filter(i =>
    (i.startDate || "").slice(0, 4) == currentYear ||
    (i.lastWatchStart || "").slice(0, 4) == currentYear).length;

  // 예상 시청시간: 영화=상영시간, TV=회당×총화수 (있을 때만)
  const totalMin = items.reduce((s, i) => {
    const rt = i.runtime || 0;
    if (!rt) return s;
    return s + (i.type === "영화" ? rt : rt * (i.totalEpisodes || 1));
  }, 0);
  const totalHours = Math.round(totalMin / 60);

  wrap.innerHTML = `
    <!-- 요약 — 타일만 흰 면을 갖고, 아래 차트들은 박스 없이 헤어라인으로 나뉜다 -->
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-2">
      <div class="stat-box"><div class="stat-label">시청 기록 <span class="text-slate-400">(편·시즌별)</span></div><div class="stat-value">${items.length}</div></div>
      <div class="stat-box"><div class="stat-label">작품 수 <span class="text-slate-400">(시리즈 묶음)</span></div><div class="stat-value">${totalWorks}</div></div>
      <div class="stat-box"><div class="stat-label">${currentYear}년 시청</div><div class="stat-value">${thisYearCount}</div></div>
      <div class="stat-box"><div class="stat-label">재시청 작품</div><div class="stat-value">${rewatched}</div></div>
      <div class="stat-box"><div class="stat-label">평균 별점</div><div class="stat-value">${avgRating}</div></div>
      <div class="stat-box"><div class="stat-label">예상 시청시간</div><div class="stat-value">${totalHours.toLocaleString()}<span class="text-base font-semibold text-slate-400">시간</span></div></div>
    </div>

    <!-- 장르 + 구분 -->
    <section class="stat-sec">
      <div class="stat-grid2">
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-chart-pie"></i>장르별</h3>
          <p class="stat-note">한 작품이 장르를 여러 개 가지므로, 전체 장르 태그(${Object.values(byGenre).reduce((a, b) => a + b, 0)}개) 중 비율입니다</p>
          <div style="height:300px"><canvas id="chartGenre"></canvas></div>
          ${!Object.keys(byGenre).length ? `<p class="stat-note text-center">TMDB 정보를 채우면 장르 통계가 표시됩니다</p>` : ""}
        </div>
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-shapes"></i>구분별</h3>
          <div style="height:280px"><canvas id="chartType"></canvas></div>
        </div>
      </div>
    </section>

    <!-- 국가 + OTT -->
    <section class="stat-sec">
      <div class="stat-grid2">
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-earth-asia"></i>국가별</h3>
          <div style="height:260px"><canvas id="chartCountry"></canvas></div>
        </div>
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-tv"></i>OTT별</h3>
          <div style="height:260px"><canvas id="chartOtt"></canvas></div>
        </div>
      </div>
    </section>

    <!-- 배우 + 감독 -->
    <section class="stat-sec">
      <div class="stat-grid2">
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-user" style="color:#d4537e"></i>많이 본 배우 TOP 10</h3>
          ${Object.keys(byActor).length
            ? `<div style="height:300px"><canvas id="chartActor"></canvas></div>`
            : `<p class="stat-note text-center">TMDB 정보를 채우면 출연진 통계가 표시됩니다</p>`}
        </div>
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-clapperboard" style="color:#64748b"></i>많이 본 감독 TOP 10</h3>
          ${Object.keys(byDirector).length
            ? `<div style="height:300px"><canvas id="chartDirector"></canvas></div>`
            : `<p class="stat-note text-center">TMDB 정보를 채우면 감독 통계가 표시됩니다</p>`}
        </div>
      </div>
    </section>

    <!-- 별점 분포 + 내 별점↔TMDB 비교 -->
    <section class="stat-sec">
      <div class="stat-grid2">
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-heart" style="color:#e0567f"></i>별점 분포</h3>
          <p class="stat-note">${pairs.length ? `내가 별점을 매긴 ${pairs.length}개를 두 점수로 나눠 셌습니다 (같은 작품이라 높이를 그대로 비교할 수 있습니다)` : `별점을 매기면 TMDB 평점과 나란히 비교됩니다`}</p>
          ${pairs.length ? `<div style="height:260px"><canvas id="chartRating"></canvas></div>` : ""}
        </div>
        <div>
          <h3 class="stat-h"><i class="fa-solid fa-code-compare" style="color:#0ea5e9"></i>작품별로 견줘보기</h3>
          <p class="stat-note">${pairs.length
            ? `점 하나가 작품입니다. 대각선 위 = 내가 더 후하게 본 작품 · ${gapNote}`
            : `별점을 매긴 작품이 없어 비교할 수 없습니다`}</p>
          ${pairs.length
            ? `<div style="height:260px"><canvas id="chartGap"></canvas></div>`
            : `<p class="stat-note text-center">목록 탭의 [별점 채우기]로 매길 수 있습니다</p>`}
        </div>
      </div>
    </section>

    <!-- 연도별 막대 -->
    <section class="stat-sec">
      <h3 class="stat-h"><i class="fa-solid fa-chart-column"></i>연도별 시청</h3>
      <div style="height:260px"><canvas id="chartYear"></canvas></div>
    </section>

    <!-- 월별 추이 -->
    <section class="stat-sec">
      <h3 class="stat-h"><i class="fa-solid fa-calendar-week"></i>월별 시청 (전체 기간)</h3>
      <div style="height:220px"><canvas id="chartMonth"></canvas></div>
    </section>

    <!-- 히트맵 -->
    <section class="stat-sec">
      <div class="flex items-center justify-between mb-4">
        <h3 class="stat-h" style="margin-bottom:0"><i class="fa-solid fa-calendar-days"></i>시청 히트맵</h3>
        <select id="heatYear" class="filter-select">
          ${years.slice().reverse().map(y => `<option value="${y}" ${y == currentYear ? "selected" : ""}>${y}년</option>`).join("")}
        </select>
      </div>
      <div id="heatmapArea" class="overflow-x-auto"></div>
    </section>
  `;

  /* --- 차트 그리기 --- */
  // 차트 요소 클릭 → 해당 조건으로 목록 조회
  const clickToFilter = (patchFn) => (evt, els, chart) => {
    if (!els.length) return;
    const label = chart.data.labels[els[0].index];
    const patch = patchFn(label);
    if (patch && typeof jumpToList === "function") jumpToList(patch);
  };
  /* '기타' 조각 = 순위 밖 값들의 합. 그 값들을 통째로 걸면 조각 크기와 목록 개수가 맞는다 */
  const restPatch = (key, t) => (t.rest.length ? { [key]: t.rest } : null);
  const commonOpts = {
    responsive: true, maintainAspectRatio: false,
    onHover: (e, els) => { if (e.native) e.native.target.style.cursor = els.length ? "pointer" : "default"; },
    plugins: { legend: { labels: { font: { size: 12, weight: 500 } } } }
  };

  // 연도별
  _charts.push(new Chart($("#chartYear"), {
    type: "bar",
    data: {
      labels: years.map(y => y + "년"),
      datasets: [{ label: "작품 수", data: years.map(y => byYear[y]), backgroundColor: "#5f9235", borderRadius: 6 }]
    },
    options: { ...commonOpts, onClick: clickToFilter(l => ({ year: String(l).replace("년", "") })), plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  // 장르 파이
  // 장르 도넛. 한 작품이 장르를 여러 개 가지므로 분모는 "작품 수"가 아니라 "전체 장르 태그 수".
  // 그래야 조각 비율의 합이 100%가 되어 원형 차트가 성립한다.
  const gTop = topN(byGenre, 12);
  if (gTop.labels.length) {
    const gTotal = gTop.values.reduce((a, b) => a + b, 0);
    _charts.push(new Chart($("#chartGenre"), {
      type: "doughnut",
      data: { labels: gTop.labels, datasets: [{ data: gTop.values, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }] },
      options: {
        ...commonOpts,
        onClick: clickToFilter(l => (l === "기타" ? restPatch("genre", gTop) : { genre: l })),
        plugins: {
          legend: { position: "right", labels: { font: { size: 11, weight: 500 }, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.label} ${c.parsed}개 (${(c.parsed / gTotal * 100).toFixed(1)}%)`
            }
          }
        }
      }
    }));
  }

  // 구분 파이
  const tTop = topN(byType, 8);
  _charts.push(new Chart($("#chartType"), {
    type: "doughnut",
    data: { labels: tTop.labels, datasets: [{ data: tTop.values, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }] },
    options: { ...commonOpts, onClick: clickToFilter(l => ({ type: l })), plugins: { legend: { position: "right", labels: { font: { size: 11, weight: 500 }, boxWidth: 12 } } } }
  }));

  // 국가
  const cTop = topN(byCountry, 10);
  _charts.push(new Chart($("#chartCountry"), {
    type: "bar",
    data: { labels: cTop.labels, datasets: [{ data: cTop.values, backgroundColor: "#10b981", borderRadius: 6 }] },
    options: { ...commonOpts, onClick: clickToFilter(l => l === "미상" ? null : l === "기타" ? restPatch("country", cTop) : { country: l }), indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  // OTT
  const oTop = topN(byOtt, 10);
  _charts.push(new Chart($("#chartOtt"), {
    type: "bar",
    data: { labels: oTop.labels, datasets: [{ data: oTop.values, backgroundColor: "#f59e0b", borderRadius: 6 }] },
    /* "정보 없음"은 필터로 걸 값이 없어 눌러도 아무 일 없게 둔다. "기타"는 묶인 OTT들을 그대로 건다 */
    options: { ...commonOpts, onClick: clickToFilter(l => l === "정보 없음" ? null : l === "기타" ? restPatch("ott", oTop) : { ott: l }), indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  /* 별점 분포 — 내 별점과 TMDB 평점을 같은 눈금에 나란히 세운다.
     소수(4.5 등)는 올림해서 그 칸에 넣으므로 `5`칸이 뜻하는 범위는 4.1~5.0이다.
     칸을 눌렀을 때 거는 필터 범위도 그것과 같아야 목록 개수가 막대 높이와 맞는다. */
  const BUCKETS = [1,2,3,4,5,6,7,8,9,10];
  const bucketOf = (vals) => BUCKETS.map(n => vals.filter(v => Math.ceil(v) === n).length);
  if ($("#chartRating")) _charts.push(new Chart($("#chartRating"), {
    type: "bar",
    data: {
      labels: BUCKETS.map(String),
      datasets: [
        { label: "♥ 내 별점", data: bucketOf(pairs.map(i => i.rating)), backgroundColor: "#e0567f", borderRadius: 6 },
        { label: "★ TMDB 평점", data: bucketOf(pairs.map(i => i.voteAverage)), backgroundColor: "#eab308", borderRadius: 6 }
      ]
    },
    options: {
      ...commonOpts,
      /* 어느 계열을 눌렀는지에 따라 거는 필터가 다르다 (내 별점 rMin/rMax, TMDB 평점 vMin/vMax).
         TMDB 쪽에 `rMin: 0.1`을 함께 거는 건 **이 차트가 별점을 매긴 기록만 세기 때문**이다.
         안 걸면 별점 없는 기록까지 조회돼 막대 높이(11)와 목록 개수(14)가 어긋난다. */
      onClick: (evt, els, chart) => {
        if (!els.length || typeof jumpToList !== "function") return;
        const n = +chart.data.labels[els[0].index];
        const lo = +(n - 0.9).toFixed(1);
        jumpToList(els[0].datasetIndex === 0 ? { rMin: lo, rMax: n } : { vMin: lo, vMax: n, rMin: 0.1 });
      },
      plugins: { legend: { position: "top", labels: { font: { size: 12, weight: 500 }, boxWidth: 12 } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  }));

  /* 작품별로 견줘보기 — 점 하나가 작품, 대각선이 "두 점수가 같은" 선이다.
     분포 막대는 "어느 점수대에 몰리나"만 보여줄 뿐 **어떤 작품에서 갈렸는지**는 못 보여준다. */
  if ($("#chartGap") && pairs.length) {
    const GAP = 0.5;                       // 이만큼 차이 나야 후하다/박하다고 본다
    const pt = (i) => ({ x: i.voteAverage, y: i.rating, id: i.id, t: i.title });
    const groups = [
      { label: "내가 더 후함", color: "#e0567f", data: pairs.filter(i => i.rating - i.voteAverage > GAP).map(pt) },
      { label: "비슷",        color: "#94a3b8", data: pairs.filter(i => Math.abs(i.rating - i.voteAverage) <= GAP).map(pt) },
      { label: "내가 더 박함", color: "#0ea5e9", data: pairs.filter(i => i.rating - i.voteAverage < -GAP).map(pt) }
    ];
    /* 두 축의 눈금이 같아야 대각선이 기준선 노릇을 한다 → 아래끝을 함께 맞춘다 */
    const lo = Math.max(0, Math.floor(Math.min(...pairs.map(i => Math.min(i.rating, i.voteAverage)))) - 0.5);
    const axis = (text) => ({ min: lo, max: 10, ticks: { stepSize: 1 }, title: { display: true, text, font: { size: 11, weight: 500 } } });
    _charts.push(new Chart($("#chartGap"), {
      type: "scatter",
      data: {
        datasets: groups.map(g => ({
          label: `${g.label} ${g.data.length}`, data: g.data,
          backgroundColor: g.color + "b3", pointRadius: 5, pointHoverRadius: 7
        })).concat([{
          // 범례에 낼 것이 아니라 배경 눈금이라 이름 앞에 _를 붙여 걸러낸다
          label: "_같은 점수", type: "line", data: [{ x: lo, y: lo }, { x: 10, y: 10 }],
          borderColor: "#cbd5e1", borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, order: 9
        }])
      },
      options: {
        ...commonOpts,
        onClick: (evt, els, chart) => {
          const hit = els.find(e => chart.data.datasets[e.datasetIndex].type !== "line");
          if (!hit) return;
          const p = chart.data.datasets[hit.datasetIndex].data[hit.index];
          if (p && typeof openDetail === "function") openDetail(p.id);
        },
        plugins: {
          legend: { position: "top", labels: { font: { size: 11, weight: 500 }, boxWidth: 10, filter: (l) => l.text[0] !== "_" } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const p = c.raw, d = p.y - p.x;
                return `${p.t} — ♥${p.y} · ★${p.x.toFixed(1)} (${d > 0 ? "+" : ""}${d.toFixed(1)})`;
              }
            }
          }
        },
        scales: { x: axis("★ TMDB 평점"), y: axis("♥ 내 별점") }
      }
    }));
  }

  // 월별 추이
  const monthLabelsShort = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  _charts.push(new Chart($("#chartMonth"), {
    type: "bar",
    data: {
      labels: monthLabelsShort,
      datasets: [{ data: monthLabelsShort.map((_, idx) => byMonth[idx + 1] || 0), backgroundColor: "#7bad48", borderRadius: 6 }]
    },
    options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));

  // 배우 TOP 10
  const aTop = topN(byActor, 10);
  if ($("#chartActor") && aTop.labels.length) {
    // '기타' 집계는 배우 차트에서 제외
    const aLabels = aTop.labels.filter(l => l !== "기타");
    const aValues = aLabels.map(l => byActor[l]);
    _charts.push(new Chart($("#chartActor"), {
      type: "bar",
      data: { labels: aLabels, datasets: [{ data: aValues, backgroundColor: "#ec4899", borderRadius: 6 }] },
      options: { ...commonOpts, onClick: clickToFilter(l => ({ person: l })), indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    }));
  }

  // 감독 TOP 10
  const dTop = topN(byDirector, 10);
  if ($("#chartDirector") && dTop.labels.length) {
    const dLabels = dTop.labels.filter(l => l !== "기타");
    const dValues = dLabels.map(l => byDirector[l]);
    _charts.push(new Chart($("#chartDirector"), {
      type: "bar",
      data: { labels: dLabels, datasets: [{ data: dValues, backgroundColor: "#64748b", borderRadius: 6 }] },
      options: { ...commonOpts, onClick: clickToFilter(l => ({ person: l })), indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    }));
  }

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
  /* '기타'에 어떤 값들이 묶였는지 함께 돌려준다 — 그래야 그 조각을 눌렀을 때
     목록에서 조회할 수 있다(다중 선택 필터는 배열을 받는다). 없으면 눌러도 아무 일 없다. */
  return { labels, values, rest: rest.map(x => x[0]) };
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
