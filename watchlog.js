/* ============================================
   watchlog.js — 카드 목록, 필터, 등록/수정
   ============================================ */

const Filters = {
  q: "", type: "", country: "", ott: "", year: "", genre: "", rating: "",
  person: "",                       // 배우/감독 (배지 클릭 전용)
  sort: "date-desc", pendingOnly: false,
  noSeasonOnly: false,              // 시즌이 여러 개인데 시즌을 기록 안 한 항목만
  dupOnly: false                    // 제목이 다른데 tmdbId가 같은 항목만 (매칭 오류 의심)
};

/* 시즌이 2개 이상인 작품인데 season이 비어 있는 항목 (기록 누락) */
function needsSeason(i) {
  return !i.season && (i.totalSeasons || 0) > 1;
}

/* 제목이 다른데 tmdbId가 같은 항목 = 자동 매칭 오류 의심.
   (속편이 1편 정보를 물고 오면 포스터·장르·평점이 전부 1편 것이 된다)
   시즌은 원래 같은 tmdbId를 공유하므로, 제목이 서로 다른 경우만 잡는다. */
function dupTmdbIdSet() {
  const titlesById = new Map();
  State.items.forEach(i => {
    if (!i.tmdbId) return;
    if (!titlesById.has(i.tmdbId)) titlesById.set(i.tmdbId, new Set());
    titlesById.get(i.tmdbId).add((i.title || "").trim());
  });
  const dup = new Set();
  titlesById.forEach((titles, id) => { if (titles.size > 1) dup.add(id); });
  return dup;
}
function isDupTmdb(i) {
  return !!(i.tmdbId && State._dupIds && State._dupIds.has(i.tmdbId));
}

function initWatchlog() {
  $("#addBtn").addEventListener("click", () => openEdit(null));
  $("#closeModal").addEventListener("click", closeEdit);
  $("#cancelBtn").addEventListener("click", closeEdit);
  $("#saveBtn").addEventListener("click", saveItem);
  $("#deleteBtn").addEventListener("click", deleteItem);
  $("#syncBtn").addEventListener("click", async () => { await pushToServer(); });

  $("#searchInput").addEventListener("input", debounce(() => {
    Filters.q = $("#searchInput").value.trim().toLowerCase();
    applyFilters();
  }, 220));

  /* 필터 팝업 */
  $("#filterBtn").addEventListener("click", openFilterModal);
  $("#clearFilterBtn").addEventListener("click", () => { clearAllFilters(); toast("필터를 해제했습니다"); });
  $("#closeFilter").addEventListener("click", closeFilterModal);
  $("#applyFilterBtn").addEventListener("click", closeFilterModal);
  $("#filterModal").addEventListener("click", e => { if (e.target.id === "filterModal") closeFilterModal(); });

  ["filterType", "filterCountry", "filterOtt", "filterYear", "filterGenre", "filterRating", "sortBy"]
    .forEach(id => $("#" + id).addEventListener("change", () => {
      Filters.type = $("#filterType").value;
      Filters.country = $("#filterCountry").value;
      Filters.ott = $("#filterOtt").value;
      Filters.year = $("#filterYear").value;
      Filters.genre = $("#filterGenre").value;
      Filters.rating = $("#filterRating").value;
      Filters.sort = $("#sortBy").value;
      applyFilters();
      $("#filterPreview").textContent = `${State.filtered.length}개 표시`;
    }));

  $("#resetFilter").addEventListener("click", () => {
    Object.assign(Filters, { type: "", country: "", ott: "", year: "", genre: "", rating: "", sort: "date-desc" });
    ["filterType", "filterCountry", "filterOtt", "filterYear", "filterGenre", "filterRating"].forEach(id => $("#" + id).value = "");
    $("#sortBy").value = "date-desc";
    applyFilters();
    $("#filterPreview").textContent = `${State.filtered.length}개 표시`;
  });

  /* 미등록 토글 */
  $("#pendingBtn").addEventListener("click", () => {
    Filters.pendingOnly = !Filters.pendingOnly;
    Filters.noSeasonOnly = false;
    Filters.dupOnly = false;
    applyFilters();
  });

  /* 시즌 미기록 토글 */
  $("#noSeasonBtn").addEventListener("click", () => {
    Filters.noSeasonOnly = !Filters.noSeasonOnly;
    Filters.pendingOnly = false;
    Filters.dupOnly = false;
    applyFilters();
  });

  /* 매칭 확인(중복 tmdbId) 토글 */
  $("#dupBtn").addEventListener("click", () => {
    Filters.dupOnly = !Filters.dupOnly;
    Filters.pendingOnly = false;
    Filters.noSeasonOnly = false;
    applyFilters();
  });

  $("#loadMoreBtn").addEventListener("click", () => { State.page++; renderCards(); });

  /* 별점 (숫자 입력, 5점 만점 소수 가능) */
  $("#clearStar").addEventListener("click", () => { $("#fRating").value = ""; });

  /* 스테퍼 */
  $$(".step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.target;
      const d = +btn.dataset.d;
      const input = $("#" + id);
      const min = id === "fCount" ? 1 : 0;
      let v = (parseInt(input.value) || min) + d;
      if (v < min) v = min;
      if (v > 99) v = 99;
      input.value = v;
      updateStepperLabel(id);
    });
  });

  /* 영화관 체크박스 — 체크하면 기타 입력칸은 잠근다 */
  $("#fTheater").addEventListener("change", e => {
    const on = e.target.checked;
    const ottWrap = $("#ottWrap");
    if (on) {
      $("#fOtt").value = "";
      ottWrap.classList.add("opacity-40", "pointer-events-none");
    } else {
      ottWrap.classList.remove("opacity-40", "pointer-events-none");
    }
  });

  /* 재시청 토글 */
  $("#rewatchToggle").addEventListener("change", e => {
    $("#rewatchFields").classList.toggle("hidden", !e.target.checked);
  });

  $("#editModal").addEventListener("click", e => { if (e.target.id === "editModal") closeEdit(); });
  $("#detailModal").addEventListener("click", e => { if (e.target.id === "detailModal") $("#detailModal").classList.add("hidden"); });
}

function updateStepperLabel(id) {
  const v = parseInt($("#" + id).value) || 0;
  if (id === "fSeason") $("#fSeasonLabel").textContent = v === 0 ? "없음" : "S" + v;
  else $("#fCountLabel").textContent = v;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- 검색 매칭: 제목 + 원제 + 배우 + 감독 ---------- */
function matchesQuery(i, q) {
  if (!q) return true;
  if ((i.title || "").toLowerCase().includes(q)) return true;
  if ((i.originalTitle || "").toLowerCase().includes(q)) return true;
  if ((i.director || "").toLowerCase().includes(q)) return true;
  return (i.cast || []).some(c => (c.name || "").toLowerCase().includes(q));
}

/* ---------- 시즌 묶기 (표시 전용 — 저장 데이터는 그대로) ----------
   같은 tmdbId를 한 카드로 묶는다. TMDB 미등록(tmdbId 없음)은 각각 개별 유지.
   목록 정렬은 applyFilters에서 이미 끝난 상태이므로 첫 등장 항목이 대표가 된다. */
/* tmdbId가 같아도 제목이 다르면 묶지 않는다.
   (자동 매칭 과정에서 속편들이 1편과 같은 tmdbId를 물고 온 경우가 있어
    — 예: 반지의 제왕 3부작이 모두 tmdbId 122 — 그대로 묶으면 다른 작품이 합쳐진다) */
function groupKeyOf(i) {
  // 1순위: TMDB 공식 시리즈(컬렉션) — 제목이 전혀 달라도 같은 시리즈면 묶인다
  //        (해리포터 5편, 반지의 제왕 3부작 등). 정보 채우기를 돌려야 채워짐.
  if (i.collectionId) return "c" + i.collectionId;
  // 2순위: 같은 작품의 시즌들 (tmdbId + 제목)
  return i.tmdbId ? "t" + i.tmdbId + "|" + (i.title || "").trim() : "one:" + i.id;
}
function groupItems(list) {
  const map = new Map();
  list.forEach(i => {
    const k = groupKeyOf(i);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  });
  return [...map.values()].map(items => ({
    key: groupKeyOf(items[0]),
    main: items[0],          // 대표(정렬 기준상 가장 앞 = 보통 가장 최근 시청)
    items
  }));
}
/* 상세용: 같은 작품의 모든 시즌을 시즌번호 순으로 */
function seasonsOf(item) {
  const key = groupKeyOf(item);
  const all = (item.tmdbId || item.collectionId)
    ? State.items.filter(x => groupKeyOf(x) === key)
    : [item];
  const num = (x) => parseInt(String(x.season || "").replace(/\D/g, "")) || 0;
  // 시즌번호 → 개봉/방영일 → 본 날짜 순 (시리즈는 시즌번호가 없을 수 있어 개봉일로 정렬)
  return all.slice().sort((a, b) =>
    num(a) - num(b) ||
    (a.releaseDate || "").localeCompare(b.releaseDate || "") ||
    (a.startDate || "").localeCompare(b.startDate || ""));
}

/* ---------- 내 별점: 하트 하나 + 숫자 (5점 만점, 소수점 가능) ---------- */
function fmtRating(n) {
  const v = Number(n);
  if (!v) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function hearts(n, big) {
  const v = fmtRating(n);
  if (!v) return "";
  return `<span class="wl-hearts${big ? " lg" : ""}"><i class="fa-solid fa-heart"></i>${v}</span>`;
}

/* ---------- 장르 표시 처리 ----------
   TMDB가 ko-KR로 줘도 TV 전용 장르 일부는 영어로 온다 → 한글로 바꿔서 보여준다.
   저장 데이터(genres)는 건드리지 않고 표시할 때만 변환. */
const GENRE_KO = {
  // TV 전용 합본 장르는 둘로 쪼개서 영화 쪽 장르와 같은 항목으로 합류시킨다.
  // (영화는 액션/모험을 따로 주므로, 합본을 그대로 두면 같은 액션물이 매체에 따라 갈린다)
  "Action & Adventure": ["액션", "모험"],
  "Sci-Fi & Fantasy": ["SF", "판타지"],
  "War & Politics": ["전쟁", "정치"],
  "Kids": "어린이",
  "Reality": "리얼리티",
  "Talk": "토크",
  "News": "뉴스",
  "Soap": "연속극",
  "Western": "서부",
  "TV Movie": "TV영화",
  "Documentary": "다큐멘터리",
  "Animation": "애니메이션",
  "Comedy": "코미디",
  "Drama": "드라마",
  "Action": "액션",
  "Adventure": "모험",
  "Fantasy": "판타지",
  "Horror": "공포",
  "Mystery": "미스터리",
  "Romance": "로맨스",
  "Thriller": "스릴러",
  "Crime": "범죄",
  "Family": "가족",
  "History": "역사",
  "Music": "음악",
  "War": "전쟁",
  "Science Fiction": "SF"
};
/* 항상 배열로 반환 (합본 장르는 여러 개로 쪼개짐) */
function koGenre(g) {
  const v = GENRE_KO[g];
  if (!v) return [g];
  return Array.isArray(v) ? v : [v];
}

/* 구분(type)과 겹치는 장르는 표시에서 숨김 */
const TYPE_LABELS = ["영화", "드라마", "예능", "애니", "다큐", "기타"];
function visibleGenres(genres) {
  return [...new Set((genres || []).flatMap(koGenre))].filter(g => !TYPE_LABELS.includes(g));
}

/* ---------- OTT 표시용: 스트리밍 전체 목록(otts) + 내가 본 곳(ott) 유지 ---------- */
function ottList(i) {
  const list = [...(i.otts || [])];
  // 영화관 등 TMDB 스트리밍 목록에 없는 "내가 본 곳"은 앞에 유지
  if (i.ott && !list.includes(i.ott)) list.unshift(i.ott);
  return list;
}
function ottBadges(i) {
  return ottList(i).map(o => `<span class="badge badge-ott">${esc(o)}</span>`).join("");
}

/* ---------- OTT 옵션 세팅 (자동판별 후보 + 폴백) ---------- */
const OTT_ALL = ["넷플릭스", "영화관", "웨이브", "티빙", "쿠팡플레이", "디즈니+", "왓챠", "애플TV+", "기타"];

/* 스트리밍 목록은 TMDB가 자동으로 채우므로(otts) 힌트만 보여준다.
   직접 기록하는 건 영화관 체크 또는 기타 입력뿐. */
function setOttOptions(candidates, selected) {
  const hint = $("#ottHint");
  if (!hint) return;
  if (candidates && candidates.length) {
    hint.innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i>TMDB 자동판별: ${esc(candidates.join(", "))} — 따로 입력 안 해도 됩니다`;
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }
}

/* ---------- 시즌 드롭다운 (TMDB 시즌목록 있을 때) ---------- */
function buildSeasonSelect(seasons) {
  const sel = $("#fSeasonSelect");
  const stepper = $("#fSeasonStepper");
  if (seasons && seasons.length > 1) {
    sel.innerHTML = `<option value="0">시즌 선택 안함</option>` +
      seasons.map(s => `<option value="${s.number}">시즌 ${s.number}${s.year ? " (" + s.year + ")" : ""}${s.episodes ? " · " + s.episodes + "화" : ""}</option>`).join("");
    sel.classList.remove("hidden");
    stepper.classList.add("hidden");
    sel.onchange = () => { $("#fSeason").value = sel.value; };
  } else {
    sel.classList.add("hidden");
    stepper.classList.remove("hidden");
  }
}

/* ---------- 필터 팝업 ---------- */
function openFilterModal() {
  buildFilterOptions();
  $("#filterPreview").textContent = `${State.filtered.length}개 표시`;
  $("#filterModal").classList.remove("hidden");
}
function closeFilterModal() { $("#filterModal").classList.add("hidden"); }

function buildFilterOptions() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko"));
  const fill = (id, values) => {
    const sel = $("#" + id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">전체</option>` +
      values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    sel.value = cur;
  };
  fill("filterType", uniq(State.items.map(i => i.type)));
  fill("filterCountry", uniq(State.items.map(i => i.country)));
  fill("filterOtt", uniq(State.items.flatMap(i => ottList(i))));
  fill("filterYear", uniq(State.items.map(i => (i.startDate || "").slice(0, 4))).reverse());
  fill("filterGenre", uniq(State.items.flatMap(i => visibleGenres(i.genres))));
}

function hasActiveFilter() {
  return !!(Filters.type || Filters.country || Filters.ott || Filters.year ||
            Filters.genre || Filters.rating || Filters.person ||
            Filters.q || Filters.pendingOnly || Filters.noSeasonOnly || Filters.dupOnly ||
            Filters.sort !== "date-desc");
}

/* 모든 필터 해제 (검색어·미등록 토글 포함) */
function clearAllFilters() {
  Object.assign(Filters, {
    q: "", type: "", country: "", ott: "", year: "", genre: "", rating: "",
    person: "", sort: "date-desc", pendingOnly: false, noSeasonOnly: false, dupOnly: false
  });
  const s = $("#searchInput"); if (s) s.value = "";
  ["filterType", "filterCountry", "filterOtt", "filterYear", "filterGenre", "filterRating"]
    .forEach(id => { const el = $("#" + id); if (el) el.value = ""; });
  const sb = $("#sortBy"); if (sb) sb.value = "date-desc";
  applyFilters();
}

/* 통계 차트 클릭 → 해당 조건으로 목록 탭 조회 */
function jumpToList(patch) {
  const backup = { ...Filters };
  Object.assign(Filters,
    { type: "", country: "", ott: "", year: "", genre: "", rating: "", person: "", pendingOnly: false, noSeasonOnly: false, dupOnly: false },
    patch);
  applyFilters();

  if (State.filtered.length === 0) {   // 조회 결과 없으면(예: '기타' 집계) 원복
    Object.assign(Filters, backup);
    applyFilters();
    toast("조회할 항목이 없습니다");
    return;
  }

  // 필터 모달 셀렉트 동기화
  buildFilterOptions();
  $("#filterType").value = Filters.type;
  $("#filterCountry").value = Filters.country;
  $("#filterOtt").value = Filters.ott;
  $("#filterYear").value = Filters.year;
  $("#filterGenre").value = Filters.genre;
  $("#filterRating").value = Filters.rating;

  // 목록 탭으로 전환
  const listTab = document.querySelector('.tab-btn[data-tab="list"]');
  if (listTab) listTab.click();
  // 탭 전환의 스크롤 복원(rAF) 뒤에 실행되도록 한 프레임 미룬다 — 새 조회 결과는 맨 위부터 보여준다
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
}

/* 배우·감독 배지 클릭 → 그 사람 작품만 조회 */
function filterByPerson(name) {
  $("#detailModal").classList.add("hidden");
  jumpToList({ person: name });
  toast(`${name} 작품 보는 중`);
}
window.filterByPerson = filterByPerson;

/* ---------- 필터 적용 ---------- */
function applyFilters() {
  const F = Filters;
  State._dupIds = dupTmdbIdSet();     // 매 조회마다 한 번만 계산
  let list = State.items.filter(i => {
    if (F.pendingOnly && i.tmdbId) return false;
    if (F.noSeasonOnly && !needsSeason(i)) return false;
    if (F.dupOnly && !isDupTmdb(i)) return false;
    if (F.q && !matchesQuery(i, F.q)) return false;
    if (F.type && i.type !== F.type) return false;
    if (F.country && i.country !== F.country) return false;
    if (F.ott && !ottList(i).includes(F.ott)) return false;
    if (F.year && (i.startDate || "").slice(0, 4) !== F.year) return false;
    if (F.genre && !visibleGenres(i.genres).includes(F.genre)) return false;
    if (F.rating && (i.rating || 0) !== +F.rating) return false;
    if (F.person && !(i.director === F.person || (i.cast || []).some(c => c.name === F.person))) return false;
    return true;
  });

  const dkey = (i) => i.lastWatchStart || i.startDate || "0000-00-00";
  if (F.sort === "date-desc") list.sort((a, b) => dkey(b).localeCompare(dkey(a)));
  else if (F.sort === "date-asc") list.sort((a, b) => dkey(a).localeCompare(dkey(b)));
  else if (F.sort === "title") list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko"));
  else if (F.sort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));

  State.filtered = list;
  State.groups = groupItems(list);   // 시즌 묶기(표시 전용)
  State.page = 1;
  renderHeaderCount();
  renderCards();
}

/* ---------- 헤더 / 카운트 ---------- */
function renderHeaderCount() {
  const total = State.items.length;
  const totalWorks = groupItems(State.items).length;   // 시즌 묶은 작품 수
  const pending = State.items.filter(i => !i.tmdbId).length;

  $("#totalCount").textContent = totalWorks;
  $("#totalBadge").title = `작품 ${totalWorks}개 · 시청 기록 ${total}개(시즌 포함)`;
  $("#totalBadge").classList.remove("hidden");

  const pb = $("#pendingBtn");
  if (Filters.pendingOnly) {
    pb.className = "px-3.5 py-2 rounded-lg border border-amber-500 bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition";
    pb.innerHTML = `<i class="fa-solid fa-xmark mr-1.5"></i>미등록 ${pending}개 보는 중`;
  } else {
    pb.className = "px-3.5 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-sm font-semibold hover:bg-amber-100 transition";
    pb.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1.5"></i>미등록 ${pending}개`;
  }
  pb.classList.toggle("hidden", pending === 0 && !Filters.pendingOnly);

  // 시즌 미기록 버튼 (0개면 숨김)
  const noSeason = State.items.filter(needsSeason).length;
  const nb = $("#noSeasonBtn");
  if (nb) {
    if (Filters.noSeasonOnly) {
      nb.className = "px-3.5 py-2 rounded-lg border border-orange-500 bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition";
      nb.innerHTML = `<i class="fa-solid fa-xmark mr-1.5"></i>시즌 미기록 ${noSeason}개 보는 중`;
    } else {
      nb.className = "px-3.5 py-2 rounded-lg border border-orange-300 bg-orange-50 text-orange-700 text-sm font-semibold hover:bg-orange-100 transition";
      nb.innerHTML = `<i class="fa-solid fa-layer-group mr-1.5"></i>시즌 미기록 ${noSeason}개`;
    }
    nb.classList.toggle("hidden", noSeason === 0 && !Filters.noSeasonOnly);
  }

  // 매칭 확인 버튼 (제목 다른데 tmdbId 같음 — 0개면 숨김)
  const dupIds = dupTmdbIdSet();
  const dupCount = State.items.filter(i => i.tmdbId && dupIds.has(i.tmdbId)).length;
  const db = $("#dupBtn");
  if (db) {
    if (Filters.dupOnly) {
      db.className = "px-3.5 py-2 rounded-lg border border-rose-500 bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 transition";
      db.innerHTML = `<i class="fa-solid fa-xmark mr-1.5"></i>매칭 확인 ${dupCount}개 보는 중`;
    } else {
      db.className = "px-3.5 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 text-sm font-semibold hover:bg-rose-100 transition";
      db.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1.5"></i>매칭 확인 ${dupCount}개`;
    }
    db.title = "제목이 다른데 TMDB 작품이 같음 — 자동 매칭 오류 의심";
    db.classList.toggle("hidden", dupCount === 0 && !Filters.dupOnly);
  }

  const active = hasActiveFilter();
  $("#filterDot").classList.toggle("hidden", !active);
  $("#clearFilterBtn").classList.toggle("hidden", !active);   // 필터 걸렸을 때만 초기화 버튼 노출
  const shown = (State.groups || []).length;
  $("#resultCount").textContent =
    State.filtered.length === total ? "" : `${shown}개 표시`;
}

/* ---------- 카드 렌더 ---------- */
function renderCards() {
  const grid = $("#cardGrid");
  const groups = State.groups || [];
  const show = groups.slice(0, State.page * State.perPage);

  $("#emptyState").classList.toggle("hidden", groups.length > 0);

  grid.innerHTML = show.map(g => {
    const i = g.main;                    // 대표 항목 (TMDB 정보·포스터는 시즌 공통)
    const multi = g.items.length > 1;    // 시즌이 여러 개로 묶인 카드
    // 묶인 카드는 시즌 전체를 아우르는 날짜 범위로 표시
    const dates = multi
      ? (() => {
          const ss = g.items.map(x => x.startDate).filter(Boolean).sort();
          const ee = g.items.map(x => x.endDate || x.startDate).filter(Boolean).sort();
          return ss.length ? fmtRange(ss[0], ee[ee.length - 1]) : "";
        })()
      : fmtRange(i.startDate, i.endDate);
    return `
    <div class="wl-card ${!i.tmdbId ? "wl-pending" : ""}" data-id="${i.id}">
      <div class="wl-poster-wrap">
        ${i.poster
          ? `<img class="wl-poster" src="${i.poster}" alt="" loading="lazy">`
          : `<div class="wl-poster-empty"><i class="fa-solid fa-film"></i></div>`}
        <div class="wl-tr">
          ${i.voteAverage ? `<span class="wl-vote"><i class="fa-solid fa-star"></i> ${i.voteAverage}</span>` : ""}
          ${i.rating ? `<span class="wl-myrate">${hearts(i.rating)}</span>` : ""}
        </div>
        ${multi
          ? `<span class="wl-season wl-season-multi"><i class="fa-solid fa-layer-group mr-1"></i>시즌 ${g.items.length}</span>`
          : (i.season ? `<span class="wl-season">${esc(i.season)}</span>` : "")}
      </div>
      <div class="wl-body">
        <div class="wl-title-row">
          <span class="wl-title">${esc(i.title)}</span>
          ${i.type ? `<span class="badge badge-type shrink-0">${esc(i.type)}</span>` : ""}
        </div>
        ${visibleGenres(i.genres).length ? `<div class="wl-genres">
          ${visibleGenres(i.genres).slice(0, 3).map(g2 => `<span class="badge badge-genre">${esc(g2)}</span>`).join("")}
        </div>` : ""}
        <div class="wl-meta">${dates || "날짜 없음"}</div>
        ${(i.releaseDate || i.releaseYear) ? `<div class="wl-meta" style="opacity:.8">
          <i class="fa-solid fa-clapperboard mr-1"></i>${i.type === "영화" ? "개봉" : "방영"} ${i.releaseDate ? fmtDate(i.releaseDate) : i.releaseYear}
        </div>` : ""}
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll(".wl-card").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });

  const remain = groups.length - show.length;
  $("#loadMoreWrap").classList.toggle("hidden", remain <= 0);
  $("#loadMoreCount").textContent = remain > 0 ? `(${remain}개 남음)` : "";
}

/* ---------- 상세 보기 ---------- */
function openDetail(id) {
  const i = State.items.find(x => x.id === id);
  if (!i) return;

  /* 같은 작품(tmdbId)의 시즌들 — 표시만 묶고 기록은 시즌별로 각각 보여준다 */
  const seasons = seasonsOf(i);
  const multiSeason = seasons.length > 1;

  const reviewBox = (s) => s.review
    ? `<div class="mt-2 p-3 rounded-lg border" style="background:linear-gradient(135deg,#fef9c3,#fce7f3);border-color:#fde68a">
         <div class="text-xs font-semibold text-slate-500 mb-1"><i class="fa-solid fa-comment-dots mr-1"></i>한줄평</div>
         <div class="text-sm text-slate-700 leading-relaxed">${esc(s.review)}</div></div>`
    : "";

  const recordRows = (s) => `
    <div class="flex justify-between"><span class="text-slate-500 font-medium">처음 본 날</span>
      <span class="font-semibold text-slate-700">${fmtRange(s.startDate, s.endDate) || "-"}</span></div>
    ${s.lastWatchStart ? `<div class="flex justify-between"><span class="text-slate-500 font-medium">마지막 시청</span>
      <span class="font-semibold text-slate-700">${fmtRange(s.lastWatchStart, s.lastWatchEnd)}</span></div>` : ""}
    <div class="flex justify-between"><span class="text-slate-500 font-medium">시청 횟수</span>
      <span class="font-semibold text-slate-700">${s.watchCount || 1}회</span></div>`;

  const recordsHtml = multiSeason
    ? `<div class="border-t border-slate-100 pt-4">
         <div class="text-xs font-semibold text-slate-500 mb-2"><i class="fa-solid fa-layer-group mr-1 text-amber-400"></i>시즌별 시청 기록</div>
         <div class="space-y-3">
           ${seasons.map(s => `
             <div class="wl-season-row">
               <div class="flex items-center justify-between gap-2 mb-2">
                 <span class="badge badge-season">${esc(s.season || "시즌 없음")}</span>
                 <div class="flex items-center gap-2">
                   ${s.rating ? hearts(s.rating) : ""}
                   <button onclick="document.getElementById('detailModal').classList.add('hidden'); openEdit('${s.id}')"
                     class="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-white">
                     <i class="fa-solid fa-pen mr-1"></i>수정</button>
                 </div>
               </div>
               <div class="space-y-1.5 text-sm">${recordRows(s)}</div>
               ${reviewBox(s)}
             </div>`).join("")}
         </div>
       </div>`
    : `<div class="space-y-2 text-sm border-t border-slate-100 pt-4">
         ${recordRows(i)}
       </div>
       ${reviewBox(i)}`;

  /* 관람등급: 숫자만 저장돼 있어(15, 12, 19...) 회차와 헷갈리므로 "15세"로 풀어서 제목 옆에 표시 */
  const certLabel = (c) => {
    if (!c) return "";
    const s = String(c).trim();
    if (/^\d+$/.test(s)) return s + "세";
    if (/^all$/i.test(s)) return "전체";
    return s;
  };

  const infoChips = [];
  if (i.voteAverage) infoChips.push(`<span class="badge badge-vote"><i class="fa-solid fa-star mr-1"></i>${i.voteAverage}</span>`);
  if (i.runtime) infoChips.push(`<span class="badge badge-time"><i class="fa-solid fa-clock mr-1"></i>${i.runtime}분</span>`);
  if (i.totalEpisodes) infoChips.push(`<span class="badge badge-time"><i class="fa-solid fa-list-ol mr-1"></i>총 ${i.totalEpisodes}화</span>`);

  /* 배우·감독 배지는 클릭하면 그 사람 작품만 조회된다 */
  const personBadge = (name, cls, title) =>
    `<span class="badge ${cls} badge-link" title="${esc(title || "")}클릭하면 이 사람 작품만 봅니다"
       onclick="filterByPerson('${esc(name).replace(/'/g, "\\'")}')">${esc(name)}</span>`;

  const directorHtml = i.director
    ? `<div class="text-xs font-medium text-slate-500 mt-2 flex items-center gap-1.5 flex-wrap">
         <i class="fa-solid fa-clapperboard text-slate-400"></i>감독
         ${personBadge(i.director, "badge-genre")}
       </div>` : "";

  const castHtml = (i.cast || []).length
    ? `<div class="mt-4 border-t border-slate-100 pt-4">
         <div class="text-xs font-semibold text-slate-500 mb-2"><i class="fa-solid fa-users mr-1 text-pink-400"></i>출연진</div>
         <div class="flex flex-wrap gap-1.5">
           ${i.cast.map(c => personBadge(c.name, "badge-cast", c.character ? c.character + " · " : "")).join("")}
         </div>
         ${directorHtml}
       </div>`
    : (i.director ? `<div class="mt-4 border-t border-slate-100 pt-4">${directorHtml}</div>` : "");

  const header = i.backdrop
    ? `<div class="relative h-32 bg-cover bg-center" style="background-image:url('${i.backdrop}')">
         <div class="absolute inset-0" style="background:linear-gradient(to top,rgba(255,255,255,1),rgba(255,255,255,0.1))"></div>
         <button onclick="document.getElementById('detailModal').classList.add('hidden')"
           class="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white/80 hover:bg-white text-slate-600"><i class="fa-solid fa-xmark"></i></button>
       </div>`
    : `<div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
         <h3 class="font-semibold text-slate-800">상세 정보</h3>
         <button onclick="document.getElementById('detailModal').classList.add('hidden')"
           class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500"><i class="fa-solid fa-xmark"></i></button>
       </div>`;

  $("#detailContent").innerHTML = `
    ${header}
    <div class="p-5 ${i.backdrop ? "-mt-12 relative" : ""}">
      <div class="flex gap-4 mb-4">
        ${i.poster
          ? `<img src="${i.poster}" class="w-28 rounded-lg object-cover self-start shadow-md" alt="">`
          : `<div class="w-28 aspect-[2/3] rounded-lg bg-slate-200 flex items-center justify-center text-slate-400"><i class="fa-solid fa-film text-2xl"></i></div>`}
        <div class="flex-1 min-w-0 ${i.backdrop ? "pt-12" : ""}">
          <h4 class="text-lg font-bold text-slate-800 leading-snug">
            ${esc(i.title)}
            ${i.cert ? `<span class="badge badge-cert align-middle ml-1">${esc(certLabel(i.cert))}</span>` : ""}
          </h4>
          ${i.originalTitle && i.originalTitle !== i.title ? `<div class="text-xs text-slate-400 font-medium">${esc(i.originalTitle)}</div>` : ""}
          ${(!multiSeason && i.rating) ? `<div class="mt-1">${hearts(i.rating, true)}</div>` : ""}
          <div class="flex flex-wrap gap-1 mt-2">
            ${multiSeason
              ? `<span class="badge badge-season"><i class="fa-solid fa-layer-group mr-1"></i>시즌 ${seasons.length}개</span>`
              : (i.season ? `<span class="badge badge-season">${esc(i.season)}</span>` : "")}
            ${i.type ? `<span class="badge badge-type">${esc(i.type)}</span>` : ""}
            ${i.country ? `<span class="badge badge-country">${esc(i.country)}</span>` : ""}
            ${ottBadges(i)}
          </div>
          ${infoChips.length ? `<div class="flex flex-wrap gap-1 mt-1.5">${infoChips.join("")}</div>` : ""}
        </div>
      </div>

      ${visibleGenres(i.genres).length ? `<div class="flex flex-wrap gap-1 mb-3">
        ${visibleGenres(i.genres).map(g => `<span class="badge badge-genre">${esc(g)}</span>`).join("")}</div>` : ""}

      ${i.overview ? `<p class="text-sm text-slate-600 leading-relaxed mb-4">${esc(i.overview)}</p>` : ""}

      ${recordsHtml}

      <div class="space-y-2 text-sm border-t border-slate-100 pt-4 mt-4">
        ${(i.releaseDate || i.releaseYear) ? `<div class="flex justify-between"><span class="text-slate-500 font-medium">${i.type === "영화" ? "개봉일" : "첫 방영일"}</span>
          <span class="font-semibold text-slate-700">${i.releaseDate ? fmtDate(i.releaseDate) : i.releaseYear}</span></div>` : ""}
        ${(i.companies || []).length ? `<div class="flex justify-between"><span class="text-slate-500 font-medium">제작사</span>
          <span class="font-semibold text-slate-700 text-right">${esc(i.companies.join(", "))}</span></div>` : ""}
      </div>

      ${castHtml}
    </div>
    <div class="flex gap-2 px-5 py-4 border-t border-slate-200">
      <div class="flex-1"></div>
      ${multiSeason ? "" : `<button onclick="document.getElementById('detailModal').classList.add('hidden'); openEdit('${i.id}')"
        class="px-4 py-2.5 rounded-lg text-white text-sm font-semibold" style="background:linear-gradient(135deg,#5f9235,#7bad48)">
        <i class="fa-solid fa-pen mr-1"></i>수정</button>`}
    </div>`;

  $("#detailModal").classList.remove("hidden");
}

/* ---------- 별점 (숫자 입력) ---------- */
function readRating() {
  const v = parseFloat($("#fRating").value);
  if (!isFinite(v) || v <= 0) return null;
  return Math.min(5, Math.round(v * 10) / 10);   // 5점 만점, 소수 첫째자리까지
}

/* ---------- 등록/수정 모달 ---------- */
function openEdit(id) {
  State.editingId = id;
  State.selectedTmdb = null;

  $("#tmdbResults").innerHTML = "";
  $("#tmdbQuery").value = "";
  $("#selectedInfo").classList.add("hidden");
  $("#tmdbSearchArea").classList.remove("hidden");
  $("#fTheater").checked = false;
  $("#ottWrap").classList.remove("opacity-40", "pointer-events-none");
  $("#ottHint").classList.add("hidden");
  setOttOptions([], null);
  buildSeasonSelect(null);

  if (id) {
    const i = State.items.find(x => x.id === id);
    $("#modalTitle").textContent = "수정";
    $("#fTitle").value = i.title || "";
    $("#fType").value = i.type || "영화";
    $("#fCountry").value = i.country || "";
    $("#fTheater").checked = (i.ott === "영화관");
    $("#fOtt").value = (i.ott === "영화관") ? "" : (i.ott || "");
    if (i.ott === "영화관") $("#ottWrap").classList.add("opacity-40", "pointer-events-none");
    $("#fCount").value = i.watchCount || 1;
    $("#fSeason").value = parseInt(String(i.season || "").replace(/\D/g, "")) || 0;
    $("#fStart").value = i.startDate || "";
    $("#fEnd").value = i.endDate || "";
    $("#fReview").value = i.review || "";
    $("#fRating").value = i.rating || "";

    const hasRe = !!i.lastWatchStart;
    $("#rewatchToggle").checked = hasRe;
    $("#rewatchFields").classList.toggle("hidden", !hasRe);
    $("#fLastStart").value = i.lastWatchStart || "";
    $("#fLastEnd").value = i.lastWatchEnd || "";

    // 이미 TMDB 정보 있으면 그 정보 카드도 표시
    if (i.tmdbId) {
      State.selectedTmdb = {
        tmdbId: i.tmdbId, poster: i.poster, backdrop: i.backdrop, genres: i.genres || [],
        overview: i.overview || "", releaseDate: i.releaseDate, releaseYear: i.releaseYear,
        cast: i.cast || [], director: i.director || "", runtime: i.runtime,
        totalEpisodes: i.totalEpisodes, totalSeasons: i.totalSeasons,
        cert: i.cert, voteAverage: i.voteAverage, companies: i.companies || [],
        originalTitle: i.originalTitle, otts: i.otts || [],
        title: i.title, type: i.type, country: i.country
      };
      renderSelected(State.selectedTmdb);
    } else {
      $("#tmdbQuery").value = i.title || "";
    }
    $("#deleteBtn").classList.remove("hidden");
  } else {
    $("#modalTitle").textContent = "새로 등록";
    ["fTitle", "fCountry", "fStart", "fEnd", "fReview", "fLastStart", "fLastEnd"]
      .forEach(f => $("#" + f).value = "");
    $("#fType").value = "영화";
    $("#fOtt").value = "넷플릭스";
    $("#fCount").value = 1;
    $("#fSeason").value = 0;
    $("#fRating").value = "";
    $("#rewatchToggle").checked = false;
    $("#rewatchFields").classList.add("hidden");
    $("#deleteBtn").classList.add("hidden");
  }

  updateStepperLabel("fSeason");
  updateStepperLabel("fCount");
  $("#editModal").classList.remove("hidden");
}

function closeEdit() {
  $("#editModal").classList.add("hidden");
  State.editingId = null;
  State.selectedTmdb = null;
}

function saveItem() {
  const title = $("#fTitle").value.trim();
  if (!title) { toast("제목을 입력하세요", "error"); return; }

  const start = $("#fStart").value || null;
  const end = $("#fEnd").value || start;
  const useRe = $("#rewatchToggle").checked;
  const lastS = useRe ? ($("#fLastStart").value || null) : null;
  const lastE = useRe ? ($("#fLastEnd").value || lastS) : null;
  const seasonNum = parseInt($("#fSeason").value) || 0;
  const ott = $("#fTheater").checked ? "영화관" : ($("#fOtt").value.trim() || null);

  const base = {
    title,
    type: $("#fType").value,
    country: $("#fCountry").value.trim() || null,
    ott,
    season: seasonNum > 0 ? "S" + seasonNum : null,
    watchCount: parseInt($("#fCount").value) || 1,
    rating: readRating(),
    startDate: start,
    endDate: end,
    lastWatchStart: lastS,
    lastWatchEnd: lastE,
    review: $("#fReview").value.trim()
  };

  const t = State.selectedTmdb;
  if (t) {
    Object.assign(base, {
      tmdbId: t.tmdbId, poster: t.poster, backdrop: t.backdrop,
      genres: t.genres || [], overview: t.overview || "",
      releaseDate: t.releaseDate, releaseYear: t.releaseYear,
      cast: t.cast || [], director: t.director || "",
      runtime: t.runtime, totalEpisodes: t.totalEpisodes, totalSeasons: t.totalSeasons,
      cert: t.cert, voteAverage: t.voteAverage, companies: t.companies || [],
      originalTitle: t.originalTitle, otts: t.otts || [],
      collectionId: t.collectionId || null, collectionName: t.collectionName || ""
    });
  }

  if (State.editingId) {
    Object.assign(State.items.find(x => x.id === State.editingId), base);
    toast("수정되었습니다", "success");
  } else {
    State.items.unshift({
      id: uid(), tmdbId: null, poster: null, genres: [], overview: "",
      releaseYear: null, cast: [], director: "",
      createdAt: new Date().toISOString(), ...base
    });
    toast("등록되었습니다", "success");
  }

  saveLocal();
  closeEdit();
  applyFilters();
}

function deleteItem() {
  if (!State.editingId) return;
  if (!confirm("정말 삭제하시겠습니까?")) return;
  State.items = State.items.filter(x => x.id !== State.editingId);
  saveLocal();
  closeEdit();
  applyFilters();
  toast("삭제되었습니다", "success");
}

/* ---------- 설정 탭 ---------- */
function initSettings() {
  $("#tmdbKeyInput").value = getTmdbKey();
  updateKeyStatus();

  $("#saveTmdbKey").addEventListener("click", () => {
    setTmdbKey($("#tmdbKeyInput").value);
    updateKeyStatus();
    toast("API 키가 저장되었습니다", "success");
  });

  /* 동기화 비밀번호 */
  updateSyncPwStatus();
  $("#syncPwBtn").addEventListener("click", openSyncPwModal);
  $("#closeSyncPw").addEventListener("click", closeSyncPwModal);
  $("#cancelSyncPw").addEventListener("click", closeSyncPwModal);
  $("#saveSyncPwBtn").addEventListener("click", saveSyncPw);
  $("#syncPwModal").addEventListener("click", e => { if (e.target.id === "syncPwModal") closeSyncPwModal(); });
  $("#syncPwInput").addEventListener("keydown", e => { if (e.key === "Enter") saveSyncPw(); });

  $("#pushBtn").addEventListener("click", async () => {
    $("#syncStatus").textContent = "저장 중...";
    $("#syncStatus").className = "text-sm mt-2 font-medium text-slate-500";
    const ok = await pushToServer();
    $("#syncStatus").textContent = ok ? "서버 저장 완료" : "저장 실패";
    $("#syncStatus").className = "text-sm mt-2 font-medium " + (ok ? "text-emerald-600" : "text-red-600");
  });

  $("#pullBtn").addEventListener("click", async () => {
    if (!confirm("서버 데이터로 덮어씁니다. 계속할까요?")) return;
    $("#syncStatus").textContent = "불러오는 중...";
    const ok = await pullFromServer();
    if (ok) applyFilters();
    $("#syncStatus").textContent = ok ? "불러오기 완료" : "불러오기 실패";
    $("#syncStatus").className = "text-sm mt-2 font-medium " + (ok ? "text-emerald-600" : "text-red-600");
  });

  $("#enrichBtn").addEventListener("click", runEnrichAll);
  $("#refreshOttBtn").addEventListener("click", runRefreshOtts);
  $("#refreshRatingBtn").addEventListener("click", runRefreshRatings);
  $("#refreshCollectionBtn").addEventListener("click", runRefreshCollections);
  renderUpdInfo();

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(State.items, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `watchlog-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  $("#importFile").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!Array.isArray(data)) throw new Error("배열이 아닙니다");
        if (!confirm(`${data.length}개 항목을 불러옵니다. 기존 데이터를 덮어쓸까요?`)) return;
        State.items = data;
        saveLocal();
        applyFilters();
        toast(`${data.length}개 불러왔습니다`, "success");
      } catch (err) { toast("파일 오류: " + err.message, "error"); }
    };
    r.readAsText(file);
    e.target.value = "";
  });

  $("#seedBtn").addEventListener("click", () => {
    if (!window.SEED_DATA) { toast("시드 데이터가 없습니다", "error"); return; }
    if (!confirm(`노션 데이터 ${window.SEED_DATA.length}개를 불러옵니다. 기존 데이터를 덮어쓸까요?`)) return;
    State.items = window.SEED_DATA.map(x => ({ ...x, createdAt: new Date().toISOString() }));
    saveLocal();
    applyFilters();
    toast(`${State.items.length}개 불러왔습니다`, "success");
  });
}

function updateKeyStatus() {
  const el = $("#tmdbKeyStatus");
  if (getTmdbKey()) {
    el.textContent = "API 키가 설정되어 있습니다";
    el.className = "text-sm mt-2 font-medium text-emerald-600";
  } else {
    el.textContent = "API 키가 없습니다. TMDB 검색이 동작하지 않습니다.";
    el.className = "text-sm mt-2 font-medium text-amber-600";
  }
}

/* ---------- 갱신 시각 기록/표시 ---------- */
const LS_UPD = "watchlog_updated_at";
function getUpd() { try { return JSON.parse(localStorage.getItem(LS_UPD) || "{}"); } catch { return {}; } }
function markUpd(key) {
  const o = getUpd();
  o[key] = new Date().toISOString();
  localStorage.setItem(LS_UPD, JSON.stringify(o));
  renderUpdInfo();
}
function fmtUpd(iso) {
  if (!iso) return "아직 실행 안 함";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `최근: ${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderUpdInfo() {
  const u = getUpd();
  const set = (id, v) => { const el = $("#" + id); if (el) el.textContent = fmtUpd(v); };
  set("updEnrich", u.enrich);
  set("updOtt", u.ott);
  set("updRating", u.rating);
  set("updCollection", u.collection);
}

/* ---------- 일괄 정보 채우기 ---------- */
let _enriching = false;
async function runEnrichAll() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  const overwrite = $("#enrichOverwrite").checked;
  const targets = overwrite ? State.items.slice() : State.items.filter(i => !i.tmdbId);
  if (!targets.length) { toast("채울 항목이 없습니다", "success"); return; }
  if (!confirm(`${targets.length}개 항목의 정보를 가져옵니다. 시간이 걸릴 수 있습니다.`)) return;

  _enriching = true;
  const status = $("#enrichStatus");
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  let ok = 0, fail = 0;
  for (let n = 0; n < targets.length; n++) {
    const i = targets[n];
    status.textContent = `${n + 1} / ${targets.length} — ${i.title}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = ((n + 1) / targets.length * 100).toFixed(1) + "%";

    try {
      const d = await tmdbAutoMatch(i.title, i.type);
      if (d) {
        Object.assign(i, {
          tmdbId: d.tmdbId, poster: d.poster, backdrop: d.backdrop,
          genres: d.genres, overview: d.overview,
          releaseDate: d.releaseDate, releaseYear: d.releaseYear,
          cast: d.cast, director: d.director, runtime: d.runtime,
          totalEpisodes: d.totalEpisodes, totalSeasons: d.totalSeasons,
          cert: d.cert, voteAverage: d.voteAverage, companies: d.companies,
          originalTitle: d.originalTitle, otts: d.otts || [],
          collectionId: d.collectionId || null, collectionName: d.collectionName || "",
          country: i.country || d.country
        });
        // 시즌 정보가 없으면 제목에서 자동 추출 (예: "킹덤 시즌2", "S2", "2기")
        if (!i.season) {
          const m = String(i.title).match(/(?:시즌|season|s|파트|part)\s*(\d+)|(\d+)\s*기/i);
          if (m) i.season = "S" + (m[1] || m[2]);
        }
        // OTT가 비어있고 영화관이 아니면 자동판별 첫번째 적용
        if ((!i.ott || i.ott === "기타") && i.ott !== "영화관" && d.otts && d.otts.length) {
          i.ott = d.otts[0];
        }
        ok++;
      } else fail++;
    } catch { fail++; }

    if (n % 10 === 9) saveLocal(true);
    await new Promise(r => setTimeout(r, 260));
  }

  saveLocal();
  applyFilters();
  _enriching = false;
  markUpd("enrich");
  status.textContent = `완료 — 성공 ${ok}개, 실패 ${fail}개`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`정보 채우기 완료 (${ok}개)`, "success");
}

/* ---------- OTT(스트리밍) 정보만 갱신 ---------- */
async function runRefreshOtts() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  const targets = State.items.filter(i => i.tmdbId);
  if (!targets.length) { toast("갱신할 항목이 없습니다 (TMDB 연동된 항목만 대상)", "success"); return; }
  if (!confirm(`${targets.length}개 항목의 OTT(스트리밍) 정보를 새로 조회합니다.`)) return;

  _enriching = true;
  const status = $("#enrichStatus");
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  let changed = 0, fail = 0;
  for (let n = 0; n < targets.length; n++) {
    const i = targets[n];
    status.textContent = `${n + 1} / ${targets.length} — ${i.title}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = ((n + 1) / targets.length * 100).toFixed(1) + "%";

    // 저장된 구분으로 movie/tv 추정, 비면 반대쪽도 시도 (애니 극장판 등 대비)
    const primary = i.type === "영화" ? "movie" : "tv";
    const other = primary === "movie" ? "tv" : "movie";
    try {
      let otts = await tmdbProviders(i.tmdbId, primary);
      if (!otts.length) otts = await tmdbProviders(i.tmdbId, other);
      const before = JSON.stringify(i.otts || []);
      i.otts = otts;
      if (JSON.stringify(otts) !== before) changed++;
    } catch { fail++; }

    if (n % 10 === 9) saveLocal(true);
    await new Promise(r => setTimeout(r, 260));
  }

  saveLocal();
  applyFilters();
  _enriching = false;
  markUpd("ott");
  status.textContent = `OTT 갱신 완료 — 변경 ${changed}개${fail ? `, 실패 ${fail}개` : ""}`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`OTT 정보 갱신 완료`, "success");
}

/* ---------- 시리즈(TMDB 컬렉션) 정보만 가져오기 ----------
   제목이 달라도 같은 시리즈면 묶이도록 collectionId를 채운다. 영화에만 존재. */
async function runRefreshCollections() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  const targets = State.items.filter(i => i.tmdbId);
  if (!targets.length) { toast("갱신할 항목이 없습니다", "success"); return; }
  if (!confirm(`${targets.length}개 항목의 시리즈(컬렉션) 정보를 가져옵니다.`)) return;

  _enriching = true;
  const status = $("#enrichStatus");
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  let found = 0, fail = 0;
  for (let n = 0; n < targets.length; n++) {
    const i = targets[n];
    status.textContent = `${n + 1} / ${targets.length} — ${i.title}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = ((n + 1) / targets.length * 100).toFixed(1) + "%";

    const mediaType = i.type === "영화" ? "movie" : "tv";
    try {
      const d = await tmdbDetail(i.tmdbId, mediaType);
      i.collectionId = d.collectionId || null;
      i.collectionName = d.collectionName || "";
      if (i.collectionId) found++;
    } catch { fail++; }

    if (n % 10 === 9) saveLocal(true);
    await new Promise(r => setTimeout(r, 260));
  }

  saveLocal();
  applyFilters();
  _enriching = false;
  markUpd("collection");
  status.textContent = `시리즈 정보 완료 — ${found}개 작품이 시리즈에 속함${fail ? `, 실패 ${fail}개` : ""}`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast("시리즈 정보 가져오기 완료", "success");
}

/* ---------- 평점(TMDB voteAverage)만 갱신 ---------- */
async function runRefreshRatings() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  const targets = State.items.filter(i => i.tmdbId);
  if (!targets.length) { toast("갱신할 항목이 없습니다 (TMDB 연동된 항목만 대상)", "success"); return; }
  if (!confirm(`${targets.length}개 항목의 TMDB 평점을 새로 조회합니다.`)) return;

  _enriching = true;
  const status = $("#enrichStatus");
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  let changed = 0, fail = 0;
  for (let n = 0; n < targets.length; n++) {
    const i = targets[n];
    status.textContent = `${n + 1} / ${targets.length} — ${i.title}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = ((n + 1) / targets.length * 100).toFixed(1) + "%";

    const mediaType = i.type === "영화" ? "movie" : "tv";
    try {
      const d = await tmdbDetail(i.tmdbId, mediaType);
      if (d && d.voteAverage != null && d.voteAverage !== i.voteAverage) {
        i.voteAverage = d.voteAverage;
        changed++;
      }
    } catch { fail++; }

    if (n % 10 === 9) saveLocal(true);
    await new Promise(r => setTimeout(r, 260));
  }

  saveLocal();
  applyFilters();
  _enriching = false;
  markUpd("rating");
  status.textContent = `평점 갱신 완료 — 변경 ${changed}개${fail ? `, 실패 ${fail}개` : ""}`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`평점 갱신 완료`, "success");
}
