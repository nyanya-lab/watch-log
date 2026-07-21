/* ============================================
   watchlog.js — 카드 목록, 필터, 등록/수정
   ============================================ */

function initWatchlog() {
  $("#addBtn").addEventListener("click", () => openEdit(null));
  $("#closeModal").addEventListener("click", closeEdit);
  $("#cancelBtn").addEventListener("click", closeEdit);
  $("#saveBtn").addEventListener("click", saveItem);
  $("#deleteBtn").addEventListener("click", deleteItem);
  $("#syncBtn").addEventListener("click", async () => { await pushToServer(); });

  $("#searchInput").addEventListener("input", debounce(applyFilters, 220));
  ["filterType", "filterCountry", "filterOtt", "filterYear", "filterGenre", "sortBy"]
    .forEach(id => $("#" + id).addEventListener("change", applyFilters));
  $("#resetFilter").addEventListener("click", () => {
    $("#searchInput").value = "";
    ["filterType", "filterCountry", "filterOtt", "filterYear", "filterGenre"].forEach(id => $("#" + id).value = "");
    $("#sortBy").value = "date-desc";
    applyFilters();
  });

  $("#loadMoreBtn").addEventListener("click", () => { State.page++; renderCards(); });

  // 별점 선택
  $$("#starPicker .star-btn").forEach(btn => {
    btn.addEventListener("click", () => setStars(+btn.dataset.v));
  });
  $("#clearStar").addEventListener("click", () => setStars(0));

  // 재시청 토글
  $("#rewatchToggle").addEventListener("change", e => {
    $("#rewatchFields").classList.toggle("hidden", !e.target.checked);
  });

  // 모달 배경 클릭
  $("#editModal").addEventListener("click", e => { if (e.target.id === "editModal") closeEdit(); });
  $("#detailModal").addEventListener("click", e => { if (e.target.id === "detailModal") $("#detailModal").classList.add("hidden"); });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- 필터 옵션 채우기 ---------- */
function buildFilterOptions() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

  const fill = (id, values, label) => {
    const sel = $("#" + id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">${label}</option>` +
      values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    sel.value = cur;
  };

  fill("filterType", uniq(State.items.map(i => i.type)), "전체 구분");
  fill("filterCountry", uniq(State.items.map(i => i.country)), "전체 국가");
  fill("filterOtt", uniq(State.items.map(i => i.ott)), "전체 OTT");

  const years = uniq(State.items.map(i => (i.startDate || "").slice(0, 4))).reverse();
  fill("filterYear", years, "전체 기간");

  const genres = uniq(State.items.flatMap(i => i.genres || []));
  fill("filterGenre", genres, "전체 장르");
}

/* ---------- 필터 적용 ---------- */
function applyFilters() {
  buildFilterOptions();

  const q = $("#searchInput").value.trim().toLowerCase();
  const fType = $("#filterType").value;
  const fCountry = $("#filterCountry").value;
  const fOtt = $("#filterOtt").value;
  const fYear = $("#filterYear").value;
  const fGenre = $("#filterGenre").value;
  const sort = $("#sortBy").value;

  let list = State.items.filter(i => {
    if (q && !(i.title || "").toLowerCase().includes(q)) return false;
    if (fType && i.type !== fType) return false;
    if (fCountry && i.country !== fCountry) return false;
    if (fOtt && i.ott !== fOtt) return false;
    if (fYear && (i.startDate || "").slice(0, 4) !== fYear) return false;
    if (fGenre && !(i.genres || []).includes(fGenre)) return false;
    return true;
  });

  const dkey = (i) => i.lastWatchStart || i.startDate || "0000-00-00";
  if (sort === "date-desc") list.sort((a, b) => dkey(b).localeCompare(dkey(a)));
  else if (sort === "date-asc") list.sort((a, b) => dkey(a).localeCompare(dkey(b)));
  else if (sort === "title") list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko"));
  else if (sort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));

  State.filtered = list;
  State.page = 1;
  renderSummary();
  renderCards();
}

/* ---------- 요약 ---------- */
function renderSummary() {
  const all = State.items;
  const f = State.filtered;
  const rated = f.filter(i => i.rating);
  const avg = rated.length ? (rated.reduce((s, i) => s + i.rating, 0) / rated.length).toFixed(1) : "-";
  const noInfo = all.filter(i => !i.tmdbId).length;

  $("#summaryBar").innerHTML = `
    <div class="stat-box"><div class="stat-label">전체</div><div class="stat-value">${all.length}</div></div>
    <div class="stat-box"><div class="stat-label">필터 결과</div><div class="stat-value">${f.length}</div></div>
    <div class="stat-box"><div class="stat-label">평균 별점</div><div class="stat-value">${avg}</div></div>
    <div class="stat-box"><div class="stat-label">정보 미등록</div><div class="stat-value ${noInfo ? "text-amber-600" : ""}">${noInfo}</div></div>
  `;
}

/* ---------- 카드 렌더 ---------- */
function renderCards() {
  const grid = $("#cardGrid");
  const list = State.filtered;
  const show = list.slice(0, State.page * State.perPage);

  $("#emptyState").classList.toggle("hidden", list.length > 0);

  grid.innerHTML = show.map(i => `
    <div class="wl-card" data-id="${i.id}">
      ${i.poster
        ? `<img class="wl-poster" src="${i.poster}" alt="" loading="lazy">`
        : `<div class="wl-poster-empty"><i class="fa-solid fa-film"></i></div>`}
      <div class="wl-body">
        <div class="wl-title">${esc(i.title)}${i.season ? ` <span class="badge badge-season">${esc(i.season)}</span>` : ""}</div>
        ${i.rating ? `<div class="text-amber-500 text-sm font-semibold mb-1">${stars(i.rating)}</div>` : ""}
        <div class="wl-meta">${[i.type, i.country].filter(Boolean).join(" · ")}</div>
        <div class="wl-meta mt-0.5 text-slate-400">${fmtRange(i.startDate, i.endDate) || "날짜 없음"}</div>
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

  $("#detailContent").innerHTML = `
    <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
      <h3 class="font-semibold text-slate-800">상세 정보</h3>
      <button onclick="document.getElementById('detailModal').classList.add('hidden')"
        class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="p-5">
      <div class="flex gap-4 mb-4">
        ${i.poster
          ? `<img src="${i.poster}" class="w-28 rounded-lg object-cover" alt="">`
          : `<div class="w-28 aspect-[2/3] rounded-lg bg-slate-200 flex items-center justify-center text-slate-400"><i class="fa-solid fa-film text-2xl"></i></div>`}
        <div class="flex-1 min-w-0">
          <h4 class="text-lg font-semibold text-slate-800 leading-snug">${esc(i.title)}</h4>
          ${i.season ? `<span class="badge badge-season mt-1">${esc(i.season)}</span>` : ""}
          ${i.rating ? `<div class="text-amber-500 text-lg font-semibold mt-2">${stars(i.rating)}</div>` : ""}
          <div class="flex flex-wrap gap-1 mt-2">
            ${i.type ? `<span class="badge badge-type">${esc(i.type)}</span>` : ""}
            ${i.country ? `<span class="badge badge-country">${esc(i.country)}</span>` : ""}
            ${i.ott ? `<span class="badge badge-ott">${esc(i.ott)}</span>` : ""}
          </div>
          ${(i.genres || []).length ? `<div class="flex flex-wrap gap-1 mt-2">
            ${i.genres.map(g => `<span class="badge badge-genre">${esc(g)}</span>`).join("")}</div>` : ""}
        </div>
      </div>

      ${i.overview ? `<p class="text-sm text-slate-600 leading-relaxed mb-4">${esc(i.overview)}</p>` : ""}

      <div class="space-y-2 text-sm border-t border-slate-200 pt-4">
        <div class="flex justify-between"><span class="text-slate-500 font-medium">처음 본 날</span>
          <span class="font-semibold text-slate-700">${fmtRange(i.startDate, i.endDate) || "-"}</span></div>
        ${i.lastWatchStart ? `<div class="flex justify-between"><span class="text-slate-500 font-medium">마지막 시청</span>
          <span class="font-semibold text-slate-700">${fmtRange(i.lastWatchStart, i.lastWatchEnd)}</span></div>` : ""}
        <div class="flex justify-between"><span class="text-slate-500 font-medium">시청 횟수</span>
          <span class="font-semibold text-slate-700">${i.watchCount || 1}회</span></div>
        ${i.releaseYear ? `<div class="flex justify-between"><span class="text-slate-500 font-medium">제작연도</span>
          <span class="font-semibold text-slate-700">${esc(i.releaseYear)}</span></div>` : ""}
      </div>

      ${i.review ? `<div class="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <div class="text-xs font-semibold text-slate-500 mb-1">한줄평</div>
        <div class="text-sm text-slate-700 leading-relaxed">${esc(i.review)}</div></div>` : ""}
    </div>
    <div class="flex gap-2 px-5 py-4 border-t border-slate-200">
      ${!i.tmdbId ? `<button onclick="enrichOne('${i.id}')"
        class="px-4 py-2.5 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-50">
        <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>정보 가져오기</button>` : ""}
      <div class="flex-1"></div>
      <button onclick="document.getElementById('detailModal').classList.add('hidden'); openEdit('${i.id}')"
        class="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
        <i class="fa-solid fa-pen mr-1"></i>수정</button>
    </div>`;

  $("#detailModal").classList.remove("hidden");
}

/* ---------- 개별 정보 채우기 ---------- */
async function enrichOne(id) {
  const i = State.items.find(x => x.id === id);
  if (!i) return;
  toast("TMDB에서 정보를 찾는 중...");
  try {
    const d = await tmdbAutoMatch(i.title, i.type);
    if (!d) { toast("검색 결과가 없습니다", "error"); return; }
    Object.assign(i, {
      tmdbId: d.tmdbId, poster: d.poster, genres: d.genres,
      overview: d.overview, releaseYear: d.releaseYear,
      country: i.country || d.country
    });
    saveLocal();
    applyFilters();
    openDetail(id);
    toast("정보를 가져왔습니다", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

/* ---------- 별점 ---------- */
let _stars = 0;
function setStars(n) {
  _stars = n;
  $$("#starPicker .star-btn").forEach(b => {
    b.classList.toggle("on", +b.dataset.v <= n);
  });
}

/* ---------- 등록/수정 모달 ---------- */
function openEdit(id) {
  State.editingId = id;
  State.selectedTmdb = null;

  $("#tmdbResults").innerHTML = "";
  $("#tmdbQuery").value = "";
  $("#selectedInfo").classList.add("hidden");
  $("#tmdbSearchArea").classList.remove("hidden");

  if (id) {
    const i = State.items.find(x => x.id === id);
    $("#modalTitle").textContent = "수정";
    $("#fTitle").value = i.title || "";
    $("#fType").value = i.type || "영화";
    $("#fCountry").value = i.country || "";
    $("#fOtt").value = i.ott || "기타";
    $("#fSeason").value = i.season || "";
    $("#fCount").value = i.watchCount || 1;
    $("#fStart").value = i.startDate || "";
    $("#fEnd").value = i.endDate || "";
    $("#fReview").value = i.review || "";
    setStars(i.rating || 0);

    const hasRe = !!i.lastWatchStart;
    $("#rewatchToggle").checked = hasRe;
    $("#rewatchFields").classList.toggle("hidden", !hasRe);
    $("#fLastStart").value = i.lastWatchStart || "";
    $("#fLastEnd").value = i.lastWatchEnd || "";

    if (i.tmdbId) {
      State.selectedTmdb = {
        tmdbId: i.tmdbId, poster: i.poster, genres: i.genres || [],
        overview: i.overview || "", releaseYear: i.releaseYear
      };
    }
    $("#deleteBtn").classList.remove("hidden");
  } else {
    $("#modalTitle").textContent = "새로 등록";
    ["fTitle", "fCountry", "fSeason", "fStart", "fEnd", "fReview", "fLastStart", "fLastEnd"]
      .forEach(f => $("#" + f).value = "");
    $("#fType").value = "영화";
    $("#fOtt").value = "넷플릭스";
    $("#fCount").value = 1;
    setStars(0);
    $("#rewatchToggle").checked = false;
    $("#rewatchFields").classList.add("hidden");
    $("#deleteBtn").classList.add("hidden");
  }

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

  const base = {
    title,
    type: $("#fType").value,
    country: $("#fCountry").value.trim() || null,
    ott: $("#fOtt").value,
    season: $("#fSeason").value.trim() || null,
    watchCount: parseInt($("#fCount").value) || 1,
    rating: _stars || null,
    startDate: start,
    endDate: end,
    lastWatchStart: lastS,
    lastWatchEnd: lastE,
    review: $("#fReview").value.trim()
  };

  const t = State.selectedTmdb;
  if (t) {
    base.tmdbId = t.tmdbId;
    base.poster = t.poster;
    base.genres = t.genres || [];
    base.overview = t.overview || "";
    base.releaseYear = t.releaseYear || null;
  }

  if (State.editingId) {
    const i = State.items.find(x => x.id === State.editingId);
    Object.assign(i, base);
    toast("수정되었습니다", "success");
  } else {
    State.items.unshift({
      id: uid(), tmdbId: null, poster: null, genres: [], overview: "",
      releaseYear: null, createdAt: new Date().toISOString(), ...base
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

/* ---------- 일괄 정보 채우기 ---------- */
let _enriching = false;
async function runEnrichAll() {
  if (_enriching) { toast("이미 진행 중입니다"); return; }
  if (!getTmdbKey()) { toast("TMDB API 키를 먼저 저장하세요", "error"); return; }

  const targets = State.items.filter(i => !i.tmdbId);
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
          tmdbId: d.tmdbId, poster: d.poster, genres: d.genres,
          overview: d.overview, releaseYear: d.releaseYear,
          country: i.country || d.country
        });
        ok++;
      } else fail++;
    } catch { fail++; }

    if (n % 10 === 9) saveLocal();
    await new Promise(r => setTimeout(r, 260));
  }

  saveLocal();
  applyFilters();
  _enriching = false;
  status.textContent = `완료 — 성공 ${ok}개, 실패 ${fail}개`;
  status.className = "text-sm mt-3 font-medium text-emerald-600";
  toast(`정보 채우기 완료 (${ok}개)`, "success");
}
