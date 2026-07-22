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
      overview: r.overview || ""
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

  const cast = ((d.credits && d.credits.cast) || [])
    .slice(0, 8).map(c => ({ name: c.name, character: c.character || "" }));

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

  return {
    tmdbId: d.id,
    mediaType,
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
    status: d.status || "",
    type: mapType(mediaType, d.genres)
  };
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
  if (d.voteAverage) chips.push(`<span class="badge badge-vote"><i class="fa-solid fa-star mr-1"></i>${d.voteAverage}</span>`);
  if (d.cert) chips.push(`<span class="badge badge-cert">${esc(d.cert)}</span>`);
  if (d.otts && d.otts.length) chips.push(`<span class="badge badge-ott">${esc(d.otts.join(", "))}</span>`);
  (d.genres || []).forEach(g => chips.push(`<span class="badge badge-genre">${esc(g)}</span>`));
  $("#selGenres").innerHTML = chips.join("");

  const castStr = (d.cast || []).slice(0, 5).map(c => c.name).join(", ");
  $("#selCast").innerHTML = castStr ? `<i class="fa-solid fa-users mr-1 text-pink-400"></i>${esc(castStr)}` : "";
  $("#selOverview").textContent = d.overview || "";

  $("#selectedInfo").classList.remove("hidden");
  $("#tmdbSearchArea").classList.add("hidden");
}
