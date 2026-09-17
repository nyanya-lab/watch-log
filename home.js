/* ============================================
   home.js — 홈 화면 (2026-09-17 개편 3단계)
   보는 중 배너 · 최근 본 작품 · 이번 달 기록 · 정리할 것
   ============================================
   전부 로컬 기록으로 그린다(TMDB 호출 없음). 기록이 바뀌면 `applyFilters`가 끝에서
   `renderHome`을 부른다 — 홈이 안 보일 때는 그리지 않고, 탭을 열 때 다시 그린다. */

/* 오늘 날짜(이 기기 시간대). `toISOString`은 UTC라 한국에서 아침 9시 전엔 어제가 된다 */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* 며칠째 — 시작한 날을 1일째로 센다 */
function daysSince(d) {
  if (!d) return 0;
  const [y, m, dd] = d.split("-").map(Number);
  const start = new Date(y, m - 1, dd);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((now - start) / 864e5) + 1);
}

/* 배너 뒤 사진은 큰 걸로 — 저장된 주소는 카드용 크기다 */
const bigImg = (u) => (u || "").replace(/\/w\d+\//, "/w1280/");

/* 보는 중 목록 — 최근에 시작한 것부터 */
function watchingItems() {
  return State.items.filter(watchingNow)
    .map(i => ({ i, start: isRewatching(i) ? i.lastWatchStart : i.startDate }))
    .sort((a, b) => (b.start || "").localeCompare(a.start || ""));
}

function heroHtml(w, cls) {
  const i = w.i;
  const live = !!w.start;
  const meta = [i.type, ...visibleGenres(i.genres).slice(0, 2), i.releaseYear, ottList(i)[0]].filter(Boolean);
  const days = live ? daysSince(w.start) : 0;
  const act = live
    ? `<button class="btn btn-primary" data-finish="${esc(i.id)}"><i class="fa-solid fa-flag-checkered"></i>다 봤어요</button>`
    : (!i.rating
        ? `<button class="btn btn-primary" data-rate="${esc(i.id)}"><i class="fa-solid fa-heart"></i>별점 남기기</button>`
        : "");
  return `<section class="hm-hero ${cls || ""}">
    ${i.backdrop ? `<div class="hm-bd-fill" style="background-image:url('${esc(i.backdrop)}')" aria-hidden="true"></div>
      <img class="hm-bd" src="${esc(bigImg(i.backdrop))}" alt="">` : ""}
    <div class="hm-hero-in">
      ${i.poster ? `<img class="hm-hero-poster" src="${esc(i.poster)}" alt="" data-open="${esc(i.id)}">` : ""}
      <div style="min-width:0">
        ${live ? `<span class="hm-live"><i class="fa-solid fa-circle"></i>${isRewatching(i) && !isWatching(i) ? "다시 보는 중" : "보는 중"}</span>`
               : `<span class="hm-live dim">가장 최근에 본</span>`}
        <h3 class="hm-watch-title">${esc(i.title)}${seriesLabel(i) ? ` <span class="hm-sn">${esc(seriesLabel(i))}</span>` : ""}</h3>
        <div class="hm-meta">${esc(meta.join(" · "))}</div>
        ${live ? `<div class="hm-since">${isRewatching(i) && !isWatching(i) ? "다시 보기" : "보기"} 시작한 지 <b>${days}</b>일째</div>`
               : (i.rating ? `<div class="hm-since">${hearts(i.rating)}</div>` : "")}
        <div class="hm-hero-act">
          ${act}
          <button class="btn hm-ghost" data-open="${esc(i.id)}"><i class="fa-solid fa-circle-info"></i>상세 보기</button>
        </div>
      </div>
    </div>
  </section>`;
}

/* 보는 중 개수에 따라 배치가 다르다: 0개 = 가장 최근에 본 것 / 1개 = 큰 배너 /
   2개 = 반반 / 3개 이상 = 큰 배너 + 옆에 "같이 보는 중" 목록. 폰에서는 옆으로 밀어서 넘긴다 */
function heroArea(ws, latest) {
  if (!ws.length) return latest ? heroHtml({ i: latest, start: "" }) : "";
  if (ws.length === 1) return heroHtml(ws[0]);
  const dots = `<div class="hm-dots">${ws.map(() => "<i></i>").join("")}</div>`;
  if (ws.length === 2) return `<div class="hm-duo">${ws.map(w => heroHtml(w)).join("")}</div>${dots}`;
  const [first, ...rest] = ws;
  return `<div class="hm-multi">
    ${heroHtml(first)}
    ${rest.map(w => heroHtml(w, "extra")).join("")}
    <aside class="hm-also">
      <div class="hm-also-h"><span class="hm-live"><i class="fa-solid fa-circle"></i>${ws.length}편</span>같이 보는 중</div>
      ${rest.map(w => `<div class="hm-also-row">
        ${w.i.poster ? `<img src="${esc(w.i.poster)}" alt="" data-open="${esc(w.i.id)}">` : `<div class="hm-also-ph" data-open="${esc(w.i.id)}"></div>`}
        <div style="min-width:0" data-open="${esc(w.i.id)}">
          <div class="t hm-watch-title">${esc(w.i.title)}${seriesLabel(w.i) ? ` <span class="hm-sn">${esc(seriesLabel(w.i))}</span>` : ""}</div>
          <div class="s"><b>${daysSince(w.start)}</b>일째${ottList(w.i)[0] ? ` · ${esc(ottList(w.i)[0])}` : ""}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-finish="${esc(w.i.id)}" title="다 봤어요"><i class="fa-solid fa-flag-checkered" style="margin:0"></i></button>
      </div>`).join("")}
    </aside>
  </div>${dots}`;
}

function renderHome() {
  const box = $("#tab-home");
  if (!box || box.classList.contains("hidden")) return;

  const all = State.items.filter(recDate).sort((a, b) => recDate(b).localeCompare(recDate(a)));
  const today = localToday();
  const y = today.slice(0, 4), ym = today.slice(0, 7);
  const thisYear = State.items.filter(i => (i.startDate || "").startsWith(y));
  const thisMonth = all.filter(i => recDate(i).startsWith(ym));

  const ws = watchingItems();
  const latest = ws.length ? null : all[0];
  const shown = new Set(ws.map(w => w.i));
  if (latest) shown.add(latest);
  /* 화면 폭으로 3페이지쯤 넘길 분량(사용자 요청) — PC 한 폭에 7장 안팎이라 21장 */
  const recent = all.filter(i => !shown.has(i)).slice(0, 21);

  /* 기간 칸 두 개 — 이번 달 / 최근 6개월(이번 달 포함, 6개월 전 1일부터). 칩이 아니라 위아래로 둔다(사용자 요청) */
  const [ty, tm] = [+today.slice(0, 4), +today.slice(5, 7)];
  const back = new Date(ty, tm - 1 - 5, 1);
  const from6 = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, "0")}-01`;
  const monthBlock = periodHtml({
    big: `${MON_EN[tm - 1]} ${ty}`, sub: "이번 달", from: `${ym}-01`, to: today, diary: true
  });
  const halfBlock = periodHtml({
    big: `${MON_EN[back.getMonth()]} — ${MON_EN[tm - 1]}`, sub: `최근 6개월 · ${from6.slice(0, 7).replace("-", ".")} ~ ${ym.replace("-", ".")}`,
    from: from6, to: today
  });

  const c = maintCounts();
  const TODO = [
    ["rate", "fa-heart", "별점 채우기", c.noRate, true],
    ["noSeasonOnly", "fa-layer-group", "시즌 미기록", c.noSeason],
    ["engNameOnly", "fa-language", "이름 영문", c.engName],
    ["pendingOnly", "fa-circle-exclamation", "미등록", c.pending],
    ["dupOnly", "fa-triangle-exclamation", "매칭 확인", c.dup]
  ].filter(t => t[3] > 0);
  const [, mm, dd] = today.split("-").map(Number);

  box.innerHTML = `
    <div class="hm-greet">
      <div>
        <div class="hm-eyebrow">${y}년 ${mm}월 ${dd}일</div>
        <h1>올해 <em>${thisYear.length}편</em>째 보고 있어요</h1>
      </div>
      <div class="hm-counts">
        <div class="hm-count"><div class="n">${State.items.length}</div><div class="l">전체 기록</div></div>
        <div class="hm-count"><div class="n">${thisMonth.length}</div><div class="l">이번 달</div></div>
      </div>
    </div>

    ${heroArea(ws, latest)}

    ${recent.length ? `<section class="hm-sec">
      <div class="hm-sec-head">
        <h2 class="hm-h2 hd">최근 본 작품</h2>
        <button class="hm-more" data-go="list">전체 기록 <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <!-- 화살표는 늘 보인다(옅은 검정 원 + 흰 화살표, 누르면 포인트 색). 아래 얇은 바가 지금 어디쯤인지 알려준다 -->
      <div class="hm-shelf-wrap">
        <button class="hm-arrow" data-dir="-1" title="이전"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="hm-shelf">${recent.map(recordCardHtml).join("")}</div>
        <button class="hm-arrow" data-dir="1" title="다음"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="hm-pos"><i></i></div>
    </section>` : ""}

    <!-- 기간 기록 — 이번 달 / 최근 6개월을 위아래로, 맨 아래에 정리할 것.
         예전 "이번 달 기록" 줄 목록은 최근 본 작품과 겹쳐서 없앴다(2026-09-17) -->
    <section class="hm-sec">
      <div class="hm-panel hm-periods">
        ${monthBlock}
        ${halfBlock}
        ${TODO.length ? `<div class="hm-todo-h">정리할 것</div><div class="hm-todos">${TODO.map(([key, ic, label, n, hot]) => `
          <button class="hm-todo" data-todo="${key}">
            <span class="ic ${hot ? "hot" : ""}"><i class="fa-solid ${ic}"></i></span>${label}
            <span class="n">${n}</span><i class="fa-solid fa-chevron-right go"></i>
          </button>`).join("")}</div>`
          : `<p class="hm-empty hm-done"><i class="fa-solid fa-circle-check" style="color:var(--ac)"></i> 정리할 게 없어요</p>`}
      </div>
    </section>`;
  syncShelfArrows();
}

/* 기간 한 칸 — 본 작품 · 본 날 · 평균 별점 · 다시 본 + 가장 좋았던 작품 · 많이 본 장르.
   "본 작품"은 다이어리와 같은 `recDate` 기준, "본 날"은 시작~종료를 날짜로 펼쳐 기간 안만 센다 */
function periodHtml({ big, sub, from, to, diary }) {
  const inR = (d) => !!d && d >= from && d <= to;
  const list = State.items.filter(i => inR(recDate(i)));
  const re = State.items.filter(i => inR(i.lastWatchStart)).length;
  const rated = list.filter(i => i.rating);
  const avg = rated.length ? rated.reduce((s, i) => s + +i.rating, 0) / rated.length : 0;
  const days = new Set();
  State.items.forEach(i => [[i.startDate, i.endDate], [i.lastWatchStart, i.lastWatchEnd]].forEach(([s, e]) => {
    if (!s) return;
    const end = e || s;
    if (end < from || s > to) return;
    const cur = new Date(s + "T00:00:00"), last = new Date(end + "T00:00:00");
    for (let g = 0; cur <= last && g < 400; g++, cur.setDate(cur.getDate() + 1)) {
      const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (k >= from && k <= to) days.add(k);
    }
  }));
  const best = rated.slice().sort((a, b) => b.rating - a.rating)[0];
  const gc = {};
  list.forEach(i => visibleGenres(i.genres).forEach(g => { gc[g] = (gc[g] || 0) + 1; }));
  const topG = Object.entries(gc).sort((a, b) => b[1] - a[1])[0];

  return `<div class="hm-period">
    <div class="hm-period-head">
      <div><div class="big">${big}</div><div class="sub">${esc(sub)}</div></div>
      ${diary ? `<button class="hm-more" data-diary>다이어리 <i class="fa-solid fa-arrow-right"></i></button>` : ""}
    </div>
    <div class="hm-year">
      <div><div class="n">${list.length}<small>편</small></div><div class="l">본 작품</div></div>
      <div><div class="n">${days.size}<small>일</small></div><div class="l">본 날</div></div>
      <div><div class="n">${avg ? avg.toFixed(1) : "-"}</div><div class="l">평균 별점</div></div>
      <div><div class="n">${re}<small>편</small></div><div class="l">다시 본</div></div>
    </div>
    ${best || topG ? `<div class="hm-period-picks">
      ${best ? `<button class="hm-pick" data-open="${esc(best.id)}">
        ${best.poster ? `<img src="${esc(best.poster)}" alt="">` : ""}
        <span class="l">가장 좋았던</span><b>${esc(best.title)}</b>${hearts(best.rating)}</button>` : ""}
      ${topG ? `<span class="hm-pick"><span class="l">많이 본 장르</span><b>${esc(topG[0])}</b><span class="c">${topG[1]}편</span></span>` : ""}
    </div>` : ""}
  </div>`;
}

/* 선반 화살표·위치 바 — 화살표는 늘 보이고, 끝에 닿은 쪽만 흐려진다 */
function syncShelfArrows() {
  const wrap = $("#tab-home .hm-shelf-wrap");
  if (!wrap) return;
  const s = wrap.querySelector(".hm-shelf");
  const [l, r] = wrap.querySelectorAll(".hm-arrow");
  const max = s.scrollWidth - s.clientWidth;
  l.classList.toggle("off", s.scrollLeft <= 4);
  r.classList.toggle("off", s.scrollLeft >= max - 4);
  const bar = wrap.parentElement.querySelector(".hm-pos");
  if (bar) {
    const w = s.scrollWidth ? s.clientWidth / s.scrollWidth : 1;
    bar.classList.toggle("hidden", w >= 0.99);
    const thumb = bar.firstElementChild;
    thumb.style.width = (w * 100).toFixed(2) + "%";
    thumb.style.left = (max > 0 ? (s.scrollLeft / max) * (1 - w) * 100 : 0).toFixed(2) + "%";
  }
  if (!s._bound) { s._bound = true; s.addEventListener("scroll", syncShelfArrows, { passive: true }); }
}

/* 다 봤어요 — 오늘로 끝내고, 별점이 없으면 바로 묻는다(2026-09-17 사용자 선택).
   다시 보는 중이면 재시청 종료일(`lastWatchEnd`)을 채운다. 건너뛰면 별점은 나중에 [별점 채우기]로. */
function finishWatching(id) {
  const i = State.items.find(x => x.id === id);
  if (!i || !watchingNow(i)) return;
  const today = localToday();
  if (isWatching(i)) i.endDate = today < i.startDate ? i.startDate : today;
  else i.lastWatchEnd = today < i.lastWatchStart ? i.lastWatchStart : today;
  saveLocal();
  applyFilters();
  if (typeof renderDiscover === "function") renderDiscover();
  toast(`「${i.title}」 다 봤어요`, "success");
  if (!i.rating) openQuickRate([i]);
}

/* 별점 하나만 — 별점 몰아넣기 창을 이 기록 한 장으로 연다 */
function rateOne(id) {
  const i = State.items.find(x => x.id === id);
  if (i) openQuickRate([i]);
}

function initHome() {
  const box = $("#tab-home");
  if (!box) return;
  window.addEventListener("resize", debounce(syncShelfArrows, 150));
  box.addEventListener("click", e => {
    const t = (sel) => e.target.closest(sel);
    let el;
    if ((el = t(".hm-arrow"))) {
      const s = el.parentElement.querySelector(".hm-shelf");
      s.scrollBy({ left: (+el.dataset.dir) * Math.max(160, s.clientWidth * 0.8), behavior: "smooth" });
      return;
    }
    if ((el = t("[data-finish]"))) return finishWatching(el.dataset.finish);
    if ((el = t("[data-rate]"))) return rateOne(el.dataset.rate);
    if ((el = t("[data-todo]"))) {
      const k = el.dataset.todo;
      if (k === "rate") return openQuickRate();
      return jumpToList({ [k]: true });
    }
    if (t("[data-diary]")) { setListView("diary"); return jumpToList({}); }
    if ((el = t("[data-go]"))) {
      const b = document.querySelector(`.tab-btn[data-tab="${el.dataset.go}"]`);
      if (b) b.click();
      return;
    }
    if ((el = t("[data-open]"))) return openDetail(el.dataset.open);
    if ((el = t(".wl-card[data-id]"))) return openDetail(el.dataset.id);
  });
}
