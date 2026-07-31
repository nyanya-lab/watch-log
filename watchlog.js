/* ============================================
   watchlog.js — 카드 목록, 필터, 등록/수정
   ============================================ */

const Filters = {
  q: "", type: "", country: "", ott: "", year: "", genre: "", rating: "",
  person: "",                       // 배우/감독 (배지 클릭 전용)
  sort: "date-desc", pendingOnly: false,
  noSeasonOnly: false,              // 시즌이 여러 개인데 시즌을 기록 안 한 항목만
  dupOnly: false,                   // 제목이 다른데 tmdbId가 같은 항목만 (매칭 오류 의심)
  group: "",                        // 시리즈 모아보기에서 고른 그룹 키
  seriesView: false                 // 목록 자리에 시리즈 카드를 보여주는 모드
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
/* 내가 적은 시즌 번호와 TMDB가 말하는 편 번호가 어긋난 항목.
   속편을 1편의 tmdbId로 등록해두면 이렇게 갈린다 (예: 범죄도시2를 S2로 적었는데 TMDB는 1편이라고 답함).
   → 포스터·장르·평점·러닝타임이 전부 1편 것이므로 재매칭이 필요하다. */
function seriesNoMismatch(i) {
  if (!i.seriesNo || !i.season) return false;
  const mine = parseInt(String(i.season).replace(/\D/g, ""));
  return !!mine && mine !== i.seriesNo;
}

function isDupTmdb(i) {
  if (seriesNoMismatch(i)) return true;
  return !!(i.tmdbId && State._dupIds && State._dupIds.has(i.tmdbId));
}

/* 자동 재매칭이 안전한 항목만 고른다.
   조건: TMDB는 이 기록을 시리즈 1편이라 하는데(seriesNo=1) 내가 2편 이상으로 적어둔 경우.
   = 속편을 1편 tmdbId에 얹어놓은 패턴. 컬렉션에서 그 번호의 영화를 찾아 갈아끼우면 된다.
   반대로 링크는 맞는데 번호 기준만 다른 경우(예: 안 본 편이 있어 번호가 밀린 브레이킹 던)는
   seriesNo가 1이 아니므로 자동 대상에서 빠진다 — 잘못 건드리면 엉뚱한 영화로 바뀐다. */
function autoFixTargets() {
  return State.items.map(i => {
    if (i.type !== "영화" || !i.collectionId || i.seriesNo !== 1) return null;
    const want = parseInt(String(i.season || "").replace(/\D/g, ""));
    if (!want || want < 2) return null;
    if (i.seriesTotal && want > i.seriesTotal) return null;   // 총편수 밖이면 판단 필요
    return { item: i, want };
  }).filter(Boolean);
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

  /* 시리즈 보기 토글 */
  $("#seriesBtn").addEventListener("click", toggleSeriesView);

  /* 매칭 확인 목록의 자동 재매칭 */
  $("#autoFixBtn").addEventListener("click", runAutoRematch);
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

  /* 별점 몰아넣기 */
  $("#quickRateBtn").addEventListener("click", openQuickRate);
  $("#qrClose").addEventListener("click", closeQuickRate);
  $("#quickRateModal").addEventListener("click", e => { if (e.target.id === "quickRateModal") closeQuickRate(); });

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

/* 남은 스테퍼는 시청 횟수 하나뿐 (시즌 스테퍼는 없앴다) */
function updateStepperLabel(id) {
  const v = parseInt($("#" + id).value) || 0;
  if (id === "fCount") $("#fCountLabel").textContent = v;
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
  const num = (x) => x.seriesNo || parseInt(String(x.season || "").replace(/\D/g, "")) || 0;
  // 시리즈 편번호(또는 시즌번호) → 개봉/방영일 → 본 날짜 순
  return all.slice().sort((a, b) =>
    num(a) - num(b) ||
    (a.releaseDate || "").localeCompare(b.releaseDate || "") ||
    (a.startDate || "").localeCompare(b.startDate || ""));
}

/* 좌상단 배지에 쓸 라벨. 시즌·시리즈 편 번호를 모두 `S1` 형식으로 통일한다.
   **직접 적은 `season`이 우선**이고 `seriesNo`(TMDB 컬렉션 순번)는 빈칸을 채울 때만 쓴다.
   속편이 1편의 tmdbId를 물고 있으면 TMDB는 그 기록을 1편이라고 답하기 때문에,
   seriesNo를 우선하면 사용자가 S3으로 적어둔 기록이 S1로 덮여버린다. */
function seriesLabel(i) {
  if (i.season) return esc(i.season);
  if (i.seriesNo) return "S" + i.seriesNo;
  return "";
}

/* ---------- 구분을 글자 대신 아이콘으로 ----------
   구분은 6종으로 고정이라 아이콘이 잘 맞는다. 카드 메타 줄에서 글자를 빼면
   장르와 섞여 보이던 문제가 없어지고 한눈에 구별된다. */
const TYPE_ICON = {
  "영화": "fa-film",
  "드라마": "fa-tv",
  "예능": "fa-microphone-lines",
  "애니": "fa-face-smile",
  "다큐": "fa-camera-retro",
  "기타": "fa-shapes"
};
function typeIcon(type) { return TYPE_ICON[type] || TYPE_ICON["기타"]; }

/* 포스터 하단 평점 띠 — 내 별점과 TMDB 평점을 한 줄에 나란히.
   둘 다 없으면 띠 자체를 안 그린다 (포스터를 괜히 가리지 않게). */
function ratingChip(i) {
  const mine = i.rating
    ? `<span class="wl-rt wl-rt-mine"><i class="fa-solid fa-heart"></i>${fmtRating(i.rating)}</span>` : "";
  const tmdb = i.voteAverage
    ? `<span class="wl-rt wl-rt-tmdb"><i class="fa-solid fa-star"></i>${i.voteAverage}</span>` : "";
  if (!mine && !tmdb) return "";
  return `<div class="wl-tr">${mine}${tmdb}</div>`;
}

/* 포스터 아래 메타 한 줄 — 장르(최대 3개) + 개봉/방영 연도 */
function metaLine(i) {
  const bits = visibleGenres(i.genres).slice(0, 3);
  if (i.releaseYear) bits.push(i.releaseYear);
  return esc(bits.join(" · "));
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

/* ---------- 시즌 드롭다운 ----------
   TMDB가 시즌 목록을 주는 작품만 시즌을 고를 수 있다. 수기 입력은 없앴다 —
   시즌 번호는 TMDB에서 오는 값이고, 손으로 넣으면 실제 시즌과 어긋나기만 했다.
   목록이 없으면(영화·단일시즌) 칸 자체를 숨긴다. 이미 저장된 값은 hidden input에 그대로 남으므로
   수정해서 저장해도 지워지지 않는다. */
/* 저장된 기록에는 TMDB 시즌 목록이 없다 (`totalSeasons` 숫자만 남는다).
   수정할 때도 시즌을 고를 수 있어야 하므로 총 시즌 수로 목록을 만들어 준다. */
function seasonListFor(i) {
  const n = i.totalSeasons || 0;
  if (n < 2) return null;
  return Array.from({ length: n }, (_, k) => ({ number: k + 1 }));
}

function buildSeasonSelect(seasons) {
  const sel = $("#fSeasonSelect");
  const field = $("#seasonField");
  if (seasons && seasons.length > 1) {
    sel.innerHTML = `<option value="0">시즌 선택 안함</option>` +
      seasons.map(s => `<option value="${s.number}">시즌 ${s.number}${s.year ? " (" + s.year + ")" : ""}${s.episodes ? " · " + s.episodes + "화" : ""}</option>`).join("");
    sel.value = $("#fSeason").value || "0";
    field.classList.remove("hidden");
    sel.onchange = () => { $("#fSeason").value = sel.value; };
  } else {
    field.classList.add("hidden");
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
            Filters.q || Filters.pendingOnly || Filters.noSeasonOnly || Filters.dupOnly || Filters.group ||
            Filters.seriesView ||
            Filters.sort !== "date-desc");
}

/* 모든 필터 해제 (검색어·미등록 토글 포함) */
function clearAllFilters() {
  Object.assign(Filters, {
    q: "", type: "", country: "", ott: "", year: "", genre: "", rating: "",
    person: "", sort: "date-desc", pendingOnly: false, noSeasonOnly: false, dupOnly: false, group: "", seriesView: false, seriesView: false
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
    { type: "", country: "", ott: "", year: "", genre: "", rating: "", person: "", pendingOnly: false, noSeasonOnly: false, dupOnly: false, group: "", seriesView: false },
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

/* ---------- 시리즈 모아보기 ----------
   목록은 기록 단위로 평면이고, 묶어보는 건 여기서만 한다.
   2편 이상인 그룹(= TMDB 컬렉션 시리즈, 또는 같은 작품의 여러 시즌)만 보여준다. */

/* 시리즈 보기 토글 — 목록 자리에 시리즈 카드를 그린다 (모달 아님) */
function toggleSeriesView() {
  Filters.seriesView = !Filters.seriesView;
  Filters.group = "";                 // 시리즈 목록으로 돌아갈 땐 개별 시리즈 조회 해제
  State.page = 1;
  applyFilters();
}

/* 시리즈 카드 렌더 — renderCards에서 시리즈 보기일 때 호출.
   현재 필터·검색이 걸린 결과를 기준으로 묶으므로 검색창으로 시리즈도 걸러진다. */
function renderSeriesCards() {
  const grid = $("#cardGrid");
  const all = groupItems(State.filtered)
    .filter(g => g.items.length > 1)
    .map(g => {
      const withPoster = g.items.find(x => x.poster) || g.main;
      const name = (g.items.find(x => x.collectionName) || {}).collectionName || g.main.title;
      const years = g.items.map(x => x.releaseYear).filter(Boolean).sort();
      return {
        key: g.key, name, items: g.items, poster: withPoster.poster,
        isCollection: !!g.main.collectionId,
        yearRange: years.length ? (years[0] === years[years.length - 1] ? years[0] : `${years[0]}~${years[years.length - 1]}`) : ""
      };
    })
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, "ko"));
  const list = all;

  // 컬렉션 정보가 아직 없으면 안내 (같은 제목의 시즌만 잡힘)
  const hint = $("#seriesHint");
  if (!all.some(s => s.isCollection)) {
    hint.innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i>설정 → <b>"시리즈 정보 가져오기"</b>를 누르면
      해리포터·트와일라잇처럼 제목이 다른 시리즈도 함께 묶여서 나옵니다.`;
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }

  const show = list.slice(0, State.page * State.perPage);
  $("#emptyState").classList.toggle("hidden", list.length > 0);

  grid.innerHTML = show.map(s => `
    <div class="wl-card wl-series-card" data-key="${esc(s.key)}">
      <div class="wl-poster-wrap">
        ${s.poster
          ? `<img class="wl-poster" src="${s.poster}" alt="" loading="lazy">`
          : `<div class="wl-poster-empty"><i class="fa-solid fa-film"></i></div>`}
        <span class="wl-season wl-season-multi"><i class="fa-solid fa-layer-group mr-1"></i>${s.items.length}편</span>
      </div>
      <div class="wl-body">
        <div class="wl-title-row">
          <i class="fa-solid fa-layer-group wl-type" style="color:#e0700f"></i>
          <span class="wl-title">${esc(s.name)}</span>
        </div>
        <div class="wl-meta">${s.items.length}편${s.yearRange ? ` · ${s.yearRange}` : ""}</div>
      </div>
    </div>`).join("");

  grid.querySelectorAll(".wl-series-card").forEach(el => {
    el.addEventListener("click", () => filterBySeries(el.dataset.key));
  });

  const remain = list.length - show.length;
  $("#loadMoreWrap").classList.toggle("hidden", remain <= 0);
  $("#loadMoreCount").textContent = remain > 0 ? `(${remain}개 남음)` : "";
  $("#resultCount").textContent = `시리즈 ${list.length}개`;
}

/* 시리즈 카드 선택 → 그 시리즈의 기록만 목록에 조회 */
function filterBySeries(key) {
  Filters.seriesView = false;
  Filters.group = key;
  State.page = 1;
  applyFilters();
  const g = groupItems(State.items).find(x => x.key === key);
  if (g) {
    const name = (g.items.find(x => x.collectionName) || {}).collectionName || g.main.title;
    toast(`${name} · ${g.items.length}편 보는 중`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.filterBySeries = filterBySeries;

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
    if (F.group && groupKeyOf(i) !== F.group) return false;
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
  const totalWorks = groupItems(State.items).length;   // 시리즈·시즌 묶은 작품 수 (참고용)
  const pending = State.items.filter(i => !i.tmdbId).length;

  $("#totalCount").textContent = total;
  $("#totalBadge").title = `시청 기록 ${total}개 · 시리즈로 묶으면 ${totalWorks}개 작품`;
  $("#totalBadge").classList.remove("hidden");

  /* 구분별 개수 — 기록에 실제로 있는 구분만, 많은 순.
     지금은 영화·드라마 둘뿐이지만 예능·애니가 생기면 자동으로 늘어난다. */
  const tc = $("#typeCounts");
  if (tc) {
    const byType = {};
    State.items.forEach(i => { const t = i.type || "기타"; byType[t] = (byType[t] || 0) + 1; });
    tc.innerHTML = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<span class="hd-chip" title="${esc(t)} ${n}개"><i class="fa-solid ${typeIcon(t)}"></i>${n}</span>`)
      .join("");
  }

  const pb = $("#pendingBtn");
  if (Filters.pendingOnly) {
    pb.className = "wl-chip wl-chip-warn on";
    pb.innerHTML = `<i class="fa-solid fa-xmark"></i>미등록 ${pending}개 보는 중`;
  } else {
    pb.className = "wl-chip wl-chip-warn";
    pb.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i>미등록 ${pending}개`;
  }
  pb.classList.toggle("hidden", pending === 0 && !Filters.pendingOnly);

  // 시즌 미기록 버튼 (0개면 숨김)
  const noSeason = State.items.filter(needsSeason).length;
  const nb = $("#noSeasonBtn");
  if (nb) {
    if (Filters.noSeasonOnly) {
      nb.className = "wl-chip wl-chip-season on";
      nb.innerHTML = `<i class="fa-solid fa-xmark"></i>시즌 미기록 ${noSeason}개 보는 중`;
    } else {
      nb.className = "wl-chip wl-chip-season";
      nb.innerHTML = `<i class="fa-solid fa-layer-group"></i>시즌 미기록 ${noSeason}개`;
    }
    nb.classList.toggle("hidden", noSeason === 0 && !Filters.noSeasonOnly);
  }

  // 매칭 확인 버튼 (제목 다른데 tmdbId 같음 — 0개면 숨김)
  const dupIds = dupTmdbIdSet();
  const dupCount = State.items.filter(i =>
    seriesNoMismatch(i) || (i.tmdbId && dupIds.has(i.tmdbId))).length;
  const db = $("#dupBtn");
  if (db) {
    if (Filters.dupOnly) {
      db.className = "wl-chip wl-chip-danger on";
      db.innerHTML = `<i class="fa-solid fa-xmark"></i>매칭 확인 ${dupCount}개 보는 중`;
    } else {
      db.className = "wl-chip wl-chip-danger";
      db.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>매칭 확인 ${dupCount}개`;
    }
    db.title = "제목이 다른데 TMDB 작품이 같음 — 자동 매칭 오류 의심";
    db.classList.toggle("hidden", dupCount === 0 && !Filters.dupOnly);
  }

  // 별점 채우기 버튼 (필터가 아니라 몰아넣기 모달을 여는 버튼 — 0개면 숨김)
  const noRate = State.items.filter(i => !i.rating).length;
  const qb = $("#quickRateBtn");
  if (qb) {
    $("#quickRateCount").textContent = noRate;
    qb.classList.toggle("hidden", noRate === 0);
  }

  // 자동 재매칭 안내바 — 매칭 확인 목록을 보는 중이고 고칠 게 있을 때만
  const fixBar = $("#autoFixBar");
  if (fixBar) {
    const fixable = Filters.dupOnly ? autoFixTargets().length : 0;
    fixBar.classList.toggle("hidden", fixable === 0);
    if (fixable) {
      $("#autoFixMsg").innerHTML =
        `<i class="fa-solid fa-circle-info mr-1"></i>이 중 <b>${fixable}개</b>는 속편이 1편에 잘못 연결된 경우예요. 올바른 편으로 자동 연결할 수 있어요.`;
    }
  }

  // 시리즈 보기 버튼 활성 표시
  const sb = $("#seriesBtn");
  if (sb) {
    sb.className = Filters.seriesView
      ? "w-11 h-11 rounded-lg border border-amber-500 bg-amber-500 text-white transition shrink-0"
      : "w-11 h-11 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-600 transition shrink-0";
    sb.title = Filters.seriesView ? "전체 목록으로 돌아가기" : "시리즈만 모아보기";
  }

  const active = hasActiveFilter();
  $("#filterDot").classList.toggle("hidden", !active);
  $("#clearFilterBtn").classList.toggle("hidden", !active);   // 필터 걸렸을 때만 초기화 버튼 노출
  $("#resultCount").textContent =
    State.filtered.length === total ? "" : `${State.filtered.length}개 표시`;
}

/* ---------- 카드 렌더 ---------- */
function renderCards() {
  if (Filters.seriesView) return renderSeriesCards();
  $("#seriesHint").classList.add("hidden");

  const grid = $("#cardGrid");
  const list = State.filtered;                        // 기록 하나 = 카드 하나 (묶지 않음)
  const show = list.slice(0, State.page * State.perPage);

  $("#emptyState").classList.toggle("hidden", list.length > 0);

  grid.innerHTML = show.map(i => `
    <div class="wl-card ${!i.tmdbId ? "wl-pending" : ""}" data-id="${i.id}">
      <div class="wl-poster-wrap">
        ${i.poster
          ? `<img class="wl-poster" src="${i.poster}" alt="" loading="lazy">`
          : `<div class="wl-poster-empty"><i class="fa-solid fa-film"></i></div>`}
        ${ratingChip(i)}
        ${seriesLabel(i) ? `<span class="wl-season">${seriesLabel(i)}</span>` : ""}
      </div>
      <div class="wl-body">
        <div class="wl-title-row">
          <i class="fa-solid ${typeIcon(i.type)} wl-type" title="${esc(i.type || "")}"></i>
          <span class="wl-title">${esc(i.title)}</span>
        </div>
        <div class="wl-meta">${metaLine(i)}</div>
      </div>
    </div>`).join("");

  grid.querySelectorAll(".wl-card").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });

  const remain = list.length - show.length;
  $("#loadMoreWrap").classList.toggle("hidden", remain <= 0);
  $("#loadMoreCount").textContent = remain > 0 ? `(${remain}개 남음)` : "";
}

/* ---------- 상세 보기 ---------- */
function openDetail(id) {
  const i = State.items.find(x => x.id === id);
  if (!i) return;

  /* 목록은 기록 단위로 분리되어 있으므로 상세도 이 기록 하나만 보여준다.
     같은 시리즈의 다른 편은 아래 "이 시리즈의 다른 편"에서 이동할 수 있다. */
  const seasons = seasonsOf(i);
  const siblings = seasons.filter(s => s.id !== i.id);

  const reviewBox = (s) => s.review
    ? `<div class="mt-2 p-3 rounded-lg border" style="background:#fdf6e3;border-color:#fde68a">
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

  /* 상세는 이 기록 하나만 보여준다. 같은 시리즈의 다른 편은 아래 "이 시리즈의 다른 편"으로 이동. */
  const recordsHtml = `
    <div class="space-y-2 text-sm border-t border-slate-100 pt-4">
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
          ${i.rating ? `<div class="mt-1">${hearts(i.rating, true)}</div>` : ""}
          <div class="flex flex-wrap gap-1 mt-2">
            ${seriesLabel(i) ? `<span class="badge badge-season">
              ${i.collectionId ? `<i class="fa-solid fa-layer-group mr-1"></i>` : ""}${seriesLabel(i)}${i.seriesTotal ? ` <span class="opacity-70 ml-1">/ 총 ${i.seriesTotal}편</span>` : ""}
            </span>` : ""}
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

      ${siblings.length ? `<div class="mt-4 border-t border-slate-100 pt-4">
        <div class="text-xs font-semibold text-slate-500 mb-2">
          <i class="fa-solid fa-layer-group mr-1 text-amber-400"></i>이 시리즈의 다른 편 ${siblings.length}개
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${siblings.map(s => `<span class="badge badge-season badge-link" onclick="openDetail('${s.id}')">
            ${seriesLabel(s) || esc(s.title)}${s.releaseYear ? ` <span class="opacity-70 ml-1">${s.releaseYear}</span>` : ""}
          </span>`).join("")}
        </div>
      </div>` : ""}
    </div>
    <div class="flex gap-2 px-5 py-4 border-t border-slate-200">
      <div class="flex-1"></div>
      <button onclick="document.getElementById('detailModal').classList.add('hidden'); openEdit('${i.id}')"
        class="px-4 py-2.5 rounded-lg text-white text-sm font-semibold" style="background:#4d7c2a">
        <i class="fa-solid fa-pen mr-1"></i>수정</button>
    </div>`;

  $("#detailModal").classList.remove("hidden");
}

/* ---------- 별점 (숫자 입력) ---------- */
function readRating() {
  const v = parseFloat($("#fRating").value);
  if (!isFinite(v) || v <= 0) return null;
  return Math.min(5, Math.round(v * 10) / 10);   // 5점 만점, 소수 첫째자리까지
}

/* ---------- 별점 몰아넣기 ----------
   별점이 276개 중 11개뿐이라, 수정 모달을 6단계 거치는 방식으로는 절대 안 채워진다.
   한 장씩 띄우고 숫자만 입력 → Enter로 다음. 빈 값으로 Enter는 건너뛰기.
   큐는 열 때 한 번 스냅샷으로 잡는다 — 점수를 넣는 순간 목록이 줄어들면 뒤로 가기가 깨진다. */
const QuickRate = { queue: [], idx: 0, done: 0 };

/* 최근 본 것부터 — 기억이 선명한 순서 */
function quickRateTargets() {
  const dkey = (i) => i.lastWatchStart || i.startDate || "";
  return State.items.filter(i => !i.rating).sort((a, b) => dkey(b).localeCompare(dkey(a)));
}

function openQuickRate() {
  QuickRate.queue = quickRateTargets();
  QuickRate.idx = 0;
  QuickRate.done = 0;
  if (!QuickRate.queue.length) { toast("별점 없는 기록이 없습니다", "success"); return; }
  $("#quickRateModal").classList.remove("hidden");
  renderQuickRate();
}

function closeQuickRate() {
  $("#quickRateModal").classList.add("hidden");
  const n = QuickRate.done;
  applyFilters();
  renderDiscover();
  if (n) toast(`별점 ${n}개를 넣었습니다`, "success");
}

function renderQuickRate() {
  const q = QuickRate.queue;
  const body = $("#qrBody");
  const total = q.length;

  // 다 넘겼을 때
  if (QuickRate.idx >= total) {
    $("#qrProgress").textContent = "";
    $("#qrBar").style.width = "100%";
    const left = q.filter(i => !i.rating).length;
    body.innerHTML = `
      <div class="text-center py-8">
        <i class="fa-solid fa-circle-check text-4xl text-emerald-500 mb-3"></i>
        <p class="font-semibold text-slate-800">${QuickRate.done}개에 별점을 넣었어요</p>
        ${left ? `<p class="text-sm text-slate-500 mt-1 font-medium">건너뛴 ${left}개는 다음에 또 뜹니다</p>` : ""}
        <div class="flex gap-2 justify-center mt-5">
          ${left ? `<button id="qrRestart" class="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50">
            <i class="fa-solid fa-rotate-left mr-1"></i>건너뛴 것 다시 보기</button>` : ""}
          <button id="qrDone" class="px-5 py-2.5 rounded-lg text-white text-sm font-semibold" style="background:#4d7c2a">닫기</button>
        </div>
      </div>`;
    $("#qrDone").addEventListener("click", closeQuickRate);
    const rs = $("#qrRestart");
    if (rs) rs.addEventListener("click", () => {
      QuickRate.queue = q.filter(i => !i.rating);
      QuickRate.idx = 0;
      renderQuickRate();
    });
    return;
  }

  const i = q[QuickRate.idx];
  $("#qrProgress").textContent = `${QuickRate.idx + 1} / ${total}`;
  $("#qrBar").style.width = ((QuickRate.idx) / total * 100).toFixed(1) + "%";

  const meta = [i.type, i.releaseYear, seriesLabel(i)].filter(Boolean).join(" · ");

  body.innerHTML = `
    <div class="flex gap-4">
      ${i.poster
        ? `<img src="${i.poster}" class="w-24 rounded-lg object-cover self-start shadow-md" alt="">`
        : `<div class="w-24 aspect-[2/3] rounded-lg bg-slate-200 flex items-center justify-center text-slate-400"><i class="fa-solid fa-film text-2xl"></i></div>`}
      <div class="flex-1 min-w-0">
        <div class="font-bold text-slate-800 leading-snug">${esc(i.title)}</div>
        <div class="text-sm text-slate-500 font-medium mt-1">${esc(meta)}</div>
        ${fmtRange(i.startDate, i.endDate)
          ? `<div class="text-xs text-slate-500 font-medium mt-2">
               <i class="fa-solid fa-calendar-day mr-1 text-rose-400"></i>${fmtRange(i.startDate, i.endDate)}</div>` : ""}
        ${visibleGenres(i.genres).length
          ? `<div class="flex flex-wrap gap-1 mt-2">
               ${visibleGenres(i.genres).slice(0, 3).map(g => `<span class="badge badge-genre">${esc(g)}</span>`).join("")}</div>` : ""}
        ${i.voteAverage ? `<div class="mt-2"><span class="badge badge-vote"><i class="fa-solid fa-star mr-1"></i>${i.voteAverage}</span></div>` : ""}
      </div>
    </div>

    <div class="mt-5">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <i class="fa-solid fa-heart absolute left-3 top-1/2 -translate-y-1/2 text-rose-400"></i>
          <input type="number" id="qrInput" class="form-input pl-9 text-lg font-semibold" min="0" max="5" step="0.1"
            placeholder="0 ~ 5 (소수점 가능)" value="${i.rating || ""}" autocomplete="off">
        </div>
        <span class="text-sm font-semibold text-slate-400">/ 5</span>
      </div>
      <p class="text-xs text-slate-400 font-medium mt-2">
        <b>Enter</b>로 저장하고 다음 · 빈 칸으로 <b>Enter</b>면 건너뛰기 · <b>Esc</b>로 닫기
      </p>
    </div>

    <div class="flex items-center gap-2 mt-5 pt-4 border-t border-slate-100">
      <button id="qrPrev" class="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 ${QuickRate.idx === 0 ? "opacity-40 pointer-events-none" : ""}">
        <i class="fa-solid fa-arrow-left mr-1"></i>뒤로
      </button>
      <button id="qrSkip" class="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50">
        건너뛰기<i class="fa-solid fa-arrow-right ml-1"></i>
      </button>
      <div class="flex-1"></div>
      <span class="text-xs font-semibold text-slate-400">넣은 별점 ${QuickRate.done}개</span>
    </div>`;

  const input = $("#qrInput");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    quickRateSubmit();
  });
  $("#qrSkip").addEventListener("click", () => { QuickRate.idx++; renderQuickRate(); });
  $("#qrPrev").addEventListener("click", () => { QuickRate.idx = Math.max(0, QuickRate.idx - 1); renderQuickRate(); });

  input.focus();
  input.select();
}

/* Enter 처리: 값이 있으면 저장, 없으면 건너뛰기 */
function quickRateSubmit() {
  const item = QuickRate.queue[QuickRate.idx];
  const raw = parseFloat($("#qrInput").value);
  if (isFinite(raw) && raw > 0) {
    const v = Math.min(5, Math.round(raw * 10) / 10);
    const isNew = !item.rating;
    item.rating = v;
    if (isNew) QuickRate.done++;
    saveLocal();          // 저장은 매번. 서버 전송은 2.5초 디바운스가 묶어준다
  }
  QuickRate.idx++;
  renderQuickRate();
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
        // 시리즈 정보도 같이 들고 있어야 수정 저장 때 지워지지 않는다
        collectionId: i.collectionId || null, collectionName: i.collectionName || "",
        seriesNo: i.seriesNo || null, seriesTotal: i.seriesTotal || null,
        title: i.title, type: i.type, country: i.country
      };
      renderSelected(State.selectedTmdb);
      buildSeasonSelect(seasonListFor(i));
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
      collectionId: t.collectionId || null, collectionName: t.collectionName || "",
      seriesNo: t.seriesNo || null, seriesTotal: t.seriesTotal || null
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
  renderDiscover();   // 탐색 탭의 이어보기·추천·위시는 "이미 본 것"을 기준으로 걸러지므로 같이 갱신
}

function deleteItem() {
  if (!State.editingId) return;
  if (!confirm("정말 삭제하시겠습니까?")) return;
  State.items = State.items.filter(x => x.id !== State.editingId);
  saveLocal();
  closeEdit();
  applyFilters();
  renderDiscover();
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

  // 시청 기록 + 보고싶어요를 함께 갱신한다.
  // (위시는 "지금 어디서 볼 수 있나"가 곧 쓸모라 오히려 최신값이 더 필요하다)
  const targets = [
    ...State.items.filter(i => i.tmdbId).map(i => ({ obj: i, primary: i.type === "영화" ? "movie" : "tv" })),
    ...State.wishes.filter(w => w.tmdbId).map(w => ({ obj: w, primary: w.mediaType || "movie" }))
  ];
  if (!targets.length) { toast("갱신할 항목이 없습니다 (TMDB 연동된 항목만 대상)", "success"); return; }

  const wishN = State.wishes.filter(w => w.tmdbId).length;
  if (!confirm(`${targets.length - wishN}개 기록${wishN ? ` + 보고싶어요 ${wishN}개` : ""}의 ` +
               `OTT(스트리밍) 정보를 새로 조회합니다.`)) return;

  _enriching = true;
  const status = $("#enrichStatus");
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  let changed = 0, fail = 0;
  for (let n = 0; n < targets.length; n++) {
    const { obj: i, primary } = targets[n];
    status.textContent = `${n + 1} / ${targets.length} — ${i.title}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = ((n + 1) / targets.length * 100).toFixed(1) + "%";

    // 저장된 구분으로 movie/tv 추정, 비면 반대쪽도 시도 (애니 극장판 등 대비)
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
  renderDiscover();
  _enriching = false;
  markUpd("ott");
  status.textContent = `OTT 갱신 완료 — 변경 ${changed}개${fail ? `, 실패 ${fail}개` : ""}`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`OTT 정보 갱신 완료`, "success");
}

/* ---------- 시리즈 편 자동 재매칭 ----------
   "속편인데 1편 tmdbId를 물고 있는" 기록을 컬렉션의 해당 편으로 다시 연결한다.
   바꾸기 전에 바뀔 목록을 전부 보여주고 확인을 받는다. */
async function runAutoRematch() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  const targets = autoFixTargets();
  if (!targets.length) { toast("자동으로 고칠 항목이 없습니다", "success"); return; }

  const status = $("#enrichStatus");
  _enriching = true;

  // 1) 컬렉션에서 "그 번호의 영화"를 찾아 미리보기 목록을 만든다
  const plan = [];
  try {
    for (const t of targets) {
      const coll = await tmdbCollection(t.item.collectionId);
      const target = [...coll.order.entries()].find(([, no]) => no === t.want);
      if (!target) continue;
      const newId = target[0];
      if (newId === t.item.tmdbId) continue;         // 이미 맞음
      const d = await tmdbDetail(newId, "movie");
      plan.push({ item: t.item, want: t.want, detail: d });
      await new Promise(r => setTimeout(r, 220));
    }
  } catch (e) {
    _enriching = false;
    toast("조회 실패: " + e.message, "error");
    return;
  }

  if (!plan.length) { _enriching = false; toast("바꿀 항목이 없습니다", "success"); return; }

  // 2) 확인
  const lines = plan.map(p =>
    `· ${p.item.title} (${p.item.releaseYear || "?"})  →  ${p.detail.title} (${p.detail.releaseYear || "?"})`);
  const ok = confirm(
    `아래 ${plan.length}개를 올바른 편으로 다시 연결합니다.\n` +
    `제목·포스터·평점·러닝타임이 그 편 것으로 바뀝니다.\n` +
    `본 날짜·별점·한줄평 같은 내 기록은 그대로 유지됩니다.\n\n` +
    lines.join("\n")
  );
  if (!ok) { _enriching = false; toast("취소했습니다"); return; }

  // 3) 적용
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  let done = 0;
  for (let n = 0; n < plan.length; n++) {
    const p = plan[n];
    status.textContent = `${n + 1} / ${plan.length} — ${p.detail.title}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = ((n + 1) / plan.length * 100).toFixed(1) + "%";

    const d = p.detail;
    try {
      d.otts = await tmdbProviders(d.tmdbId, "movie");
      const coll = await tmdbCollection(d.collectionId || p.item.collectionId);
      Object.assign(p.item, {
        tmdbId: d.tmdbId, title: d.title || p.item.title,
        poster: d.poster, backdrop: d.backdrop,
        genres: d.genres, overview: d.overview,
        originalTitle: d.originalTitle,
        releaseDate: d.releaseDate, releaseYear: d.releaseYear,
        runtime: d.runtime, cert: d.cert, voteAverage: d.voteAverage,
        companies: d.companies, cast: d.cast, director: d.director,
        otts: d.otts || [],
        collectionId: d.collectionId || p.item.collectionId,
        collectionName: d.collectionName || p.item.collectionName,
        seriesNo: coll ? (coll.order.get(d.tmdbId) || p.want) : p.want,
        seriesTotal: coll ? coll.total : p.item.seriesTotal
      });
      done++;
    } catch { /* 실패한 항목은 건드리지 않고 넘어간다 */ }

    await new Promise(r => setTimeout(r, 220));
  }

  saveLocal();
  applyFilters();
  _enriching = false;
  markUpd("rematch");
  status.textContent = `재매칭 완료 — ${done}개 수정됨`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`${done}개를 올바른 편으로 연결했습니다`, "success");
}
window.runAutoRematch = runAutoRematch;

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
      i.seriesNo = null;
      i.seriesTotal = null;

      // 시리즈에 속하면 개봉일 순으로 "몇 번째 편"인지까지 채운다
      if (i.collectionId) {
        found++;
        try {
          const coll = await tmdbCollection(i.collectionId);
          i.seriesNo = coll.order.get(i.tmdbId) || null;
          i.seriesTotal = coll.total || null;
          if (coll.name) i.collectionName = coll.name;
          saveCollInfo(coll);        // 편별 개봉일·제목 저장 (탐색 탭 이어보기용)
        } catch { /* 편 번호만 실패해도 컬렉션 정보는 유지 */ }
      }
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
