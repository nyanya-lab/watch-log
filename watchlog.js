/* ============================================
   watchlog.js — 카드 목록, 필터, 등록/수정
   ============================================ */

/* 여러 개 고를 수 있는 필터. 값은 **배열**이고 빈 배열 = 전체 */
const MULTI = ["type", "country", "ott", "genre"];

/* 별점은 칸이 11개나 되고 "8점 이상" 같은 조회가 더 자연스러워서 **범위**로 받는다.
   내 별점과 TMDB 평점을 각각 둔다 — 카드에 나란히 보이는 두 점수라 따로 걸 수 있어야 한다.
   별점을 안 매긴 기록은 0으로 친다(기본 범위 0~10이면 그대로 다 보인다). */
const RANGE0 = { rMin: 0, rMax: 10, vMin: 0, vMax: 10 };

/* 정렬 기준마다 자연스러운 기본 방향이 다르다 — 날짜·별점은 높은(최근) 쪽, 제목은 가나다 */
const SORT_DIR0 = { date: "desc", title: "asc", rating: "desc", vote: "desc" };

const Filters = {
  q: "", type: [], country: [], ott: [], genre: [],
  rMin: 0, rMax: 10,                // 내 별점 범위
  vMin: 0, vMax: 10,                // TMDB 평점 범위
  year: "",                         // 연도는 해마다 늘어나 칩으로 두기 어렵다 (드롭다운 유지)
  person: "",                       // 배우/감독 (배지 클릭 전용)
  sort: "date", sortDir: "desc", pendingOnly: false,
  noSeasonOnly: false,              // 시즌이 여러 개인데 시즌을 기록 안 한 항목만
  engNameOnly: false,               // 배우·감독 이름이 영문으로 남은 항목만
  dupOnly: false,                   // 제목이 다른데 tmdbId가 같은 항목만 (매칭 오류 의심)
  group: "",                        // 시리즈 모아보기에서 고른 그룹 키
  seriesView: false                 // 목록 자리에 시리즈 카드를 보여주는 모드
};

/* 시즌이 2개 이상인 작품인데 season이 비어 있는 항목 (기록 누락) */
function needsSeason(i) {
  return !i.season && (i.totalSeasons || 0) > 1;
}

/* 배우·감독 이름이 아직 영문인 항목.
   **한글 표기가 없다고 확인된 사람(캐시값 "")은 세지 않는다** — 외국 배우가 대부분이라
   그대로 세면 이 숫자가 영원히 0이 되지 않아 잔소리만 된다.
   캐시는 applyFilters에서 한 번만 읽어 State._personKo에 담는다(항목마다 파싱하면 느리다). */
function needsKoName(i) {
  if (!i.tmdbId) return false;
  const cache = State._personKo || {};
  const settled = (k) => Object.prototype.hasOwnProperty.call(cache, k) && cache[k] === "";
  const bad = (name, id) => {
    if (!name || HANGUL.test(name)) return false;
    if (id && settled(id)) return false;        // id로 "한글 표기 없음" 확인됨
    if (settled(nameKey(name))) return false;   // id를 못 구했지만 이름으로 확인됨
    return true;
  };
  if (bad(i.director, i.directorId)) return true;
  return (i.cast || []).some(c => bad(c.name, c.id));
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
  $("#pullBtn").addEventListener("click", manualPull);

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

  /* 칩은 열 때마다 다시 그리므로 위임으로 받는다 */
  $("#filterModal").addEventListener("click", e => {
    const chip = e.target.closest(".fchip");
    if (!chip) return;
    const fkey = chip.dataset.fkey, fval = chip.dataset.fval;

    if (fkey === "sort") {
      // 같은 칩을 다시 누르면 방향만 뒤집는다
      if (Filters.sort === fval) Filters.sortDir = Filters.sortDir === "asc" ? "desc" : "asc";
      else { Filters.sort = fval; Filters.sortDir = SORT_DIR0[fval] || "desc"; }
    } else if (fval === "") {
      Filters[fkey] = [];                     // 각 줄 맨 앞 [전체] = 그 줄 해제
    } else {
      const cur = Filters[fkey];
      Filters[fkey] = cur.includes(fval) ? cur.filter(v => v !== fval) : cur.concat([fval]);
    }
    applyFilters();
    buildFilterOptions();
  });

  /* 별점 범위 — 비우면 양 끝값으로 되돌린다 (빈 칸이 "제한 없음"이 되게) */
  ["rMin", "rMax", "vMin", "vMax"].forEach(k => {
    const el = $("#f_" + k);
    if (!el) return;
    el.addEventListener("input", () => {
      const raw = parseFloat(el.value);
      Filters[k] = isFinite(raw) ? Math.min(10, Math.max(0, raw)) : RANGE0[k];
      applyFilters();
      const pv = $("#filterPreview");
      if (pv) pv.textContent = `${State.filtered.length}개 표시`;
    });
  });

  $("#filterYear").addEventListener("change", () => {
    Filters.year = $("#filterYear").value;
    applyFilters();
    buildFilterOptions();
  });

  $("#resetFilter").addEventListener("click", () => {
    MULTI.forEach(k => { Filters[k] = []; });
    Object.assign(Filters, RANGE0, { year: "", sort: "date", sortDir: "desc" });
    applyFilters();
    buildFilterOptions();
  });

  /* 유지보수 칩 토글 — 서로 배타적으로 켜진다 (하나 켜면 나머지는 꺼짐) */
  const EXCLUSIVE = ["pendingOnly", "noSeasonOnly", "engNameOnly", "dupOnly"];
  const toggleOnly = (key) => {
    const on = !Filters[key];
    EXCLUSIVE.forEach(k => { Filters[k] = false; });
    Filters[key] = on;
    applyFilters();
  };
  $("#pendingBtn").addEventListener("click", () => toggleOnly("pendingOnly"));
  $("#noSeasonBtn").addEventListener("click", () => toggleOnly("noSeasonOnly"));
  $("#engNameBtn").addEventListener("click", () => toggleOnly("engNameOnly"));
  $("#dupBtn").addEventListener("click", () => toggleOnly("dupOnly"));
  $("#nameFixBtn").addEventListener("click", () => runFixNames(State.filtered));

  /* 별점 몰아넣기 */
  $("#quickRateBtn").addEventListener("click", openQuickRate);
  $("#qrClose").addEventListener("click", closeQuickRate);
  $("#quickRateModal").addEventListener("click", e => { if (e.target.id === "quickRateModal") closeQuickRate(); });

  $("#loadMoreBtn").addEventListener("click", () => { State.page++; renderCards(); });

  /* 별점 (숫자 입력, 10점 만점 소수 가능) */
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

  /* 영화관 / 기타 체크박스 — `ott`는 값이 하나뿐이라 둘 중 하나만 켜진다.
     둘 다 끄면 "직접 적을 게 없음"이고, 스트리밍 목록은 TMDB(`otts`)가 채운다. */
  $("#fTheater").addEventListener("change", e => {
    if (e.target.checked) $("#fOttEtc").checked = false;
    syncOttFields();
  });
  $("#fOttEtc").addEventListener("change", e => {
    if (e.target.checked) $("#fTheater").checked = false;
    syncOttFields();
    if (e.target.checked) $("#fOtt").focus();
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

/* 체크 상태에 맞춰 기타 입력칸을 보이거나 감춘다.
   기타를 끄면 값도 비운다 — 안 비우면 **안 보이는 칸의 값이 그대로 저장된다.**
   예전 기본값 "넷플릭스" 사고가 바로 그 구조였다. */
function syncOttFields() {
  const etc = $("#fOttEtc").checked;
  $("#ottWrap").classList.toggle("hidden", !etc);
  if (!etc) $("#fOtt").value = "";
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
    sel.onchange = () => {
      $("#fSeason").value = sel.value;
      // 고른 시즌의 포스터·연도·화수가 정보 카드에 바로 보이게 (저장되는 값도 그것이다)
      if (State.selectedTmdb) renderSelected(State.selectedTmdb);
    };
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

  /* 값 칩 한 줄. 맨 앞 [전체]는 아무것도 안 고른 상태를 뜻하고, 누르면 그 줄이 풀린다 */
  const chips = (boxId, fkey, values, label) => {
    const box = $("#" + boxId);
    if (!box) return;
    const on = Filters[fkey];
    box.innerHTML =
      `<button class="fchip ${on.length ? "" : "on"}" data-fkey="${fkey}" data-fval="">전체</button>` +
      values.map(v => `<button class="fchip ${on.includes(String(v)) ? "on" : ""}"
        data-fkey="${fkey}" data-fval="${esc(v)}">${esc(label ? label(v) : v)}</button>`).join("");
  };

  chips("fcType", "type", uniq(State.items.map(i => i.type)));
  chips("fcCountry", "country", uniq(State.items.map(i => i.country)));
  chips("fcOtt", "ott", uniq(State.items.flatMap(i => ottList(i))));
  chips("fcGenre", "genre", uniq(State.items.flatMap(i => visibleGenres(i.genres))));

  ["rMin", "rMax", "vMin", "vMax"].forEach(k => {
    const el = $("#f_" + k);
    if (el && document.activeElement !== el) el.value = Filters[k];   // 입력 중인 칸은 건드리지 않는다
  });

  const arrow = (k) => Filters.sort === k
    ? `<span class="fdir">${Filters.sortDir === "asc" ? "↑" : "↓"}</span>` : "";
  const sorts = [["date", "본 날짜"], ["title", "가나다"], ["rating", "♥ 내 별점"], ["vote", "★ TMDB 평점"]];
  $("#fcSort").innerHTML = sorts.map(pair =>
    `<button class="fchip ${Filters.sort === pair[0] ? "on" : ""}" data-fkey="sort" data-fval="${pair[0]}">${pair[1]}${arrow(pair[0])}</button>`).join("");

  const ysel = $("#filterYear");
  if (ysel) {
    ysel.innerHTML = `<option value="">전체</option>` +
      uniq(State.items.map(i => (i.startDate || "").slice(0, 4))).reverse()
        .map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    ysel.value = Filters.year;
  }

  const pv = $("#filterPreview");
  if (pv) pv.textContent = `${State.filtered.length}개 표시`;
}

function hasActiveFilter() {
  const ranged = Object.keys(RANGE0).some(k => Filters[k] !== RANGE0[k]);
  return !!(MULTI.some(k => Filters[k].length) || ranged || Filters.year || Filters.person ||
            Filters.q || Filters.pendingOnly || Filters.noSeasonOnly || Filters.engNameOnly ||
            Filters.dupOnly || Filters.group ||
            Filters.seriesView ||
            Filters.sort !== "date" || Filters.sortDir !== "desc");
}

/* 모든 필터 해제 (검색어·미등록 토글 포함) */
function clearAllFilters() {
  MULTI.forEach(k => { Filters[k] = []; });
  Object.assign(Filters, RANGE0, {
    q: "", year: "", person: "", sort: "date", sortDir: "desc",
    pendingOnly: false, noSeasonOnly: false, engNameOnly: false, dupOnly: false,
    group: "", seriesView: false
  });
  const s = $("#searchInput"); if (s) s.value = "";
  applyFilters();
}

/* 통계 차트 클릭 → 해당 조건으로 목록 탭 조회 */
function jumpToList(patch) {
  const backup = { ...Filters };
  /* 차트는 `{genre:"액션"}`처럼 값 하나를 넘긴다 — 다중 선택 필터는 배열이라 감싸준다 */
  const norm = {};
  Object.entries(patch || {}).forEach(pair => {
    const k = pair[0], v = pair[1];
    norm[k] = (MULTI.indexOf(k) >= 0 && !Array.isArray(v)) ? [String(v)] : v;
  });
  const cleared = {};
  MULTI.forEach(k => { cleared[k] = []; });
  Object.assign(Filters, cleared, RANGE0,
    { year: "", person: "", pendingOnly: false, noSeasonOnly: false, engNameOnly: false, dupOnly: false, group: "", seriesView: false },
    norm);
  applyFilters();

  if (State.filtered.length === 0) {   // 조회 결과 없으면(예: '기타' 집계) 원복
    Object.assign(Filters, backup);
    applyFilters();
    toast("조회할 항목이 없습니다");
    return;
  }

  buildFilterOptions();      // 필터 모달의 칩·연도 상태를 맞춰둔다

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
  State._personKo = getPersonCache(); // 이름 판별용 캐시도 한 번만 읽는다
  let list = State.items.filter(i => {
    if (F.pendingOnly && i.tmdbId) return false;
    if (F.noSeasonOnly && !needsSeason(i)) return false;
    if (F.engNameOnly && !needsKoName(i)) return false;
    if (F.dupOnly && !isDupTmdb(i)) return false;
    if (F.group && groupKeyOf(i) !== F.group) return false;
    if (F.q && !matchesQuery(i, F.q)) return false;
    /* 다중 선택: 고른 게 없으면 통과, 있으면 그중 하나라도 맞아야 한다 */
    if (F.type.length && !F.type.includes(i.type)) return false;
    if (F.country.length && !F.country.includes(i.country)) return false;
    if (F.ott.length && !ottList(i).some(o => F.ott.includes(o))) return false;
    if (F.year && (i.startDate || "").slice(0, 4) !== F.year) return false;
    if (F.genre.length && !visibleGenres(i.genres).some(g => F.genre.includes(g))) return false;
    /* 별점 범위. 안 매긴 기록은 0으로 쳐서 기본 범위(0~10)에는 그대로 들어온다 */
    const myR = i.rating || 0;
    if (myR < F.rMin || myR > F.rMax) return false;
    const tmR = i.voteAverage || 0;
    if (tmR < F.vMin || tmR > F.vMax) return false;
    if (F.person && !(i.director === F.person || (i.cast || []).some(c => c.name === F.person))) return false;
    return true;
  });

  /* 정렬용 날짜. 본 날짜가 없으면 개봉/방영일로 대신한다 —
     `0000-00-00`으로 두면 날짜 없는 기록이 전부 목록 맨 끝에 몰린다.
     **데이터에는 쓰지 않는다.** startDate에 개봉일을 넣으면 히트맵·월별 통계·올해 시청이
     "본 적 없는 해"에 잡히고, 어느 게 진짜 기억인지 구분할 수 없게 된다. */
  const dkey = (i) => i.lastWatchStart || i.startDate || i.releaseDate ||
                      (i.releaseYear ? i.releaseYear + "-01-01" : "0000-00-00");
  const CMP = {
    date: (a, b) => dkey(a).localeCompare(dkey(b)),
    title: (a, b) => (a.title || "").localeCompare(b.title || "", "ko"),
    rating: (a, b) => (a.rating || 0) - (b.rating || 0),
    vote: (a, b) => (a.voteAverage || 0) - (b.voteAverage || 0)
  };
  const base = CMP[F.sort] || CMP.date;
  const sgn = F.sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => sgn * base(a, b));

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

  // 이름 영문 칩 (0개면 숨김). 한글 표기가 없다고 확인된 사람은 세지 않으므로
  // 한 번 정리하고 나면 자연스럽게 0이 된다.
  const engName = State.items.filter(needsKoName).length;
  const eb = $("#engNameBtn");
  if (eb) {
    if (Filters.engNameOnly) {
      eb.className = "wl-chip wl-chip-name on";
      eb.innerHTML = `<i class="fa-solid fa-xmark"></i>이름 영문 ${engName}개 보는 중`;
    } else {
      eb.className = "wl-chip wl-chip-name";
      eb.innerHTML = `<i class="fa-solid fa-language"></i>이름 영문 ${engName}개`;
    }
    eb.classList.toggle("hidden", engName === 0 && !Filters.engNameOnly);
  }

  // 이름 영문 목록을 볼 때만 뜨는 안내바
  const nameBar = $("#nameFixBar");
  if (nameBar) {
    const show = Filters.engNameOnly && engName > 0;
    nameBar.classList.toggle("hidden", !show);
    if (show) {
      $("#nameFixMsg").innerHTML =
        `<i class="fa-solid fa-circle-info mr-1"></i>TMDB에서 <b>한글 표기</b>를 찾아 바꿉니다.
         한글 표기가 없는 사람(주로 외국 배우)은 그대로 두고 다시 세지 않아요.`;
    }
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
    sb.className = Filters.seriesView ? "btn-icon on" : "btn-icon";
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

  /* 시리즈 전체를 포스터로 그릴 수 있는 경우 — 영화는 TMDB 컬렉션, TV는 시즌이 2개 이상.
     그릴 수 있으면 아래 "다른 편" 배지 줄은 그리지 않는다 (같은 걸 두 번 보일 이유가 없다).
     **영화는 편 목록이 이미 캐시에 있으면 API 키가 없어도 그린다** — 조회할 게 없기 때문. */
  const hasParts = !!i.tmdbId && (mediaTypeOf(i) === "movie"
    ? !!i.collectionId && (!!getTmdbKey() || !!(getCollCache()[i.collectionId] || {}).parts)
    : (i.totalSeasons || 0) > 1 && !!getTmdbKey());

  /* ---- 내 기록 블록 ----
     별점·본 날짜·한줄평은 이 앱에서 유일하게 "내가 만든" 정보다.
     예전에는 TMDB 정보(방영일·제작사)와 똑같은 label-value 줄로 섞여 있어 구분이 안 됐다.
     하나의 면으로 묶고 맨 위에 두어, 모달을 열면 이게 먼저 읽히게 한다. */
  const mineHtml = `
    <div class="dt-mine">
      <div class="dt-mine-top">
        ${i.rating
          ? `<div class="dt-rate">${hearts(i.rating, true)}<span class="dt-rate-max">/ 10</span></div>`
          : `<button class="dt-rate-empty" onclick="document.getElementById('detailModal').classList.add('hidden'); openEdit('${i.id}')">
               <i class="fa-regular fa-heart"></i>별점 매기기</button>`}
        <div class="dt-when">
          <div class="dt-when-main">${fmtRange(i.startDate, i.endDate) || "본 날짜 없음"}</div>
          <div class="dt-when-sub">
            ${(i.watchCount || 1) > 1 ? `${i.watchCount}번 봄` : "처음 본 날"}
            ${i.lastWatchStart ? ` · 마지막 ${fmtRange(i.lastWatchStart, i.lastWatchEnd)}` : ""}
          </div>
        </div>
      </div>
      ${i.review && i.review.trim()
        ? `<p class="dt-review">${esc(i.review)}</p>` : ""}
    </div>`;

  /* 관람등급: 숫자만 저장돼 있어(15, 12, 19...) 회차와 헷갈리므로 "15세"로 풀어서 제목 옆에 표시 */
  const certLabel = (c) => {
    if (!c) return "";
    const s = String(c).trim();
    if (/^\d+$/.test(s)) return s + "세";
    if (/^all$/i.test(s)) return "전체";
    return s;
  };

  /* 작품 정보는 배지 대신 가운뎃점 텍스트 한 줄로 (카드에서 쓴 방식과 같다).
     배지 9개가 세 줄로 흩어져 있던 게 "평평함"의 큰 원인이었다. */
  const factLine = [
    i.type,
    i.country,
    ...visibleGenres(i.genres),
    i.runtime ? `${i.runtime}분` : "",
    i.totalEpisodes ? `총 ${i.totalEpisodes}화` : "",
    (i.releaseDate ? fmtDate(i.releaseDate) : i.releaseYear) || ""
  ].filter(Boolean).join(" · ");

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
    ? `<div class="dt-sec">
         <div class="dt-sec-h"><i class="fa-solid fa-users mr-1 text-pink-400"></i>출연진</div>
         <div class="flex flex-wrap gap-1.5">
           ${i.cast.map(c => personBadge(c.name, "badge-cast", c.character ? c.character + " · " : "")).join("")}
         </div>
         ${directorHtml}
       </div>`
    : (i.director ? `<div class="dt-sec">${directorHtml}</div>` : "");

  const header = i.backdrop
    ? `<div class="relative h-32 bg-cover bg-center" style="background-image:url('${i.backdrop}')">
         <div class="absolute inset-0" style="background:linear-gradient(to top,rgba(255,255,255,1),rgba(255,255,255,0.1))"></div>
         <button onclick="document.getElementById('detailModal').classList.add('hidden')"
           class="modal-x absolute top-3 right-3" style="background:rgba(255,255,255,.85)"><i class="fa-solid fa-xmark"></i></button>
       </div>`
    : `<div class="modal-head">
         <h3 class="font-semibold text-slate-800">상세 정보</h3>
         <button onclick="document.getElementById('detailModal').classList.add('hidden')"
           class="modal-x"><i class="fa-solid fa-xmark"></i></button>
       </div>`;

  $("#detailContent").innerHTML = `
    ${header}
    <div class="p-5 ${i.backdrop ? "-mt-12 relative" : ""}">
      <div class="flex gap-4 mb-4">
        ${i.poster
          ? `<img src="${i.poster}" class="w-24 rounded-lg object-cover self-start" alt="">`
          : `<div class="w-24 aspect-[2/3] rounded-lg bg-slate-200 flex items-center justify-center text-slate-400"><i class="fa-solid fa-film text-2xl"></i></div>`}
        <div class="flex-1 min-w-0 ${i.backdrop ? "pt-12" : ""}">
          <h4 class="dt-title">
            ${esc(i.title)}
            ${i.cert ? `<span class="badge badge-cert align-middle ml-1">${esc(certLabel(i.cert))}</span>` : ""}
          </h4>
          ${i.originalTitle && i.originalTitle !== i.title ? `<div class="dt-orig">${esc(i.originalTitle)}</div>` : ""}
          <div class="dt-facts">${esc(factLine)}</div>
          <div class="flex flex-wrap gap-1 mt-2">
            ${seriesLabel(i) ? `<span class="badge badge-season">
              ${i.collectionId ? `<i class="fa-solid fa-layer-group mr-1"></i>` : ""}${seriesLabel(i)}${i.seriesTotal ? ` <span class="opacity-70 ml-1">/ 총 ${i.seriesTotal}편</span>` : ""}
            </span>` : ""}
            ${i.ott ? `<span class="badge badge-ott"><i class="fa-solid ${i.ott === "영화관" ? "fa-film" : "fa-user-check"} mr-1"></i>${esc(i.ott)}</span>` : ""}
            ${i.voteAverage ? `<span class="badge badge-vote"><i class="fa-solid fa-star mr-1"></i>${i.voteAverage}</span>` : ""}
          </div>
        </div>
      </div>

      ${mineHtml}

      ${i.overview ? `<div class="dt-sec">
        <p class="dt-overview" id="dtOverview">${esc(i.overview)}</p>
        <button class="dt-more" onclick="this.previousElementSibling.classList.toggle('open');
          this.textContent = this.previousElementSibling.classList.contains('open') ? '접기' : '더 보기';">더 보기</button>
      </div>` : ""}

      ${castHtml}

      ${(i.companies || []).length ? `<div class="dt-sec">
        <div class="dt-sec-h"><i class="fa-solid fa-building mr-1 text-slate-400"></i>제작사</div>
        <div class="dt-facts" style="margin-top:0">${esc(i.companies.join(" · "))}</div>
      </div>` : ""}

      <!-- 시리즈 전체를 포스터로 (안 본 편까지). 못 그리는 경우에만 아래 배지 줄로 물러난다 -->
      <div id="dtParts"></div>
      ${siblings.length && !hasParts ? `<div class="dt-sec">
        <div class="dt-sec-h">
          <i class="fa-solid fa-layer-group mr-1 text-amber-400"></i>이 시리즈의 다른 편 ${siblings.length}개
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${siblings.map(s => `<span class="badge badge-season badge-link" onclick="openDetail('${s.id}')">
            ${seriesLabel(s) || esc(s.title)}${s.releaseYear ? ` <span class="opacity-70 ml-1">${s.releaseYear}</span>` : ""}
          </span>`).join("")}
        </div>
      </div>` : ""}

      <div id="dtWatch"></div>
    </div>
    <div class="modal-foot">
      ${i.tmdbId ? `<button onclick="refreshTmdbInDetail(this, '${i.id}')" class="btn btn-ghost"
        title="매칭은 그대로 두고 OTT·평점·시즌 정보만 다시 받아옵니다">
        <i class="fa-solid fa-rotate mr-1"></i>OTT·평점 갱신</button>` : ""}
      <div class="flex-1"></div>
      <button onclick="document.getElementById('detailModal').classList.add('hidden'); openEdit('${i.id}')"
        class="btn btn-primary">
        <i class="fa-solid fa-pen mr-1"></i>수정</button>
    </div>`;

  $("#detailModal").classList.remove("hidden");
  /* 저장된 `otts`는 등록 시점 값이라 시간이 지나면 어긋난다. 열자마자 지금 값을 받아 아래에 붙인다 */
  renderWatchInto($("#dtWatch"), i.tmdbId, mediaTypeOf(i), i.title);
  if (hasParts) renderPartsInto($("#dtParts"), i);
}

/* ---------- 상세: 이 시리즈를 포스터로 (안 본 편까지) ----------
   예전엔 **내 기록에 있는 편만** 작은 배지로 나왔다. 그래서 "3편 중 뭘 안 봤나"가 안 보였고,
   포스터가 있는데도 글자만 보였다. 영화는 TMDB 컬렉션의 편 목록, TV는 시즌 목록을 받아
   내 기록을 겹쳐 그린다 — 탐색 탭의 "이어보기"가 하는 일을 그 작품 안에서 보여주는 셈이다.

   `renderWatchInto`와 같은 이유로 늦게 온 응답이 다음 작품 화면을 덮지 않게 순번을 둔다. */
async function renderPartsInto(box, i) {
  if (!box || !i.tmdbId) return;
  const isMovie = mediaTypeOf(i) === "movie";
  if (!isMovie && !getTmdbKey()) return;      // TV 시즌은 받아와야만 알 수 있다

  const my = String(Date.now()) + ":" + Math.random();
  box.dataset.req = my;
  box.innerHTML = `<div class="dt-sec"><div class="dt-sec-h">
    <i class="fa-solid fa-spinner fa-spin mr-1 text-amber-400"></i>시리즈 정보 불러오는 중...</div></div>`;

  const today = new Date().toISOString().slice(0, 10);
  try {
    let parts, title;
    if (isMovie) {
      /* 편 목록은 이미 받아둔 게 대부분이다(이어보기·시리즈 보기가 쓰는 캐시). 없으면 1회만 조회. */
      let info = getCollCache()[i.collectionId];
      if (!info || !info.parts) { info = await tmdbCollection(i.collectionId); saveCollInfo(info); }
      title = info.name || i.collectionName || "";
      parts = info.parts.map(p => ({
        no: p.no, tmdbId: p.tmdbId, title: p.title, poster: p.poster,
        date: p.releaseDate, year: (p.releaseDate || "").slice(0, 4)
      }));
    } else {
      const d = await tmdbDetail(i.tmdbId, "tv");
      title = i.title;
      parts = (d.seasons || []).map(s => ({
        no: s.number, tmdbId: i.tmdbId, title: s.name, poster: s.poster,
        date: s.airDate, year: s.year, episodes: s.episodes
      }));
    }
    if (box.dataset.req !== my) return;              // 그 사이 다른 작품이 열렸다
    if (!parts || parts.length < 2) { box.innerHTML = ""; return; }

    /* 내 기록을 겹친다. 영화는 **tmdbId와 편 번호 둘 다**로 본다 — 속편이 1편의 tmdbId를
       물고 있는 기록이 있으면 tmdbId만으로는 실제로 본 편을 "안 봤다"고 잘못 잡는다. */
    const mine = isMovie
      ? State.items.filter(x => x.collectionId === i.collectionId)
      : State.items.filter(x => x.tmdbId === i.tmdbId);
    const numOf = (x) => x.seriesNo || parseInt(String(x.season || "").replace(/\D/g, "")) || 0;
    const recOf = (p) => mine.find(x => numOf(x) === p.no)
                      || (isMovie ? mine.find(x => x.tmdbId === p.tmdbId && !numOf(x)) : null);

    const seen = parts.filter(p => recOf(p)).length;
    const soon = parts.filter(p => p.date && p.date > today).length;

    const cells = parts.map(p => {
      const rec = recOf(p);
      const upcoming = !rec && p.date && p.date > today;
      /* 안 본 편은 눌러서 바로 등록으로 간다 (TV는 시즌까지 미리 골라준다).
         미개봉은 아직 볼 수 없으니 누를 게 없다. */
      const act = rec ? `openDetail('${rec.id}')`
        : upcoming ? ""
        : `document.getElementById('detailModal').classList.add('hidden');`
          + `addFromDiscover(${p.tmdbId},'${isMovie ? "movie" : "tv"}'${isMovie ? "" : `,'S${p.no}'`})`;
      const mark = rec
        ? (rec.rating ? `<span class="dt-part-mark seen">${hearts(rec.rating)}</span>`
                      : `<span class="dt-part-mark seen"><i class="fa-solid fa-check"></i></span>`)
        : upcoming ? `<span class="dt-part-mark soon">미개봉</span>`
                   : `<span class="dt-part-mark miss">안 봄</span>`;
      return `
        <button class="dt-part${rec ? "" : upcoming ? " is-soon" : " is-miss"}"
                ${act ? `onclick="${act}"` : "disabled"}>
          <div class="dt-part-img">
            ${p.poster ? `<img src="${esc(p.poster)}" alt="" loading="lazy">`
                       : `<div class="dt-part-none"><i class="fa-solid fa-image"></i></div>`}
            <span class="dt-part-no">S${p.no}</span>
            ${mark}
          </div>
          <div class="dt-part-t">${esc(p.title || "")}</div>
          <div class="dt-part-y">${esc(p.year || "")}${p.episodes ? ` · ${p.episodes}화` : ""}</div>
        </button>`;
    }).join("");

    box.innerHTML = `<div class="dt-sec">
      <div class="dt-sec-h">
        <i class="fa-solid fa-layer-group mr-1 text-amber-400"></i>
        ${esc(title || "이 시리즈")} · 총 ${parts.length}${isMovie ? "편" : "시즌"}
        <span class="dt-part-sum">본 것 ${seen} · 안 본 것 ${parts.length - seen - soon}${soon ? ` · 미개봉 ${soon}` : ""}</span>
      </div>
      <div class="dt-parts">${cells}</div>
    </div>`;
  } catch {
    /* 시리즈 정보는 없어도 상세는 멀쩡하다 — 조용히 비운다 */
    if (box.dataset.req === my) box.innerHTML = "";
  }
}

/* ---------- 상세에서 TMDB 정보 새로 받기 ----------
   포스터·평점·OTT·출연진은 시간이 지나면 바뀌는데 저장된 값은 등록 시점 그대로다.
   여기서는 **바로 갱신하고 저장한다**(사용자 선택) — 별점·본 날짜·한줄평·시청 횟수·시즌 같은
   내 기록은 건드리지 않는다. 되돌리려면 콘솔 `restoreBackup()`. */
/* ⚠ TMDB는 영화와 TV가 **완전히 다른 id 공간**이다 — `movie/12345`와 `tv/12345`는 남남이다.
   그런데 기록에는 media_type이 없고 구분(`type`)만 있어서, "애니"·"다큐"·"예능"을 전부 tv로 넘기면
   **같은 번호의 엉뚱한 TV 시리즈**를 받아온다. 실제로 그걸 저장해 기록이 다른 작품이 된 사고가 났다.

   그래서 받아온 게 이 기록과 같은 작품인지 확인한다. 원제·제목·개봉연도 중 하나라도 맞아야 한다. */
function sameWork(i, d) {
  if (!d) return false;
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
  const t = norm(i.title), ot = norm(i.originalTitle);
  const dt = norm(d.title), dot = norm(d.originalTitle);
  if (ot && dot && ot === dot) return true;
  if (t && dt && t === dt) return true;
  // 제목이 달라도(속편을 직접 고쳐 적은 경우 등) 원제나 개봉연도가 맞으면 같은 작품으로 본다
  const y = (i.releaseDate || "").slice(0, 4), dy = (d.releaseDate || "").slice(0, 4);
  if (y && dy && y === dy && (ot && dot ? ot === dot : true) && (t.slice(0, 2) === dt.slice(0, 2))) return true;
  return false;
}

async function refreshTmdbInDetail(btn, itemId) {
  const i = State.items.find(x => x.id === itemId);
  if (!i || !i.tmdbId) return;
  if (!getTmdbKey()) { toast("설정 탭에서 TMDB API 키를 먼저 저장하세요", "error"); return; }

  /* 저장된 mediaType이 있으면 그걸 쓰고, 없으면 구분으로 짐작하되 **결과를 반드시 확인**한다 */
  let mediaType = mediaTypeOf(i);
  const before = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>갱신 중...`;
  try {
    let d = await tmdbDetail(i.tmdbId, mediaType).catch(() => null);

    // 짐작이 틀렸을 수 있으니 반대쪽도 본다
    if (!sameWork(i, d)) {
      const other = mediaType === "movie" ? "tv" : "movie";
      const d2 = await tmdbDetail(i.tmdbId, other).catch(() => null);
      if (sameWork(i, d2)) { d = d2; mediaType = other; }
    }

    /* 둘 다 달라 보이면 **뭐가 올지 보여주고 물어본다.** 진짜 엉뚱한 작품일 수도 있지만,
       제목을 많이 고쳐 적어서 비교가 실패한 것일 수도 있다 — 그건 내가 막을 게 아니라 볼 일이다. */
    if (!sameWork(i, d)) {
      const line = (t, y) => `${t || "(제목 없음)"}${y ? ` (${y})` : ""}`;
      const ok = d && confirm(
        `받아온 정보가 이 기록과 달라 보입니다.\n\n` +
        `이 기록:  ${line(i.title, i.releaseYear)}\n` +
        `TMDB:     ${line(d.title, d.releaseYear)}\n\n` +
        `그대로 갱신할까요? (아니면 수정창에서 다시 연결하세요)`
      );
      if (!ok) {
        btn.disabled = false;
        btn.innerHTML = before;
        toast(d ? "취소했습니다" : "TMDB에서 이 작품을 찾지 못했어요", d ? "info" : "error");
        return;
      }
    }

    i.mediaType = mediaType;          // 다음부터는 짐작하지 않아도 되게 남긴다
    d.otts = await tmdbProviders(i.tmdbId, mediaType);
    /* ⚠ **매칭은 절대 건드리지 않는다.** 갱신하는 건 시간이 지나면 실제로 바뀌는 값뿐이다:
       OTT·평점·시즌/화수. 제목·구분·국가·포스터·줄거리·출연진, 그리고 컬렉션과 시리즈 번호는
       그대로 둔다 — 전부 손으로 맞춰둘 수 있는 값이고, 덮으면 맞춰둔 게 TMDB 기준으로 되돌아간다.
       (제목만 막았을 때도 컬렉션·시리즈 번호가 되돌아가 매칭이 흐트러졌다.) */
    Object.assign(i, {
      otts: d.otts || [],
      voteAverage: d.voteAverage,
      totalSeasons: d.totalSeasons,
      totalEpisodes: d.totalEpisodes
    });

    saveLocal();
    applyFilters();
    renderDiscover();
    openDetail(i.id);              // 갱신된 값으로 상세를 다시 그린다
    toast("OTT·평점을 새로 받았습니다", "success");
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = before;
    toast("갱신 실패: " + e.message, "error");
  }
}

/* ---------- 별점 (숫자 입력) ---------- */
function readRating() {
  const v = parseFloat($("#fRating").value);
  if (!isFinite(v) || v <= 0) return null;
  return Math.min(10, Math.round(v * 10) / 10);  // 10점 만점, 소수 첫째자리까지
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
          ${left ? `<button id="qrRestart" class="btn btn-ghost">
            <i class="fa-solid fa-rotate-left mr-1"></i>건너뛴 것 다시 보기</button>` : ""}
          <button id="qrDone" class="btn btn-primary">닫기</button>
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
        <!-- 줄거리는 3줄까지만. 여기선 "이게 뭐였더라"를 떠올리는 게 목적이라 다 읽을 필요가 없고,
             길면 카드가 밀려 입력칸이 화면 밖으로 나간다. -->
        ${i.overview
          ? `<div class="text-xs text-slate-500 font-medium mt-2 leading-relaxed line-clamp-3">${esc(i.overview)}</div>` : ""}
        <!-- TMDB 평점은 일부러 안 보여준다 — 남의 점수가 눈에 있으면 내 점수가 그쪽으로 끌려간다.
             여기서 받아야 하는 건 "내가 어떻게 봤나"지 "평균이 몇 점인가"가 아니다. -->
      </div>
    </div>

    <div class="mt-5">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <i class="fa-solid fa-heart absolute left-3 top-1/2 -translate-y-1/2 text-rose-400"></i>
          <input type="number" id="qrInput" class="form-input pl-9 text-lg font-semibold" min="0" max="10" step="0.1"
            placeholder="0 ~ 10 (소수점 가능)" value="${i.rating || ""}" autocomplete="off">
        </div>
        <span class="text-sm font-semibold text-slate-400">/ 10</span>
      </div>
      <p class="text-xs text-slate-400 font-medium mt-2">
        <b>Enter</b>로 저장하고 다음 · 빈 칸으로 <b>Enter</b>면 건너뛰기 · <b>Esc</b>로 닫기
      </p>
      <!-- 기억이 안 날 때를 위한 도움닫기. 점수를 **미리 보여주지는 않는다** — 눌러야 칸에 들어온다.
           평소에 보이면 내 점수가 그쪽으로 끌려가지만, 눌러서 가져오는 건 내가 고른 것이라 다르다.
           바로 저장하지 않고 입력칸에만 채워서, 보고 조정한 뒤 Enter를 치게 한다. -->
      ${i.voteAverage ? `<button id="qrUseTmdb" class="btn btn-sm btn-ghost mt-2.5">
        <i class="fa-solid fa-star mr-1 text-amber-400"></i>기억이 안 나요 — TMDB 평점 가져오기
      </button>` : ""}
    </div>

    <div class="flex items-center gap-2 mt-5 pt-4 border-t border-slate-100">
      <button id="qrPrev" class="btn btn-sm btn-ghost ${QuickRate.idx === 0 ? "opacity-40 pointer-events-none" : ""}">
        <i class="fa-solid fa-arrow-left mr-1"></i>뒤로
      </button>
      <button id="qrSkip" class="btn btn-sm btn-ghost">
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
  const useTmdb = $("#qrUseTmdb");
  if (useTmdb) useTmdb.addEventListener("click", () => {
    input.value = i.voteAverage;
    input.focus();
    input.select();               // 바로 고쳐 쓸 수 있게 선택해 둔다
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
    const v = Math.min(10, Math.round(raw * 10) / 10);
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
  $("#fOttEtc").checked = false;
  syncOttFields();
  $("#ottHint").classList.add("hidden");
  setOttOptions([], null);
  buildSeasonSelect(null);

  if (id) {
    const i = State.items.find(x => x.id === id);
    $("#modalTitle").textContent = "수정";
    $("#fTitle").value = i.title || "";
    $("#fType").value = i.type || "영화";
    $("#fCountry").value = i.country || "";
    /* 저장된 `ott`가 "영화관"이면 그 체크, 다른 값이 있으면 기타 체크 + 그 값을 칸에 */
    $("#fTheater").checked = (i.ott === "영화관");
    $("#fOttEtc").checked = !!(i.ott && i.ott !== "영화관");
    $("#fOtt").value = (i.ott && i.ott !== "영화관") ? i.ott : "";
    syncOttFields();
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
      loadSeasonsForEdit(i);          // 진짜 시즌 목록으로 갈아끼운다 (아래 참고)
    } else {
      $("#tmdbQuery").value = i.title || "";
    }
    $("#deleteBtn").classList.remove("hidden");
  } else {
    $("#modalTitle").textContent = "새로 등록";
    ["fTitle", "fCountry", "fStart", "fEnd", "fReview", "fLastStart", "fLastEnd"]
      .forEach(f => $("#" + f).value = "");
    $("#fType").value = "영화";
    $("#fOtt").value = "";        // 기본값 없음 — 스트리밍 목록은 TMDB(otts)가 채운다
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

/* ---------- 수정창을 열 때 진짜 시즌 목록 받아오기 ----------
   저장된 기록에는 시즌 목록이 없고 `totalSeasons` 숫자만 있다. 그것만으로 만든 임시 목록
   (`seasonListFor`)은 번호뿐이라 ① 드롭다운에 방영연도·화수가 안 나오고
   ② 시즌을 바꿔 저장해도 **그 시즌의 포스터·방영일을 쓸 수 없다**(`saveItem`이 `seasons`를 본다).
   그래서 TV 기록을 열 때 한 번 받아온다. 모달은 먼저 뜨고 목록만 나중에 갈아끼운다. */
async function loadSeasonsForEdit(i) {
  if (mediaTypeOf(i) !== "tv" || (i.totalSeasons || 0) < 2) return;
  if (!i.tmdbId || !getTmdbKey()) return;
  try {
    const d = await tmdbDetail(i.tmdbId, "tv");
    /* 그 사이 창을 닫았거나 다른 기록으로 옮겼으면 버린다.
       받아온 게 같은 작품이 아니면(짐작이 틀린 경우) 엉뚱한 시즌 목록을 얹지 않는다. */
    if (State.editingId !== i.id || !State.selectedTmdb) return;
    if (!sameWork(i, d) || !(d.seasons || []).length) return;

    State.selectedTmdb.seasons = d.seasons;
    buildSeasonSelect(d.seasons);
    renderSelected(State.selectedTmdb);      // 고른 시즌의 포스터로 갱신
  } catch { /* 못 받아와도 번호만 있는 임시 목록으로 시즌은 고를 수 있다 */ }
}

function closeEdit() {
  $("#editModal").classList.add("hidden");
  State.editingId = null;
  State.selectedTmdb = null;
  // 편집 중에 다른 기기의 변경이 왔다면 미뤄뒀다가 지금 받는다
  if (window.flushPendingPull) flushPendingPull();
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

  /* 시즌이 여러 개인 작품은 **어느 시즌인지 고르고 저장한다.**
     안 고르면 몇 번째를 본 기록인지 알 수 없어서 시리즈 묶기·시즌 미기록 칩이 흐트러지고,
     탐색 탭 이어보기는 그런 기록을 **대상에서 아예 뺀다**(`unknownSeason`) — 안 본 시즌을
     영영 못 찾는다. 드롭다운이 떠 있다는 건 곧 시즌이 2개 이상이라는 뜻이다. */
  const seasonField = $("#seasonField");
  if (seasonField && !seasonField.classList.contains("hidden") && seasonNum <= 0) {
    toast("시즌을 선택하세요", "error");
    $("#fSeasonSelect").focus();
    return;
  }

  /* 둘 다 안 켰으면 "직접 적을 게 없음"(null) — 스트리밍은 TMDB `otts`가 맡는다 */
  const ott = $("#fTheater").checked ? "영화관"
            : ($("#fOttEtc").checked ? ($("#fOtt").value.trim() || null) : null);

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
      /* TMDB는 영화와 TV가 **다른 번호판**이라 `tmdbId`만으로는 작품이 특정되지 않는다.
         어느 쪽 번호인지 같이 저장해야 나중에 짐작하지 않는다 (구분으로 짐작하면 애니·다큐가 틀린다). */
      tmdbId: t.tmdbId, mediaType: t.mediaType || null,
      poster: t.poster, backdrop: t.backdrop,
      genres: t.genres || [], overview: t.overview || "",
      releaseDate: t.releaseDate, releaseYear: t.releaseYear,
      cast: t.cast || [], director: t.director || "",
      runtime: t.runtime, totalEpisodes: t.totalEpisodes, totalSeasons: t.totalSeasons,
      cert: t.cert, voteAverage: t.voteAverage, companies: t.companies || [],
      originalTitle: t.originalTitle, otts: t.otts || [],
      collectionId: t.collectionId || null, collectionName: t.collectionName || "",
      seriesNo: t.seriesNo || null, seriesTotal: t.seriesTotal || null
    });

    /* 시즌을 고른 TV 기록은 **그 시즌의** 포스터·방영일을 쓴다.
       `tmdbDetail`이 주는 `poster`/`first_air_date`는 **작품 전체의 것**이라, 안 그러면
       킹덤 S1·S2·S3이 전부 같은 포스터에 같은 연도(2019)로 저장된다. */
    const sn = seasonNum > 0 && (t.seasons || []).find(s => s.number === seasonNum);
    if (sn) {
      if (sn.poster) base.poster = sn.poster;
      if (sn.airDate) { base.releaseDate = sn.airDate; base.releaseYear = sn.airDate.slice(0, 4); }
    }
  }

  /* ---- 중복 확인 ----
     같은 작품의 같은 시즌이 이미 있으면 대개 실수다. 다시 본 거라면 새 기록을 만들 게 아니라
     기존 기록의 **재시청 날짜**에 넣는 게 맞다 — 통계·히트맵·재시청 수가 그걸 전제로 센다.
     그래도 정말 따로 두고 싶을 수 있으니 막지 않고 물어본다.
     `tmdbId`가 없는 기록은 제목으로 비교한다. */
  const dupKey = (x) => [x.tmdbId || ("t:" + String(x.title || "").trim()),
                         String(x.season || "").trim()].join("|");
  const already = State.items.find(x => x.id !== State.editingId && dupKey(x) === dupKey(base));
  if (already) {
    const when = fmtRange(already.startDate, already.endDate) || "본 날짜 없음";
    const ok = confirm(
      `이미 같은 기록이 있습니다.\n\n` +
      `${already.title}${already.season ? " " + already.season : ""} — ${when}` +
      `${already.rating ? ` · 별점 ${fmtRating(already.rating)}` : ""}\n\n` +
      `다시 본 거라면 새로 만들지 말고 그 기록의 [재시청]에 날짜를 넣는 편이 좋습니다.\n` +
      `그래도 따로 저장할까요?`
    );
    if (!ok) { toast("취소했습니다"); return; }
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

  $("#refreshAllBtn").addEventListener("click", runRefreshAll);
  $("#enrichBtn").addEventListener("click", runEnrichAll);
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

  $("#clearOttBtn").addEventListener("click", runClearOttField);
  $("#restoreBtn").addEventListener("click", runRestoreBackup);

  /* 되돌리기 팝업 — 항목은 열 때마다 새로 그리므로 위임으로 받는다 */
  const closeRestore = () => $("#restoreModal").classList.add("hidden");
  $("#closeRestore").addEventListener("click", closeRestore);
  $("#cancelRestore").addEventListener("click", closeRestore);
  $("#restoreModal").addEventListener("click", e => {
    if (e.target.id === "restoreModal") { closeRestore(); return; }
    const item = e.target.closest(".rst-item");
    if (item) applyRestorePoint(+item.dataset.idx);
  });

  /* 갱신 미리보기 — 닫기/취소는 조회 결과를 버린다 (아직 저장 전이라 잃는 건 시간뿐) */
  const closePreview = () => {
    $("#refreshPreviewModal").classList.add("hidden");
    RefreshPlan = [];
    $("#enrichStatus").textContent = "취소했습니다 — 아무것도 바뀌지 않았습니다";
    $("#enrichStatus").className = "text-sm mt-3 font-medium text-slate-500";
  };
  $("#closeRefreshPreview").addEventListener("click", closePreview);
  $("#cancelRefreshPreview").addEventListener("click", closePreview);
  $("#applyRefreshPreview").addEventListener("click", applyRefreshPlan);
  $("#refreshPreviewModal").addEventListener("click", e => {
    if (e.target.id === "refreshPreviewModal") closePreview();
  });
  /* 항목은 열 때마다 새로 그리므로 체크·접기는 전부 위임으로 받는다.
     실제 선택 상태를 갖는 건 값 한 줄짜리 `.rf-f-cb` 하나뿐이고,
     항목·필드·전체 체크박스는 **그걸 켜고 끄는 손잡이**일 뿐이다 (상태를 따로 두면 어긋난다). */
  const setAll = (list, on) => { list.forEach(b => { b.checked = on; }); syncRefreshPicked(); };
  $("#rfList").addEventListener("change", e => {
    const t = e.target;
    if (t.classList.contains("rf-g-cb")) {          // 주제 묶음 = 그 주제 전체를 켜고 끈다
      const q = `#rfList .rf-f-cb[data-label="${CSS.escape(t.dataset.label)}"]`;
      setAll([...document.querySelectorAll(q)], t.checked);
    } else if (t.classList.contains("rf-f-cb")) {
      syncRefreshPicked();
    }
  });
  $("#rfList").addEventListener("click", e => {
    const fold = e.target.closest(".rf-fold");
    if (fold) { fold.closest(".rf-group").classList.toggle("rf-folded"); return; }
    // 주제 이름을 눌러도 접힌다 — 폰에서 작은 화살표만 노리기 어렵다
    const name = e.target.closest(".rf-name, .rf-gn, .rf-sum");
    const g = name && name.closest(".rf-group");
    if (g) g.classList.toggle("rf-folded");
  });
  $("#rfAll").addEventListener("change", e =>
    setAll([...document.querySelectorAll("#rfList .rf-f-cb")], e.target.checked));
  $("#rfFoldAll").addEventListener("click", () => setRefreshFold(!$("#rfFoldAll").dataset.folded));
}

/* ---------- 백업에서 되돌리기 ----------
   `saveLocal()`이 덮어쓰기 직전 상태를 `watchlog_items_backup`에 하나 남긴다.
   **서버 데이터를 채택할 때는 백업을 갱신하지 않으므로**, 다른 기기가 서버를 망가뜨린 뒤에도
   이 기기의 백업에는 그 전 상태가 남아 있는 경우가 많다.
   콘솔을 못 쓰는 상황(폰 등)에서도 복구할 수 있어야 해서 버튼으로 둔다. */
async function runRestoreBackup() {
  const btn = $("#restoreBtn");
  if (btn) { btn.disabled = true; }

  /* 되돌릴 수 있는 지점을 모은다 — 이 기기 것 하나 + 서버 것 둘.
     기기 백업은 그 기기를 쓸수록 덮이므로, 서버 쪽이 더 옛날이자 더 성한 경우가 많다. */
  const points = [];
  try {
    const local = JSON.parse(localStorage.getItem("watchlog_items_backup") || "null");
    if (Array.isArray(local) && local.length) {
      points.push({
        label: "이 기기 · 저장 직전",
        items: local,
        at: localStorage.getItem("watchlog_items_backup_at") || ""
      });
    }
  } catch { /* 깨진 백업은 없는 셈 친다 */ }

  try {
    const NAME = { prev: "서버 · 1시간 전쯤", daily: "서버 · 하루 전" };
    (await fetchBackups()).forEach(b =>
      points.push({ label: NAME[b.kind] || b.kind, items: b.data.items, at: b.data.savedAt || "" }));
  } catch { /* 서버 백업을 못 받아도 기기 백업으로는 되돌릴 수 있다 */ }

  if (btn) btn.disabled = false;
  if (!points.length) { toast("되돌릴 수 있는 백업이 없습니다", "error"); return; }

  /* 개수만으로는 어느 쪽이 나은지 알 수 없다 — 별점·한줄평도 같이 보여준다 */
  const cnt = (arr, f) => arr.filter(f).length;
  const desc = (items) =>
    `기록 ${items.length} · 별점 ${cnt(items, i => i.rating)} · 한줄평 ${cnt(items, i => i.review)}`;

  $("#restoreNow").innerHTML = `<b>지금</b> — ${esc(desc(State.items))}`;
  $("#restoreList").innerHTML = points.map((p, n) => `
    <button class="rst-item" data-idx="${n}">
      <div class="rst-when">${esc(p.label)}</div>
      ${p.at ? `<div class="rst-time">${esc(fmtDateTime(p.at))}</div>` : ""}
      <div class="rst-desc">${esc(desc(p.items))}</div>
    </button>`).join("");

  RestorePoints = points;
  $("#restoreModal").classList.remove("hidden");
}

/* 목록에서 고른 지점으로 되돌린다 (모달의 항목 클릭) */
let RestorePoints = [];
function applyRestorePoint(idx) {
  const pick = RestorePoints[idx];
  if (!pick) return;

  const cnt = (arr, f) => arr.filter(f).length;
  const line = `기록 ${pick.items.length} · 별점 ${cnt(pick.items, i => i.rating)} · 한줄평 ${cnt(pick.items, i => i.review)}`;
  if (!confirm(`「${pick.label}」${pick.at ? ` (${fmtDateTime(pick.at)})` : ""} 로 되돌립니다.\n\n${line}\n\n지금 데이터는 사라집니다. 계속할까요?`)) {
    toast("취소했습니다");
    return;
  }

  $("#restoreModal").classList.add("hidden");
  State.items = pick.items;
  saveLocal();
  applyFilters();
  renderDiscover();
  toast(`${pick.label} 상태로 되돌렸습니다 (${pick.items.length}개)`, "success");
}

/* ---------- "내가 본 곳"(ott) 비우기 ----------
   등록 폼의 옛 기본값 "넷플릭스"가 어디서 봤든 저장돼서, 넷플릭스에 없는 작품이
   넷플릭스로 보였다. 스트리밍 목록은 TMDB(`otts`)가 채우므로 이 필드는 없어도 표시가 멀쩡하다.
   **영화관만 남긴다** — TMDB가 절대 알 수 없는 정보라 지우면 되살릴 방법이 없다. */
function runClearOttField() {
  const targets = State.items.filter(i => i.ott && i.ott !== "영화관");
  if (!targets.length) { toast("지울 값이 없습니다", "success"); return; }

  // 뭐가 지워지는지 값별로 세어서 보여준다
  const byVal = {};
  targets.forEach(i => { byVal[i.ott] = (byVal[i.ott] || 0) + 1; });
  const lines = Object.entries(byVal).sort((a, b) => b[1] - a[1]).map(([v, n]) => `· ${v} — ${n}개`);

  const ok = confirm(
    `"내가 본 곳"에 적힌 값을 기록 ${targets.length}개에서 지웁니다.\n` +
    `영화관 기록과 TMDB가 가져온 스트리밍 목록은 그대로입니다.\n` +
    `되돌리려면 콘솔에서 restoreBackup()\n\n` +
    lines.join("\n")
  );
  if (!ok) { toast("취소했습니다"); return; }

  targets.forEach(i => { i.ott = null; });
  saveLocal();
  applyFilters();
  renderDiscover();
  toast(`${targets.length}개에서 지웠습니다`, "success");
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
  touchCache();
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
  /* 예전에 OTT·평점·시리즈 버튼이 따로 있던 시절의 시각도 본다 —
     버튼을 합쳤다고 "아직 실행 안 함"으로 되돌아가면 안 되니 그중 가장 최근 것을 쓴다. */
  set("updRefresh", [u.refresh, u.ott, u.rating, u.collection].filter(Boolean).sort().pop());
}

/* ---------- 미등록 항목 채우기 ----------
   ⚠ **이미 `tmdbId`가 있는 기록은 대상이 아니다.** 예전엔 "이미 채운 항목도 갱신" 체크박스가 있어
   그 경우에도 `tmdbAutoMatch`(제목 검색)를 돌렸는데, 그건 저장된 `tmdbId`를 통째로 무시하고
   **검색 결과 1등으로 갈아치우는** 동작이라 손으로 맞춰둔 매칭이 전부 풀렸다.
   재매칭이 필요하면 수정창에서 직접 고르고, 정보 갱신은 `runRefreshAll`이 한다. */
let _enriching = false;
async function runEnrichAll() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  const targets = State.items.filter(i => !i.tmdbId);
  if (!targets.length) { toast("미등록 항목이 없습니다", "success"); return; }
  if (!confirm(`미등록 ${targets.length}개를 제목으로 찾아 채웁니다. 시간이 걸릴 수 있습니다.`)) return;

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
          // mediaType을 같이 남긴다 — movie/tv는 다른 번호판이라 나중에 짐작하면 위험하다
          tmdbId: d.tmdbId, mediaType: d.mediaType || null,
          poster: d.poster, backdrop: d.backdrop,
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

/* ---------- 최신 정보로 갱신 (OTT · 평점 · 시즌/화수 · 시리즈) ----------
   예전엔 [OTT만]·[평점만]·[시리즈 정보] 버튼이 따로 있었다. 셋 다 같은 기록을 놓고
   **각자 mediaType을 짐작해 각자 조회**했으므로 위험도 세 배, 시간도 세 배(283개면 세 바퀴)였다.
   한 번 조회해서 한 번 확인하고 셋을 함께 갱신한다.

   ⚠ **매칭은 건드리지 않는다.** `tmdbId`·제목·포스터·줄거리·장르·출연진, 그리고 별점·본 날짜·
   한줄평 같은 내 기록은 그대로다.
   `collectionId`/`seriesNo`는 갱신 대상에 **넣는다** — 저장된 `tmdbId`로부터 계산되는 값이라
   갱신해도 매칭이 바뀌지 않기 때문이다(`coll.order.get(i.tmdbId)` — id를 그대로 쓴다).
   시즌 표기도 직접 적은 `season`이 우선이라 덮이지 않는다(`seriesLabel` 참고).
   예전에 "컬렉션이 되돌아가 매칭이 흐트러졌다"던 사고의 원인은 컬렉션을 갱신한 것이 아니라
   **mediaType 짐작이 틀려 엉뚱한 작품의 컬렉션을 넣은 것**이었다. 아래 `sameWork` 확인이 그걸 막는다. */
async function runRefreshAll() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  // 시청 기록 + 보고싶어요를 함께 갱신한다.
  // (위시는 "지금 어디서 볼 수 있나"가 곧 쓸모라 오히려 최신값이 더 필요하다)
  const items = State.items.filter(i => i.tmdbId);
  const wishes = State.wishes.filter(w => w.tmdbId);
  const total = items.length + wishes.length;
  if (!total) { toast("갱신할 항목이 없습니다 (TMDB 연동된 항목만 대상)", "success"); return; }

  if (!confirm(
    `${items.length}개 기록${wishes.length ? ` + 보고싶어요 ${wishes.length}개` : ""}의 정보를 새로 조회합니다.\n\n` +
    `갱신 — OTT · TMDB 평점 · 시즌/화수 · 시리즈 정보\n` +
    `그대로 둠 — 제목 · 포스터 · 줄거리 · 장르 · 출연진 · 내 기록(별점·본 날짜·한줄평)\n\n` +
    `몇 분 걸립니다.`
  )) return;

  _enriching = true;
  const status = $("#enrichStatus");
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  let done = 0, fail = 0;
  const plan = [];                   // 적용 대기 중인 변경 (아직 State에 안 씀)
  const unsure = [];                 // 받아온 게 다른 작품처럼 보여 건너뛴 것
  const step = (label) => {
    done++;
    status.textContent = `조회 중 ${done} / ${total} — ${label}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = (done / total * 100).toFixed(1) + "%";
  };

  const differs = (a, b) => (Array.isArray(a) || Array.isArray(b))
    ? JSON.stringify(a || []) !== JSON.stringify(b || [])
    : (a ?? null) !== (b ?? null);

  /* 바뀐 값 하나 = 미리보기에서 **따로 고를 수 있는 한 줄**.
     `keys`에 실제로 쓸 필드를 담는다 — 적용은 고른 줄의 keys만 `Object.assign` 한다.
     같은 값이면 아무것도 안 담기므로 "안 바뀐 항목"은 목록에 뜨지 않는다. */
  const put = (p, label, cur, next, keys, fmt) => {
    if (!differs(cur, next)) return;
    p.diff.push({ label, from: fmt ? fmt(cur) : cur, to: fmt ? fmt(next) : next, keys });
  };
  const ottTxt = (v) => (v && v.length) ? v.join("·") : "";
  const numTxt = (v) => (v == null || v === "") ? "" : String(v);
  const mtTxt = (v) => v === "tv" ? "TV" : v === "movie" ? "영화" : "";
  const noTxt = (v) => v ? "S" + v : "";
  const totTxt = (v) => v ? v + "편" : "";

  for (const i of items) {
    step(i.title);
    try {
      /* 저장된 mediaType이 있으면 그걸 쓰고, 없으면 짐작하되 **받아온 게 같은 작품인지 반드시 확인**한다.
         movie와 tv는 다른 번호판이라, 확인이 없으면 같은 번호의 엉뚱한 작품을 저장하게 된다. */
      let mt = mediaTypeOf(i);
      let d = await tmdbDetail(i.tmdbId, mt).catch(() => null);
      if (!sameWork(i, d)) {
        const other = mt === "movie" ? "tv" : "movie";
        const d2 = await tmdbDetail(i.tmdbId, other).catch(() => null);
        if (sameWork(i, d2)) { d = d2; mt = other; }
      }
      /* 둘 다 아니면 **아무것도 바꾸지 않고** 넘어간다. 일괄이라 하나씩 물어볼 수 없고,
         그냥 두면 기존 값이 그대로 남으므로 잃는 게 없다. 미리보기에 따로 모아 보여준다. */
      if (!sameWork(i, d)) {
        unsure.push({ title: i.title, got: d ? (d.title || "(제목 없음)") : "(조회 실패)" });
        continue;
      }

      const p = { obj: i, title: i.title, diff: [] };
      put(p, "영화/TV 구분", i.mediaType || null, mt, { mediaType: mt }, mtTxt);
      const otts = await tmdbProviders(i.tmdbId, mt);
      put(p, "볼 수 있는 곳", i.otts || [], otts, { otts }, ottTxt);
      put(p, "TMDB 평점", i.voteAverage ?? null, d.voteAverage ?? null,
          { voteAverage: d.voteAverage ?? null }, numTxt);
      put(p, "시즌 수", i.totalSeasons ?? null, d.totalSeasons ?? null,
          { totalSeasons: d.totalSeasons ?? null }, numTxt);
      put(p, "화수", i.totalEpisodes ?? null, d.totalEpisodes ?? null,
          { totalEpisodes: d.totalEpisodes ?? null }, numTxt);

      /* 시즌을 적어둔 TV 기록은 **그 시즌의** 포스터·방영일이 맞다.
         `d.poster`/`d.releaseDate`는 **작품 전체의 값**이라 그대로 두면 킹덤 S1·S2·S3이
         전부 같은 포스터에 같은 연도(2019)가 된다 — 실제로 그렇게 저장돼 있었다. */
      if (mt === "tv") {
        const no = parseInt(String(i.season || "").replace(/\D/g, "")) || 0;
        const sn = no && (d.seasons || []).find(s => s.number === no);
        if (sn) {
          if (sn.poster && differs(i.poster || null, sn.poster)) {
            // 포스터는 주소를 글자로 보여줘야 알 수가 없다 — 미리보기에 그림으로 그린다(`img`)
            p.diff.push({ label: "시즌 포스터", from: i.poster || "", to: sn.poster,
                          keys: { poster: sn.poster }, img: true });
          }
          if (sn.airDate) {
            put(p, "시즌 방영일", i.releaseDate || null, sn.airDate,
                { releaseDate: sn.airDate, releaseYear: sn.airDate.slice(0, 4) });
          }
        }
      }

      /* 시리즈 정보는 **조회에 성공했을 때만 담는다.** 예전 코드는 조회하기 전에 seriesNo/
         seriesTotal을 null로 밀어놔서, 컬렉션 조회가 실패하면 멀쩡하던 "S3 / 총 8편"이 사라졌다. */
      if (d.collectionId) {
        let name = d.collectionName || i.collectionName || "";
        let no = i.seriesNo ?? null, tot = i.seriesTotal ?? null;
        try {
          const coll = await tmdbCollection(d.collectionId);
          no = coll.order.get(i.tmdbId) || no;
          tot = coll.total || tot;
          if (coll.name) name = coll.name;
          saveCollInfo(coll);            // 편별 개봉일·제목 (탐색 탭 이어보기용)
        } catch { /* 편 번호를 못 구해도 컬렉션 연결 자체는 담는다 */ }
        /* 컬렉션 **id와 이름은 한 줄로 묶는다** — 따로 고를 수 있게 하면 이름만 바뀌고 id는
           옛것으로 남는 어긋난 상태가 만들어진다. 화면에는 이름으로 보여준다. */
        if (differs(i.collectionId ?? null, d.collectionId) || differs(i.collectionName || "", name)) {
          p.diff.push({ label: "시리즈", from: i.collectionName || "", to: name,
                        keys: { collectionId: d.collectionId, collectionName: name } });
        }
        put(p, "시리즈 편", i.seriesNo ?? null, no, { seriesNo: no }, noTxt);
        put(p, "총 편수", i.seriesTotal ?? null, tot, { seriesTotal: tot }, totTxt);
      } else if (mt === "movie" && i.collectionId) {
        /* 영화인데 컬렉션이 없다고 답했으면 연결을 지운다 (시리즈에서 빠졌거나 애초에 없던 것).
           TV는 TMDB가 컬렉션 개념을 제공하지 않으므로 "없다"가 근거가 못 된다 — 건드리지 않는다. */
        p.diff.push({ label: "시리즈", from: i.collectionName || "", to: "",
                      keys: { collectionId: null, collectionName: "" } });
        put(p, "시리즈 편", i.seriesNo ?? null, null, { seriesNo: null }, noTxt);
        put(p, "총 편수", i.seriesTotal ?? null, null, { seriesTotal: null }, totTxt);
      }

      if (p.diff.length) plan.push(p);
    } catch { fail++; }

    await new Promise(r => setTimeout(r, 260));
  }

  /* 위시는 `mediaType`을 담을 때부터 저장해두므로 짐작할 일이 없다 (확인도 필요 없다). */
  for (const w of wishes) {
    step(w.title);
    try {
      const p = { obj: w, title: w.title, wish: true, diff: [] };
      const otts = await tmdbProviders(w.tmdbId, w.mediaType || "movie");
      put(p, "볼 수 있는 곳", w.otts || [], otts, { otts }, ottTxt);
      if (p.diff.length) plan.push(p);
    } catch { fail++; }

    await new Promise(r => setTimeout(r, 260));
  }

  _enriching = false;
  bar.classList.add("hidden");

  if (!plan.length && !unsure.length) {
    status.textContent = `조회 완료 — 바뀔 내용이 없습니다${fail ? ` (실패 ${fail}개)` : ""}`;
    status.className = "text-sm mt-3 font-medium text-emerald-600";
    markUpd("refresh");                  // 조회는 실제로 했으니 시각은 남긴다
    toast("이미 최신 상태입니다", "success");
    return;
  }

  status.textContent = `조회 완료 — 바뀔 항목 ${plan.length}개`
    + (fail ? `, 실패 ${fail}개` : "") + (unsure.length ? `, 확인 필요 ${unsure.length}개` : "")
    + " · 확인 후 [적용]을 누르세요";
  status.className = "text-sm mt-3 font-medium text-slate-600";
  showRefreshPreview(plan, unsure, fail);
}

/* ---------- 갱신 미리보기 ----------
   **아직 아무것도 저장되지 않은 상태**에서 뭐가 바뀔지 전부 보여준다.
   자동 매칭에 여러 번 데인 뒤라, 일괄 작업은 "하고 나서 알려주기"가 아니라
   "보여주고 나서 하기"여야 한다. 취소하면 조회 결과를 버리고 끝난다. */
let RefreshPlan = [];
function showRefreshPreview(plan, unsure, fail) {
  RefreshPlan = plan;

  const changes = plan.reduce((s, p) => s + p.diff.length, 0);
  $("#rfSummary").innerHTML =
    `<b>${plan.length}개 항목 · 바뀔 값 ${changes}개</b>`
    + ` — 기록 ${plan.filter(p => !p.wish).length} · 보고싶어요 ${plan.filter(p => p.wish).length}`
    + (fail ? ` · 조회 실패 ${fail}` : "");

  /* **필드(주제)로 묶는다.** 예전엔 작품별로 묶고 필드는 위에 칩으로만 뒀는데,
     그러면 "볼 수 있는 곳 2개"를 봐도 그 2개가 작품 목록 어디에 있는지 스크롤로 찾아야 했다.
     주제를 제목으로 놓고 **그 아래에 해당 내역이 딸려오게** 한다 — 묶음 헤더가 곧 필드별 일괄이다.
     묶음 순서는 `put()`이 담은 순서 그대로다 (실행마다 자리가 바뀌면 찾기 어렵다). */
  const groups = new Map();
  plan.forEach((p, n) => p.diff.forEach((c, f) => {
    if (!groups.has(c.label)) groups.set(c.label, []);
    groups.get(c.label).push({ idx: n, f, p, c });
  }));

  /* 값 한 줄 = 체크박스 하나. 줄 전체가 `<label>`이라 아무 데나 눌러도 토글된다
     (폰에서 네모만 노리기 어렵다). 묶음 체크박스는 그 주제의 줄들을 한꺼번에 켜고 끈다. */
  const val = (v) => (v === "" || v == null) ? "(없음)" : esc(String(v));
  /* 포스터처럼 주소를 글자로 보여줘야 알 수 없는 값은 그림으로 그린다 (`c.img`) */
  const cell = (c, v, cls) => c.img
    ? (v ? `<img class="rf-thumb ${cls}" src="${esc(v)}" alt="" loading="lazy">`
         : `<span class="${cls}">(없음)</span>`)
    : `<span class="${cls}">${val(v)}</span>`;
  const rows = [...groups].map(([label, list]) => `
    <div class="rf-group" data-label="${esc(label)}">
      <div class="rf-head">
        <input type="checkbox" class="rf-cb rf-g-cb" data-label="${esc(label)}" checked>
        <button type="button" class="rf-fold" title="접기/펴기">
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <span class="rf-name">${esc(label)}</span>
        <span class="rf-gn">${list.length}개</span>
        <span class="rf-sum">${esc(list.slice(0, 3).map(e => e.p.title).join(", "))}${
          list.length > 3 ? ` 외 ${list.length - 3}` : ""}</span>
      </div>
      <div class="rf-fieldrows">${list.map(e => `
        <label class="rf-field">
          <input type="checkbox" class="rf-cb rf-f-cb" data-idx="${e.idx}" data-f="${e.f}"
                 data-label="${esc(label)}" checked>
          <span class="rf-w">${esc(e.p.title)}${e.p.wish ? ` <span class="badge badge-genre">보고싶어요</span>` : ""}</span>
          ${cell(e.c, e.c.from, "rf-a")}<span class="rf-arrow">→</span>${cell(e.c, e.c.to, "rf-b")}
        </label>`).join("")}</div>
    </div>`).join("");

  /* 건너뛴 건 **어떤 작품이 왔는지까지** 보여준다 — 제목만 알려주면 뭐가 문제인지 알 수가 없다. */
  const skipped = unsure.length ? `
    <div class="rf-item rf-skip">
      <div class="rf-name"><i class="fa-solid fa-triangle-exclamation mr-1.5" style="color:#c08a2e"></i>확인 필요 ${unsure.length}개 — 건드리지 않습니다</div>
      <div class="rf-note">저장된 TMDB 번호로 받아온 게 다른 작품처럼 보입니다. 수정창에서 다시 연결해 주세요.</div>
      <div class="rf-diff">${unsure.map(u =>
        `<div><span class="rf-b">${esc(u.title)}</span><span class="rf-k"> ← TMDB는 </span><span class="rf-a">${esc(u.got)}</span></div>`).join("")}</div>
    </div>` : "";

  $("#rfList").innerHTML = skipped + rows;
  $("#rfAll").checked = true;
  setRefreshFold(false);              // 처음엔 펴서 보여준다 — 확인하려고 여는 화면이다
  syncRefreshPicked();
  $("#refreshPreviewModal").classList.remove("hidden");
}

/* 접기/펴기. 목록이 길 때 주제만 훑고 싶을 때가 있다 (접으면 작품 몇 개가 요약으로 남는다) */
function setRefreshFold(folded) {
  document.querySelectorAll("#rfList .rf-group")
    .forEach(el => el.classList.toggle("rf-folded", folded));
  const b = $("#rfFoldAll");
  b.innerHTML = folded
    ? `<i class="fa-solid fa-chevron-down mr-1"></i>모두 펴기`
    : `<i class="fa-solid fa-chevron-up mr-1"></i>모두 접기`;
  b.dataset.folded = folded ? "1" : "";
}

/* 고른 상태를 위쪽 체크박스들과 버튼에 반영한다 — 몇 개가 저장될지 누르기 전에 보여야 한다.
   부분 선택은 `indeterminate`로 표시한다 (켬/끔 둘 중 하나로 보이면 거짓말이 된다). */
function syncRefreshPicked() {
  const boxes = [...document.querySelectorAll("#rfList .rf-f-cb")];
  const on = boxes.filter(b => b.checked).length;

  const mark = (box, list) => {
    const k = list.filter(b => b.checked).length;
    box.checked = k > 0 && k === list.length;
    box.indeterminate = k > 0 && k < list.length;
  };
  // 주제(필드)별 묶음 헤더
  document.querySelectorAll("#rfList .rf-g-cb").forEach(cb => {
    mark(cb, boxes.filter(b => b.dataset.label === cb.dataset.label));
  });
  mark($("#rfAll"), boxes);

  $("#rfPicked").textContent = `${on} / ${boxes.length}개 값 선택`;
  const btn = $("#applyRefreshPreview");
  btn.textContent = on ? `적용 (${on}개)` : "적용";
  btn.disabled = !on;
}

/* [적용] — 여기서 처음으로 State가 바뀐다. **체크된 값만** 반영한다. */
function applyRefreshPlan() {
  const boxes = [...document.querySelectorAll("#rfList .rf-f-cb")].filter(b => b.checked);
  $("#refreshPreviewModal").classList.add("hidden");
  if (!boxes.length) { toast("고른 값이 없습니다"); RefreshPlan = []; return; }

  const touched = new Set();
  boxes.forEach(b => {
    const p = RefreshPlan[+b.dataset.idx];
    const c = p && p.diff[+b.dataset.f];
    if (!c) return;
    Object.assign(p.obj, c.keys);
    touched.add(p);
  });

  const cnt = boxes.length, items = touched.size;
  const left = RefreshPlan.reduce((s, p) => s + p.diff.length, 0) - cnt;
  RefreshPlan = [];

  saveLocal();
  applyFilters();
  renderDiscover();
  markUpd("refresh");

  const status = $("#enrichStatus");
  status.textContent = `적용 완료 — ${items}개 항목의 값 ${cnt}개 갱신됨`
    + (left ? `, ${left}개는 체크를 풀어 그대로 뒀습니다` : "");
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`${items}개 항목을 갱신했습니다`, "success");
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
      await applyKoreanNames(d);          // 재매칭으로 갈아끼울 때도 한글 이름으로
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

/* ---------- 사람 이름 한글로 바꾸기 ----------
   "임화영 / Park Shin-woo"처럼 한 화면에서 표기가 갈리는 걸 고친다.
   지금 데이터에는 사람 id가 없으므로(이름만 저장됨) 작품별 크레딧을 다시 받아 id를 얻고,
   한글이 없는 이름만 /person/{id}의 also_known_as에서 한글 표기를 찾는다.
   사람 조회 결과는 캐시하므로 같은 배우를 여러 번 부르지 않는다. */
async function runFixNames(list) {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  // 목록 탭의 "이름 영문" 칩에서 부르면 그 목록만 처리한다
  const targets = (list || State.items).filter(i => i.tmdbId && needsKoName(i));
  if (!targets.length) { toast("바꿀 이름이 없습니다", "success"); return; }
  if (!confirm(
    `${targets.length}개 항목의 배우·감독 이름을 한글 표기로 바꿉니다.\n` +
    `한글 표기가 TMDB에 없는 사람(주로 외국 배우)은 그대로 둡니다.\n` +
    `사람 수가 많아 몇 분 걸릴 수 있습니다.`)) return;

  _enriching = true;
  const status = $("#enrichStatus");
  const bar = $("#enrichBar");
  const fill = $("#enrichBarFill");
  bar.classList.remove("hidden");

  const cache = getPersonCache();
  let changed = 0, looked = 0, fail = 0;

  /* 캐시 → 조회 순으로 한글 표기를 얻는다. ""는 "한글 표기 없음"으로 확정된 값.
     id가 없으면 이름으로 한 번 찾아보고, 그래도 안 되면 **이름으로 "확인함"을 남긴다** —
     안 그러면 그 사람은 영원히 "이름 영문" 목록에 남는다. */
  const koName = async (id, cur) => {
    if (!cur || HANGUL.test(cur)) return null;
    if (id && Object.prototype.hasOwnProperty.call(cache, id)) return cache[id] || null;
    const nk = nameKey(cur);
    if (!id && Object.prototype.hasOwnProperty.call(cache, nk)) return cache[nk] || null;

    let pid = id;
    if (!pid) {
      pid = await tmdbFindPersonId(cur);
      await new Promise(r => setTimeout(r, 200));
      if (!pid) { cache[nk] = ""; return null; }   // 사람을 못 찾음 → 확인 완료로 표시
    }

    const ko = await tmdbPersonKoreanName(pid);
    await new Promise(r => setTimeout(r, 200));
    looked++;
    if (ko === null) { fail++; return null; }      // 조회 실패는 캐시하지 않음 (다음에 재시도)
    cache[pid] = ko;
    if (!id) cache[nk] = ko;                        // id를 새로 알아낸 경우 이름으로도 기록
    return ko || null;
  };

  for (let n = 0; n < targets.length; n++) {
    const i = targets[n];
    status.textContent = `${n + 1} / ${targets.length} — ${i.title}`;
    status.className = "text-sm mt-3 font-medium text-slate-600";
    fill.style.width = ((n + 1) / targets.length * 100).toFixed(1) + "%";

    try {
      // 저장된 cast에 id가 없으면 크레딧을 다시 받아 id를 채운다
      const needIds = (i.cast || []).some(c => !c.id) || (i.director && !i.directorId);
      if (needIds) {
        const d = await tmdbDetail(i.tmdbId, mediaTypeOf(i));
        if (d) {
          (i.cast || []).forEach(c => {
            const m = (d.cast || []).find(x => x.name === c.name);
            if (m) c.id = m.id;
          });
          if (d.directorId && d.director === i.director) i.directorId = d.directorId;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      for (const c of (i.cast || [])) {
        const ko = await koName(c.id, c.name);
        if (ko && ko !== c.name) { c.name = ko; changed++; }
      }
      const koDir = await koName(i.directorId, i.director || "");
      if (koDir && koDir !== i.director) { i.director = koDir; changed++; }
    } catch { fail++; }

    if (n % 5 === 4) { saveLocal(true); savePersonCache(cache); }
  }

  savePersonCache(cache);
  saveLocal();
  applyFilters();
  renderDiscover();
  _enriching = false;
  markUpd("names");
  status.textContent = `이름 한글화 완료 — ${changed}곳 변경 (사람 ${looked}명 조회${fail ? `, 실패 ${fail}` : ""})`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`배우·감독 이름 ${changed}곳을 한글로 바꿨습니다`, "success");
}

