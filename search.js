/* ============================================
   search.js — 상단바 검색 (2026-09-17 개편 5단계)
   ============================================
   메뉴에 탭을 따로 두지 않고 **상단바에 검색창**을 둔다(사용자 요청). 검색하면 본문 자리에
   결과(`#tab-search`)가 뜬다. 예전 탐색 탭의 검색(`#dcQuery`)을 이리로 옮겼다.

   - 결과의 주인공은 **TMDB 작품**이다(안 본 작품도 찾으려고 검색하는 것이므로).
     각 줄 오른쪽 칸에 **내 기록을 겹쳐** 보여준다 — 봤으면 내 별점·본 시즌·날짜, 안 봤으면 담기 버튼.
   - 맨 위에 **내 기록에서 찾은 개수**를 한 줄로 두고, 누르면 기록 탭에 그 검색어를 건다
     (미등록 기록이나 배우·감독 이름은 TMDB 결과에 안 걸리기 때문).
   - 폰은 상단바에 자리가 없어 돋보기 버튼만 두고, 결과 화면 안의 입력칸을 쓴다(두 칸은 값을 같이 쓴다). */

const Search = { q: "", results: null, usedQuery: "", wasFallback: false, error: "", scope: "all", seq: 0 };

function searchInputs() { return [$("#topSearch"), $("#searchPageInput")].filter(Boolean); }

function openSearchTab() {
  if (window.showTab) window.showTab("search");
}

async function runSearch(q) {
  q = (q || "").trim();
  searchInputs().forEach(el => { if (el.value !== q) el.value = q; });
  if (!q) return;
  openSearchTab();
  if (q === Search.q && Search.results && !Search.error) return renderSearch();

  Search.q = q;
  Search.results = null;
  Search.error = "";
  const my = ++Search.seq;            // 늦게 온 응답이 다음 검색 결과를 덮지 않게
  renderSearch();
  if (!getTmdbKey()) { Search.results = []; Search.error = "nokey"; return renderSearch(); }
  try {
    const r = await tmdbSearchSmart(q);
    if (my !== Search.seq) return;
    Search.results = r.results;
    Search.usedQuery = r.usedQuery;
    Search.wasFallback = r.wasFallback;
  } catch (e) {
    if (my !== Search.seq) return;
    Search.results = [];
    Search.error = e.message;
  }
  renderSearch();
}

/* 오른쪽 칸 — 내 기록이 있으면 요약, 없으면 담기 버튼 */
function searchMineHtml(r, st) {
  if (st.watched) {
    const recs = st.recs.slice().sort((a, b) => recDate(b).localeCompare(recDate(a)));
    const live = recs.some(watchingNow);
    const last = recDate(recs[0]);
    return `<div class="sr-mine has" data-open="${esc(recs[0].id)}">
      <div class="lbl"><i class="fa-solid fa-check"></i>내 기록 ${recs.length}개</div>
      <div class="big">${live ? `<span class="dy-live"><i class="fa-solid fa-circle-play"></i>보는 중</span>`
        : st.rating ? hearts(st.rating, true) : `<span class="none">별점 전</span>`}</div>
      <div class="sub">${st.seenSeasons.length ? `${st.seenSeasons.map(n => "S" + n).join(" · ")} 봄 · ` : ""}${esc(last.replaceAll("-", "."))}</div>
      ${st.missing.length ? `<button class="btn btn-sm btn-primary sr-btn" data-act="add" data-season="${st.missing[0]}">
          <i class="fa-solid fa-plus"></i>안 본 S${st.missing[0]} 기록하기</button>` : ""}
    </div>`;
  }
  if (st.hidden) {
    return `<div class="sr-mine none">
      <span class="sr-hidden"><i class="fa-solid fa-ban"></i>관심없음으로 표시함</span>
      <button class="btn btn-sm btn-ghost" data-act="unhide"><i class="fa-solid fa-rotate-left"></i>다시 관심</button>
    </div>`;
  }
  return `<div class="sr-mine none">
    <button class="btn btn-sm btn-primary" data-act="add"><i class="fa-solid fa-plus"></i>봤어요</button>
    <button class="btn btn-sm ${st.wished ? "btn-primary sr-on" : "btn-ghost"}" data-act="wish">
      <i class="fa-solid fa-bookmark"></i>${st.wished ? "담아둠" : "보고싶어요"}</button>
    <button class="btn btn-sm btn-ghost sr-icon" data-act="hide" title="관심없음"><i class="fa-solid fa-ban"></i></button>
  </div>`;
}

function renderSearch() {
  const box = $("#searchBody");
  const tab = $("#tab-search");
  if (!box || !tab || tab.classList.contains("hidden")) return;

  const q = Search.q;
  $$("#searchScope [data-scope]").forEach(b => b.classList.toggle("on", b.dataset.scope === Search.scope));

  if (!q) {
    box.innerHTML = `<p class="sr-note"><i class="fa-solid fa-magnifying-glass"></i> 제목을 입력하면 TMDB 전체에서 찾고, 내가 본 작품엔 내 기록을 붙여서 보여줘요</p>`;
    return;
  }

  const lq = q.toLowerCase();
  const mineN = State.items.filter(i => matchesQuery(i, lq)).length;
  const mineLine = mineN
    ? `<button class="sr-mine-line" data-jump-q="${esc(q)}"><i class="fa-solid fa-book-open"></i>
        내 기록에서 <b>${mineN}개</b> 찾았어요 — 제목·원제·배우·감독 <i class="fa-solid fa-arrow-right"></i></button>`
    : "";

  if (Search.results === null) {
    box.innerHTML = `${mineLine}<p class="sr-note"><i class="fa-solid fa-spinner fa-spin"></i> "${esc(q)}" TMDB에서 찾는 중...</p>`;
    return;
  }
  if (Search.error === "nokey") {
    box.innerHTML = `${mineLine}<p class="sr-note"><i class="fa-solid fa-key"></i> TMDB 검색은 설정에서 API 키를 넣어야 쓸 수 있어요</p>`;
    return;
  }
  if (Search.error) {
    box.innerHTML = `${mineLine}<p class="sr-note err"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(Search.error)}</p>`;
    return;
  }

  const rows = Search.results.map(r => ({ r, st: myStatus(r.tmdbId, r.mediaType) })).filter(({ r, st }) =>
    Search.scope === "movie" ? r.mediaType === "movie"
    : Search.scope === "tv" ? r.mediaType === "tv"
    : Search.scope === "unseen" ? !st.watched : true);

  const fallback = Search.wasFallback
    ? `<p class="sr-note"><i class="fa-solid fa-circle-info"></i> "${esc(q)}" 결과가 없어 <b>"${esc(Search.usedQuery)}"</b>로 찾았어요</p>` : "";

  box.innerHTML = `${mineLine}${fallback}
    ${rows.length ? `<div class="sr-list">${rows.map(({ r, st }) => {
      /* 보는 중인 작품이면 TMDB 평점을 가린다 — 카드·상세와 같은 규칙 */
      const hideVote = st.watched && st.recs.some(watchingNow);
      return `<div class="sr-row" data-tid="${r.tmdbId}" data-mt="${r.mediaType}">
        ${r.poster ? `<img class="sr-poster" src="${esc(r.posterSm || r.poster)}" alt="" loading="lazy">`
                   : `<div class="sr-poster"><i class="fa-solid fa-film"></i></div>`}
        <div class="sr-txt">
          <div class="sr-t">${esc(r.title)}</div>
          <div class="sr-m">
            <span>${r.mediaType === "tv" ? "TV" : "영화"}${r.year ? ` · ${esc(r.year)}` : ""}${
              r.originalTitle && r.originalTitle !== r.title ? ` · ${esc(r.originalTitle)}` : ""}</span>
            ${r.voteAverage && !hideVote ? `<span class="dy-vote"><i class="fa-solid fa-star"></i>${r.voteAverage}</span>` : ""}
          </div>
          ${r.overview ? `<div class="sr-o">${esc(r.overview)}</div>` : ""}
        </div>
        ${searchMineHtml(r, st)}
      </div>`;
    }).join("")}</div>`
    : `<p class="sr-note">${Search.results.length ? "이 조건에 맞는 결과가 없어요" : `"${esc(q)}" 검색 결과가 없어요 — 제목을 줄여서 다시 찾아보세요`}</p>`}`;
}

async function searchToggleWish(r) {
  if (isWished(r.tmdbId)) {
    removeWish(r.tmdbId);
    toast("보고싶어요에서 뺐습니다");
  } else {
    addWish({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, originalTitle: r.originalTitle || "",
      poster: r.poster, year: r.year, voteAverage: r.voteAverage, overview: r.overview || "", reason: "" });
    toast("보고싶어요에 담았습니다", "success");
    renderSearch();
    renderDiscover();
    await fillWishOtt(r.tmdbId, r.mediaType);   // 볼 수 있는 곳은 뒤이어 채운다 (기다리게 하지 않는다)
    return;
  }
  renderSearch();
  renderDiscover();
}

function initSearch() {
  const top = $("#topSearch");
  if (!top) return;

  searchInputs().forEach(el => {
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); runSearch(el.value); }
      if (e.key === "Escape" && el === top) { el.blur(); }
    });
  });
  const tb = $("#topSearchBtn");
  if (tb) tb.addEventListener("click", () => {
    openSearchTab();
    renderSearch();
    setTimeout(() => $("#searchPageInput").focus(), 50);
  });
  const clear = $("#searchClear");
  if (clear) clear.addEventListener("click", () => {
    searchInputs().forEach(el => { el.value = ""; });
    Search.q = ""; Search.results = null; Search.seq++;
    renderSearch();
    $("#searchPageInput").focus();
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
    const row = e.target.closest(".sr-row");
    if (!row) return;
    const r = (Search.results || []).find(x => String(x.tmdbId) === row.dataset.tid && x.mediaType === row.dataset.mt);
    if (!r) return;
    const btn = e.target.closest("[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "add") addFromDiscover(r.tmdbId, r.mediaType, btn.dataset.season);
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
      return;
    }
    const mine = e.target.closest("[data-open]");
    if (mine) return openDetail(mine.dataset.open);
    openDcDetail(r.tmdbId, r.mediaType);
  });
}
