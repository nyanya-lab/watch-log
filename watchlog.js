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

function mapType(mediaType, genres) {
  const g = (genres || []).map(x => x.name || x);
  if (g.includes("애니메이션") || g.includes("Animation")) return "애니";
  if (g.includes("다큐멘터리") || g.includes("Documentary")) return "다큐";
  if (g.includes("리얼리티") || g.includes("Reality")) return "예능";
  if (g.includes("토크") || g.includes("Talk")) return "예능";
  return mediaType === "tv" ? "드라마" : "영화";
}

/* ---------- 제목 변형 생성 (검색 실패 시 재시도용) ---------- */
function titleVariants(title) {
  const t = (title || "").trim();
  const out = [t];
  const push = (s) => {
    s = (s || "").trim().replace(/\s+/g, " ");
    if (s && s.length >= 2 && !out.includes(s)) out.push(s);
  };

  // 콜론/대시/물결 앞부분만
  push(t.split(/\s*[:：]\s*/)[0]);
  push(t.split(/\s*[-–—]\s*/)[0]);
  push(t.split(/\s*[,·]\s*/)[0]);

  // 괄호 제거
  push(t.replace(/[([{（].*?[)\]}）]/g, ""));

  // 시즌/파트 표기 제거
  push(t.replace(/\s*(시즌|season|part|파트)\s*\d+.*$/i, ""));
  push(t.replace(/\s*\d+$/, ""));

  // 조사/기호 정리
  push(t.replace(/[^\w가-힣\s]/g, " "));

  // 띄어쓰기 제거 / 첫 두 단어
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

/* 변형 제목까지 시도하는 검색 — { results, usedQuery, wasFallback } */
async function tmdbSearchSmart(query) {
  const variants = titleVariants(query);
  for (let i = 0; i < variants.length; i++) {
    const results = await tmdbSearchRaw(variants[i]);
    if (results.length) {
      return { results, usedQuery: variants[i], wasFallback: i > 0 };
    }
    if (i < variants.length - 1) await new Promise(r => setTimeout(r, 120));
  }
  return { results: [], usedQuery: query, wasFallback: false };
}

/* 하위호환 */
async function tmdbSearch(q) { return (await tmdbSearchSmart(q)).results; }

/* ---------- 상세 (출연진 포함) ---------- */
async function tmdbDetail(id, mediaType) {
  const key = getTmdbKey();
  const url = `${TMDB_BASE}/${mediaType}/${id}?api_key=${key}&language=ko-KR&append_to_response=credits`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("TMDB 상세 조회 실패");
  const d = await res.json();

  const originCountry = d.origin_country || [];
  const prodCountries = d.production_countries || [];
  let country = "";
  if (originCountry.length) country = COUNTRY_KO[originCountry[0]] || originCountry[0];
  else if (prodCountries.length) country = COUNTRY_KO[prodCountries[0].iso_3166_1] || prodCountries[0].name;

  const cast = ((d.credits && d.credits.cast) || [])
    .slice(0, 8)
    .map(c => ({ name: c.name, character: c.character || "" }));

  const crew = (d.credits && d.credits.crew) || [];
  const director = crew.find(c => c.job === "Director");
  const creator = (d.created_by || [])[0];

  return {
    tmdbId: d.id,
    mediaType,
    title: d.title || d.name || "",
    poster: d.poster_path ? TMDB_IMG + d.poster_path : null,
    genres: (d.genres || []).map(g => g.name),
    overview: d.overview || "",
    country: country || "",
    releaseYear: (d.release_date || d.first_air_date || "").slice(0, 4),
    totalSeasons: d.number_of_seasons || null,
    cast,
    director: director ? director.name : (creator ? creator.name : ""),
    type: mapType(mediaType, d.genres)
  };
}

/* 제목으로 자동 매칭 */
async function tmdbAutoMatch(title, hintType) {
  const { results } = await tmdbSearchSmart(title);
  if (!results.length) return null;

  let best = results[0];
  if (hintType === "드라마" || hintType === "예능") {
    const tv = results.find(r => r.mediaType === "tv");
    if (tv) best = tv;
  } else if (hintType === "영화") {
    const mv = results.find(r => r.mediaType === "movie");
    if (mv) best = mv;
  }
  return await tmdbDetail(best.tmdbId, best.mediaType);
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
        <span class="text-xs">제목을 줄여서 다시 검색해보세요</span></div>`;
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
    State.selectedTmdb = d;
    renderSelected(d);

    // 검색으로 선택한 제목으로 덮어쓰기
    $("#fTitle").value = d.title;
    if (d.type) $("#fType").value = d.type;
    if (d.country) $("#fCountry").value = d.country;

    box.innerHTML = "";
  } catch (e) {
    box.innerHTML = `<div class="text-center py-4 text-red-500 text-sm font-medium">${esc(e.message)}</div>`;
  }
}

function renderSelected(d) {
  $("#selPoster").src = d.poster || "";
  $("#selPoster").style.display = d.poster ? "" : "none";
  $("#selTitle").textContent = d.title || "";
  $("#selMeta").textContent = [d.type, d.country, d.releaseYear,
    d.totalSeasons ? `시즌 ${d.totalSeasons}개` : null].filter(Boolean).join(" · ");
  $("#selGenres").innerHTML = (d.genres || []).map(g => `<span class="badge badge-genre">${esc(g)}</span>`).join("");

  const castStr = (d.cast || []).slice(0, 5).map(c => c.name).join(", ");
  $("#selCast").innerHTML = castStr
    ? `<i class="fa-solid fa-users mr-1 text-slate-400"></i>${esc(castStr)}`
    : "";
  $("#selOverview").textContent = d.overview || "";

  $("#selectedInfo").classList.remove("hidden");
  $("#tmdbSearchArea").classList.add("hidden");
}
