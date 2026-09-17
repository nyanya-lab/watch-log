/* ============================================
   search.js — 상단바 검색 (2026-09-17 개편 5단계)
   ============================================
   메뉴에 탭을 따로 두지 않고 **상단바에 검색창**을 둔다(사용자 요청). 검색하면 본문 자리에
   결과(`#tab-search`)가 뜬다. 예전 탐색 탭의 검색(`#dcQuery`)을 이리로 옮겼다.

   결과는 **포스터 격자**다(예전 탐색 검색처럼 — 줄 목록은 "별로"였다). 한 흐름으로 세 묶음:
   ① **내 기록** — 제목·원제·배우·감독으로 내 기록에서 찾은 것(TMDB에 안 걸리는 미등록·배우 이름도 여기서 잡힌다)
   ② **인물** — TMDB 인물 검색(배우·감독). 누르면 탐색 탭 인물 보기로 그 사람 필모를 연다
   ③ **TMDB 작품** — ①에 이미 나온 작품은 뺀다. 봤으면 `봤어요` 표시, 안 봤으면 담기 버튼
   안 본 작품의 TMDB 평점은 가리고, 누르면 그 카드만 보인다(`ratingChip`의 reveal — watchlog.js).

   폰은 상단바에 자리가 없어 돋보기 버튼만 두고, 결과 화면 안의 입력칸을 쓴다(두 칸은 값을 같이 쓴다). */

const Search = { q: "", results: null, people: [], usedQuery: "", wasFallback: false, error: "", scope: "all", seq: 0 };
const SEARCH_MINE_MAX = 12;

function searchInputs() { return [$("#topSearch"), $("#searchPageInput")].filter(Boolean); }

function syncSearchClear() {
  const x = $("#topSearchClear");
  if (x) x.classList.toggle("hidden", !$("#topSearch").value);
}

function openSearchTab() {
  if (window.showTab) window.showTab("search");
}

/* TMDB 인물 검색 — 배우·감독만, 사진 있는 사람 위주로 6명 */
async function tmdbSearchPeople(q) {
  const key = getTmdbKey();
  if (!key) return [];
  const res = await fetch(`${TMDB_BASE}/search/person?api_key=${key}&language=ko-KR&query=${encodeURIComponent(q)}&include_adult=false`);
  if (!res.ok) return [];
  const d = await res.json();
  const ko = getPersonCache();
  return (d.results || [])
    .filter(p => p.known_for_department === "Acting" || p.known_for_department === "Directing")
    .sort((a, b) => (b.profile_path ? 1 : 0) - (a.profile_path ? 1 : 0) || (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 6)
    .map(p => ({
      id: p.id,
      name: ko[p.id] || p.name,
      kind: p.known_for_department === "Directing" ? "director" : "actor",
      photo: p.profile_path ? TMDB_IMG_SM + p.profile_path : null,
      known: (p.known_for || []).map(k => k.title || k.name).filter(Boolean).slice(0, 2)
    }));
}

async function runSearch(q) {
  q = (q || "").trim();
  searchInputs().forEach(el => { if (el.value !== q) el.value = q; });
  syncSearchClear();
  if (!q) return;
  openSearchTab();
  if (q === Search.q && Search.results && !Search.error) return renderSearch();

  Object.assign(Search, { q, results: null, people: [], error: "" });
  const my = ++Search.seq;            // 늦게 온 응답이 다음 검색 결과를 덮지 않게
  renderSearch();
  if (!getTmdbKey()) { Object.assign(Search, { results: [], error: "nokey" }); return renderSearch(); }
  try {
    const [r, people] = await Promise.all([tmdbSearchSmart(q), tmdbSearchPeople(q).catch(() => [])]);
    if (my !== Search.seq) return;
    Object.assign(Search, { results: r.results, usedQuery: r.usedQuery, wasFallback: r.wasFallback, people });
  } catch (e) {
    if (my !== Search.seq) return;
    Object.assign(Search, { results: [], error: e.message });
  }
  renderSearch();
}

/* TMDB 작품 카드 — 탐색 탭 카드와 같은 모양(`dcCardHtml`). 버튼만 검색용으로 고른다 */
function searchCardHtml(r) {
  const st = myStatus(r.tmdbId, r.mediaType);
  const acts = [];
  let note = "";
  if (st.watched && st.missing.length) {
    note = `<span class="badge badge-cert">안 본 시즌 ${esc(st.missing.map(n => "S" + n).join("·"))}</span>`;
    acts.push({ act: "add", season: st.missing[0], label: `S${st.missing[0]} 기록`, icon: "fa-plus", cls: "dc-btn-main" });
    acts.push({ act: "open", id: st.recs[0].id, label: "내 기록", icon: "fa-clock-rotate-left" });
  } else if (st.watched) {
    acts.push({ act: "open", id: st.recs[0].id, label: "내 기록", icon: "fa-clock-rotate-left", cls: "dc-btn-main" });
  } else if (st.hidden) {
    acts.push({ act: "unhide", label: "다시 관심", icon: "fa-rotate-left", cls: "dc-btn-main" });
  } else {
    acts.push({ act: "wish", label: st.wished ? "담아둠" : "보고싶어요", icon: "fa-bookmark", cls: st.wished ? "dc-btn-on" : "" });
    acts.push({ act: "add", label: "봤어요", icon: "fa-plus", cls: "dc-btn-main" });
    acts.push({ act: "hide", label: "", icon: "fa-ban", cls: "dc-btn-icon", title: "관심없음" });
  }
  return dcCardHtml({
    tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, poster: r.poster,
    year: r.year, voteAverage: r.voteAverage, note, actions: acts
  });
}

function renderSearch() {
  const box = $("#searchBody");
  const tab = $("#tab-search");
  if (!box || !tab || tab.classList.contains("hidden")) return;

  const q = Search.q;
  $("#searchTitle").textContent = q ? `"${q}"` : "검색";
  $$("#searchScope [data-scope]").forEach(b => b.classList.toggle("on", b.dataset.scope === Search.scope));
  $("#searchScope").classList.toggle("hidden", !q);

  if (!q) {
    box.innerHTML = `<p class="sr-note"><i class="fa-solid fa-magnifying-glass"></i> 제목·배우·감독을 입력하면 내 기록과 TMDB 전체에서 함께 찾아요</p>`;
    return;
  }

  const S = Search.scope;
  const typeOk = (mt) => S === "movie" ? mt === "movie" : S === "tv" ? mt === "tv" : true;

  /* ① 내 기록 — 최근 본 순. "안 본 것만"이면 통째로 뺀다 */
  const lq = q.toLowerCase();
  const mineAll = S === "unseen" ? [] : State.items.filter(i => matchesQuery(i, lq) && typeOk(mediaTypeOf(i)))
    .sort((a, b) => recDate(b).localeCompare(recDate(a)));
  const mine = mineAll.slice(0, SEARCH_MINE_MAX);
  const mineIds = new Set(mineAll.map(i => `${mediaTypeOf(i)}:${i.tmdbId}`));

  const sec = (icon, title, n, extra) => `<div class="sr-sec-h"><i class="fa-solid ${icon}"></i>${title}${
    n != null ? `<b>${n}</b>` : ""}${extra || ""}</div>`;
  const grid = (html) => `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6">${html}</div>`;

  let html = "";
  if (mine.length) {
    html += `<section class="sr-sec">${sec("fa-book-open", "내 기록", mineAll.length,
      mineAll.length > SEARCH_MINE_MAX ? `<button class="hm-more sr-more" data-jump-q="${esc(q)}">기록 탭에서 ${mineAll.length}개 전부 보기 <i class="fa-solid fa-arrow-right"></i></button>` : "")}
      ${grid(mine.map(recordCardHtml).join(""))}</section>`;
  }

  if (Search.results === null) {
    box.innerHTML = html + `<p class="sr-note"><i class="fa-solid fa-spinner fa-spin"></i> TMDB에서 찾는 중...</p>`;
    return;
  }
  if (Search.error) {
    box.innerHTML = html + (Search.error === "nokey"
      ? `<p class="sr-note"><i class="fa-solid fa-key"></i> TMDB 검색은 설정에서 API 키를 넣어야 쓸 수 있어요</p>`
      : `<p class="sr-note err"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(Search.error)}</p>`);
    return;
  }

  /* ② 인물 */
  if (Search.people.length && S === "all") {
    html += `<section class="sr-sec">${sec("fa-user-group", "인물")}
      <div class="sr-people">${Search.people.map(p => `
        <button class="sr-person" data-person="${p.id}">
          ${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="ph"><i class="fa-solid fa-user"></i></span>`}
          <span class="tx"><b>${esc(p.name)}</b><span>${p.kind === "director" ? "감독" : "배우"}${
            p.known.length ? ` · ${esc(p.known.join(", "))}` : ""}</span></span>
        </button>`).join("")}</div></section>`;
  }

  /* ③ TMDB 작품 — ①에 이미 나온 건 뺀다 */
  const works = Search.results.filter(r => !mineIds.has(`${r.mediaType}:${r.tmdbId}`) && typeOk(r.mediaType) &&
    (S !== "unseen" || !myStatus(r.tmdbId, r.mediaType).watched));
  const fallback = Search.wasFallback
    ? `<span class="sr-sub">"${esc(q)}" 결과가 없어 "${esc(Search.usedQuery)}"로 찾았어요</span>` : "";
  if (works.length) {
    html += `<section class="sr-sec">${sec("fa-film", mine.length ? "TMDB에서 더 찾은 작품" : "TMDB 작품", works.length, fallback)}
      <div id="srGrid">${grid(works.map(searchCardHtml).join(""))}</div></section>`;
  }

  if (!html) {
    html = `<p class="sr-note">"${esc(q)}" — ${Search.results.length ? "이 조건에 맞는 결과가 없어요" : "찾은 결과가 없어요. 제목을 줄여서 다시 찾아보세요"}</p>`;
  }
  box.innerHTML = html;
}

async function searchToggleWish(r) {
  if (isWished(r.tmdbId)) {
    removeWish(r.tmdbId);
    toast("보고싶어요에서 뺐습니다");
    renderSearch(); renderDiscover();
    return;
  }
  addWish({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, originalTitle: r.originalTitle || "",
    poster: r.poster, year: r.year, voteAverage: r.voteAverage, overview: r.overview || "", reason: "" });
  toast("보고싶어요에 담았습니다", "success");
  renderSearch(); renderDiscover();
  await fillWishOtt(r.tmdbId, r.mediaType);   // 볼 수 있는 곳은 뒤이어 채운다 (기다리게 하지 않는다)
}

function initSearch() {
  const top = $("#topSearch");
  if (!top) return;

  searchInputs().forEach(el => {
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); runSearch(el.value); }
      if (e.key === "Escape" && el === top) el.blur();
    });
  });
  top.addEventListener("input", syncSearchClear);

  /* 입력칸 안 ✕ — 한 번에 지우기 */
  const clearAll = () => {
    searchInputs().forEach(el => { el.value = ""; });
    syncSearchClear();
  };
  $("#topSearchClear").addEventListener("click", e => { e.preventDefault(); clearAll(); top.focus(); });
  $("#searchClear").addEventListener("click", () => { clearAll(); $("#searchPageInput").focus(); });

  /* 결과 화면 오른쪽 위 ✕ — 설정처럼 보던 화면으로 돌아간다 */
  $("#searchCloseBtn").addEventListener("click", () => window.closeTab && window.closeTab("search"));

  $("#topSearchBtn").addEventListener("click", () => {
    openSearchTab();
    setTimeout(() => $("#searchPageInput").focus(), 50);
  });

  $("#searchScope").addEventListener("click", e => {
    const b = e.target.closest("[data-scope]");
    if (!b) return;
    Search.scope = b.dataset.scope;
    renderSearch();
  });

  $("#searchBody").addEventListener("click", e => {
    const jump = e.target.closest("[data-jump-q]");
    if (jump) {
      const q = jump.dataset.jumpQ;
      $("#searchInput").value = q;
      jumpToList({ q: q.toLowerCase() });
      return;
    }
    const person = e.target.closest("[data-person]");
    if (person) {
      const p = Search.people.find(x => String(x.id) === person.dataset.person);
      if (p) openPersonFilmo(p.id, p.name, p.kind);
      return;
    }
    const card = e.target.closest(".wl-card[data-id]");
    if (card) return openDetail(card.dataset.id);

    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const r = (Search.results || []).find(x => String(x.tmdbId) === btn.dataset.tid);
    if (!r) return;
    const act = btn.dataset.act;
    if (act === "detail") return openDcDetail(r.tmdbId, r.mediaType);
    if (act === "add") addFromDiscover(r.tmdbId, r.mediaType, btn.dataset.season);
    else if (act === "open") openDetail(btn.dataset.id);
    else if (act === "wish") searchToggleWish(r);
    else if (act === "hide") {
      addHide({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, poster: r.poster, year: r.year, voteAverage: r.voteAverage });
      toast(`「${r.title}」을 관심없음으로 표시했습니다`);
      fillHideColl(r.tmdbId, r.mediaType);
      renderSearch(); renderDiscover();
    } else if (act === "unhide") {
      removeHide(r.tmdbId, r.mediaType);
      toast("관심없음을 해제했습니다");
      renderSearch(); renderDiscover();
    }
  });
}
