/* ============================================
   core.js — Firebase(RTDB), 인증, 상태, 공통 유틸
   ============================================ */

/* ---------- 설정 ---------- */
/* Watch LOG 전용 Realtime Database (단어장과 완전히 분리된 별도 프로젝트) */
const FIREBASE_DB_URL = "https://nyanya-watchlog-default-rtdb.asia-southeast1.firebasedatabase.app";

/* 데이터가 저장되는 상위 경로. 실제 방 이름은 "동기화 비밀번호"가 된다.
   → 비밀번호를 모르면 경로 자체를 모르므로 남이 데이터에 접근할 수 없음.
   Firebase 규칙에서 watchlog/$room 만 읽기·쓰기 허용 (부모 목록 열거는 차단). */
const SYNC_BRANCH = "watchlog";

/* --------------------------------------------- */

const LS_KEY = "watchlog_items";
const LS_WISH = "watchlog_wishes";  // 보고싶어요 목록. 시청 기록과 섞지 않고 따로 둔다(통계 오염 방지)
const LS_HIDE = "watchlog_hides";   // 관심없음 목록. 추천·검색에서 걸러낼 작품
/* 화면 설정 (포인트 색 등). **기록과 같은 서버 문서에 같이 올린다** — 폰에서 바꾼 색이 PC에도 똑같이
   보여야 한다(2026-09-17 요청). 기기별로 남아야 하는 값(API 키·비밀번호)은 여기 넣지 말 것. */
const LS_PREFS = "watchlog_prefs";
const LS_TMDB = "watchlog_tmdb_key";
const LS_SYNC_PW = "watchlog_sync_password";   // 동기화 비밀번호 = 서버 데이터 경로 (이 기기에만 저장, 깃에는 없음)
const LS_MODIFIED = "watchlog_modified";
const LS_BACKUP = "watchlog_items_backup";
const LS_BACKUP_AT = "watchlog_items_backup_at";   // 그 백업이 언제 것인지
const LOCAL_BACKUP_MIN = 10 * 60 * 1000;           // 기기 백업 갱신 주기 (10분)
/* 서버 것을 받아 **이 기기 기록을 갈아끼우기 직전** 상태(기록·보고싶어요·관심없음·설정 통째로).
   처음 켠 기기(또는 비밀번호를 새로 넣은 기기)는 서버를 따르는데, 이 기기에만 있던 게 있으면 여기 남는다.
   [백업에서 되돌리기]에 "서버에서 받기 직전"으로 뜬다. */
const LS_REPLACED = "watchlog_replaced";
/* 시드를 넣던 코드는 없앴지만(2026-08-07) 이 표시는 남긴다 —
   **예전에 시드가 들어간 채로 남아 있는 기기**가 그걸 서버로 올리지 않도록 계속 막아야 한다.
   새로 붙는 일은 없고, `saveLocal()`이 한 번 돌면 지워진다. */
const LS_SEED = "watchlog_is_seed";

/* 로컬 데이터가 아직 "시드일 뿐"인지 */
function isSeedData() { return localStorage.getItem(LS_SEED) === "1"; }
function markSeed(on) {
  if (on) localStorage.setItem(LS_SEED, "1");
  else localStorage.removeItem(LS_SEED);
}

/* 동기화 비밀번호 = 서버에서의 내 데이터 방 이름 */
function getSyncPassword() {
  return (localStorage.getItem(LS_SYNC_PW) || "").trim();
}
function hasSyncPassword() {
  return getSyncPassword().length > 0;
}
/* 비밀번호가 없으면 null → 이 기기에만 저장(로컬 전용 모드) */
function getDataUrl() {
  const pw = getSyncPassword();
  if (!pw) return null;
  return `${FIREBASE_DB_URL}/${SYNC_BRANCH}/${encodeURIComponent(pw)}.json`;
}
const State = {
  items: [],
  wishes: [],        // 보고싶어요 (아직 안 본 작품) — items와 별도
  hides: [],         // 관심없음 — 추천·검색에서 제외할 작품
  prefs: {},         // 화면 설정 { accent } — 동기화된다
  filtered: [],
  page: 1,
  perPage: 24,
  editingId: null,
  selectedTmdb: null,
  online: true,
  autoSync: true
};

/* ---------- 유틸 ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function uid() {
  return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toast(msg, type = "info") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-white text-sm font-semibold z-50 shadow-lg " +
    (type === "error" ? "bg-red-600" : type === "success" ? "bg-emerald-600" : "bg-slate-800");
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2800);
}

function fmtDate(d) {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${y}.${m}.${dd}`;
}

/* "2026.08.07 14:32" — 백업이 언제 것인지 보여줄 때 쓴다 (날짜만으론 오늘 것끼리 구분이 안 된다) */
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtRange(s, e) {
  if (!s) return "";
  if (!e || s === e) return fmtDate(s);
  return `${fmtDate(s)} ~ ${fmtDate(e)}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- 동기화 상태 아이콘 ---------- */
function setSyncIcon(state) {
  const btn = $("#syncBtn");
  if (!btn) return;
  const map = {
    idle:    ["fa-cloud",             "text-slate-400",   "대기 중 (클릭하면 즉시 저장)"],
    pending: ["fa-pen",               "text-amber-500",   "저장 대기 중..."],
    // 저장 중·저장됨은 포인트 색을 따른다 (Tailwind 색을 박아두면 색을 바꿔도 이 아이콘만 남는다)
    saving:  ["fa-spinner fa-spin",   "ac-text",          "서버 저장 중..."],
    saved:   ["fa-cloud",             "ac-text",          "서버에 저장됨"],
    offline: ["fa-cloud",             "text-amber-500",   "연결 끊김 — 다시 연결되면 자동으로 올라가요"],
    error:   ["fa-triangle-exclamation", "text-red-500",  "서버 연결 실패 — 클릭해서 다시 연결"],
    local:   ["fa-cloud-slash",       "text-slate-400",   "이 기기에만 저장 중 — 클릭해서 동기화 비밀번호 설정"]
  };
  const [icon, color, title] = map[state] || map.idle;
  btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  btn.className = `top-icon ${color}`;
  btn.title = title;
}

/* ---------- 로컬 저장 ----------
   이 기기 사본(화면을 빨리 띄우는 용도)에 적고, 서버에는 **바뀐 칸만** 보낸다(`schedulePush` → 아래 "저장" 절).
   `skipCloud` = 일괄 작업 중간 저장 — 이 기기에만 적고, 끝에 한 번 부르는 `saveLocal()`이 몰아서 보낸다. */
function saveLocal(skipCloud) {
  try {
    /* 백업은 **10분에 한 번만** 갱신한다.
       저장할 때마다 덮으면, 별점을 연달아 넣는 것처럼 저장이 촘촘한 작업 중에 백업이 바로
       "방금 상태"가 되어 버려 되돌릴 데가 없어진다. 주기를 두면 10분 전 상태가 남는다. */
    const prev = localStorage.getItem(LS_KEY);
    const bakAt = Date.parse(localStorage.getItem(LS_BACKUP_AT) || "") || 0;
    if (prev && prev.length > 20 && Date.now() - bakAt >= LOCAL_BACKUP_MIN) {
      localStorage.setItem(LS_BACKUP, prev);
      localStorage.setItem(LS_BACKUP_AT, new Date().toISOString());
    }

    localStorage.setItem(LS_KEY, JSON.stringify(State.items));
    localStorage.setItem(LS_WISH, JSON.stringify(State.wishes));
    localStorage.setItem(LS_HIDE, JSON.stringify(State.hides));
    localStorage.setItem(LS_PREFS, JSON.stringify(State.prefs || {}));
    localStorage.setItem(LS_MODIFIED, new Date().toISOString());
    // 사용자가 실제로 저장한 순간부터는 더 이상 "시드"가 아니다
    markSeed(false);
  } catch (e) {
    console.error("로컬 저장 실패", e);
    toast("브라우저 저장 공간이 부족합니다", "error");
  }

  if (skipCloud || !State.autoSync) return;
  schedulePush();
}

function loadLocal() {
  try {
    State.items = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch { State.items = []; }
  try {
    State.wishes = JSON.parse(localStorage.getItem(LS_WISH) || "[]");
  } catch { State.wishes = []; }
  try {
    State.hides = JSON.parse(localStorage.getItem(LS_HIDE) || "[]");
  } catch { State.hides = []; }
  try {
    State.prefs = JSON.parse(localStorage.getItem(LS_PREFS) || "{}") || {};
  } catch { State.prefs = {}; }
  /* 예전 통째 동기화가 쓰던 자리 — 칸마다 저장으로 바꾸며(2026-10-16) 안 쓴다. 0.7MB짜리라 비운다 */
  ["watchlog_sync_base", "watchlog_server_stamp"].forEach(k => { try { localStorage.removeItem(k); } catch {} });
  applyPrefs();
}

/* ---------- 화면 설정: 포인트 색 ----------
   색 값 자체는 style.css의 `html[data-accent]` 세트에 있다. 여기는 이름만 고른다.
   기본값은 코랄(`data-accent` 없음). 목록에 없는 값이 서버에서 오면 코랄로 둔다. */
const ACCENTS = [
  ["coral", "코랄", "#e5533d"], ["teal", "틸", "#0e9384"], ["plum", "플럼", "#9d3b77"], ["burgundy", "버건디", "#8e3346"],
  ["sage", "세이지", "#5f8a6e"], ["rose", "로즈", "#cf5f7d"], ["terra", "테라코타", "#b95a3c"], ["olive", "올리브", "#7a8a36"],
  ["petrol", "페트롤", "#1f6470"], ["navy", "네이비", "#2b4a7e"], ["orchid", "오키드", "#ad569f"], ["sky", "스카이", "#3a97cf"]
];
function currentAccent() {
  const a = State.prefs && State.prefs.accent;
  return ACCENTS.some(x => x[0] === a) ? a : "coral";
}
function applyPrefs() {
  /* 탐색 탭 설정(한국 비중·정렬·필터·보던 자리)과 기록 화면 보기도 `prefs`에 함께 들어 있다 —
     다른 기기에서 바뀐 게 들어오면 화면에 얹는다. 받아오는 길은 모두 뒤에 `applyFilters()`·
     `renderDiscover()`가 따라오므로 다시 그려진다. 두 파일이 나중에 로드되므로 있을 때만 부른다. */
  if (typeof applyDcPrefs === "function") applyDcPrefs();
  if (typeof loadListView === "function") loadListView();
  const a = currentAccent();
  if (a === "coral") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = a;
  // 차트는 캔버스라 CSS 변수를 못 따라온다 — 보고 있으면 다시 그린다
  const st = document.getElementById("tab-stats");
  if (st && !st.classList.contains("hidden") && typeof renderStats === "function") renderStats();
  if (typeof renderAccentPicker === "function") renderAccentPicker();
}
function setAccent(key) {
  if (!ACCENTS.some(x => x[0] === key) || key === currentAccent()) return;
  State.prefs = { ...State.prefs, accent: key };
  applyPrefs();
  saveLocal();   // 다른 기기에도 같은 색이 칠해진다
}

/* 화면 설정만 바뀐 경우 — 이 기기에 적고 **그 설정 칸만** 서버로 보낸다(연달아 눌러도 몰아서 한 번).
   ⚠ 기기에만 남아야 하는 값(API 키·동기화 비밀번호)은 여기에 넣지 말 것. */
function savePrefs(patch) {
  const next = { ...State.prefs, ...patch };
  /* **안 바뀌었으면 아무 일도 안 한다** — 기록 화면 보기처럼 그릴 때마다 적는 값이 있다 */
  if (JSON.stringify(next) === JSON.stringify(State.prefs || {})) return;
  State.prefs = next;
  try { localStorage.setItem(LS_PREFS, JSON.stringify(State.prefs)); }
  catch { /* 저장 공간 문제면 이번 판만 적용된다 */ }
  schedulePush(800);
}

/* ---------- 서버 백업 (2026-08-07) ----------
   기기 안의 백업(`watchlog_items_backup`)은 **그 기기를 쓸수록 덮인다.** 실제로 하루 종일 만진 PC는
   이미 망가진 상태가 백업에 들어가 있었고, 거의 안 쓴 폰에만 성한 사본이 남아 살았다.
   그래서 서버에도 둔다 — 어느 기기에서든 꺼낼 수 있고, 그 기기를 얼마나 썼는지와 무관하다.

   세 벌:
     · `prev`  — 1시간마다   → 방금 망친 걸 되돌릴 때
     · `daily` — 하루마다    → 오늘 여러 번 저장해 `prev`까지 덮였을 때
     · `undo`  — [백업에서 되돌리기] 직전 상태 (욱진보드와 같다) → 되돌리기를 되돌릴 때
   백업은 예전 통째 모양(`{items:[…], wishes, hides, prefs, cache}`) 그대로 옆방(`<비번>_bak_…`)에 둔다.
   방 이름만 다르므로 Firebase 규칙(`watchlog/$room`)은 그대로 쓴다. */
const BAK_KINDS = { prev: 60 * 60 * 1000, daily: 24 * 60 * 60 * 1000 };
const LS_BAK_AT = "watchlog_server_bak_at";   // 종류별 마지막 갱신 시각 (이 기기 기준 — 서버에 묻기 전 거르기용)

function getBackupUrl(kind) {
  const pw = getSyncPassword();
  if (!pw) return null;
  return `${FIREBASE_DB_URL}/${SYNC_BRANCH}/${encodeURIComponent(pw + (isDevHost() ? "__v3dev" : "") + "_bak_" + kind)}.json`;
}

function bakStamps() {
  try { return JSON.parse(localStorage.getItem(LS_BAK_AT) || "{}"); } catch { return {}; }
}

/* 지금 서버 내용(`current`, 통째 모양)을 백업 자리로 옮긴다 — 주기가 됐을 때만 */
async function rotateServerBackup(current) {
  if (!current || !Array.isArray(current.items) || !current.items.length) return;   // 빈 데이터는 백업하지 않는다

  const now = Date.now();
  const at = bakStamps();
  for (const kind of Object.keys(BAK_KINDS)) {
    if (now - (Date.parse(at[kind] || "") || 0) < BAK_KINDS[kind]) continue;   // 이 기기가 최근에 굴렸다
    const url = getBackupUrl(kind);
    if (!url) continue;
    /* ⚠ 주기는 **서버에 있는 백업 자체의 시각**으로 본다(2026-10-14). 예전엔 이 기기 기록만 봐서, 기기가 셋이면
       각자 "하루 지났다"며 굴려 `하루 전` 백업이 1시간 전 것이 됐다 — 폰이 옛 기록을 올린 날 백업 둘이 다 옛것이었다.
       백업 시각을 못 읽으면 굴리지 않는다(모르고 덮는 것보다 낫다) */
    let last = 0;
    try {
      const r = await fetch(url.replace(/\.json$/, "/savedAt.json") + "?t=" + now);
      if (!r.ok) continue;
      last = Date.parse((await r.json()) || "") || 0;
    } catch { continue; }
    if (now - last < BAK_KINDS[kind]) { at[kind] = new Date(last).toISOString(); continue; }
    try {
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, savedAt: new Date().toISOString() })
      });
      at[kind] = new Date().toISOString();
    } catch { /* 백업 실패가 저장을 막지는 않는다 */ }
  }
  try { localStorage.setItem(LS_BAK_AT, JSON.stringify(at)); } catch {}
}

/* [백업에서 되돌리기] 직전 — 지금 서버 내용을 `undo`에 둔다(주기 없이 매번) */
async function saveUndoBackup() {
  const doc = serverDoc();
  const url = getBackupUrl("undo");
  if (!doc || !url || !doc.items.length) return;
  try {
    await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
                       body: JSON.stringify({ ...doc, savedAt: new Date().toISOString() }) });
  } catch { /* 못 남겨도 되돌리기는 한다 */ }
}

/* 복구 화면에서 쓸 목록. 없는 건 빼고 돌려준다.
   `old` = 칸마다 저장으로 옮기기 전 **예전 통째 저장**(`watchlog/<비번>`) — 이사한 뒤로는 아무도 안 쓰니 그때 상태 그대로다 */
async function fetchBackups() {
  const out = [];
  const pw = getSyncPassword();
  const urls = [...Object.keys(BAK_KINDS), "undo"].map(k => [k, getBackupUrl(k)]);
  if (pw) urls.push(["old", `${FIREBASE_DB_URL}/${SYNC_BRANCH}/${encodeURIComponent(pw)}.json`]);
  for (const [kind, url] of urls) {
    if (!url) continue;
    try {
      const res = await fetch(url + "?t=" + Date.now());
      if (!res.ok) continue;
      const d = await res.json();
      if (d && Array.isArray(d.items) && d.items.length) out.push({ kind, data: d });
    } catch { /* 못 받으면 그 항목만 빠진다 */ }
  }
  return out;
}

/* 서버가 돌려준 값과 견줄 때 쓰는 정규화 — 서버(Firebase)는 키를 정렬해 돌려주고 null·빈 배열·빈 객체를 지운다.
   ⚠ 서버 값과 비교할 땐 **항상 `sameVal`**(2026-10-14: 글자 그대로 견줘서 두 기기가 끝없이 주고받은 사고) */
function canon(x) {
  if (x === null || x === undefined) return undefined;
  if (Array.isArray(x)) { const a = x.map(canon); return a.length ? a : undefined; }
  if (typeof x === "object") {
    const o = {};
    Object.keys(x).sort().forEach(k => { const v = canon(x[k]); if (v !== undefined) o[k] = v; });
    return Object.keys(o).length ? o : undefined;
  }
  return x;
}
const sameVal = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/* ---------- TMDB에서 받아온 참고 정보 (2026-08-07부터 같이 동기화) ----------
   내가 입력한 기록이 아니라 앱이 TMDB에서 받아 저장해둔 것들 — 배우 한글 이름, 시리즈 편 목록,
   추천 결과 등. 기기를 옮길 때마다 같은 작업을 처음부터 다시 돌리지 않으려고 같이 올린다.
   API 키·동기화 비밀번호·백업·시드 표시는 **일부러 뺐다** — 그 기기에 남아야 하는 것들이다. */
const CACHE_KEYS = [
  "watchlog_person_ko",     // 배우·감독 한글 표기 (한글 표기가 "없다고 확인된" 사람 포함)
  "watchlog_collections",   // 컬렉션 편 정보
  "watchlog_franchises",    // 프랜차이즈(MCU 등) 목록
  "watchlog_reco",          // 추천 결과
  "watchlog_updated_at"     // 설정 탭의 "마지막 실행" 시각
];
/* 사람·컬렉션·프랜차이즈는 맵이라 **한 칸씩** 쓴다(`cache/<이름>/<키>`) — 두 기기가 서로 다른 걸 조회해도
   둘 다 남는다. 추천 결과·시각은 한 덩어리로 쓴다(한 번에 새로 만드는 값이라). */
const CACHE_MAPS = ["watchlog_person_ko", "watchlog_collections", "watchlog_franchises"];

function collectCache() {
  const out = {};
  CACHE_KEYS.forEach(k => {
    const raw = localStorage.getItem(k);
    if (raw == null) return;
    try { out[k] = JSON.parse(raw); } catch { /* 깨진 값은 올리지 않는다 */ }
  });
  return out;
}

/* 캐시만 바뀐 작업(이름 한글화·시리즈 정보·추천 등)도 서버에 보낸다. 한 작업이 캐시를 여러 번 건드리므로 몰아서 */
function touchCache() { schedulePush(1000); }

/* 파일 가져오기용 — 받은 캐시를 이 기기에 얹는다(맵은 합친다, 겹치면 이 기기 것) */
function adoptCache(cache) {
  if (!cache || typeof cache !== "object") return;
  CACHE_KEYS.forEach(k => {
    if (cache[k] === undefined) return;
    let val = cache[k];
    if (CACHE_MAPS.includes(k)) {
      let mine = {};
      try { mine = JSON.parse(localStorage.getItem(k) || "{}"); } catch { mine = {}; }
      val = { ...val, ...mine };
    }
    try { localStorage.setItem(k, JSON.stringify(val)); } catch { /* 저장 공간 문제면 넘어간다 */ }
  });
}

/* 파일 가져오기용 — 곁 목록·설정·캐시를 **있을 때만** 이 기기에 얹는다(기록만 든 옛 파일이 곁 목록을 지우지 않게).
   저장(=서버로 보내기)은 부른 쪽의 `saveLocal()`이 한다 */
function adoptLists(d) {
  if (!d) return;
  if (Array.isArray(d.wishes)) State.wishes = d.wishes;
  if (Array.isArray(d.hides)) State.hides = d.hides;
  if (d.prefs && typeof d.prefs === "object" && !Array.isArray(d.prefs)) { State.prefs = d.prefs; applyPrefs(); }
  adoptCache(d.cache);
}

/* ============================================
   저장 — 욱진보드식: 고친 칸만 쓰고, 서버가 유일한 진짜 (2026-10-16)

   예전엔 기기마다 전체 사본(localStorage)을 들고, 저장할 때마다 **문서 통째로**(기록 343개, 0.7MB) PUT 하고,
   누가 최신인지를 수정 시각·서버 시각·합치기 기준으로 겨뤘다. 시드(8/1)·별점(8/7)·빈 폰(9/23)·옛 폰(10/14) 사고가
   전부 "기기 사본이 자기가 최신이라고 착각해 통째로 올린" 일이었다. 욱진보드처럼 바꿨다:

   · 자리: `watchlog/<비번>__v3/` 아래 items/<id> · wishes/<id> · hides/<id> · prefs/<이름> · cache/<이름>[/<키>] · meta
     (로컬 시험은 `__v3dev` — 진짜 자리를 시험으로 더럽히지 않게). 규칙(`watchlog/$room`)은 그대로 열린다.
   · 쓰기: **고친 칸만.** `saveLocal()`이 부를 때마다 "마지막으로 서버와 맞춘 상태(그림자 `Sync.shadow`)"와 지금을 견줘
     바뀐 **기록의 칸**(items/<id>/<칸>)만 모아 한 번에 `update` 한다. 고치는 곳마다 따로 부르지 않아서 빠뜨릴 곳이 없다.
     옛 폰이 시즌 수 하나를 고치면 그 한 칸만 가고, 남의 별점·날짜는 건드리지 않는다.
   · 읽기: Firebase SDK의 실시간 구독(모음마다 `onValue`). 다른 기기가 고친 칸이 바로 들어온다.
     받은 것 = 그림자. 아직 못 보낸 이 기기 변경이 있으면 그 위에 다시 얹고 보낸다.
   · 기기 사본(localStorage)은 **화면을 빨리 띄우는 용도**로만 남긴다. 그림자도 기기에 둬서(`watchlog_v3_shadow`)
     창을 닫았다 열어도 "아직 못 보낸 것"을 알 수 있다. **그림자가 없으면(처음 켠 기기) 이 기기 것은 하나도 안 보낸다.**
   · SDK는 욱진보드와 같은 v10을 필요할 때 받아온다(gstatic). 연결 끊김 감지·쓰기 모아두기·재연결을 SDK가 한다.
   · 처음 한 번 **이사**: 새 자리가 비었으면 예전 통째 저장(`watchlog/<비번>`)을 그대로 옮긴다(트랜잭션 — 두 기기가
     동시에 해도 한 번만). 예전 자리는 지우지 않는다 = 이사 전 백업. */
const FB_VER = "10.12.2";
const LS_SHADOW = "watchlog_v3_shadow";
/* 보냈는데 서버가 "받았다"고 답하기 전인 칸들 — 그 사이 창을 닫으면 다음에 켤 때 다시 보낸다.
   (그림자는 보내는 순간 고쳐 두므로, 이게 없으면 못 간 변경을 "이미 보낸 것"으로 알고 잃는다) */
const LS_UNACKED = "watchlog_v3_unacked";
const V3_LISTS = { items: [LS_KEY, "createdAt"], wishes: [LS_WISH, "addedAt"], hides: [LS_HIDE, "addedAt"] };
const V3_SECS = ["items", "wishes", "hides", "prefs", "cache"];
const Sync = {
  rt: null, db: null, ref: null, room: "",
  shadow: null, hadShadow: false, got: {},
  connected: false, pending: 0, timer: null, starting: false, unsubs: [], redraw: null, bakTimer: null
};

function isDevHost() {
  return location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}
function v3RoomName() {
  const pw = getSyncPassword();
  return pw ? pw + (isDevHost() ? "__v3dev" : "__v3") : "";
}

/* 맵 캐시의 키는 서버 자리 이름이 된다 — . # $ [ ] / 는 못 쓴다(이름 캐시의 "n:J.K. 시먼스" 같은 것) */
const encKey = (k) => String(k).replace(/[.#$\[\]\/%]/g, c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"));
const decKey = (k) => String(k).replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const emptyView = () => ({ items: {}, wishes: {}, hides: {}, prefs: {}, cache: {} });
/* 서버는 번호 키가 촘촘하면 객체를 배열로 돌려준다 — 맵으로 되돌린다 */
const asMap = (v) => (Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [String(i), x]).filter(([, x]) => x != null))
                                       : (v && typeof v === "object" ? v : {}));

/* 지금 이 기기 상태를 서버 모양(칸 이름 → 값)으로 — 그림자와 견줄 때 쓴다 */
function localView() {
  const v = emptyView();
  Object.keys(V3_LISTS).forEach(n => (State[n] || []).forEach(x => { if (x && x.id) v[n][x.id] = x; }));
  v.prefs = State.prefs || {};
  v.cache = collectCache();
  return v;
}

/* 서버에서 받은 한 모음 → 그림자 모양 */
function fromServer(sec, val) {
  if (sec !== "cache") return asMap(val);
  const out = {};
  Object.entries(asMap(val)).forEach(([k, v]) => {
    out[k] = CACHE_MAPS.includes(k) ? Object.fromEntries(Object.entries(asMap(v)).map(([e, x]) => [decKey(e), x])) : v;
  });
  return out;
}

/* 그림자(sh)와 지금(cur)을 견줘 바뀐 칸만 `{경로: 값}`으로 — 지운 건 null */
function diffView(cur, sh, sec) {
  const out = {};
  const a = cur[sec] || {}, b = sh[sec] || {};
  if (V3_LISTS[sec]) {
    Object.keys(a).forEach(id => {
      const x = a[id], s = b[id];
      if (!s) { out[`${sec}/${id}`] = plain(x); return; }
      new Set([...Object.keys(x), ...Object.keys(s)]).forEach(f => {
        if (!sameVal(x[f], s[f])) out[`${sec}/${id}/${f}`] = plain(x[f]);
      });
    });
    Object.keys(b).forEach(id => { if (!(id in a)) out[`${sec}/${id}`] = null; });
  } else if (sec === "prefs") {
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
      if (!sameVal(a[k], b[k])) out[`prefs/${k}`] = plain(a[k]);
    });
  } else {
    Object.keys(a).forEach(k => {
      if (CACHE_MAPS.includes(k)) {
        /* 캐시는 칸을 **지우지 않는다** — 이 기기에 없다고 다른 기기가 받아둔 걸 지우면 안 된다 */
        const am = a[k] || {}, bm = b[k] || {};
        Object.keys(am).forEach(e => { if (!sameVal(am[e], bm[e])) out[`cache/${k}/${encKey(e)}`] = plain(am[e]); });
      } else if (!sameVal(a[k], b[k])) out[`cache/${k}`] = plain(a[k]);
    });
  }
  return out;
}

/* 경로 모음을 그림자 모양(view)에 얹는다. 지운 기록의 칸만 고친 경우(다른 기기가 지웠다)는 얹지 않고 빼버린다 */
function applyPaths(view, out) {
  Object.keys(out).forEach(p => {
    const parts = p.split("/").map((s, i) => (parts0(p) === "cache" && i === 2 ? decKey(s) : s));
    if (V3_LISTS[parts[0]] && parts.length > 2 && !(view[parts[0]] || {})[parts[1]]) { delete out[p]; return; }
    let o = view;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!o[parts[i]] || typeof o[parts[i]] !== "object") o[parts[i]] = {};
      o = o[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (out[p] === null) delete o[last]; else o[last] = plain(out[p]);
  });
}
const parts0 = (p) => p.split("/")[0];
function getPath(view, p) {
  const parts = p.split("/").map((s, i) => (parts0(p) === "cache" && i === 2 ? decKey(s) : s));
  let o = view;
  for (const k of parts) { if (!o || typeof o !== "object") return undefined; o = o[k]; }
  return o;
}

/* 그림자 모양 → 이 기기 상태(State·localStorage) 한 모음 */
function writeLocal(view, sec) {
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 공간 */ } };
  if (V3_LISTS[sec]) {
    const [ls, at] = V3_LISTS[sec];
    /* ⚠ 있던 객체는 **그대로 두고 안만 고친다** — 별점 몰아넣기처럼 기록 객체를 붙잡고 있다가 고치는 곳이 있어서,
       새 객체로 갈아끼우면 그쪽에서 고친 게 허공에 적혀 저장되지 않는다 */
    const old = new Map((State[sec] || []).map(x => [x.id, x]));
    State[sec] = Object.values(view[sec] || {}).map(v => {
      const o = old.get(v.id);
      if (!o) return plain(v);
      if (!sameVal(o, v)) {
        const nv = plain(v);
        Object.keys(o).forEach(k => { if (!(k in nv)) delete o[k]; });
        Object.assign(o, nv);
      }
      return o;
    }).sort((x, y) => (y[at] || "").localeCompare(x[at] || "") || String(y.id).localeCompare(String(x.id)));
    set(ls, State[sec]);
  } else if (sec === "prefs") {
    State.prefs = plain(view.prefs || {});
    set(LS_PREFS, State.prefs);
  } else {
    Object.entries(view.cache || {}).forEach(([k, v]) => set(k, v));
  }
}

function saveShadow() {
  try { localStorage.setItem(LS_SHADOW, JSON.stringify({ room: Sync.room, view: Sync.shadow })); }
  catch { /* 저장 공간이 모자라면 이번 판만 — 다음에 켤 땐 "처음 켠 기기"처럼 서버를 따른다 */ }
}
function loadShadow(room) {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SHADOW) || "null");
    return s && s.room === room && s.view ? s.view : null;
  } catch { return null; }
}

/* 한꺼번에 많이 지우려는 건 의심한다 — 기기 사본이 망가졌거나 코드가 목록을 비운 것일 수 있다 */
function massDelete(out) {
  const total = Object.keys((Sync.shadow || {}).items || {}).length;
  const del = Object.keys(out).filter(p => /^items\/[^/]+$/.test(p) && out[p] === null).length;
  return del >= 3 && del >= total * 0.2 ? del : 0;
}
function dropItemDeletes(out) {
  Object.keys(out).forEach(p => { if (/^items\/[^/]+$/.test(p) && out[p] === null) delete out[p]; });
}

function loadUnacked() {
  try { const u = JSON.parse(localStorage.getItem(LS_UNACKED) || "null"); return u && u.room === Sync.room ? u.paths || {} : {}; }
  catch { return {}; }
}
function saveUnacked(paths) {
  try { localStorage.setItem(LS_UNACKED, JSON.stringify({ room: Sync.room, paths })); } catch { /* 저장 공간 */ }
}

/* 서버에서 한 모음을 받았을 때 */
function onSnap(sec, val) {
  const cur = localView();
  /* 아직 못 보낸 이 기기 변경 = 지난번에 보내다 만 것 + 그림자와 지금의 차이(뒤에 것이 이긴다) */
  const un = Sync.got[sec] ? {} : Object.fromEntries(Object.entries(loadUnacked()).filter(([p]) => parts0(p) === sec));
  const pend = { ...un, ...diffView(cur, Sync.shadow, sec) };
  if (sec === "items" && massDelete(pend)) {
    dropItemDeletes(pend);
    toast("이 기기에서 기록이 많이 사라져 있어 서버에서 지우지 않았어요", "error");
  }
  const server = fromServer(sec, val);
  const changed = !sameVal(server, Sync.shadow[sec]);

  /* 처음 켠 기기(그림자 없음)는 서버를 따른다 — 이 기기 기록이 달랐으면 [백업에서 되돌리기]에 남긴다 */
  if (sec === "items" && !Sync.hadShadow && !Sync.got.items && State.items.length && !sameVal(cur.items, server)) {
    try { localStorage.setItem(LS_REPLACED, JSON.stringify({ at: new Date().toISOString(), items: State.items,
      wishes: State.wishes, hides: State.hides, prefs: State.prefs })); } catch { /* 저장 공간 */ }
  }

  Sync.shadow[sec] = server;
  if (changed || Object.keys(pend).length || !Sync.got[sec]) {
    const view = { ...cur, [sec]: plain(server) };
    applyPaths(view, pend);                                    // 서버 것 위에 이 기기 변경을 얹는다
    writeLocal(view, sec);
  }
  saveShadow();
  Sync.got[sec] = true;
  if (Object.keys(pend).length) send(pend);
  if (changed || Object.keys(pend).length) redrawSoon(sec === "prefs");
  syncIcon();
}

function redrawSoon(prefs) {
  clearTimeout(Sync.redraw);
  Sync.redraw = setTimeout(() => {
    if (prefs) applyPrefs();
    if (typeof applyFilters === "function") applyFilters();
    if (window.renderDiscover) renderDiscover();
  }, 60);
}

/* 경로 모음을 서버에 보낸다. 그림자에는 먼저 얹고, 실패하면 되돌린다(다음 저장 때 다시 간다) */
async function send(out) {
  if (!Sync.ref || !Object.keys(out).length) return;
  const undo = {};
  Object.keys(out).forEach(p => { const v = getPath(Sync.shadow, p); undo[p] = v === undefined ? null : plain(v); });
  applyPaths(Sync.shadow, out);
  saveShadow();
  saveUnacked({ ...loadUnacked(), ...out });
  Sync.pending++; syncIcon();
  try {
    await Sync.rt.update(Sync.ref, out);
    State.lastError = "";
    const un = loadUnacked();
    Object.keys(out).forEach(p => { if (sameVal(un[p], out[p])) delete un[p]; });
    saveUnacked(un);
  } catch (e) {
    console.error("저장 실패", e);
    State.lastError = e.message;
    applyPaths(Sync.shadow, undo); saveShadow();
    toast("서버 저장 실패 — 다음 저장 때 다시 보내요", "error");
  } finally { Sync.pending--; syncIcon(); }
}

/* 지금 이 기기 변경을 모아 보낸다 — 이미 받은 모음만(아직 못 받은 모음은 받을 때 `onSnap`이 얹어 보낸다) */
function pushNow() {
  clearTimeout(Sync.timer); Sync.timer = null;
  if (!Sync.ref || !Sync.shadow) { syncIcon(); return; }
  const cur = localView();
  const out = {};
  V3_SECS.filter(s => Sync.got[s]).forEach(s => Object.assign(out, diffView(cur, Sync.shadow, s)));
  const del = massDelete(out);
  if (del && !confirm(`기록 ${del}개를 서버에서 지우려고 해요. 정말 지울까요?\n\n[취소]를 누르면 지우지 않아요.`)) dropItemDeletes(out);
  send(out);
  syncIcon();
}
function schedulePush(delay = 400) {
  if (!hasSyncPassword()) { setSyncIcon("local"); return; }
  clearTimeout(Sync.timer);
  Sync.timer = setTimeout(pushNow, delay);
  syncIcon();
}

function syncIcon() {
  if (!hasSyncPassword()) return setSyncIcon("local");
  if (!Sync.ref) return setSyncIcon(Sync.starting ? "saving" : "error");
  if (!Sync.connected) return setSyncIcon("offline");
  if (Sync.pending || Sync.timer || V3_SECS.some(s => !Sync.got[s])) return setSyncIcon("saving");
  setSyncIcon("saved");
}

/* 그림자로 예전 통째 모양을 만든다 — 서버 백업·내보내기용 */
function serverDoc() {
  if (!Sync.shadow) return null;
  const list = (n) => Object.values(Sync.shadow[n] || {})
    .sort((x, y) => (y[V3_LISTS[n][1]] || "").localeCompare(x[V3_LISTS[n][1]] || ""));
  return { items: list("items"), wishes: list("wishes"), hides: list("hides"), prefs: Sync.shadow.prefs || {},
           cache: Sync.shadow.cache || {}, updatedAt: new Date().toISOString() };
}

/* 처음 한 번 — 예전 통째 저장을 새 자리로 옮긴다 */
async function migrateToV3(ref) {
  const rt = Sync.rt;
  const old = (await rt.get(rt.ref(Sync.db, `${SYNC_BRANCH}/${getSyncPassword()}`))).val();
  const byId = (arr) => Object.fromEntries((Array.isArray(arr) ? arr : Object.values(asMap(arr)))
    .filter(x => x && x.id).map(x => [x.id, x]));
  const tree = { meta: { migratedAt: new Date().toISOString(), from: (old && old.updatedAt) || null } };
  if (old && old.items) {
    tree.items = byId(old.items); tree.wishes = byId(old.wishes); tree.hides = byId(old.hides);
    tree.prefs = old.prefs && typeof old.prefs === "object" ? old.prefs : {};
    const c = {};
    Object.entries(old.cache || {}).forEach(([k, v]) => {
      if (!CACHE_KEYS.includes(k)) return;
      c[k] = CACHE_MAPS.includes(k) ? Object.fromEntries(Object.entries(asMap(v)).map(([e, x]) => [encKey(e), x])) : v;
    });
    tree.cache = c;
  }
  /* 두 기기가 동시에 이사해도 한 번만 — 자리가 비어 있을 때만 쓴다 */
  await rt.runTransaction(ref, (cur) => (cur === null ? plain(tree) : undefined));
  if (old && old.items) toast(`새 저장 방식으로 옮겼어요 (기록 ${Object.keys(tree.items).length}개)`, "success");
}

function stopSync() {
  Sync.unsubs.forEach(u => { try { u(); } catch {} });
  Sync.unsubs = []; Sync.ref = null; Sync.got = {}; Sync.shadow = null;
  clearTimeout(Sync.timer); Sync.timer = null;
  clearInterval(Sync.bakTimer);
}

async function startSync() {
  stopSync();
  const room = v3RoomName();
  if (!room) { setSyncIcon("local"); return; }
  Sync.starting = true; syncIcon();
  try {
    if (!Sync.rt) {
      const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
      const [app, rt] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-database.js")]);
      Sync.rt = rt;
      Sync.db = rt.getDatabase(app.initializeApp({ databaseURL: FIREBASE_DB_URL }));
      rt.onValue(rt.ref(Sync.db, ".info/connected"), (s) => { Sync.connected = s.val() === true; syncIcon(); });
    }
    const rt = Sync.rt;
    const ref = rt.ref(Sync.db, `${SYNC_BRANCH}/${room}`);
    if (!(await rt.get(rt.child(ref, "meta"))).exists()) await migrateToV3(ref);
    if (v3RoomName() !== room) return;                         // 그 사이 비밀번호가 바뀌었다

    Sync.room = room; Sync.ref = ref; Sync.got = {};
    const sh = loadShadow(room);
    Sync.hadShadow = !!sh;
    if (sh) Sync.shadow = sh;
    else {
      /* 처음 켠 기기: **이 기기 것은 하나도 안 보낸다**(그림자 = 지금 이 기기). 단 서버가 완전히 비었으면 이 기기 기록을 올린다 */
      const hasItems = (await rt.get(rt.child(ref, "items"))).exists();
      Sync.shadow = hasItems || !State.items.length ? plain(localView()) : emptyView();
    }
    V3_SECS.forEach(sec => {
      Sync.unsubs.push(rt.onValue(rt.child(ref, sec), (snap) => onSnap(sec, snap.val()), (e) => {
        console.error("구독 실패", sec, e);
        toast("서버에서 받아오지 못했어요 — 이 기기 것을 보여드려요", "error");
      }));
    });
    /* 서버 백업: 켤 때 한 번, 그 뒤로 10분마다 주기가 됐는지 본다(욱진보드와 같다) */
    const rotate = () => { if (Sync.got.items) rotateServerBackup(serverDoc()); };
    setTimeout(rotate, 15000);
    Sync.bakTimer = setInterval(rotate, 10 * 60 * 1000);
  } catch (e) {
    console.error("서버 연결 실패", e);
    toast("서버 연결 실패 — 이 기기에만 저장되고, 다시 연결되면 올라가요", "error");
  } finally {
    Sync.starting = false; syncIcon();
  }
}

/* 헤더 구름 = 지금 보내기 · 새로고침 아이콘 = 연결 다시 붙이기 */
async function pushToServer() {
  if (!hasSyncPassword()) { toast("먼저 동기화 비밀번호를 설정하세요", "error"); openSyncPwModal(); return false; }
  if (!Sync.ref) { await startSync(); return !!Sync.ref; }
  pushNow();
  toast(Sync.connected ? (Sync.pending ? "서버에 올리는 중..." : "서버와 맞춰져 있어요")
                       : "연결이 끊겨 있어요 — 다시 연결되면 자동으로 올라가요", Sync.connected ? "success" : "error");
  return true;
}
async function manualPull() {
  if (!hasSyncPassword()) { toast("먼저 동기화 비밀번호를 설정하세요", "error"); openSyncPwModal(); return; }
  if (!Sync.ref) { await startSync(); return; }
  try { Sync.rt.goOffline(Sync.db); Sync.rt.goOnline(Sync.db); } catch {}
  toast("서버와 다시 연결했어요");
}

/* 창을 내리거나 닫을 때 남은 저장을 바로 보낸다 · 인터넷이 돌아오면 못 켠 연결을 다시 켠다 */
function initVisibilitySync() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && Sync.timer) pushNow();
  });
  window.addEventListener("online", () => { if (hasSyncPassword() && !Sync.ref && !Sync.starting) startSync(); });
}

/* ---------- 새 버전이 나왔으면 새로고침 묻기 (2026-10-07 요청) ----------
   열려 있는 화면은 앱을 열 때 받은 코드를 계속 쓰므로, 배포해도 **스스로는 모른다**(PC를 며칠 켜두면 옛 코드로 돈다).
   그래서 **창으로 돌아올 때** index.html만 한 번 받아 코드 파일 번호(`core.js?v=…`·`style.css?v=…`)를 지금 도는 것과 견준다.
   다르면 `#updateModal` — [새로고침] = 로고와 같은 `hardReload` / [나중에]·Escape·바깥 = 그 버전은 다시 안 묻는다.
   · 처음엔 "1시간 쉬면 묻기"였는데 영화 한 편(2시간)만 봐도 뜨고, 기록은 실시간·합치기로 이미 따라오므로
     정말 필요한 건 새 코드뿐이라 이걸로 바꿨다(사용자 선택).
   · 확인은 돌아올 때(`visibilitychange`·`focus`)만, **5분에 한 번까지** — 주기적으로 서버에 묻지 않는다.
   · GitHub Pages가 파일을 최대 10분쯤 붙잡아 두어 배포 직후엔 몇 분 늦게 알아챌 수 있다.
   · 등록·수정 창이 열려 있으면 안 띄우고, 닫은 뒤 돌아올 때 띄운다(새로고침하면 적던 게 날아간다).
   · 무엇이 실패하든(오프라인·file://) 조용히 넘어간다 — 이 기능 때문에 앱이 멈추면 안 된다. */
function codeVersionOf(text) {
  return [...String(text).matchAll(/([\w-]+\.(?:js|css))\?v=([\w.-]+)/g)]
    .map(m => m[1] + "=" + m[2]).sort().join("|");
}
function runningVersion() {
  return codeVersionOf([...document.querySelectorAll("script[src], link[href]")]
    .map(el => el.getAttribute("src") || el.getAttribute("href")).join(" "));
}
let _verChecked = 0, _verNew = "", _verSkip = "";
async function checkNewVersion() {
  try {
    const m = $("#updateModal");
    if (!m || !m.classList.contains("hidden")) return;
    if (!_verNew) {
      if (Date.now() - _verChecked < 5 * 60 * 1000) return;
      _verChecked = Date.now();
      const res = await fetch(location.pathname + "?vc=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const latest = codeVersionOf(await res.text());
      if (!latest || latest === runningVersion() || latest === _verSkip) return;
      _verNew = latest;
    }
    if (!$("#editModal").classList.contains("hidden")) return;   // 적는 중이면 다음에
    m.classList.remove("hidden");
  } catch { /* 확인 실패는 조용히 넘어간다 */ }
}
function closeUpdateModal() {
  $("#updateModal").classList.add("hidden");
  _verSkip = _verNew;   // 이 버전은 다시 안 묻는다 (더 새 버전이 나오면 다시 묻는다)
  _verNew = "";
}
function initUpdateCheck() {
  if (!$("#updateModal") || !$("#updateReloadBtn") || !$("#updateLaterBtn")) return;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkNewVersion(); });
  window.addEventListener("focus", checkNewVersion);
  $("#updateReloadBtn").addEventListener("click", () => hardReload());
  $("#updateLaterBtn").addEventListener("click", closeUpdateModal);
  onBackdropClose("#updateModal", closeUpdateModal);
}

/* 저장 대기 중 페이지 닫기 방지 */
window.addEventListener("beforeunload", (e) => {
  if (Sync.timer) pushNow();
  if (Sync.timer || Sync.pending) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- 에러 해설 ---------- */
function describeHttp(status) {
  if (status === 401 || status === 403)
    return `권한 거부 (${status}) — Firebase 보안 규칙이 이 경로를 막고 있습니다`;
  if (status === 404)
    return `주소를 찾을 수 없음 (404) — DB 주소를 확인하세요`;
  if (status >= 500)
    return `서버 오류 (${status}) — 잠시 후 다시 시도하세요`;
  return `HTTP ${status}`;
}

/* ---------- 연결 테스트 ---------- */
async function testConnection() {
  const dataUrl = getDataUrl();
  const out = { url: dataUrl || "(동기화 비밀번호 없음)", read: "", write: "" };
  if (!dataUrl) { out.read = out.write = "동기화 비밀번호를 먼저 설정하세요"; return out; }
  try {
    const r = await fetch(dataUrl + "?t=" + Date.now());
    out.read = r.ok ? "성공" : describeHttp(r.status);
  } catch (e) { out.read = "네트워크 오류: " + e.message; }

  try {
    const testUrl = `${FIREBASE_DB_URL}/${SYNC_BRANCH}/${encodeURIComponent(getSyncPassword())}_test.json`;
    const w = await fetch(testUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ping: new Date().toISOString() })
    });
    out.write = w.ok ? "성공" : describeHttp(w.status);
    if (w.ok) await fetch(testUrl, { method: "DELETE" });
  } catch (e) { out.write = "네트워크 오류: " + e.message; }

  return out;
}
window.testConnection = testConnection;

/* ---------- 복구용 (콘솔에서 호출) ---------- */
window.restoreBackup = function () {
  const b = localStorage.getItem(LS_BACKUP);
  if (!b) { console.log("백업이 없습니다"); return; }
  const arr = JSON.parse(b);
  if (!confirm(`백업 ${arr.length}개로 되돌릴까요?`)) return;
  State.items = arr;
  saveLocal();
  applyFilters();
  console.log("복구 완료:", arr.length);
};

window.showStorage = function () {
  const cur = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  const bak = JSON.parse(localStorage.getItem(LS_BACKUP) || "[]");
  console.log("현재 데이터:", cur.length, "개");
  console.log("백업 데이터:", bak.length, "개");
  console.log("마지막 저장:", localStorage.getItem(LS_MODIFIED));
  return { current: cur.length, backup: bak.length };
};

/* ---------- 동기화 비밀번호 ---------- */
function openSyncPwModal() {
  const m = $("#syncPwModal");
  if (!m) return;
  $("#syncPwInput").value = getSyncPassword();
  m.classList.remove("hidden");
  setTimeout(() => $("#syncPwInput").focus(), 50);
}
function closeSyncPwModal() {
  $("#syncPwModal")?.classList.add("hidden");
}

/* 비밀번호를 저장하면 그게 곧 서버 데이터 경로가 됨.
   새 방은 "처음 켠 기기"처럼 시작한다 — 서버에 기록이 있으면 서버 것을 쓰고(이 기기에만 있던 건
   [백업에서 되돌리기]의 "서버에서 받기 직전"에 남는다), 서버가 비었으면 이 기기 기록을 올린다.
   같은 비밀번호를 다시 넣으면 연결만 다시 붙인다. */
async function saveSyncPw() {
  const v = ($("#syncPwInput").value || "").trim();
  if (!v) { toast("비밀번호를 입력하세요", "error"); return; }
  const prev = getSyncPassword();
  if (v !== prev && State.items.length && !confirm(
    `이 비밀번호의 서버 기록을 씁니다.
서버에 기록이 있으면 이 기기 기록 ${State.items.length}개는 서버 것으로 바뀌어요` +
    `
(바뀌기 전 상태는 [백업에서 되돌리기]에 남아요).

계속할까요?`)) return;
  localStorage.setItem(LS_SYNC_PW, v);
  closeSyncPwModal();
  toast(v === prev ? "서버와 다시 연결하는 중..." : "동기화 비밀번호 저장됨 — 서버 확인 중...");
  await startSync();
  updateSyncPwStatus();
}

function updateSyncPwStatus() {
  const el = $("#syncPwStatus");
  if (!el) return;
  if (hasSyncPassword()) {
    el.textContent = "동기화 비밀번호가 설정되어 있습니다 (다른 기기에서도 같은 비밀번호로 동기화됩니다)";
    el.className = "text-sm mt-2 font-medium text-emerald-600";
  } else {
    el.textContent = "비밀번호가 없습니다. 지금은 이 기기에만 저장됩니다.";
    el.className = "text-sm mt-2 font-medium text-amber-600";
  }
}

/* ---------- 바깥을 눌러 모달 닫기 ----------
   `click`의 target만 보면 **모달 안에서 누르고 바깥에서 손을 뗀 경우에도 닫힌다** —
   click은 누른 곳과 뗀 곳의 공통 조상에서 발생하는데, 그게 백드롭이기 때문이다.
   그래서 한줄평을 드래그해 고르거나 버튼에서 손이 살짝 미끄러지면 창이 통째로 닫혀
   입력하던 게 날아갔다. **누르기 시작한 곳도 백드롭이었을 때만** 닫는다.

   모달마다 따로 쓰던 `if (e.target.id === "...")`를 전부 이걸로 바꿨다. */
function onBackdropClose(sel, close) {
  const el = $(sel);
  if (!el) return;
  let downOnBack = false;
  // 터치도 mousedown이 따라오므로 폰에서도 같은 판정이 된다
  el.addEventListener("mousedown", e => { downOnBack = (e.target === el); });
  el.addEventListener("click", e => {
    const ok = downOnBack && e.target === el;
    downOnBack = false;
    if (ok) close();
  });
}

/* ---------- Escape 키로 모달 닫기 ----------
   위에 겹쳐 뜬 것부터 하나씩 닫는다 (Escape 한 번에 전부 닫히면 뒤에 있던 것까지 사라진다).
   등록/수정 모달은 State도 정리해야 하므로 closeEdit()을 쓴다. */
function initEscapeKey() {
  const layers = [
    { sel: "#updateModal", close: () => closeUpdateModal() },
    { sel: "#quickRateModal", close: () => closeQuickRate() },
    { sel: "#dcModal" },
    { sel: "#detailModal" },
    { sel: "#worksModal" },
    { sel: "#restoreModal" },
    // Escape로 닫아도 조회 결과를 버려야 한다 — 남겨두면 다음에 [적용]이 옛 계획을 쓴다
    { sel: "#refreshPreviewModal", close: () => {
        $("#refreshPreviewModal").classList.add("hidden"); RefreshPlan = [];
      } },
    { sel: "#filterModal", close: () => closeFilterModal() },
    { sel: "#dcRecoModal" },
    { sel: "#syncPwModal", close: () => closeSyncPwModal() },
    { sel: "#editModal", close: () => closeEdit() }
  ];
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const l of layers) {
      const el = $(l.sel);
      if (el && !el.classList.contains("hidden")) {
        if (l.close) l.close(); else el.classList.add("hidden");
        return;   // 한 번에 한 겹만
      }
    }
  });
}

/* ---------- 탭 ---------- */
function initTabs() {
  // 탭마다 스크롤 위치를 기억해서, 돌아오면 보던 자리 그대로 (통계 ↔ 목록)
  const scrollPos = { home: 0, list: 0, discover: 0, stats: 0, settings: 0, search: 0 };
  let curTab = "home";    // 앱은 홈으로 열린다 (2026-09-17)
  const backOf = {};      // 설정·검색을 닫으면 돌아갈 탭 (둘 다 "잠깐 들르는 곳")

  const show = (tab) => {
    if (tab === curTab) return;
    scrollPos[curTab] = window.scrollY;      // 떠나는 탭 위치 저장
    if ((tab === "settings" || tab === "search") && curTab !== "settings" && curTab !== "search") backOf[tab] = curTab;

    // 같은 탭 버튼이 상단 메뉴와 폰 탭바에 하나씩 있다 — 둘 다 맞춰 켠다
    $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    ["home", "list", "discover", "stats", "settings", "search"].forEach(t => {
      $("#tab-" + t).classList.toggle("hidden", t !== tab);
    });
    if (tab === "home") renderHome();
    if (tab === "search") renderSearch();
    const ts = $(".top-search");
    if (ts) ts.classList.toggle("on", tab === "search");
    if (tab === "stats") renderStats();
    if (tab === "discover") renderDiscover();
    curTab = tab;

    // 렌더 끝난 뒤 이전 위치로 복원
    requestAnimationFrame(() => window.scrollTo(0, scrollPos[tab] || 0));
  };

  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      /* 설정은 "잠깐 들르는 곳"이다 — 톱니를 한 번 더 누르면 보던 탭으로 돌아간다 */
      if (btn.dataset.tab === "settings" && curTab === "settings") show(backOf.settings || "home");
      /* 메뉴의 [추천]은 **들어갈 때마다 처음부터**(2026-10-06 요청) — 전에 이어보기·인물·한 줄 보기 중
         뭘 보고 있었든 추천의 고르는 화면으로 연다. 인물 검색처럼 함수로 여는 길(`showTab`)은 그대로 둔다 */
      else if (btn.dataset.tab === "discover") {
        if (typeof enterRecoFresh === "function") enterRecoFresh();
        scrollPos.discover = 0;
        if (curTab === "discover") { renderDiscover(); window.scrollTo(0, 0); }
        else show("discover");
      }
      else show(btn.dataset.tab);
    });
  });
  // 검색 결과(search.js)는 메뉴 버튼이 없어서 함수로 연다 / 닫으면 들어오기 전 탭으로
  window.showTab = show;
  window.closeTab = (tab) => show(backOf[tab] || "home");
  const closeBtn = $("#settingsCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", () => show(backOf.settings || "home"));
}

/* 콘솔에서 비밀번호 설정용 (선택) */
window.setSyncPassword = function (pw) {
  if (!pw) { console.log("현재 비밀번호:", getSyncPassword() || "(없음)"); return; }
  localStorage.setItem(LS_SYNC_PW, String(pw).trim());
  console.log("동기화 비밀번호 설정됨. 새로고침하면 동기화됩니다.");
};
window.openSyncPwModal = openSyncPwModal;
window.closeSyncPwModal = closeSyncPwModal;
window.saveSyncPw = saveSyncPw;

/* ---------- 부팅 ---------- */
let _booted = false;
function bootApp() {
  if (_booted) return;
  _booted = true;

  loadLocal();

  initTabs();
  initEscapeKey();
  initVisibilitySync();
  initUpdateCheck();
  initWatchlog();
  initTmdb();
  initDiscover();
  initSettings();
  initHome();
  initSearch();
  applyFilters();

  bootSync();
}

/* ⚠ 별점 10점 만점 전환(2026-08-06)에 쓰던 `clearOldRatings`는 **없앴다** (2026-08-07).
   "이미 전환했음" 플래그를 localStorage에 뒀는데 그건 **기기마다 따로**라서, 새 기기에서 앱을 열면
   서버에서 받아온 별점(다른 기기에서 새로 매긴 것)을 "아직 안 지운 옛 별점"으로 보고 지워버렸다.
   실제로 폰에서 그 일이 났다. 시드 사고와 같은 구조다 — **부팅 때 데이터를 지우는 코드는
   기기별 플래그로 제어하면 안 된다.** 전환은 이미 끝났으므로 코드를 남길 이유도 없다. */

async function bootSync() {
  /* ⚠ 앱은 데이터를 스스로 만들어내지 않는다(시드 사고 2026-08-01). 서버 연결은 `startSync`가 하고,
     그 전까지는 이 기기 사본으로 화면을 그린다. */
  if (!hasSyncPassword()) { setSyncIcon("local"); return; }
  await startSync();
}

document.addEventListener("DOMContentLoaded", bootApp);
