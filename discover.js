/* ============================================
   discover.js — 탐색 탭
   목록 탭이 "이미 본 기록"이라면, 이 탭은 "볼 것"을 다룬다.
     · 검색      — TMDB 전체에서 찾기 (안 본 작품 포함). 내 기록이 있으면 겹쳐서 보여준다
     · 이어보기  — 시즌이 여러 개인데 일부만 본 작품
     · 보고싶어요 — 나중에 볼 작품 담아두기 (State.wishes)
   ============================================ */

const Discover = {
  view: "reco",      // reco=추천 | next=이어보기 | wish=보고싶어요 | search=검색 결과 | fr=시리즈
  frKey: "mcu",      // 시리즈 뷰에서 보고 있는 프랜차이즈
  frStory: false,    // 스토리 시간순으로 볼지 (기본은 개봉일 순)
  recoType: "",      // 추천 뷰의 구분 필터 ("" | movie | tv)
  reco: null,        // 캐시된 추천 결과
  query: "",
  usedQuery: "",
  wasFallback: false,
  results: [],
  searching: false,
  _byId: new Map()   // 화면에 그려진 카드의 원본 데이터 (버튼 핸들러가 참조)
};

/* ---------- 보고싶어요 (위시리스트) ----------
   시청 기록(State.items)과 섞지 않는다. 섞으면 통계·히트맵·시리즈 묶기가
   "아직 안 본 작품"까지 집계하게 되기 때문. 저장·동기화는 core.js가 함께 처리. */
function isWished(tmdbId) {
  return State.wishes.some(w => w.tmdbId === tmdbId);
}

function addWish(w) {
  if (isWished(w.tmdbId)) return false;
  State.wishes.unshift({
    id: uid(),
    tmdbId: w.tmdbId,
    mediaType: w.mediaType || "movie",
    title: w.title || "",
    originalTitle: w.originalTitle || "",
    poster: w.poster || null,
    year: w.year || "",
    voteAverage: w.voteAverage ?? null,
    overview: w.overview || "",
    otts: w.otts || [],                 // 담는 시점에 한 번 조회 (목록 응답엔 없는 정보)
    reason: w.reason || "",             // 추천으로 담았다면 그 이유
    addedAt: new Date().toISOString()
  });
  saveLocal();
  return true;
}

function removeWish(tmdbId) {
  const before = State.wishes.length;
  State.wishes = State.wishes.filter(w => w.tmdbId !== tmdbId);
  if (State.wishes.length !== before) saveLocal();
}

/* ---------- 관심없음 ----------
   추천·검색에서 계속 나오는데 볼 생각이 없는 작품을 걸러낸다.
   위시와 같은 이유로 items와 섞지 않는다 (본 게 아니니까). */
function isHidden(tmdbId) {
  return State.hides.some(h => h.tmdbId === tmdbId);
}

function addHide(h) {
  if (isHidden(h.tmdbId)) return false;
  State.hides.unshift({
    id: uid(),
    tmdbId: h.tmdbId,
    mediaType: h.mediaType || "movie",
    title: h.title || "",
    poster: h.poster || null,
    year: h.year || "",
    voteAverage: h.voteAverage ?? null,
    addedAt: new Date().toISOString()
  });
  // 관심없음으로 옮기면 위시에는 남겨둘 이유가 없다
  removeWish(h.tmdbId);
  saveLocal();
  return true;
}

function removeHide(tmdbId) {
  const before = State.hides.length;
  State.hides = State.hides.filter(h => h.tmdbId !== tmdbId);
  if (State.hides.length !== before) saveLocal();
}

/* ---------- 이 작품에 대한 "내 상태" ----------
   봤는지 / 어느 시즌까지 봤는지 / 위시에 담아뒀는지 */
function myStatus(tmdbId) {
  const wished = isWished(tmdbId);
  const hidden = isHidden(tmdbId);
  const recs = State.items.filter(i => i.tmdbId === tmdbId);
  if (!recs.length) return { watched: false, wished, hidden, recs: [], missing: [] };

  const total = Math.max(...recs.map(r => r.totalSeasons || 0), 0);
  const seen = new Set();
  recs.forEach(r => {
    const n = parseInt(String(r.season || "").replace(/\D/g, ""));
    if (n) seen.add(n);
  });

  const missing = [];
  if (total > 1 && seen.size) {
    for (let n = 1; n <= total; n++) if (!seen.has(n)) missing.push(n);
  }

  return {
    watched: true,
    wished,
    hidden,
    recs,
    rating: Math.max(...recs.map(r => r.rating || 0)) || null,
    totalSeasons: total,
    seenSeasons: [...seen].sort((a, b) => a - b),
    missing,
    // 시즌이 여러 개인데 몇 시즌을 봤는지 안 적어둔 경우 (목록 탭 "시즌 미기록"이 담당)
    unknownSeason: total > 1 && seen.size === 0
  };
}

/* 저장된 구분(type)으로 TMDB media_type 추정 */
function mediaTypeOf(item) {
  return item.type === "영화" ? "movie" : "tv";
}

/* ---------- 이어보기 목록 ----------
   시즌이 2개 이상인데 일부만 본 작품. (예: 총 2시즌인데 S1만 기록됨 → S2 안 봄) */
function continueList() {
  const byId = new Map();
  State.items.forEach(i => {
    if (!i.tmdbId || !((i.totalSeasons || 0) > 1)) return;
    if (!byId.has(i.tmdbId)) byId.set(i.tmdbId, []);
    byId.get(i.tmdbId).push(i);
  });

  const dkey = (x) => x.lastWatchStart || x.startDate || "";
  const out = [];
  byId.forEach((recs, tmdbId) => {
    const st = myStatus(tmdbId);
    if (!st.missing.length) return;
    const main = recs.slice().sort((a, b) => dkey(b).localeCompare(dkey(a)))[0];
    out.push({ tmdbId, mediaType: mediaTypeOf(main), item: main, st });
  });

  return out.sort((a, b) => dkey(b.item).localeCompare(dkey(a.item)));
}

/* ============================================
   추천
   두 갈래를 섞는다.
     ① 유사작  — 내가 좋아한 작품의 TMDB /recommendations (근거가 구체적)
     ② 취향 발굴 — 내 장르 프로필로 /discover (안 본 영역까지 넓게)
   결과는 캐시해 두고, "다시 추천받기"를 눌렀을 때만 다시 조회한다.
   ============================================ */

const LS_RECO = "watchlog_reco";

/* 받침에 따라 조사 고르기 ("오징어 게임과" / "기생충과" → "해리포터와") */
function josa(word, withBatchim, without) {
  const ch = String(word || "").trim().slice(-1);
  if (!ch) return withBatchim;
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return withBatchim;   // 한글이 아니면 기본형
  return ((code - 0xac00) % 28) ? withBatchim : without;
}

/* 이 기록이 "내 취향"을 얼마나 대변하는지.
   별점이 달린 기록이 몇 개 없으므로(노션 원본 268개 중 9개) 재시청·최근 시청도 신호로 쓴다. */
function seedWeight(i) {
  const r = i.rating || 0;
  let w;
  if (r >= 10) w = 3.0;
  else if (r >= 9) w = 2.6;
  else if (r >= 8) w = 2.2;
  else if (r >= 7) w = 1.4;
  else if (r >= 6) w = 0.9;
  else if (r > 0) return 0;          // 낮게 준 작품은 취향 신호로 쓰지 않는다
  else w = 0.6;                       // 별점 없음 = 중립

  if ((i.watchCount || 1) > 1 || i.lastWatchStart) w += 1.5;   // 재시청 = 확실히 좋아함
  const y = +((i.startDate || "").slice(0, 4));
  if (y && y >= new Date().getFullYear() - 1) w += 0.4;        // 최근 취향에 가중
  return w;
}

/* 내 기록에서 뽑아낸 취향 프로필 */
function tasteProfile() {
  const genre = new Map(), country = new Map();
  const seeds = [];

  State.items.forEach(i => {
    const w = seedWeight(i);
    if (w <= 0) return;
    visibleGenres(i.genres).forEach(g => genre.set(g, (genre.get(g) || 0) + w));
    if (i.country) country.set(i.country, (country.get(i.country) || 0) + w);
    if (i.tmdbId) seeds.push({ item: i, w });
  });

  // 같은 작품·같은 시리즈는 시드에 한 번만 (해리포터 8편이 시드를 다 잡아먹지 않게)
  // 가중치가 같으면 섞어서, "다시 추천받기"마다 다른 작품이 시드가 되도록 한다
  const usedId = new Set(), usedColl = new Set();
  const picked = [];
  seeds.sort((a, b) => b.w - a.w || Math.random() - 0.5).forEach(s => {
    const i = s.item;
    if (usedId.has(i.tmdbId)) return;
    if (i.collectionId && usedColl.has(i.collectionId)) return;
    usedId.add(i.tmdbId);
    if (i.collectionId) usedColl.add(i.collectionId);
    picked.push(s);
  });

  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { genres: top(genre, 5), countries: top(country, 3), seeds: picked };
}

/* 후보 장르가 내 취향 장르와 얼마나 겹치나 (0~1 가중치 합) */
function genreMatchScore(card, gmap, profMap, maxW) {
  const names = (gmap[card.mediaType] || [])
    .filter(g => (card.genreIds || []).includes(g.id))
    .flatMap(g => g.names);
  let s = 0;
  [...new Set(names)].forEach(n => { if (profMap.has(n)) s += profMap.get(n) / maxW; });
  return s;
}

let _recoRunning = false;

async function runReco() {
  if (_recoRunning) { toast("추천을 만드는 중입니다"); return; }
  if (!getTmdbKey()) { toast("설정 탭에서 TMDB API 키를 먼저 저장하세요", "error"); return; }

  const prof = tasteProfile();
  if (!prof.seeds.length) { toast("TMDB 정보가 있는 기록이 있어야 추천할 수 있어요", "error"); return; }

  _recoRunning = true;
  const seeds = prof.seeds.slice(0, 10);
  const profMap = new Map(prof.genres);
  const maxW = prof.genres.length ? prof.genres[0][1] : 1;

  const cand = new Map();
  const seenIds = new Set(State.items.map(i => i.tmdbId).filter(Boolean));
  const gmap = await tmdbGenreMap();

  const bump = (card, score, reason) => {
    if (!card.tmdbId || !card.poster) return;        // 포스터 없는 건 카드가 허전해서 뺀다
    if (seenIds.has(card.tmdbId)) return;            // 이미 본 작품
    if (isHidden(card.tmdbId)) return;               // 관심없음으로 넘긴 작품
    if ((card.voteCount || 0) < 50) return;          // 표본이 너무 적은 작품
    const c = cand.get(card.tmdbId) || { card, score: 0, reasons: [] };
    c.score += score;
    if (reason && !c.reasons.includes(reason)) c.reasons.push(reason);
    cand.set(card.tmdbId, c);
  };

  const setStatus = (msg, pct) => {
    $("#dcRecoStatus").textContent = msg;
    $("#dcRecoBarFill").style.width = pct.toFixed(0) + "%";
  };
  $("#dcRecoProgress").classList.remove("hidden");

  const genreNames = prof.genres.slice(0, 2).map(g => g[0]);
  const totalSteps = seeds.length + genreNames.length * 2;
  let step = 0;

  try {
    // ① 내가 좋아한 작품과 비슷한 작품
    for (const s of seeds) {
      const i = s.item;
      setStatus(`「${i.title}」과 비슷한 작품 찾는 중...`, ++step / totalSteps * 100);
      try {
        const list = await tmdbRecommendations(i.tmdbId, mediaTypeOf(i));
        const label = `「${i.title}」${josa(i.title, "과", "와")} 비슷`;
        list.slice(0, 12).forEach((c, idx) => bump(c, s.w * (1.2 - idx * 0.04), label));
      } catch { /* 한 시드가 실패해도 계속 */ }
      await new Promise(r => setTimeout(r, 240));
    }

    // ② 취향 장르로 발굴 (안 본 영역까지)
    for (const gname of genreNames) {
      for (const mt of ["movie", "tv"]) {
        setStatus(`${gname} ${mt === "movie" ? "영화" : "시리즈"} 찾아보는 중...`, ++step / totalSteps * 100);
        const ids = (gmap[mt] || []).filter(g => g.names.includes(gname)).map(g => g.id);
        if (!ids.length) continue;
        try {
          const list = await tmdbDiscoverList(mt, {
            with_genres: ids.join("|"),
            sort_by: "popularity.desc",
            "vote_average.gte": "7",
            "vote_count.gte": "200"
          });
          const gw = (profMap.get(gname) || 1) / maxW;
          list.slice(0, 16).forEach((c, idx) => bump(c, 0.9 * gw * (1 - idx * 0.03), `${gname} 취향`));
        } catch { /* 무시하고 계속 */ }
        await new Promise(r => setTimeout(r, 240));
      }
    }

    // 장르 매칭·평점 보정 후 정렬
    const list = [...cand.values()].map(c => {
      const gm = genreMatchScore(c.card, gmap, profMap, maxW);
      const vote = c.card.voteAverage ? (c.card.voteAverage - 6.8) * 0.2 : 0;
      return { ...c.card, score: c.score + gm * 0.5 + vote, reason: c.reasons[0] || "" };
    }).sort((a, b) => b.score - a.score).slice(0, 60);

    const data = { generatedAt: new Date().toISOString(), basis: genreNames, list };
    localStorage.setItem(LS_RECO, JSON.stringify(data));
    Discover.reco = data;

    setStatus(`추천 ${list.length}개를 골랐어요`, 100);
    setTimeout(() => $("#dcRecoProgress").classList.add("hidden"), 1200);
    toast(`추천 ${list.length}개를 새로 골랐습니다`, "success");
  } catch (e) {
    $("#dcRecoProgress").classList.add("hidden");
    toast("추천 실패: " + e.message, "error");
  } finally {
    _recoRunning = false;
    Discover.view = "reco";
    renderDiscover();
  }
}

function loadReco() {
  if (Discover.reco) return Discover.reco;
  try { Discover.reco = JSON.parse(localStorage.getItem(LS_RECO) || "null"); }
  catch { Discover.reco = null; }
  return Discover.reco;
}

/* 추천 목록 */
function renderDcReco() {
  $("#dcHint").classList.add("hidden");
  $("#dcRecoBar").classList.remove("hidden");

  const data = loadReco();
  const info = $("#dcRecoInfo");
  $("#dcRecoBtn").innerHTML = `<i class="fa-solid fa-wand-magic-sparkles mr-1"></i>${data ? "다시 추천받기" : "추천 받기"}`;
  if (data) {
    const d = new Date(data.generatedAt);
    const p = (n) => String(n).padStart(2, "0");
    info.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles mr-1"></i>
      ${(data.basis || []).length ? `<b>${esc(data.basis.join("·"))}</b> 취향 기준 · ` : ""}
      ${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 기준`;
  } else {
    info.innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i>아직 추천을 만들지 않았어요. 오른쪽 버튼을 눌러보세요.`;
  }

  const mt = Discover.recoType;   // "" | movie | tv
  const list = (data ? data.list : [])
    // 캐시를 만든 뒤에 기록하거나 관심없음으로 넘긴 작품은 빼고 보여준다
    .filter(c => !State.items.some(i => i.tmdbId === c.tmdbId))
    .filter(c => !isHidden(c.tmdbId))
    .filter(c => !mt || c.mediaType === mt)
    .map(c => ({
      tmdbId: c.tmdbId, mediaType: c.mediaType, title: c.title,
      poster: c.poster, year: c.year, voteAverage: c.voteAverage,
      note: c.reason ? `<span class="badge badge-genre">${esc(c.reason)}</span>` : "",
      actions: [
        { act: "wish", label: isWished(c.tmdbId) ? "담아둠" : "보고싶어요", icon: "fa-bookmark",
          cls: isWished(c.tmdbId) ? "dc-btn-on" : "dc-btn-main" },
        { act: "add", label: "봤어요", icon: "fa-plus" },
        { act: "hide", label: "", icon: "fa-ban", cls: "dc-btn-icon", title: "관심없음 — 추천에서 빼기" }
      ],
      _raw: c
    }));

  paintDcCards(list, `
    <i class="fa-solid fa-wand-magic-sparkles text-4xl mb-3"></i>
    <p class="font-medium">아직 추천이 없어요</p>
    <p class="text-sm mt-1">"추천 받기"를 누르면 내 기록을 바탕으로 골라옵니다.</p>`);
}

/* ---------- 영화 시리즈 이어보기 ----------
   TV는 `totalSeasons`로 안 본 시즌을 알 수 있지만, 영화에는 그 필드가 없다.
   영화는 TMDB 컬렉션(`collectionId`)의 편 목록과 내 기록을 맞춰봐야 한다.

   미개봉 편은 뺀다 — TMDB 컬렉션에는 발표만 된 속편도 들어있어서
   (분노의 질주 12편, 범죄도시 5편 등) 그대로 두면 볼 수 없는 걸 "안 봤다"고 띄운다. */
function movieContinueList() {
  const cache = getCollCache();
  const today = new Date().toISOString().slice(0, 10);
  const dkey = (x) => x.lastWatchStart || x.startDate || "";

  const byColl = new Map();
  State.items.forEach(i => {
    if (i.type !== "영화" || !i.collectionId) return;
    if (!byColl.has(i.collectionId)) byColl.set(i.collectionId, []);
    byColl.get(i.collectionId).push(i);
  });

  const out = [];
  byColl.forEach((recs, cid) => {
    const info = cache[cid];
    if (!info || !info.parts) return;            // 편 정보가 없거나 조회에 실패한 시리즈

    /* 본 편 판정을 tmdbId와 편 번호 둘 다로 한다.
       속편이 1편의 tmdbId를 물고 있는 기록이 남아 있을 수 있어서(매칭 확인 참고),
       tmdbId만 보면 실제로 본 편을 "안 봤다"고 잘못 잡는다. */
    const seenId = new Set(recs.map(r => r.tmdbId).filter(Boolean));
    const seenNo = new Set(recs.map(r =>
      r.seriesNo || parseInt(String(r.season || "").replace(/\D/g, "")) || 0).filter(Boolean));

    const released = info.parts.filter(p => p.releaseDate && p.releaseDate <= today);
    const missing = released.filter(p => !seenId.has(p.tmdbId) && !seenNo.has(p.no));
    if (!missing.length) return;

    /* 본 편 번호. 1편부터 차례로 본 게 아니라 중간부터 봤을 수도 있어서,
       개수("3편 봄")만으로는 뭘 봤는지 알 수 없다. TV 카드와 같이 번호를 보여준다. */
    const seenNos = released.filter(p => seenId.has(p.tmdbId) || seenNo.has(p.no)).map(p => p.no);

    const main = recs.slice().sort((a, b) => dkey(b).localeCompare(dkey(a)))[0];
    out.push({
      kind: "movie", collectionId: cid, info, recs, main, missing, seenNos,
      watched: recs.length,
      upcoming: info.parts.length - released.length,   // 아직 안 나온 편 수 (안내용)
      sortKey: dkey(main)
    });
  });

  return out;
}

/* 편 정보를 아직 안 가져온 영화 시리즈.
   조회에 실패해 `failed`로 기록된 것은 제외한다 — 없어진 컬렉션이면 다시 눌러도 계속 실패하고,
   그러면 안내바가 영원히 뜬 채로 버튼이 먹지 않는 것처럼 보인다. */
function collsNeedingParts() {
  const cache = getCollCache();
  const ids = new Set();
  State.items.forEach(i => {
    if (i.type !== "영화" || !i.collectionId) return;
    if (!cache[i.collectionId]) ids.add(i.collectionId);
  });
  return [...ids];
}

/* 조회에 실패한 컬렉션 수 (안내에만 씀) */
function collsFailedCount() {
  const cache = getCollCache();
  const ids = new Set();
  State.items.forEach(i => {
    if (i.type === "영화" && i.collectionId) {
      const c = cache[i.collectionId];
      if (c && c.failed) ids.add(i.collectionId);
    }
  });
  return ids.size;
}

/* 그 시리즈들의 편 정보를 받아온다 (시리즈당 1회) */
let _partsFetching = false;
async function runFetchCollParts() {
  if (_partsFetching) return;
  if (!getTmdbKey()) { toast("설정 탭에서 TMDB API 키를 먼저 저장하세요", "error"); return; }

  const ids = collsNeedingParts();
  if (!ids.length) { toast("가져올 시리즈가 없습니다"); renderDiscover(); return; }

  _partsFetching = true;
  const msg = $("#dcPartsMsg");
  let ok = 0;
  const failed = [];
  try {
    for (let n = 0; n < ids.length; n++) {
      msg.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>시리즈 편 정보 ${n + 1} / ${ids.length} 가져오는 중...`;
      try {
        saveCollInfo(await tmdbCollection(ids[n]));
        ok++;
      } catch (e) {
        // 실패도 기록해 둔다. 안 그러면 이 안내가 사라지지 않는다.
        saveCollFailure(ids[n], e.message);
        failed.push({ id: ids[n], error: e.message });
      }
      await new Promise(r => setTimeout(r, 240));
    }
  } finally {
    _partsFetching = false;
  }

  if (failed.length) {
    console.warn("컬렉션 편 정보 조회 실패:", failed);
    toast(`${ok}개 완료 · ${failed.length}개는 TMDB에서 못 찾았습니다`, failed.length > ok ? "error" : "info");
  } else {
    toast(`시리즈 ${ok}개의 편 정보를 가져왔습니다`, "success");
  }
  renderDiscover();
}

/* ---------- 없어진 시리즈 복구 ----------
   TMDB에서 컬렉션이 삭제·병합되면 기록이 들고 있던 `collectionId`가 404가 된다.
   이때 같은 요청을 "다시 시도"해봐야 구조적으로 영영 같은 404다 — 고쳐야 할 건
   TMDB가 아니라 **내 기록이 들고 있는 번호**다. 그래서 그 작품의 상세를 다시 받아
   지금의 컬렉션으로 갈아끼우고, 컬렉션에서 아예 빠졌으면 비운다.
   별점·본 날짜·한줄평 같은 내 기록은 건드리지 않는다. */
async function runFixDeadColls() {
  if (_partsFetching) return;
  if (!getTmdbKey()) { toast("설정 탭에서 TMDB API 키를 먼저 저장하세요", "error"); return; }

  const cache = getCollCache();
  const failedIds = [...new Set(State.items
    .filter(i => i.type === "영화" && i.collectionId && cache[i.collectionId] && cache[i.collectionId].failed)
    .map(i => String(i.collectionId)))];
  if (!failedIds.length) { toast("고칠 시리즈가 없습니다"); renderDiscover(); return; }

  const msg = $("#dcPartsMsg");
  _partsFetching = true;
  try {
    /* 0) 먼저 컬렉션을 한 번 더 조회해 본다.
       실패가 404(없어짐)가 아니라 일시적 네트워크 오류였을 수도 있는데,
       그때 곧장 작품 연결을 고치러 가면 TMDB가 같은 id를 돌려줘서
       "고칠 수 없다"는 엉뚱한 결론이 난다. 살아 있으면 여기서 그냥 끝난다. */
    const dead = [];
    let revived = 0;
    for (let n = 0; n < failedIds.length; n++) {
      msg.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>시리즈 확인 ${n + 1} / ${failedIds.length}...`;
      try {
        saveCollInfo(await tmdbCollection(failedIds[n]));
        revived++;
      } catch {
        dead.push(failedIds[n]);
      }
      await new Promise(r => setTimeout(r, 240));
    }

    if (!dead.length) {
      renderDiscover();
      toast(`시리즈 ${revived}개의 편 정보를 가져왔습니다 (일시적 오류였어요)`, "success");
      return;
    }

    const targets = State.items.filter(i =>
      i.type === "영화" && i.collectionId && dead.includes(String(i.collectionId)));

    // 1) 작품마다 지금의 컬렉션이 뭔지 다시 확인해 계획을 만든다
    const plan = [];
    for (let n = 0; n < targets.length; n++) {
      const i = targets[n];
      msg.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>작품 정보 다시 확인 ${n + 1} / ${targets.length} — ${esc(i.title)}`;
      const p = { item: i, oldId: String(i.collectionId) };
      if (!i.tmdbId) {
        p.error = "TMDB 미등록";               // 다시 확인할 근거가 없다
      } else {
        try {
          const d = await tmdbDetail(i.tmdbId, "movie");
          p.newId = d.collectionId || null;
          p.newName = d.collectionName || "";
        } catch (e) { p.error = e.message; }
        await new Promise(r => setTimeout(r, 240));
      }
      plan.push(p);
    }

    const change = plan.filter(p => !p.error && String(p.newId) !== p.oldId);
    const same = plan.filter(p => !p.error && String(p.newId) === p.oldId);
    const errs = plan.filter(p => p.error);

    const revivedNote = revived ? ` (${revived}개는 다시 조회돼 해결됨)` : "";

    if (!change.length) {
      /* 작품 쪽도 여전히 없어진 컬렉션을 가리키는 경우 — 우리가 고칠 수 있는 게 없다.
         조용히 넘기지 않고 그대로 알린다. */
      toast(same.length
        ? `TMDB가 아직 없어진 시리즈를 가리키고 있어 고칠 수 없습니다 (${same.length}개)${revivedNote}`
        : `조회에 실패했습니다 (${errs.length}개)${revivedNote}`, "error");
      renderDiscover();
      return;
    }

    // 2) 확인 — 바뀔 것을 전부 보여준다
    const lines = change.map(p => `· ${p.item.title} (${p.item.releaseYear || "?"}) → ` +
      (p.newId ? `「${p.newName || "이름 없는 시리즈"}」로 다시 연결` : "시리즈 없음 (연결 비움)"));
    const ok = confirm(
      `TMDB에서 없어진 시리즈를 참조하던 기록 ${change.length}개를 고칩니다.\n` +
      `시리즈 연결만 바뀌고 별점·본 날짜·한줄평은 그대로 유지됩니다.\n\n` +
      lines.join("\n") +
      (same.length ? `\n\n※ ${same.length}개는 TMDB가 아직 없어진 시리즈를 가리켜 그대로 둡니다.` : "") +
      (errs.length ? `\n※ ${errs.length}개는 조회에 실패해 그대로 둡니다.` : "")
    );
    if (!ok) { toast("취소했습니다"); renderDiscover(); return; }

    // 3) 적용
    let done = 0;
    for (let n = 0; n < change.length; n++) {
      const p = change[n];
      msg.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>고치는 중 ${n + 1} / ${change.length} — ${esc(p.item.title)}`;
      if (p.newId) {
        p.item.collectionId = p.newId;
        p.item.collectionName = p.newName || "";
        try {
          const coll = await tmdbCollection(p.newId);
          saveCollInfo(coll);
          p.item.seriesNo = coll.order.get(p.item.tmdbId) || null;
          p.item.seriesTotal = coll.total || null;
        } catch { /* 편 정보는 안내바에서 다시 받으면 된다 */ }
        await new Promise(r => setTimeout(r, 240));
      } else {
        p.item.collectionId = null;
        p.item.collectionName = "";
        p.item.seriesNo = null;
        p.item.seriesTotal = null;
      }
      done++;
    }

    /* 이제 아무 기록도 참조하지 않는 실패 흔적은 치운다.
       안 치우면 고쳐놓고도 안내바가 계속 뜬다. */
    const used = new Set(State.items.filter(i => i.collectionId).map(i => String(i.collectionId)));
    [...new Set(plan.map(p => p.oldId))].forEach(id => { if (!used.has(id)) dropCollCache(id); });

    saveLocal();
    applyFilters();
    renderDiscover();
    toast(`${done}개의 시리즈 연결을 고쳤습니다${revivedNote}`, "success");
  } finally {
    _partsFetching = false;
  }
}

/* ============================================
   프랜차이즈 (얽힌 시리즈)

   TMDB의 컬렉션은 **계층이 없다.** 영화 하나가 컬렉션 하나에만 속하고 그 위를 묶는 개념이
   없어서, 아이언맨·토르·어벤져스 컬렉션은 서로 남남이다. 그래서 "MCU 전체"처럼 여러 컬렉션에
   걸친 묶음은 **여기에 직접 적어야** 한다.

   묶는 방법이 둘이다:
     · `keyword`    — TMDB 키워드로 조회 (MCU는 `marvel cinematic universe (mcu)`가 실제로 있다).
                      단 키워드는 커뮤니티가 붙이는 태그라 작품마다 제각각이다 —
                      반지의 제왕엔 `tolkien`이 있는데 호빗엔 없어서 이 방법을 못 쓴다.
     · `collections` — 컬렉션 id를 직접 나열. 키워드가 없는 시리즈는 이쪽.

   ⚠ **시청 순서(스토리 시간순)는 TMDB에 없다.** 개봉일 순이 전부다. 그래서 스토리 순은
   `storyOrder`에 **컬렉션 단위로만** 적는다("호빗 다음 반지"). 영화 하나하나 순서를 적으면
   새 작품이 나올 때마다 어긋나지만, 컬렉션 순서는 그럴 일이 없다.
   키워드로 묶은 프랜차이즈는 컬렉션이 없으니 스토리 순을 만들 수 없다(= 개봉일 순만).
   ============================================ */
const FRANCHISES = [
  {
    key: "mcu",
    name: "마블 시네마틱 유니버스",
    short: "마블",
    icon: "fa-shield-halved",
    keyword: 180547
    // 키워드 조회라 컬렉션이 없다 → 스토리 순 없음(개봉일 순만)
  },
  {
    key: "middleearth",
    name: "미들어스",
    short: "미들어스",
    icon: "fa-ring",
    collections: [119, 121938],      // 반지의 제왕 / 호빗
    storyOrder: [121938, 119]        // 호빗(3차시대 이전) → 반지의 제왕
  },
  {
    key: "wizarding",
    name: "위저딩 월드",
    short: "위저딩",
    icon: "fa-wand-sparkles",
    collections: [1241, 435259],     // 해리 포터 / 신비한 동물사전
    storyOrder: [435259, 1241]       // 신비한 동물사전(1926~) → 해리 포터(1991~)
  }
];

/* 조회 결과 캐시. TMDB로 다시 만들 수 있는 정보라 서버 동기화는 안 한다. */
const LS_FR = "watchlog_franchises";

function getFrCache() {
  try { return JSON.parse(localStorage.getItem(LS_FR) || "{}"); }
  catch { return {}; }
}

function saveFrCache(key, parts) {
  try {
    const c = getFrCache();
    c[key] = { parts, updatedAt: new Date().toISOString() };
    localStorage.setItem(LS_FR, JSON.stringify(c));
  } catch { /* 캐시일 뿐이라 조용히 넘어간다 */ }
}

function franchiseOf(key) {
  return FRANCHISES.find(f => f.key === key) || FRANCHISES[0];
}

/* 키워드로 묶은 프랜차이즈의 영화 목록.
   다큐(장르 99)와 70분 미만을 빼서 `Marvel One-Shot` 단편·메이킹 다큐를 걸러낸다
   (MCU 기준 82편 → 39편). 페이지가 여러 장이라 끝까지 받는다. */
async function fetchByKeyword(keywordId) {
  const key = getTmdbKey();
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const url = `${TMDB_BASE}/discover/movie?api_key=${key}&language=ko-KR`
      + `&with_keywords=${keywordId}&without_genres=99&with_runtime.gte=70`
      + `&sort_by=release_date.asc&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`시리즈 조회 실패 (${res.status})`);
    const d = await res.json();
    (d.results || []).forEach(r => out.push({
      tmdbId: r.id,
      title: r.title || r.name || "",
      poster: r.poster_path ? TMDB_IMG + r.poster_path : null,
      releaseDate: r.release_date || "",
      voteAverage: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
      collectionId: null
    }));
    if (page >= (d.total_pages || 1)) break;
    await new Promise(r => setTimeout(r, 240));
  }
  return out;
}

/* 컬렉션들로 묶은 프랜차이즈의 영화 목록 */
async function fetchByCollections(ids) {
  const out = [];
  for (const cid of ids) {
    const coll = await tmdbCollection(cid);
    saveCollInfo(coll);              // 이어보기가 쓰는 캐시도 겸사겸사 채운다
    coll.parts.forEach(p => out.push({
      tmdbId: p.tmdbId,
      title: p.title,
      poster: p.poster,
      releaseDate: p.releaseDate,
      voteAverage: null,
      collectionId: cid
    }));
    await new Promise(r => setTimeout(r, 240));
  }
  return out;
}

let _frLoading = false;
async function loadFranchise(key, force) {
  const f = franchiseOf(key);
  const cache = getFrCache();
  if (!force && cache[key] && cache[key].parts) return cache[key].parts;
  if (_frLoading) return null;
  if (!getTmdbKey()) { toast("설정 탭에서 TMDB API 키를 먼저 저장하세요", "error"); return null; }

  _frLoading = true;
  const bar = $("#dcFrMsg");
  if (bar) bar.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>${esc(f.name)} 목록을 받아오는 중...`;
  try {
    const parts = f.keyword
      ? await fetchByKeyword(f.keyword)
      : await fetchByCollections(f.collections);
    saveFrCache(key, parts);
    return parts;
  } catch (e) {
    toast("시리즈를 받지 못했습니다: " + e.message, "error");
    return null;
  } finally {
    _frLoading = false;
  }
}

/* 미개봉 편은 목록에서 뺀다 — 이어보기와 같은 이유로, 볼 수 없는 걸 "안 봤다"고 띄우지 않는다 */
function frOrder(parts, f, story) {
  const today = new Date().toISOString().slice(0, 10);
  const list = parts.filter(p => p.releaseDate && p.releaseDate <= today);
  const byDate = (a, b) => (a.releaseDate || "").localeCompare(b.releaseDate || "");

  if (!story || !f.storyOrder) return list.slice().sort(byDate);

  // 스토리 순 = storyOrder에 적힌 컬렉션 차례대로, 각 컬렉션 안에서는 개봉일 순
  return list.slice().sort((a, b) => {
    const ia = f.storyOrder.indexOf(a.collectionId);
    const ib = f.storyOrder.indexOf(b.collectionId);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return byDate(a, b);
  });
}

/* ---------- 카드 ---------- */
/* e = { tmdbId, mediaType, title, poster, year, voteAverage, note, flag, actions[] } */
function dcCardHtml(e) {
  const st = myStatus(e.tmdbId);

  let flag = e.flag || "";
  if (!flag) {
    if (st.watched) flag = `<span class="dc-flag dc-flag-seen"><i class="fa-solid fa-check mr-1"></i>봤어요</span>`;
    else if (st.hidden) flag = `<span class="dc-flag dc-flag-hide"><i class="fa-solid fa-ban mr-1"></i>관심없음</span>`;
    else if (st.wished) flag = `<span class="dc-flag dc-flag-wish"><i class="fa-solid fa-bookmark mr-1"></i>담아둠</span>`;
  }

  const actions = (e.actions || []).map(a => `
    <button class="dc-btn ${a.cls || ""}" data-act="${a.act}" data-tid="${e.tmdbId}"
      ${a.season ? `data-season="${a.season}"` : ""}${a.id ? ` data-id="${a.id}"` : ""}
      ${a.title ? ` title="${esc(a.title)}"` : ""}>
      ${a.icon ? `<i class="fa-solid ${a.icon}${a.label ? " mr-1" : ""}"></i>` : ""}${esc(a.label)}
    </button>`).join("");

  return `
    <div class="wl-card dc-card" data-act="detail" data-tid="${e.tmdbId}">
      <div class="wl-poster-wrap">
        ${e.poster
          ? `<img class="wl-poster" src="${e.poster}" alt="" loading="lazy">`
          : `<div class="wl-poster-empty"><i class="fa-solid fa-film"></i></div>`}
        ${ratingChip({ rating: st.rating, voteAverage: e.voteAverage })}
        ${flag}
      </div>
      <div class="wl-body">
        <div class="wl-title-row">
          <i class="fa-solid ${e.mediaType === "tv" ? "fa-tv" : "fa-film"} wl-type"
             title="${e.mediaType === "tv" ? "TV" : "영화"}"></i>
          <span class="wl-title">${esc(e.title)}</span>
        </div>
        ${e.year ? `<div class="wl-meta">${esc(e.year)}</div>` : ""}
        ${e.note ? `<div class="dc-note">${e.note}</div>` : ""}
        ${actions ? `<div class="dc-actions">${actions}</div>` : ""}
      </div>
    </div>`;
}

/* 검색 결과·이어보기·위시에서 공통으로 쓰는 그리기 */
function paintDcCards(entries, empty) {
  Discover._byId = new Map(entries.map(e => [String(e.tmdbId), e]));
  const grid = $("#dcGrid");
  grid.innerHTML = entries.map(dcCardHtml).join("");
  const em = $("#dcEmpty");
  em.innerHTML = empty || "";
  em.classList.toggle("hidden", entries.length > 0);
  $("#dcCount").textContent = entries.length ? `${entries.length}개` : "";
}

/* ---------- 뷰별 렌더 ---------- */
function renderDiscover() {
  if (!$("#dcGrid")) return;
  updateDcNav();
  if (Discover.view !== "reco") $("#dcRecoBar").classList.add("hidden");
  if (Discover.view !== "next") $("#dcPartsBar").classList.add("hidden");
  if (Discover.view !== "fr") $("#dcFrBar").classList.add("hidden");

  if (Discover.view === "reco") return renderDcReco();
  if (Discover.view === "search") return renderDcSearch();
  if (Discover.view === "wish") return renderDcWish();
  if (Discover.view === "hide") return renderDcHide();
  if (Discover.view === "fr") return renderDcFranchise();
  return renderDcNext();
}
window.renderDiscover = renderDiscover;

function updateDcNav() {
  $$(".dc-nav").forEach(b => b.classList.toggle("active", b.dataset.view === Discover.view));
  const nextN = continueList().length + movieContinueList().length;
  const wishN = State.wishes.length;
  const hideN = State.hides.length;
  $("#dcNextCount").textContent = nextN;
  $("#dcWishCount").textContent = wishN;
  $("#dcHideCount").textContent = hideN;
  $("#dcNextCount").classList.toggle("hidden", nextN === 0);
  $("#dcWishCount").classList.toggle("hidden", wishN === 0);
  $("#dcHideCount").classList.toggle("hidden", hideN === 0);

  // 관심없음 탭은 표시한 게 있을 때만 (0개면 굳이 자리 차지할 필요 없음)
  const hb = $('.dc-nav[data-view="hide"]');
  if (hb) hb.classList.toggle("hidden", hideN === 0 && Discover.view !== "hide");

  // 검색 결과 탭은 검색했을 때만 보인다
  const sb = $('.dc-nav[data-view="search"]');
  if (sb) sb.classList.toggle("hidden", !Discover.results.length && Discover.view !== "search");
}

/* 이어보기 — TV의 안 본 시즌 + 영화 시리즈의 안 본 편을 함께 */
function renderDcNext() {
  $("#dcHint").classList.add("hidden");

  // TV: 안 본 시즌
  const tv = continueList().map(c => {
    const st = c.st;
    const seen = st.seenSeasons.map(n => `S${n}`).join("·");
    const miss = st.missing.map(n => `S${n}`).join("·");
    return {
      _sort: c.item.lastWatchStart || c.item.startDate || "",
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      title: c.item.title,
      poster: c.item.poster,
      year: c.item.releaseYear || "",
      voteAverage: c.item.voteAverage,
      flag: `<span class="dc-flag dc-flag-next"><i class="fa-solid fa-forward mr-1"></i>${esc(miss)} 안 봄</span>`,
      note: `<span class="badge badge-season">본 시즌 ${esc(seen)}</span>
             <span class="badge badge-cert">안 본 시즌 ${esc(miss)}</span>
             <span class="wl-meta ml-1">총 ${st.totalSeasons}시즌</span>`,
      actions: [
        { act: "add", season: st.missing[0], label: `S${st.missing[0]} 기록하기`, icon: "fa-plus", cls: "dc-btn-main" },
        { act: "open", id: c.item.id, label: "내 기록", icon: "fa-clock-rotate-left" }
      ]
    };
  });

  /* 영화: 안 본 편을 **편마다 한 장씩** 카드로. 편마다 포스터·제목이 따로 있으니
     한 장으로 뭉치면(예전 방식) 다음 편만 보이고 나머지는 묻힌다.
     TV 시즌은 반대로 포스터·제목이 시즌마다 없으므로 한 장에 모아둔다. */
  const movie = movieContinueList().flatMap(c =>
    c.missing.filter(p => !isHidden(p.tmdbId)).map(p => ({
      _sort: c.sortKey + "|" + String(1000 - p.no).padStart(4, "0"),   // 시리즈끼리 붙이고 편 순서대로
      tmdbId: p.tmdbId,
      mediaType: "movie",
      title: p.title,
      poster: p.poster,
      year: (p.releaseDate || "").slice(0, 4),
      voteAverage: null,
      flag: `<span class="dc-flag dc-flag-next"><i class="fa-solid fa-forward mr-1"></i>${p.no}편 안 봄</span>`,
      /* 배지 구성을 TV 카드와 같게 맞춘다: 본 것 · 안 본 것 · 총 개수.
         시리즈명과 미개봉은 영화에만 있는 정보라 앞뒤에 덧붙인다.
         이 카드가 몇 편인지는 포스터 위 띠에 이미 있으므로 시리즈명만 둔다. */
      note: `<span class="badge badge-genre"><i class="fa-solid fa-layer-group mr-1"></i>${esc(c.info.name)}</span>
             <span class="badge badge-season">본 편 ${c.seenNos.length ? c.seenNos.map(n => "S" + n).join("·") : `${c.watched}편`}</span>
             <span class="badge badge-cert">안 본 편 ${c.missing.map(m => "S" + m.no).join("·")}</span>
             <span class="wl-meta ml-1">총 ${c.info.total}편</span>
             ${c.upcoming ? `<span class="badge badge-genre">미개봉 ${c.upcoming}편 제외</span>` : ""}`,
      actions: [
        { act: "add", label: "기록하기", icon: "fa-plus", cls: "dc-btn-main" },
        /* 이 카드는 "안 본 편"이라 내 기록이 없다. 그래서 같은 시리즈에서
           가장 최근에 본 편의 기록을 연다 (TV 카드의 [내 기록]과 같은 동작). */
        { act: "open", id: c.main.id, label: "내 기록", icon: "fa-clock-rotate-left" },
        { act: "wish", label: isWished(p.tmdbId) ? "담아둠" : "보고싶어요", icon: "fa-bookmark",
          cls: isWished(p.tmdbId) ? "dc-btn-on" : "" },
        { act: "hide", label: "", icon: "fa-ban", cls: "dc-btn-icon", title: "관심없음 — 이 목록에서 숨기기" }
      ]
    })));

  const list = [...tv, ...movie].sort((a, b) => (b._sort || "").localeCompare(a._sort || ""));

  /* 편 정보를 안 가져온 영화 시리즈가 있으면 안내.
     실패한 것만 남았을 때는 "가져오기"가 아니라 "다시 시도"를 제안한다 — 그 상태에서
     같은 버튼을 눌러도 매번 같은 실패라 아무 일도 안 일어나는 것처럼 보이기 때문. */
  const need = collsNeedingParts();
  const failed = collsFailedCount();
  const bar = $("#dcPartsBar");
  const btn = $("#dcPartsBtn");
  bar.classList.toggle("hidden", need.length === 0 && failed === 0);

  if (need.length) {
    $("#dcPartsMsg").innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i>영화 시리즈 <b>${need.length}개</b>의
      편 정보가 아직 없어요. 가져오면 해리포터처럼 <b>안 본 편</b>도 여기 모입니다
      (약 ${Math.ceil(need.length * 0.25)}초).`;
    btn.innerHTML = `<i class="fa-solid fa-layer-group mr-1"></i>시리즈 편 정보 가져오기`;
    btn.dataset.retry = "";
  } else if (failed) {
    /* 같은 요청을 다시 보내봐야 영영 같은 404다 (TMDB에서 없어진 컬렉션).
       그래서 "다시 시도"가 아니라 작품 쪽 시리즈 연결을 고치는 길을 준다. */
    $("#dcPartsMsg").innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i>영화 시리즈
      <b>${failed}개</b>는 TMDB에서 없어졌어요 (삭제되거나 다른 시리즈로 합쳐진 경우).
      그 시리즈만 안 본 편이 안 잡힙니다. 작품 정보를 다시 받아 <b>지금의 시리즈로 연결</b>할 수 있어요.`;
    btn.innerHTML = `<i class="fa-solid fa-wrench mr-1"></i>시리즈 연결 고치기`;
    btn.dataset.retry = "1";
  }

  paintDcCards(list, `
    <i class="fa-solid fa-circle-check text-4xl mb-3"></i>
    <p class="font-medium">안 본 시즌·편이 없어요</p>
    <p class="text-sm mt-1">시즌이나 시리즈 중 일부만 본 게 있으면 여기에 모입니다.</p>`);
}

/* 프랜차이즈 — 얽힌 시리즈를 순서대로 늘어놓고, 본 것/안 본 것을 겹쳐서 보여준다.
   기존 기록은 건드리지 않는다. 이 화면은 보여주기만 한다. */
async function renderDcFranchise() {
  $("#dcHint").classList.add("hidden");
  const f = franchiseOf(Discover.frKey);

  // 프랜차이즈 고르는 칩 + 순서 전환
  $("#dcFrBar").classList.remove("hidden");
  $("#dcFrChips").innerHTML = FRANCHISES.map(x => `
    <button class="dc-type ${x.key === f.key ? "active" : ""}" data-fr="${x.key}">
      <i class="fa-solid ${x.icon} mr-1"></i>${esc(x.short)}
    </button>`).join("");

  /* 스토리 순은 컬렉션 단위로만 만들 수 있다 — 키워드로 묶은 프랜차이즈(MCU)엔 없으므로
     그때는 전환 버튼 자체를 숨긴다. 있지도 않은 선택지를 보여주지 않는다. */
  const canStory = !!f.storyOrder;
  $("#dcFrSort").classList.toggle("hidden", !canStory);
  if (canStory) {
    $$("#dcFrSort .dc-type").forEach(b =>
      b.classList.toggle("active", (b.dataset.order === "story") === Discover.frStory));
  }

  const cached = getFrCache()[f.key];
  if (!cached || !cached.parts) {
    $("#dcFrMsg").innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i>
      <b>${esc(f.name)}</b> 목록을 아직 안 받았어요. [불러오기]를 누르면 TMDB에서 받아옵니다.`;
    paintDcCards([], `<i class="fa-solid fa-layer-group text-4xl mb-3"></i>
      <p class="font-medium">${esc(f.name)} 목록이 없어요</p>
      <p class="text-sm mt-1">위 [불러오기]를 눌러주세요.</p>`);
    return;
  }

  const ordered = frOrder(cached.parts, f, canStory && Discover.frStory);
  const seen = ordered.filter(p => myStatus(p.tmdbId).watched).length;
  $("#dcFrMsg").innerHTML = `<i class="fa-solid ${f.icon} mr-1"></i><b>${esc(f.name)}</b>
    — ${ordered.length}편 중 <b>${seen}편</b> 봄
    ${canStory && Discover.frStory ? " · 스토리 시간순" : " · 개봉일 순"}`;

  const list = ordered.map((p, idx) => {
    const st = myStatus(p.tmdbId);
    const acts = [];
    if (st.watched) {
      acts.push({ act: "open", id: st.recs[0].id, label: "내 기록", icon: "fa-clock-rotate-left" });
    } else {
      acts.push({ act: "add", label: "기록하기", icon: "fa-plus", cls: "dc-btn-main" });
      acts.push({ act: "wish", label: isWished(p.tmdbId) ? "담아둠" : "보고싶어요", icon: "fa-bookmark",
        cls: isWished(p.tmdbId) ? "dc-btn-on" : "" });
      acts.push({ act: "hide", label: "", icon: "fa-ban", cls: "dc-btn-icon", title: "관심없음" });
    }
    return {
      tmdbId: p.tmdbId,
      mediaType: "movie",
      title: p.title,
      poster: p.poster,
      year: (p.releaseDate || "").slice(0, 4),
      voteAverage: p.voteAverage,
      // 순서가 이 화면의 핵심이라 몇 번째인지 배지로 먼저 보여준다
      note: `<span class="badge badge-season">${idx + 1}번째</span>`,
      actions: acts
    };
  });

  paintDcCards(list, `<i class="fa-solid fa-layer-group text-4xl mb-3"></i>
    <p class="font-medium">표시할 작품이 없어요</p>`);
}

/* 보고싶어요 */
function renderDcWish() {
  $("#dcHint").classList.add("hidden");

  const list = State.wishes.map(w => {
    const st = myStatus(w.tmdbId);
    const acts = [];
    if (st.watched) {
      acts.push({ act: "unwish", label: "위시에서 빼기", icon: "fa-check", cls: "dc-btn-main" });
    } else {
      acts.push({ act: "add", label: "봤어요 기록", icon: "fa-plus", cls: "dc-btn-main" });
      acts.push({ act: "unwish", label: "빼기", icon: "fa-xmark" });
    }
    return {
      tmdbId: w.tmdbId,
      mediaType: w.mediaType,
      title: w.title,
      poster: w.poster,
      year: w.year,
      voteAverage: w.voteAverage,
      note: st.watched
        ? `<span class="badge badge-type"><i class="fa-solid fa-check mr-1"></i>이미 기록에 있어요</span>`
        : `${ottBadges(w)}${w.reason ? `<span class="badge badge-genre">${esc(w.reason)}</span>` : ""}`,
      actions: acts
    };
  });

  paintDcCards(list, `
    <i class="fa-solid fa-bookmark text-4xl mb-3"></i>
    <p class="font-medium">담아둔 작품이 없어요</p>
    <p class="text-sm mt-1">위에서 검색해 마음에 드는 작품을 담아두세요.</p>`);
}

/* 관심없음 모아보기 */
function renderDcHide() {
  $("#dcHint").classList.add("hidden");

  const list = State.hides.map(h => ({
    tmdbId: h.tmdbId, mediaType: h.mediaType, title: h.title,
    poster: h.poster, year: h.year, voteAverage: h.voteAverage,
    flag: `<span class="dc-flag dc-flag-hide"><i class="fa-solid fa-ban mr-1"></i>관심없음</span>`,
    actions: [
      { act: "unhide", label: "다시 관심", icon: "fa-rotate-left", cls: "dc-btn-main" },
      { act: "wish", label: "보고싶어요", icon: "fa-bookmark" }
    ]
  }));

  paintDcCards(list, `
    <i class="fa-solid fa-ban text-4xl mb-3"></i>
    <p class="font-medium">관심없음으로 표시한 작품이 없어요</p>
    <p class="text-sm mt-1">추천이나 이어보기에서 <i class="fa-solid fa-ban mx-1"></i>를 누르면 여기로 옵니다.</p>`);
}

/* 검색 결과 */
function renderDcSearch() {
  const hint = $("#dcHint");
  if (Discover.wasFallback) {
    hint.innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i>"${esc(Discover.query)}" 결과가 없어
      <b>"${esc(Discover.usedQuery)}"</b>로 검색했습니다`;
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }

  const list = Discover.results.map(r => {
    const st = myStatus(r.tmdbId);
    const acts = [];
    let note = "";

    if (st.watched && st.missing.length) {
      const miss = st.missing.map(n => `S${n}`).join("·");
      note = `<span class="badge badge-cert">안 본 시즌 ${esc(miss)}</span>
              <span class="badge badge-season">본 시즌 ${st.seenSeasons.map(n => "S" + n).join("·")}</span>`;
      acts.push({ act: "add", season: st.missing[0], label: `S${st.missing[0]} 기록하기`, icon: "fa-plus", cls: "dc-btn-main" });
      acts.push({ act: "open", id: st.recs[0].id, label: "내 기록", icon: "fa-clock-rotate-left" });
    } else if (st.watched) {
      note = `<span class="badge badge-type"><i class="fa-solid fa-check mr-1"></i>${st.recs.length}개 기록 있음</span>`;
      acts.push({ act: "open", id: st.recs[0].id, label: "내 기록 보기", icon: "fa-clock-rotate-left", cls: "dc-btn-main" });
      acts.push({ act: "add", label: "또 기록", icon: "fa-plus" });
    } else if (st.hidden) {
      // 직접 검색해서 찾아온 거니 숨기지 않고, 되돌릴 버튼을 준다
      note = `<span class="badge badge-genre"><i class="fa-solid fa-ban mr-1"></i>관심없음으로 표시함</span>`;
      acts.push({ act: "unhide", label: "다시 관심", icon: "fa-rotate-left", cls: "dc-btn-main" });
    } else {
      acts.push({ act: "wish", label: st.wished ? "담아둠" : "보고싶어요", icon: "fa-bookmark", cls: st.wished ? "dc-btn-on" : "" });
      acts.push({ act: "add", label: "봤어요", icon: "fa-plus", cls: "dc-btn-main" });
      acts.push({ act: "hide", label: "", icon: "fa-ban", cls: "dc-btn-icon", title: "관심없음" });
    }

    return {
      tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title,
      poster: r.poster, year: r.year, voteAverage: r.voteAverage,
      note, actions: acts, _raw: r
    };
  });

  paintDcCards(list, `
    <i class="fa-solid fa-face-frown text-4xl mb-3"></i>
    <p class="font-medium">"${esc(Discover.query)}" 검색 결과가 없습니다</p>
    <p class="text-sm mt-1">제목을 줄여서 다시 검색해보세요.</p>`);
}

/* ---------- 검색 실행 ---------- */
async function runDiscoverSearch() {
  const q = $("#dcQuery").value.trim();
  if (!q) return;
  if (!getTmdbKey()) { toast("설정 탭에서 TMDB API 키를 먼저 저장하세요", "error"); return; }
  if (Discover.searching) return;

  Discover.searching = true;
  Discover.query = q;
  Discover.view = "search";
  updateDcNav();
  $("#dcGrid").innerHTML = "";
  $("#dcEmpty").classList.add("hidden");
  $("#dcHint").innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>"${esc(q)}" 검색 중...`;
  $("#dcHint").classList.remove("hidden");

  try {
    const { results, usedQuery, wasFallback } = await tmdbSearchSmart(q);
    Discover.results = results;
    Discover.usedQuery = usedQuery;
    Discover.wasFallback = wasFallback;
    renderDiscover();
  } catch (e) {
    $("#dcHint").innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i>${esc(e.message)}`;
  } finally {
    Discover.searching = false;
  }
}

/* ---------- 액션 ---------- */
/* TMDB 작품 → 등록 모달 (정보 자동 채움). season을 주면 그 시즌까지 미리 선택 */
async function addFromDiscover(tmdbId, mediaType, season) {
  openEdit(null);
  await selectTmdb({ tmdbId: +tmdbId, mediaType });
  if (season) {
    $("#fSeason").value = season;
    const sel = $("#fSeasonSelect");
    if (sel) sel.value = String(season);
  }
}

async function dcToggleWish(tmdbId) {
  const e = Discover._byId.get(String(tmdbId));
  if (isWished(+tmdbId)) {
    removeWish(+tmdbId);
    toast("보고싶어요에서 뺐습니다");
    renderDiscover();
    return;
  }
  if (!e) return;

  // 먼저 담아서 바로 반응하게 하고, OTT는 뒤이어 채운다
  addWish({
    tmdbId: +tmdbId, mediaType: e.mediaType, title: e.title,
    originalTitle: (e._raw || {}).originalTitle || "",
    poster: e.poster, year: e.year, voteAverage: e.voteAverage,
    overview: (e._raw || {}).overview || "",
    reason: (e._raw || {}).reason || ""
  });
  toast("보고싶어요에 담았습니다", "success");
  renderDiscover();
  await fillWishOtt(+tmdbId, e.mediaType);
}

/* 위시에 담는 순간 OTT를 한 번 조회한다.
   스트리밍 정보는 목록 응답에 없고 작품별 엔드포인트에만 있어서, 카드 60개를 한꺼번에
   조회하면 그만큼 기다려야 한다. "담을 때 1개씩"이면 기다림 없이 최신 정보를 얻는다. */
async function fillWishOtt(tmdbId, mediaType) {
  try {
    let otts = await tmdbProviders(tmdbId, mediaType);
    // 구분 추정이 빗나갈 수 있어(애니 극장판 등) 비면 반대쪽도 한 번 시도
    if (!otts.length) otts = await tmdbProviders(tmdbId, mediaType === "movie" ? "tv" : "movie");
    const w = State.wishes.find(x => x.tmdbId === tmdbId);
    if (w) { w.otts = otts; saveLocal(); renderDiscover(); }
  } catch { /* OTT를 못 가져와도 담긴 건 유지 */ }
}

function dcHide(tmdbId) {
  const e = Discover._byId.get(String(tmdbId));
  if (!e) return;
  addHide({
    tmdbId: +tmdbId, mediaType: e.mediaType, title: e.title,
    poster: e.poster, year: e.year, voteAverage: e.voteAverage
  });
  toast(`「${e.title}」을 관심없음으로 표시했습니다`);
  renderDiscover();
}

/* ---------- TMDB 상세 미리보기 ---------- */
async function openDcDetail(tmdbId, mediaType) {
  const modal = $("#dcModal");
  const box = $("#dcModalContent");
  box.innerHTML = `<div class="p-10 text-center text-slate-400 font-medium">
    <i class="fa-solid fa-spinner fa-spin mr-2"></i>정보 가져오는 중...</div>`;
  modal.classList.remove("hidden");

  try {
    const d = await tmdbDetail(+tmdbId, mediaType);
    d.otts = await tmdbProviders(+tmdbId, mediaType);
    renderDcDetail(d, mediaType);
  } catch (e) {
    box.innerHTML = `<div class="p-10 text-center text-red-500 font-medium">${esc(e.message)}</div>`;
  }
}

function renderDcDetail(d, mediaType) {
  const st = myStatus(d.tmdbId);
  const certLabel = (c) => {
    if (!c) return "";
    const s = String(c).trim();
    if (/^\d+$/.test(s)) return s + "세";
    if (/^all$/i.test(s)) return "전체";
    return s;
  };

  const chips = [];
  if (d.voteAverage) chips.push(`<span class="badge badge-vote"><i class="fa-solid fa-star mr-1"></i>${d.voteAverage}</span>`);
  if (d.runtime) chips.push(`<span class="badge badge-time"><i class="fa-solid fa-clock mr-1"></i>${d.runtime}분</span>`);
  if (d.totalSeasons) chips.push(`<span class="badge badge-season"><i class="fa-solid fa-layer-group mr-1"></i>총 ${d.totalSeasons}시즌</span>`);
  if (d.totalEpisodes) chips.push(`<span class="badge badge-time"><i class="fa-solid fa-list-ol mr-1"></i>총 ${d.totalEpisodes}화</span>`);

  // 내 기록 상황
  let mine = "";
  if (st.watched) {
    const rows = st.recs.map(r => `
      <button class="badge badge-season badge-link" onclick="dcOpenMyRecord('${r.id}')">
        ${seriesLabel(r) || "기록"}${r.startDate ? ` <span class="opacity-70 ml-1">${fmtDate(r.startDate)}</span>` : ""}
      </button>`).join("");
    mine = `<div class="rounded-xl border border-lime-200 bg-lime-50 p-3.5 mb-4">
      <div class="text-xs font-semibold text-lime-800 mb-2">
        <i class="fa-solid fa-check mr-1"></i>이미 본 작품이에요 — 내 기록 ${st.recs.length}개
        ${st.rating ? `<span class="ml-2">${hearts(st.rating)}</span>` : ""}
      </div>
      <div class="flex flex-wrap gap-1.5">${rows}</div>
      ${st.missing.length
        ? `<div class="text-xs font-semibold text-rose-700 mt-2.5">
             <i class="fa-solid fa-forward mr-1"></i>안 본 시즌: ${st.missing.map(n => "S" + n).join(", ")}</div>`
        : ""}
    </div>`;
  }

  // 시즌 목록
  const seasonsHtml = (d.seasons || []).length > 1
    ? `<div class="mt-4 border-t border-slate-100 pt-4">
         <div class="text-xs font-semibold text-slate-500 mb-2"><i class="fa-solid fa-layer-group mr-1 text-amber-400"></i>시즌</div>
         <div class="flex flex-wrap gap-1.5">
           ${d.seasons.map(s => {
             const seen = st.seenSeasons && st.seenSeasons.includes(s.number);
             return `<span class="badge ${seen ? "badge-type" : "badge-genre"}">
               ${seen ? `<i class="fa-solid fa-check mr-1"></i>` : ""}S${s.number}${s.year ? ` <span class="opacity-70 ml-1">${s.year}</span>` : ""}
             </span>`;
           }).join("")}
         </div>
       </div>`
    : "";

  const castHtml = (d.cast || []).length
    ? `<div class="mt-4 border-t border-slate-100 pt-4">
         <div class="text-xs font-semibold text-slate-500 mb-2"><i class="fa-solid fa-users mr-1 text-pink-400"></i>출연진</div>
         <div class="flex flex-wrap gap-1.5">
           ${d.cast.map(c => `<span class="badge badge-cast">${esc(c.name)}</span>`).join("")}
         </div>
         ${d.director ? `<div class="text-xs font-medium text-slate-500 mt-2">
           <i class="fa-solid fa-clapperboard text-slate-400 mr-1"></i>감독
           <span class="badge badge-genre ml-1">${esc(d.director)}</span></div>` : ""}
       </div>`
    : "";

  const header = d.backdrop
    ? `<div class="relative h-32 bg-cover bg-center" style="background-image:url('${d.backdrop}')">
         <div class="absolute inset-0" style="background:linear-gradient(to top,rgba(255,255,255,1),rgba(255,255,255,0.1))"></div>
         <button onclick="document.getElementById('dcModal').classList.add('hidden')"
           class="modal-x absolute top-3 right-3" style="background:rgba(255,255,255,.85)"><i class="fa-solid fa-xmark"></i></button>
       </div>`
    : `<div class="modal-head">
         <h3 class="font-semibold text-slate-800">작품 정보</h3>
         <button onclick="document.getElementById('dcModal').classList.add('hidden')"
           class="modal-x"><i class="fa-solid fa-xmark"></i></button>
       </div>`;

  const wished = isWished(d.tmdbId);

  $("#dcModalContent").innerHTML = `
    ${header}
    <div class="p-5 ${d.backdrop ? "-mt-12 relative" : ""}">
      <div class="flex gap-4 mb-4">
        ${d.poster
          ? `<img src="${d.poster}" class="w-28 rounded-lg object-cover self-start shadow-md" alt="">`
          : `<div class="w-28 aspect-[2/3] rounded-lg bg-slate-200 flex items-center justify-center text-slate-400"><i class="fa-solid fa-film text-2xl"></i></div>`}
        <div class="flex-1 min-w-0 ${d.backdrop ? "pt-12" : ""}">
          <h4 class="text-lg font-bold text-slate-800 leading-snug">
            ${esc(d.title)}
            ${d.cert ? `<span class="badge badge-cert align-middle ml-1">${esc(certLabel(d.cert))}</span>` : ""}
          </h4>
          ${d.originalTitle && d.originalTitle !== d.title
            ? `<div class="text-xs text-slate-400 font-medium">${esc(d.originalTitle)}</div>` : ""}
          <div class="flex flex-wrap gap-1 mt-2">
            ${d.type ? `<span class="badge badge-type">${esc(d.type)}</span>` : ""}
            ${d.country ? `<span class="badge badge-country">${esc(d.country)}</span>` : ""}
            ${(d.otts || []).map(o => `<span class="badge badge-ott">${esc(o)}</span>`).join("")}
          </div>
          ${chips.length ? `<div class="flex flex-wrap gap-1 mt-1.5">${chips.join("")}</div>` : ""}
          ${(d.releaseDate || d.releaseYear) ? `<div class="wl-meta mt-2">
            <i class="fa-solid fa-clapperboard mr-1"></i>${mediaType === "movie" ? "개봉" : "방영"}
            ${d.releaseDate ? fmtDate(d.releaseDate) : d.releaseYear}</div>` : ""}
        </div>
      </div>

      ${mine}

      ${visibleGenres(d.genres).length ? `<div class="flex flex-wrap gap-1 mb-3">
        ${visibleGenres(d.genres).map(g => `<span class="badge badge-genre">${esc(g)}</span>`).join("")}</div>` : ""}

      ${d.overview ? `<p class="text-sm text-slate-600 leading-relaxed">${esc(d.overview)}</p>` : ""}

      ${seasonsHtml}
      ${castHtml}
      <div id="dcWatch"></div>
    </div>
    <div class="modal-foot">
      <button onclick="dcModalWish(${d.tmdbId},'${mediaType}')"
        class="px-4 py-2.5 rounded-lg border text-sm font-semibold ${wished
          ? "border-amber-400 bg-amber-50 text-amber-700"
          : "btn-ghost"}">
        <i class="fa-solid fa-bookmark mr-1"></i>${wished ? "담아둠" : "보고싶어요"}
      </button>
      <button onclick="dcModalHide(${d.tmdbId},'${mediaType}')"
        class="px-3 py-2.5 rounded-lg border text-sm font-semibold ${isHidden(d.tmdbId)
          ? "border-slate-400 bg-slate-100 text-slate-600"
          : "btn-ghost"}"
        title="${isHidden(d.tmdbId) ? "관심없음 해제" : "관심없음 — 추천에서 빼기"}">
        <i class="fa-solid fa-ban"></i>
      </button>
      <div class="flex-1"></div>
      <button onclick="document.getElementById('dcModal').classList.add('hidden'); addFromDiscover(${d.tmdbId},'${mediaType}')"
        class="btn btn-primary">
        <i class="fa-solid fa-plus mr-1"></i>시청 기록 추가
      </button>
    </div>`;

  // 모달에서 담기/빼기를 눌렀을 때 쓰려고 방금 조회한 정보를 들고 있는다
  Discover._detail = { ...d, mediaType };

  // 지금 볼 수 있는 곳(대여·구매까지)은 열자마자 받아 아래에 붙인다 — 내 기록 상세와 같은 방식
  renderWatchInto($("#dcWatch"), d.tmdbId, mediaType, d.title);
}

function dcModalWish(tmdbId, mediaType) {
  const d = Discover._detail;
  if (isWished(+tmdbId)) {
    removeWish(+tmdbId);
    toast("보고싶어요에서 뺐습니다");
  } else {
    addWish({
      tmdbId: +tmdbId, mediaType,
      title: d ? d.title : "", originalTitle: d ? d.originalTitle : "",
      poster: d ? d.poster : null, year: d ? d.releaseYear : "",
      voteAverage: d ? d.voteAverage : null, overview: d ? d.overview : "",
      otts: d ? (d.otts || []) : []      // 상세를 여는 김에 이미 받아둔 값 — 추가 호출 없음
    });
    toast("보고싶어요에 담았습니다", "success");
  }
  if (d) renderDcDetail(d, mediaType);
  renderDiscover();
}
window.dcModalWish = dcModalWish;

function dcModalHide(tmdbId, mediaType) {
  const d = Discover._detail;
  if (isHidden(+tmdbId)) {
    removeHide(+tmdbId);
    toast("관심없음을 해제했습니다");
  } else {
    addHide({
      tmdbId: +tmdbId, mediaType,
      title: d ? d.title : "", poster: d ? d.poster : null,
      year: d ? d.releaseYear : "", voteAverage: d ? d.voteAverage : null
    });
    toast("관심없음으로 표시했습니다");
  }
  if (d) renderDcDetail(d, mediaType);
  renderDiscover();
}
window.dcModalHide = dcModalHide;

function dcOpenMyRecord(id) {
  $("#dcModal").classList.add("hidden");
  openDetail(id);
}
window.dcOpenMyRecord = dcOpenMyRecord;
window.addFromDiscover = addFromDiscover;

/* ---------- 초기화 ---------- */
function initDiscover() {
  if (!$("#tab-discover")) return;

  $("#dcSearchBtn").addEventListener("click", runDiscoverSearch);
  $("#dcQuery").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); runDiscoverSearch(); }
  });

  $$(".dc-nav").forEach(btn => {
    btn.addEventListener("click", () => {
      Discover.view = btn.dataset.view;
      renderDiscover();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  /* 추천 */
  $("#dcRecoBtn").addEventListener("click", runReco);
  /* 아직 안 가져온 게 있으면 가져오기, 실패만 남았으면 연결 고치기 */
  $("#dcPartsBtn").addEventListener("click", (e) =>
    e.currentTarget.dataset.retry === "1" ? runFixDeadColls() : runFetchCollParts());
  $$(".dc-type[data-type]").forEach(btn => {
    btn.addEventListener("click", () => {
      Discover.recoType = btn.dataset.type;
      $$(".dc-type[data-type]").forEach(b => b.classList.toggle("active", b === btn));
      renderDiscover();
    });
  });

  /* 시리즈 뷰 — 프랜차이즈 칩은 그릴 때마다 새로 만들어지므로 위임으로 받는다 */
  $("#dcFrChips").addEventListener("click", e => {
    const b = e.target.closest("[data-fr]");
    if (!b) return;
    Discover.frKey = b.dataset.fr;
    renderDiscover();
  });
  $("#dcFrSort").addEventListener("click", e => {
    const b = e.target.closest("[data-order]");
    if (!b) return;
    Discover.frStory = b.dataset.order === "story";
    renderDiscover();
  });
  $("#dcFrLoadBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const got = await loadFranchise(Discover.frKey, true);   // 눌렀으면 캐시가 있어도 새로 받는다
    btn.disabled = false;
    if (got) toast(`${franchiseOf(Discover.frKey).name} ${got.length}편을 받았습니다`, "success");
    renderDiscover();
  });

  /* 카드/버튼 클릭은 위임으로 한 번에 처리 */
  $("#dcGrid").addEventListener("click", e => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const tid = btn.dataset.tid;
    const entry = Discover._byId.get(String(tid));

    if (act === "detail") { openDcDetail(tid, entry ? entry.mediaType : "movie"); return; }

    e.stopPropagation();
    if (act === "wish") dcToggleWish(tid);
    else if (act === "unwish") { removeWish(+tid); toast("보고싶어요에서 뺐습니다"); renderDiscover(); }
    else if (act === "hide") dcHide(tid);
    else if (act === "unhide") { removeHide(+tid); toast("관심없음을 해제했습니다"); renderDiscover(); }
    else if (act === "open") openDetail(btn.dataset.id);
    else if (act === "add") addFromDiscover(tid, entry ? entry.mediaType : "movie", btn.dataset.season);
  });

  $("#dcModal").addEventListener("click", e => {
    if (e.target.id === "dcModal") $("#dcModal").classList.add("hidden");
  });
}
