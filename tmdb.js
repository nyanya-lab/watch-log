/* ============================================
   tmdb.js — TMDB API 검색 및 정보 추출
   ============================================ */

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_IMG_SM = "https://image.tmdb.org/t/p/w92";

function getTmdbKey() {
  return localStorage.getItem(LS_TMDB) || "";
}

function setTmdbKey(k) {
  localStorage.setItem(LS_TMDB, k.trim());
}

/* 국가코드 → 한글 */
const COUNTRY_KO = {
  KR: "한국", US: "미국", JP: "일본", CN: "중국", GB: "영국",
  FR: "프랑스", DE: "독일", ES: "스페인", IT: "이탈리아",
  TW: "대만", TH: "태국", IN: "인도", CA: "캐나다", AU: "호주",
  HK: "홍콩", RU: "러시아", BR: "브라질", MX: "멕시코", SE: "스웨덴"
};

/* TMDB 미디어타입 → 앱 구분 */
function mapType(mediaType, genres) {
  const g = (genres || []).map(x => x.name || x);
  if (g.includes("Animation") || g.includes("애니메이션")) return "애니";
  if (g.includes("Documentary") || g.includes("다큐멘터리")) return "다큐";
  if (g.includes("Reality") || g.includes("리얼리티")) return "예능";
  if (g.includes("Talk") || g.includes("토크")) return "예능";
  return mediaType === "tv" ? "드라마" : "영화";
}

/* 멀티 검색 */
async function tmdbSearch(query) {
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

/* 상세 정보 */
async function tmdbDetail(id, mediaType) {
  const key = getTmdbKey();
  const url = `${TMDB_BASE}/${mediaType}/${id}?api_key=${key}&language=ko-KR`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("TMDB 상세 조회 실패");
  const d = await res.json();

  const countries = d.production_countries || [];
  const originCountry = d.origin_country || [];
  let country = "";
  if (originCountry.length) country = COUNTRY_KO[originCountry[0]] || originCountry[0];
  else if (countries.length) country = COUNTRY_KO[countries[0].iso_3166_1] || countries[0].name;

  return {
    tmdbId: d.id,
    mediaType,
    title: d.title || d.name || "",
    poster: d.poster_path ? TMDB_IMG + d.poster_path : null,
    genres: (d.genres || []).map(g => g.name),
    overview: d.overview || "",
    country: country || "",
    releaseYear: (d.release_date || d.first_air_date || "").slice(0, 4),
    seasons: d.number_of_seasons || null,
    type: mapType(mediaType, d.genres)
  };
}

/* 제목으로 자동 매칭 (일괄 채우기용) */
async function tmdbAutoMatch(title, hintType) {
  const results = await tmdbSearch(title);
  if (!results.length) return null;

  let best = results[0];
  if (hintType === "드라마") {
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
    const results = await tmdbSearch(q);
    if (!results.length) {
      box.innerHTML = `<div class="text-center py-4 text-slate-400 text-sm font-medium">검색 결과가 없습니다</div>`;
      return;
    }
    box.innerHTML = results.map((r, i) => `
      <div class="tmdb-item" data-idx="${i}">
        ${r.posterSm
          ? `<img src="${r.posterSm}" alt="">`
          : `<div class="w-[46px] h-[69px] rounded-md bg-slate-200 flex items-center justify-center text-slate-400"><i class="fa-solid fa-image"></i></div>`}
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm text-slate-800">${esc(r.title)}</div>
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

    $("#selPoster").src = d.poster || "";
    $("#selPoster").style.display = d.poster ? "" : "none";
    $("#selTitle").textContent = d.title;
    $("#selMeta").textContent = [d.type, d.country, d.releaseYear,
      d.seasons ? `시즌 ${d.seasons}개` : null].filter(Boolean).join(" · ");
    $("#selGenres").innerHTML = d.genres.map(g => `<span class="badge badge-genre">${esc(g)}</span>`).join("");
    $("#selOverview").textContent = d.overview;

    $("#selectedInfo").classList.remove("hidden");
    $("#tmdbSearchArea").classList.add("hidden");

    if (!$("#fTitle").value.trim()) $("#fTitle").value = d.title;
    if (d.type) $("#fType").value = d.type;
    if (d.country) $("#fCountry").value = d.country;

    box.innerHTML = "";
  } catch (e) {
    box.innerHTML = `<div class="text-center py-4 text-red-500 text-sm font-medium">${esc(e.message)}</div>`;
  }
}
