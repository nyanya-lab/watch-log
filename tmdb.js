/* ============================================
   tmdb.js — TMDB API 검색 및 정보 추출
   ============================================ */

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_IMG_SM = "https://image.tmdb.org/t/p/w92";

function getTmdbKey() { return localStorage.getItem(LS_TMDB) || ""; }
function setTmdbKey(k) { localStorage.setItem(LS_TMDB, k.trim()); }

/* 국가코드 → 한글 */
const COUNTRY_KO = {
  KR: "한국", US: "미국", JP: "일본", CN: "중국", GB: "영국",
  FR: "프랑스", DE: "독일", ES: "스페인", IT: "이탈리아",
  TW: "대만", TH: "태국", IN: "인도", CA: "캐나다", AU: "호주",
  HK: "홍콩", RU: "러시아", BR: "브라질", MX: "멕시코", SE: "스웨덴",
  NZ: "뉴질랜드", NO: "노르웨이", DK: "덴마크", NL: "네덜란드",
  BE: "벨기에", IE: "아일랜드", PL: "폴란드", TR: "터키", AR: "아르헨티나"
};

/* TMDB 스트리밍 provider명 → 앱 OTT 옵션 매핑 */
const PROVIDER_MAP = {
  "Netflix": "넷플릭스",
  "Netflix basic with Ads": "넷플릭스",
  "Wavve": "웨이브",
  "wavve": "웨이브",
  "Tving": "티빙",
  "TVING": "티빙",
  "Coupang Play": "쿠팡플레이",
  "Disney Plus": "디즈니+",
  "Watcha": "왓챠",
  "Apple TV Plus": "애플TV+",
  "Apple TV+": "애플TV+"
};

function mapType(mediaType, genres) {
  const g = (genres || []).map(x => x.name || x);
  if (g.includes("애니메이션") || g.includes("Animation")) return "애니";
  if (g.includes("다큐멘터리") || g.includes("Documentary")) return "다큐";
  if (g.includes("리얼리티") || g.includes("Reality")) return "예능";
  if (g.includes("토크") || g.includes("Talk")) return "예능";
  return mediaType === "tv" ? "드라마" : "영화";
}

/* ---------- 제목 변형 (검색 실패 시 재시도) ---------- */
function titleVariants(title) {
  const t = (title || "").trim();
  const out = [t];
  const push = (s) => {
    s = (s || "").trim().replace(/\s+/g, " ");
    if (s && s.length >= 2 && !out.includes(s)) out.push(s);
  };
  push(t.split(/\s*[:：]\s*/)[0]);
  push(t.split(/\s*[-–—]\s*/)[0]);
  push(t.split(/\s*[,·]\s*/)[0]);
  push(t.replace(/[([{（].*?[)\]}）]/g, ""));
  push(t.replace(/\s*(시즌|season|part|파트)\s*\d+.*$/i, ""));
  push(t.replace(/\s*\d+$/, ""));
  push(t.replace(/[^\w가-힣\s]/g, " "));
  push(t.replace(/\s+/g, ""));
  const words = t.split(/\s+/);
  if (words.length > 2) push(words.slice(0, 2).join(" "));
  if (words.length > 1) push(words[0]);
  return out;
}

/* ---------- 검색 ---------- */
async function tmdbSearchRaw(query) {
  const key = getTmdbKey();
  if (!key) throw new Error("TMDB API 키를 설정 탭에서 먼저 입력하세요");

  const url = `${TMDB_BASE}/search/multi?api_key=${key}&language=ko-KR&query=${encodeURIComponent(query)}&include_adult=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("TMDB 요청 실패 (" + res.status + ")");
  const data = await res.json();

  return (data.results || [])
    .filter(r => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 12)
    .map(r => ({
      tmdbId: r.id,
      mediaType: r.media_type,
      title: r.title || r.name || "",
      originalTitle: r.original_title || r.original_name || "",
      poster: r.poster_path ? TMDB_IMG + r.poster_path : null,
      posterSm: r.poster_path ? TMDB_IMG_SM + r.poster_path : null,
      year: (r.release_date || r.first_air_date || "").slice(0, 4),
      overview: r.overview || "",
      // 탐색 탭 카드용 (등록 모달은 안 씀)
      voteAverage: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
      genreIds: r.genre_ids || []
    }));
}

async function tmdbSearchSmart(query) {
  const variants = titleVariants(query);
  for (let i = 0; i < variants.length; i++) {
    const results = await tmdbSearchRaw(variants[i]);
    if (results.length) return { results, usedQuery: variants[i], wasFallback: i > 0 };
    if (i < variants.length - 1) await new Promise(r => setTimeout(r, 120));
  }
  return { results: [], usedQuery: query, wasFallback: false };
}

async function tmdbSearch(q) { return (await tmdbSearchSmart(q)).results; }

/* ---------- 추천용 (탐색 탭) ---------- */
/* 목록형 응답 한 건을 카드용 공통 모양으로 */
function normTmdbCard(r, mediaType) {
  return {
    tmdbId: r.id,
    mediaType: mediaType || r.media_type || "movie",
    title: r.title || r.name || "",
    originalTitle: r.original_title || r.original_name || "",
    poster: r.poster_path ? TMDB_IMG + r.poster_path : null,
    year: (r.release_date || r.first_air_date || "").slice(0, 4),
    overview: r.overview || "",
    voteAverage: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    voteCount: r.vote_count || 0,
    genreIds: r.genre_ids || []
  };
}

/* 이 작품을 본 사람들이 함께 본 작품 */
async function tmdbRecommendations(id, mediaType) {
  const key = getTmdbKey();
  const url = `${TMDB_BASE}/${mediaType}/${id}/recommendations?api_key=${key}&language=ko-KR&page=1`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const d = await res.json();
  return (d.results || []).map(r => normTmdbCard(r, mediaType));
}

/* 조건 검색 (장르·국가 등 취향 조건으로 발굴) */
async function tmdbDiscoverList(mediaType, params) {
  const key = getTmdbKey();
  const qs = new URLSearchParams({
    api_key: key, language: "ko-KR", include_adult: "false", page: "1", ...params
  });
  const res = await fetch(`${TMDB_BASE}/discover/${mediaType}?${qs}`);
  if (!res.ok) return [];
  const d = await res.json();
  return (d.results || []).map(r => normTmdbCard(r, mediaType));
}

/* 장르 목록 (이름 → TMDB 장르 id). 앱 표시명과 맞추려고 koGenre로 한글화해 둔다.
   TV의 합본 장르("Action & Adventure")는 koGenre가 ["액션","모험"]으로 쪼개주므로
   영화 쪽 "액션"과 같은 이름으로 이어진다. */
let _genreCache = null;
async function tmdbGenreMap() {
  if (_genreCache) return _genreCache;
  const key = getTmdbKey();
  const out = { movie: [], tv: [] };
  for (const mt of ["movie", "tv"]) {
    try {
      const res = await fetch(`${TMDB_BASE}/genre/${mt}/list?api_key=${key}&language=ko-KR`);
      if (res.ok) {
        const d = await res.json();
        out[mt] = (d.genres || []).map(g => ({ id: g.id, names: koGenre(g.name) }));
      }
    } catch { /* 장르 목록은 없어도 추천은 돌아간다 */ }
  }
  _genreCache = out;
  return out;
}

/* ---------- 한국 스트리밍(OTT) 판별 ---------- */
async function tmdbProviders(id, mediaType) {
  try {
    const key = getTmdbKey();
    const url = `${TMDB_BASE}/${mediaType}/${id}/watch/providers?api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const kr = (data.results && data.results.KR) || {};
    const list = [...(kr.flatrate || []), ...(kr.free || []), ...(kr.ads || [])];
    const seen = new Set();
    const otts = [];
    list.forEach(p => {
      const mapped = PROVIDER_MAP[p.provider_name];
      if (mapped && !seen.has(mapped)) { seen.add(mapped); otts.push(mapped); }
    });
    return otts;
  } catch { return []; }
}

/* 관람등급 (한국 기준 우선) */
function extractCert(d, mediaType) {
  try {
    if (mediaType === "movie") {
      const rels = (d.release_dates && d.release_dates.results) || [];
      const kr = rels.find(r => r.iso_3166_1 === "KR");
      if (kr) { const c = kr.release_dates.find(x => x.certification); if (c) return c.certification; }
      const us = rels.find(r => r.iso_3166_1 === "US");
      if (us) { const c = us.release_dates.find(x => x.certification); if (c) return "US " + c.certification; }
    } else {
      const rr = (d.content_ratings && d.content_ratings.results) || [];
      const kr = rr.find(r => r.iso_3166_1 === "KR");
      if (kr && kr.rating) return kr.rating;
      const us = rr.find(r => r.iso_3166_1 === "US");
      if (us && us.rating) return "US " + us.rating;
    }
  } catch {}
  return "";
}

/* ---------- 상세 정보 ---------- */
async function tmdbDetail(id, mediaType) {
  const key = getTmdbKey();
  const extra = mediaType === "movie" ? "credits,release_dates" : "credits,content_ratings";
  const url = `${TMDB_BASE}/${mediaType}/${id}?api_key=${key}&language=ko-KR&append_to_response=${extra}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("TMDB 상세 조회 실패");
  const d = await res.json();

  const originCountry = d.origin_country || [];
  const prodCountries = d.production_countries || [];
  let country = "";
  if (originCountry.length) country = COUNTRY_KO[originCountry[0]] || originCountry[0];
  else if (prodCountries.length) country = COUNTRY_KO[prodCountries[0].iso_3166_1] || prodCountries[0].name;

  /* 사람 id도 같이 담는다 — TMDB는 사람 이름을 언어별로 번역해주지 않아서,
     한글 표기를 찾으려면 /person/{id}의 also_known_as를 봐야 한다 (fixPersonNames 참고). */
  const cast = ((d.credits && d.credits.cast) || [])
    .slice(0, 8).map(c => ({ name: c.name, character: c.character || "", id: c.id }));

  const crew = (d.credits && d.credits.crew) || [];
  const director = crew.find(c => c.job === "Director");
  const creator = (d.created_by || [])[0];

  // 러닝타임
  let runtime = null;
  if (mediaType === "movie") runtime = d.runtime || null;
  else runtime = (d.episode_run_time && d.episode_run_time[0]) || null;

  // 시즌 목록 (실제 방영 시즌만)
  const seasons = ((d.seasons || [])
    .filter(s => s.season_number > 0)
    .map(s => ({
      number: s.season_number,
      name: s.name,
      year: (s.air_date || "").slice(0, 4),
      episodes: s.episode_count
    })));

  const companies = (d.production_companies || []).slice(0, 3).map(c => c.name);

  // TMDB 공식 시리즈(컬렉션) — 제목이 달라도 같은 시리즈면 같은 id (영화만 제공)
  const coll = d.belongs_to_collection || null;

  return {
    tmdbId: d.id,
    mediaType,
    collectionId: coll ? coll.id : null,
    collectionName: coll ? coll.name : "",
    title: d.title || d.name || "",
    originalTitle: d.original_title || d.original_name || "",
    poster: d.poster_path ? TMDB_IMG + d.poster_path : null,
    backdrop: d.backdrop_path ? TMDB_IMG + d.backdrop_path : null,
    genres: (d.genres || []).map(g => g.name),
    overview: d.overview || "",
    country: country || "",
    releaseDate: d.release_date || d.first_air_date || "",
    releaseYear: (d.release_date || d.first_air_date || "").slice(0, 4),
    totalSeasons: d.number_of_seasons || null,
    totalEpisodes: d.number_of_episodes || null,
    seasons,
    runtime,
    cert: extractCert(d, mediaType),
    voteAverage: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    companies,
    cast,
    director: director ? director.name : (creator ? creator.name : ""),
    directorId: director ? director.id : (creator ? creator.id : null),
    status: d.status || "",
    type: mapType(mediaType, d.genres)
  };
}

/* ---------- 사람 이름 한글 표기 ----------
   TMDB는 사람 이름을 언어별로 번역해주지 않는다. `language=ko-KR`을 줘도 그 사람의
   대표 표기 하나만 온다 — 한국 배우는 한글로 등록된 경우가 많고 감독은 로마자인 경우가 많아
   같은 작품 안에서 "임화영 / Park Shin-woo"처럼 갈린다.
   한글 표기는 `also_known_as`(다른 표기 목록)에 들어 있으므로 거기서 찾는다.

   사람당 한 번만 조회하면 되므로 결과를 localStorage에 캐시한다.
   한글 표기가 없는 사람(대부분의 외국 배우)은 빈 문자열로 캐시해 재조회를 막는다. */
const LS_PERSON = "watchlog_person_ko";
const HANGUL = /[가-힣]/;

function getPersonCache() {
  try { return JSON.parse(localStorage.getItem(LS_PERSON) || "{}"); }
  catch { return {}; }
}
function savePersonCache(c) {
  try { localStorage.setItem(LS_PERSON, JSON.stringify(c)); } catch {}
}

/* 이름으로 사람을 찾는다 — 저장된 이름이 지금 크레딧 목록에 없어 id를 못 구했을 때의 대비책.
   **이름이 정확히 일치하는 결과만** 받는다 (동명이인·유사검색으로 엉뚱한 사람을 물면 안 된다). */
async function tmdbFindPersonId(name) {
  const key = getTmdbKey();
  if (!key || !name) return null;
  try {
    const url = `${TMDB_BASE}/search/person?api_key=${key}&language=ko-KR&query=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    const hit = (d.results || []).find(p => (p.name || "").trim() === name.trim());
    return hit ? hit.id : null;
  } catch { return null; }
}

/* 이름 자체로 "확인했지만 한글 표기를 못 찾음"을 기억하는 키.
   id를 못 구한 사람은 id로 기억할 수 없어서, 안 그러면 목록에서 영원히 세어진다. */
function nameKey(name) { return "n:" + String(name || "").trim(); }

/* 한글 표기를 찾으면 그 문자열, 없으면 "" — 조회 실패는 null (캐시하지 않음) */
async function tmdbPersonKoreanName(personId) {
  if (!personId) return null;
  const key = getTmdbKey();
  if (!key) return null;
  try {
    const res = await fetch(`${TMDB_BASE}/person/${personId}?api_key=${key}&language=ko-KR`);
    if (!res.ok) return null;
    const d = await res.json();
    if (HANGUL.test(d.name || "")) return d.name;
    const alias = (d.also_known_as || []).find(a => HANGUL.test(a));
    return alias || "";
  } catch { return null; }
}

/* tmdbDetail 결과의 배우·감독 이름을 한글 표기로 바꾼다 (있을 때만).
   TMDB 정보를 받아오는 **모든 경로**에서 이걸 거쳐야 한다 —
   안 그러면 설정에서 한 번 정리해도 새로 등록하는 작품은 다시 영문으로 들어온다.
   캐시가 있어 이미 조회한 사람은 호출이 없다. */
async function applyKoreanNames(d) {
  if (!d) return d;
  const cache = getPersonCache();
  let touched = false;

  const ko = async (id, cur) => {
    if (!id || HANGUL.test(cur || "")) return null;
    if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id] || null;
    const v = await tmdbPersonKoreanName(id);
    await new Promise(r => setTimeout(r, 150));
    if (v === null) return null;          // 조회 실패는 캐시하지 않음
    cache[id] = v;
    touched = true;
    return v || null;
  };

  for (const c of (d.cast || [])) {
    const v = await ko(c.id, c.name);
    if (v) c.name = v;
  }
  const dv = await ko(d.directorId, d.director);
  if (dv) d.director = dv;

  if (touched) savePersonCache(cache);
  return d;
}

/* ---------- 시리즈(컬렉션) 상세 ----------
   컬렉션에 속한 작품들을 개봉일 순으로 정렬해 "몇 번째 편"을 계산할 수 있게 한다.
   같은 컬렉션을 여러 번 조회하지 않도록 캐시. */
const _collCache = new Map();
async function tmdbCollection(collectionId) {
  if (_collCache.has(collectionId)) return _collCache.get(collectionId);
  const key = getTmdbKey();
  const url = `${TMDB_BASE}/collection/${collectionId}?api_key=${key}&language=ko-KR`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB 컬렉션 조회 실패 (${res.status})`);
  const d = await res.json();

  // 미개봉(개봉일 없음)은 뒤로 보내고 개봉일 순 정렬
  const parts = (d.parts || [])
    .slice()
    .sort((a, b) => (a.release_date || "9999").localeCompare(b.release_date || "9999"));

  const info = {
    id: d.id,
    name: d.name || "",
    order: new Map(parts.map((p, idx) => [p.id, idx + 1])),   // tmdbId → 몇 번째 편
    total: parts.length,
    // 편별 정보. "안 본 편" 중 미개봉을 걸러내고, 카드에 실제 제목·포스터를 쓰려면 필요하다
    parts: parts.map((p, idx) => ({
      tmdbId: p.id,
      no: idx + 1,
      title: p.title || p.name || "",
      releaseDate: p.release_date || "",
      poster: p.poster_path ? TMDB_IMG + p.poster_path : null
    }))
  };
  _collCache.set(collectionId, info);
  return info;
}

/* ---------- 컬렉션 편 정보 캐시 (localStorage) ----------
   `_collCache`는 새로고침하면 날아가므로, 편별 개봉일·제목을 이 기기에 남겨둔다.
   TMDB에서 다시 만들 수 있는 정보라 서버 동기화는 하지 않는다(payload만 커짐). */
const LS_COLL = "watchlog_collections";

function getCollCache() {
  try { return JSON.parse(localStorage.getItem(LS_COLL) || "{}"); }
  catch { return {}; }
}

function saveCollInfo(info) {
  if (!info || !info.id || !info.parts) return;
  writeCollCache(info.id, {
    name: info.name, total: info.total, parts: info.parts
  });
}

/* 조회가 실패한 컬렉션도 흔적을 남긴다.
   안 남기면 "편 정보 없음" 안내가 영원히 뜨고, 버튼을 눌러도 매번 같은 실패를 반복해
   아무 일도 안 일어나는 것처럼 보인다 (없어진 컬렉션이면 절대 성공하지 않는다). */
function saveCollFailure(collectionId, message) {
  writeCollCache(collectionId, { failed: true, error: String(message || "") });
}

function writeCollCache(id, value) {
  try {
    const c = getCollCache();
    c[id] = { ...value, updatedAt: new Date().toISOString() };
    localStorage.setItem(LS_COLL, JSON.stringify(c));
  } catch { /* 저장 공간 문제면 조용히 넘어간다 (캐시일 뿐) */ }
}

/* 실패로 기록된 컬렉션들을 지워서 다시 시도할 수 있게 한다 */
function clearCollFailures() {
  try {
    const c = getCollCache();
    let n = 0;
    Object.keys(c).forEach(k => { if (c[k] && c[k].failed) { delete c[k]; n++; } });
    localStorage.setItem(LS_COLL, JSON.stringify(c));
    return n;
  } catch { return 0; }
}

/* 자동 매칭 (일괄 채우기용) */
async function tmdbAutoMatch(title, hintType) {
  const { results } = await tmdbSearchSmart(title);
  if (!results.length) return null;
  let best = results[0];
  if (hintType === "드라마" || hintType === "예능") {
    const tv = results.find(r => r.mediaType === "tv"); if (tv) best = tv;
  } else if (hintType === "영화") {
    const mv = results.find(r => r.mediaType === "movie"); if (mv) best = mv;
  }
  const detail = await tmdbDetail(best.tmdbId, best.mediaType);
  detail.otts = await tmdbProviders(best.tmdbId, best.mediaType);
  await applyKoreanNames(detail);      // 일괄 채우기도 한글 이름으로
  return detail;
}

/* ---------- 검색 UI ---------- */
function initTmdb() {
  $("#tmdbSearchBtn").addEventListener("click", runSearch);
  $("#tmdbQuery").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); runSearch(); }
  });
  $("#clearSelection").addEventListener("click", () => {
    State.selectedTmdb = null;
    $("#selectedInfo").classList.add("hidden");
    $("#tmdbSearchArea").classList.remove("hidden");
    $("#manualFields").classList.remove("opacity-50", "pointer-events-none");
  });
}

async function runSearch() {
  const q = $("#tmdbQuery").value.trim();
  if (!q) return;
  const box = $("#tmdbResults");
  box.innerHTML = `<div class="text-center py-4 text-slate-400 text-sm font-medium">
    <i class="fa-solid fa-spinner fa-spin mr-2"></i>검색 중...</div>`;

  try {
    const { results, usedQuery, wasFallback } = await tmdbSearchSmart(q);
    if (!results.length) {
      box.innerHTML = `<div class="text-center py-5 text-slate-400 text-sm font-medium">
        <i class="fa-solid fa-face-frown text-2xl mb-2 block"></i>
        "${esc(q)}" 검색 결과가 없습니다<br>
        <span class="text-xs">제목을 줄여서 다시 검색하거나, 아래에 직접 입력하세요</span></div>`;
      return;
    }
    const notice = wasFallback
      ? `<div class="text-xs font-semibold text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-1">
           "${esc(q)}" 결과가 없어 <b>"${esc(usedQuery)}"</b>로 검색했습니다</div>`
      : "";

    box.innerHTML = notice + results.map((r, i) => `
      <div class="tmdb-item" data-idx="${i}">
        ${r.posterSm
          ? `<img src="${r.posterSm}" alt="">`
          : `<div class="w-[46px] h-[69px] rounded-md bg-slate-200 flex items-center justify-center text-slate-400"><i class="fa-solid fa-image"></i></div>`}
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm text-slate-800">${esc(r.title)}</div>
          ${r.originalTitle && r.originalTitle !== r.title
            ? `<div class="text-xs text-slate-400 font-medium">${esc(r.originalTitle)}</div>` : ""}
          <div class="text-xs text-slate-500 font-medium mt-0.5">
            ${r.mediaType === "tv" ? "📺 TV" : "🎬 영화"} · ${r.year || "연도미상"}
          </div>
          <div class="text-xs text-slate-400 mt-1 line-clamp-2">${esc(r.overview.slice(0, 80))}</div>
        </div>
      </div>`).join("");

    box.querySelectorAll(".tmdb-item").forEach(el => {
      el.addEventListener("click", () => selectTmdb(results[+el.dataset.idx]));
    });
  } catch (e) {
    box.innerHTML = `<div class="text-center py-4 text-red-500 text-sm font-medium">${esc(e.message)}</div>`;
  }
}

async function selectTmdb(item) {
  const box = $("#tmdbResults");
  box.innerHTML = `<div class="text-center py-4 text-slate-400 text-sm font-medium">
    <i class="fa-solid fa-spinner fa-spin mr-2"></i>정보 가져오는 중...</div>`;
  try {
    const d = await tmdbDetail(item.tmdbId, item.mediaType);
    d.otts = await tmdbProviders(item.tmdbId, item.mediaType);
    await applyKoreanNames(d);           // 새로 등록·수정할 때도 한글 이름으로

    // 시리즈에 속하면 "몇 번째 편"까지 등록 시점에 채운다
    if (d.collectionId) {
      try {
        const coll = await tmdbCollection(d.collectionId);
        d.seriesNo = coll.order.get(d.tmdbId) || null;
        d.seriesTotal = coll.total || null;
        if (coll.name) d.collectionName = coll.name;
        saveCollInfo(coll);          // 편 정보도 같이 남겨둔다 (탐색 탭 이어보기용)
      } catch { /* 편 번호는 못 가져와도 등록은 계속 */ }
    }

    State.selectedTmdb = d;
    renderSelected(d);
    applyTmdbToForm(d);
    box.innerHTML = "";
  } catch (e) {
    box.innerHTML = `<div class="text-center py-4 text-red-500 text-sm font-medium">${esc(e.message)}</div>`;
  }
}

/* 선택 정보 → 폼 반영 */
function applyTmdbToForm(d) {
  $("#fTitle").value = d.title;
  if (d.type) $("#fType").value = d.type;
  if (d.country) $("#fCountry").value = d.country;

  // OTT 자동판별: 영화관 체크 아닐 때만
  if (!$("#fTheater").checked) {
    if (d.otts && d.otts.length) {
      setOttOptions(d.otts, d.otts[0]);
    } else {
      setOttOptions([], null); // 폴백: 직접 선택
    }
  }

  // 시즌 드롭다운
  buildSeasonSelect(d.seasons);
}

function renderSelected(d) {
  $("#selPoster").src = d.poster || "";
  $("#selPoster").style.display = d.poster ? "" : "none";
  $("#selTitle").textContent = d.title || "";

  const metaBits = [];
  if (d.type) metaBits.push(d.type);
  if (d.country) metaBits.push(d.country);
  if (d.releaseYear) metaBits.push(d.releaseYear);
  if (d.runtime) metaBits.push(d.runtime + "분");
  if (d.totalEpisodes) metaBits.push("총 " + d.totalEpisodes + "화");
  $("#selMeta").textContent = metaBits.join(" · ");

  const chips = [];
  if (d.collectionName) {
    chips.push(`<span class="badge badge-season"><i class="fa-solid fa-layer-group mr-1"></i>${esc(d.collectionName)}${d.seriesNo ? ` S${d.seriesNo}` : ""}</span>`);
  }
  if (d.voteAverage) chips.push(`<span class="badge badge-vote"><i class="fa-solid fa-star mr-1"></i>${d.voteAverage}</span>`);
  if (d.cert) chips.push(`<span class="badge badge-cert">${esc(d.cert)}</span>`);
  if (d.otts && d.otts.length) chips.push(`<span class="badge badge-ott">${esc(d.otts.join(", "))}</span>`);
  visibleGenres(d.genres).forEach(g => chips.push(`<span class="badge badge-genre">${esc(g)}</span>`));
  $("#selGenres").innerHTML = chips.join("");

  const castStr = (d.cast || []).slice(0, 5).map(c => c.name).join(", ");
  $("#selCast").innerHTML = castStr ? `<i class="fa-solid fa-users mr-1 text-pink-400"></i>${esc(castStr)}` : "";
  $("#selOverview").textContent = d.overview || "";

  $("#selectedInfo").classList.remove("hidden");
  $("#tmdbSearchArea").classList.add("hidden");
}
