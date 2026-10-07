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

const AUTO_SYNC_DELAY = 2500;       // 자동 저장 대기시간(ms)
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
  syncing: false,
  serverStamp: "",   // 마지막으로 알고 있는 서버 updatedAt (덮어쓰기 방지용)
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
    error:   ["fa-triangle-exclamation", "text-red-500",  "저장 실패 — 클릭해서 재시도"],
    local:   ["fa-cloud-slash",       "text-slate-400",   "이 기기에만 저장 중 — 클릭해서 동기화 비밀번호 설정"]
  };
  const [icon, color, title] = map[state] || map.idle;
  btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  btn.className = `top-icon ${color}`;
  btn.title = title;
}

/* ---------- 로컬 저장 ---------- */
let _syncTimer = null;

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

  // 동기화 비밀번호가 없으면 서버로 안 보내고 이 기기에만 저장
  if (!hasSyncPassword()) { setSyncIcon("local"); return; }

  setSyncIcon("pending");
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(autoPush, AUTO_SYNC_DELAY);
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
  saveLocal();   // 수정 시각이 바뀌어야 다른 기기가 알아채고 받아간다
}

/* 화면 설정만 바뀐 경우 — **서버로는 몰아서 한 번만** 보낸다(`touchCache`와 같은 생각).
   추천 필터 칩처럼 연달아 눌리는 값이 섞여 있어서, 누를 때마다 문서를 통째로 올리면 낭비다.
   ⚠ 기기에만 남아야 하는 값(API 키·동기화 비밀번호)은 여기에 넣지 말 것. */
let _prefPush = null;
function savePrefs(patch) {
  const next = { ...State.prefs, ...patch };
  /* **안 바뀌었으면 아무 일도 안 한다** — 기록 화면 보기처럼 그릴 때마다 적는 값이 있어서,
     그냥 두면 필터를 만질 때마다 수정 시각이 바뀌어 다른 기기가 헛되이 받아간다. */
  if (JSON.stringify(next) === JSON.stringify(State.prefs || {})) return;
  State.prefs = next;
  try { localStorage.setItem(LS_PREFS, JSON.stringify(State.prefs)); }
  catch { /* 저장 공간 문제면 이번 판만 적용된다 */ }
  clearTimeout(_prefPush);
  _prefPush = setTimeout(() => saveLocal(), 3000);
}

/* ---------- 서버 백업 (2026-08-07) ----------
   기기 안의 백업(`watchlog_items_backup`)은 **그 기기를 쓸수록 덮인다.** 실제로 하루 종일 만진 PC는
   이미 망가진 상태가 백업에 들어가 있었고, 거의 안 쓴 폰에만 성한 사본이 남아 살았다.
   그래서 서버에도 둔다 — 어느 기기에서든 꺼낼 수 있고, 그 기기를 얼마나 썼는지와 무관하다.

   두 벌을 서로 다른 주기로 굴린다:
     · `prev`  — 1시간마다   → 방금 망친 걸 되돌릴 때
     · `daily` — 하루마다    → 오늘 여러 번 저장해 `prev`까지 덮였을 때
   방 이름만 다르므로 Firebase 규칙(`watchlog/$room`)은 그대로 쓴다. */
const BAK_KINDS = { prev: 60 * 60 * 1000, daily: 24 * 60 * 60 * 1000 };
const LS_BAK_AT = "watchlog_server_bak_at";   // 종류별 마지막 갱신 시각 (이 기기 기준)

function getBackupUrl(kind) {
  const pw = getSyncPassword();
  if (!pw) return null;
  return `${FIREBASE_DB_URL}/${SYNC_BRANCH}/${encodeURIComponent(pw + "_bak_" + kind)}.json`;
}

function bakStamps() {
  try { return JSON.parse(localStorage.getItem(LS_BAK_AT) || "{}"); } catch { return {}; }
}

/* 서버를 덮어쓰기 **직전에**, 지금 서버에 있던 내용을 백업 자리로 옮긴다.
   `current`는 호출부가 이미 받아둔 서버 응답이다 (백업 때문에 새로 조회하지 않는다). */
async function rotateServerBackup(current) {
  if (!current || !Array.isArray(current.items) || !current.items.length) return;

  const now = Date.now();
  const at = bakStamps();
  for (const kind of Object.keys(BAK_KINDS)) {
    const last = Date.parse(at[kind] || "") || 0;
    if (now - last < BAK_KINDS[kind]) continue;     // 아직 주기가 안 됐다
    const url = getBackupUrl(kind);
    if (!url) continue;
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

/* 복구 화면에서 쓸 목록. 없는 건 빼고 돌려준다. */
async function fetchBackups() {
  const out = [];
  for (const kind of Object.keys(BAK_KINDS)) {
    const url = getBackupUrl(kind);
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

/* ---------- 서버 통신 (Realtime Database REST) ---------- */
/* 서버에 내가 모르는 변경이 있는지 확인.
   실시간 구독이 있어도 끊겨 있던 동안의 변경은 놓칠 수 있어서, 올리기 직전에 한 번 더 본다.
   있으면 **덮어쓰지 않는다** — 조용히 덮는 게 8월 1일 사고의 본질이었다. */
async function serverChangedBehindUs() {
  try {
    const d = await fetchServer();
    /* 덮어쓰기 직전의 서버 내용 — 백업을 굴리는 데 그대로 쓴다 (조회를 한 번 더 하지 않으려고) */
    _lastServerSeen = d;
    if (!d || !d.updatedAt) return false;
    const known = State.serverStamp || localStorage.getItem(LS_MODIFIED) || "";
    return d.updatedAt > known;
  } catch { return false; }   // 확인 실패는 막지 않는다 (오프라인에서도 저장은 되어야 함)
}
let _lastServerSeen = null;
/* 이 기기는 비었는데 서버엔 기록이 있다 → 올리면 서버가 통째로 지워진다 */
function wouldWipeServer(d) {
  return !State.items.length && !!d && Array.isArray(d.items) && d.items.length > 0;
}

/* ============================================
   합치기 (2026-10-06)
   예전엔 문서를 통째로 주고받아서, 두 기기가 엇갈리면 한쪽 변경이 사라졌다:
   ① 올리기 전에 다른 기기 것을 받으면 이 기기 변경이 덮였다(추천 [치우기]가 집에서 그대로였던 사고)
   ② 올리려는데 다른 기기가 먼저 저장했으면 "먼저 저장했어요"로 멈췄고, 곧 받아오면서 이 기기 변경이 사라졌다.
   그래서 **마지막으로 서버와 맞췄던 상태(`base`)**를 기억해 두고, 엇갈리면 항목별로 합친다(3-way):
   · 이 기기에서 안 바뀐 항목 → 서버 것 / 서버에서 안 바뀐 항목 → 이 기기 것
   · 둘 다 바뀐 기록 → 서버 것 위에 **이 기기에서 바뀐 칸만** 얹는다
   · 한쪽은 지우고 한쪽은 고쳤으면 → 고친 쪽을 남긴다(지워서 잃는 쪽보다 낫다)
   기록·보고싶어요·관심없음은 id로, 설정(`prefs`)은 키로 합친다. 캐시는 원래 합쳐진다(`adoptCache`).
   `base`가 없으면(이 기능 이전·첫 동기화) 예전처럼 동작한다 — 짐작으로 합치지 않는다.
   ⚠ 합친 결과가 이 기기 기록의 절반도 안 되면 합치지 않는다(빈 서버·일부 지워진 서버를 "지운 것"으로 믿으면 사고다). */
const LS_BASE = "watchlog_sync_base";
function snapshotNow() {
  return { items: State.items || [], wishes: State.wishes || [], hides: State.hides || [], prefs: State.prefs || {} };
}
function saveBase(doc) {
  try {
    localStorage.setItem(LS_BASE, JSON.stringify({
      items: Array.isArray(doc.items) ? doc.items : [], wishes: Array.isArray(doc.wishes) ? doc.wishes : [],
      hides: Array.isArray(doc.hides) ? doc.hides : [], prefs: doc.prefs && typeof doc.prefs === "object" ? doc.prefs : {}
    }));
  } catch { /* 저장 공간이 모자라면 base 없이(예전처럼) 돈다 */ }
}
function loadBase() { try { return JSON.parse(localStorage.getItem(LS_BASE) || "null"); } catch { return null; } }
/* 비교용 정규화 — 서버(Firebase)는 키를 정렬해 돌려주고 null·빈 배열을 지운다. 그 차이로 "바뀌었다"고 보면 안 된다 */
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
function mergeById(B, L, S, key) {
  const m = (arr) => new Map((arr || []).filter(Boolean).map(x => [key(x), x]));
  const bm = m(B), lm = m(L), sm = m(S);
  const pick = (k) => {
    const b = bm.get(k), l = lm.get(k), sv = sm.get(k);
    const lc = !sameVal(l, b), sc = !sameVal(sv, b);
    if (!lc) return sv;
    if (!sc) return l;
    if (l && sv) {                                        // 둘 다 고쳤다 → 서버 것 위에 이 기기에서 바뀐 칸만
      const out = { ...sv };
      Object.keys({ ...l, ...(b || {}) }).forEach(f => { if (!sameVal(l[f], b ? b[f] : undefined)) out[f] = l[f]; });
      return out;
    }
    return l || sv;                                       // 한쪽은 지우고 한쪽은 고쳤다 → 고친 쪽
  };
  const out = [], seen = new Set();
  (L || []).forEach(x => { const k = key(x); if (!sm.has(k) && !bm.has(k)) { out.push(x); seen.add(k); } });  // 이 기기에서 새로 만든 것
  [...(S || []), ...(L || [])].forEach(x => {
    const k = key(x); if (seen.has(k)) return; seen.add(k);
    const r = pick(k); if (r) out.push(r);
  });
  return out;
}
function mergePrefs(B, L, S) {
  B = B || {}; L = L || {}; S = S || {};
  const out = { ...S };
  Object.keys({ ...L, ...B }).forEach(k => {
    if (sameVal(L[k], B[k])) return;
    if (L[k] === undefined) delete out[k]; else out[k] = L[k];
  });
  /* 추천 [치우기]·뒤집기는 양쪽 다 바꿨으면 합친다(같은 추천일 때) */
  const lf = L.recoFlip, sf = S.recoFlip, bf = B.recoFlip;
  if (lf && sf && lf.gen === sf.gen && !sameVal(lf, bf) && !sameVal(sf, bf)) {
    const uni = (k) => [...new Set([...(sf[k] || []), ...(lf[k] || [])])];
    out.recoFlip = { gen: lf.gen, all: !!(lf.all || sf.all), ids: uni("ids"), shown: uni("shown"), gone: uni("gone") };
  }
  return out;
}
const wishKey = (x) => x.id || `${x.mediaType}:${x.tmdbId}`;
/* 서버 문서 d와 이 기기를 합친다. "merged" = 합쳐서 State에 얹었다(올려야 한다) / "same" = 이 기기엔 바뀐 게 없다 /
   "nobase" = 기준이 없어 못 합친다 / "suspicious" = 합치면 기록이 너무 줄어 합치지 않았다 */
function mergeIntoLocal(d) {
  const base = loadBase();
  if (!base || !d || !Array.isArray(d.items)) return "nobase";
  const mine = snapshotNow();
  if (sameVal(mine, base)) return "same";
  /* 서버 쪽에서 한꺼번에 많이 사라졌으면(빈 서버·일부만 남은 서버) 합치지 않는다 — "다른 기기에서 지웠다"고
     믿으면 사고다. 기준: 이 기기에선 그대로인데 서버에서 없어진 기록이 3개 이상 + 기준의 20% 이상, 또는 결과가 절반 미만 */
  const srvIds = new Set(d.items.map(x => x.id));
  const mineById = new Map(mine.items.map(x => [x.id, x]));
  const goneOnServer = (base.items || []).filter(b => !srvIds.has(b.id) && sameVal(mineById.get(b.id), b)).length;
  if (goneOnServer >= 3 && goneOnServer >= (base.items || []).length * 0.2) return "suspicious";
  const items = mergeById(base.items, mine.items, d.items, x => x.id);
  if (mine.items.length && items.length < mine.items.length * 0.5) return "suspicious";
  State.items = items;
  State.wishes = mergeById(base.wishes, mine.wishes, Array.isArray(d.wishes) ? d.wishes : base.wishes, wishKey);
  State.hides = mergeById(base.hides, mine.hides, Array.isArray(d.hides) ? d.hides : base.hides, wishKey);
  State.prefs = mergePrefs(base.prefs, mine.prefs, d.prefs && typeof d.prefs === "object" ? d.prefs : base.prefs);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(State.items));
    localStorage.setItem(LS_WISH, JSON.stringify(State.wishes));
    localStorage.setItem(LS_HIDE, JSON.stringify(State.hides));
    localStorage.setItem(LS_PREFS, JSON.stringify(State.prefs));
  } catch { /* 저장 공간 문제면 이번 판만 화면에 */ }
  adoptCache(d.cache);
  applyPrefs();
  State.serverStamp = d.updatedAt || "";
  saveBase(d);                       // 지금 공통 조상은 서버 문서다 — 이 기기 변경은 곧 올라간다
  return "merged";
}

async function autoPush() {
  _syncTimer = null;
  if (State.syncing) return;
  const url = getDataUrl();
  if (!url) { setSyncIcon("local"); return; }   // 비밀번호 없음 → 로컬 전용

  if (await serverChangedBehindUs()) {
    /* 다른 기기가 먼저 저장했다 → 서버 것과 **합쳐서** 올린다(2026-10-06). 기준(base)이 없거나
       합치면 기록이 너무 줄면 예전처럼 멈춘다 */
    const r = mergeIntoLocal(_lastServerSeen);
    if (r === "same") {
      // 이 기기엔 바뀐 게 없다(캐시만 바뀐 경우 등) — 서버 것을 받고 끝낸다
      await pullFromServer(true);
      if (typeof applyFilters === "function") applyFilters();
      if (window.renderDiscover) renderDiscover();
      return;
    }
    if (r !== "merged") {
      setSyncIcon("error");
      toast("다른 기기에서 먼저 저장했어요. 구름 아이콘을 눌러 확인하세요", "error");
      return;
    }
    localStorage.setItem(LS_MODIFIED, new Date().toISOString());
    if (typeof applyFilters === "function") applyFilters();
    if (window.renderDiscover) renderDiscover();
    toast("다른 기기의 변경과 합쳐서 저장했어요");
  }
  /* 빈 기기가 기록 있는 서버를 덮는 일은 **자동으로는 절대** 하지 않는다 (2026-09-23 사고) */
  if (wouldWipeServer(_lastServerSeen)) {
    setSyncIcon("error");
    toast(`이 기기는 비어 있어 서버 기록(${_lastServerSeen.items.length}개)을 덮지 않았어요`, "error");
    return;
  }

  State.syncing = true;
  setSyncIcon("saving");
  await rotateServerBackup(_lastServerSeen);      // 덮어쓰기 전 사본을 남긴다
  try {
    const doc = {
      items: State.items,
      wishes: State.wishes,
      hides: State.hides,
      prefs: State.prefs || {},
      updatedAt: localStorage.getItem(LS_MODIFIED) || new Date().toISOString(),
      count: State.items.length,
      cache: collectCache()
    };
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc)
    });
    if (!res.ok) throw new Error(describeHttp(res.status));
    saveBase(doc);                                  // 이제 서버와 맞췄다
    State.serverStamp = localStorage.getItem(LS_MODIFIED) || "";
    setSyncIcon("saved");
    State.lastError = "";
  } catch (e) {
    console.error("자동 저장 실패", e);
    State.lastError = e.message;
    setSyncIcon("error");
  } finally {
    State.syncing = false;
  }
}

async function pushToServer() {
  clearTimeout(_syncTimer);
  _syncTimer = null;
  const url = getDataUrl();
  if (!url) {
    setSyncIcon("local");
    toast("먼저 동기화 비밀번호를 설정하세요", "error");
    openSyncPwModal();
    return false;
  }
  /* 구름 버튼은 확인 없이 이 기기 것을 올린다 — **서버보다 훨씬 적으면 먼저 묻는다** (2026-09-23 사고:
     새 폰에서 목록이 비어 보여 눌렀더니 0개가 서버 337개를 덮었다). 비었으면 받아오기를 권한다. */
  let cur = null;
  try { cur = await fetchServer(); } catch { /* 확인 실패는 막지 않는다 (오프라인) */ }
  const sc = cur && Array.isArray(cur.items) ? cur.items.length : 0;
  if (sc && State.items.length < sc * 0.5) {
    if (!State.items.length) {
      toast(`이 기기는 비어 있어요 — 서버 기록 ${sc}개를 받아옵니다`);
      await manualPull();
      return false;
    }
    const ok = confirm(
      `서버에는 ${sc}개가 있는데 이 기기에는 ${State.items.length}개뿐이에요.\n` +
      `이 기기 것으로 서버를 덮어쓸까요?\n\n[취소]를 누르면 아무것도 안 바뀝니다.`
    );
    if (!ok) { setSyncIcon("idle"); return false; }
  }
  /* 다른 기기가 먼저 저장했으면 덮지 말고 합쳐서 올린다(2026-10-06) */
  if (cur && cur.updatedAt && cur.updatedAt > (State.serverStamp || localStorage.getItem(LS_MODIFIED) || "")
      && mergeIntoLocal(cur) === "merged") {
    if (typeof applyFilters === "function") applyFilters();
    if (window.renderDiscover) renderDiscover();
  }
  State.syncing = true;
  setSyncIcon("saving");
  try { await rotateServerBackup(cur); } catch { /* 백업 실패가 저장을 막지 않는다 */ }
  const stamp = new Date().toISOString();
  try {
    const doc = {
      items: State.items,
      wishes: State.wishes,
      hides: State.hides,
      prefs: State.prefs || {},
      updatedAt: stamp,
      count: State.items.length,
      cache: collectCache()
    };
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc)
    });
    if (!res.ok) throw new Error(describeHttp(res.status));
    saveBase(doc);
    localStorage.setItem(LS_MODIFIED, stamp);
    State.serverStamp = stamp;
    setSyncIcon("saved");
    State.lastError = "";
    toast(`서버에 저장 완료 (${State.items.length}개)`, "success");
    return true;
  } catch (e) {
    console.error(e);
    State.lastError = e.message;
    setSyncIcon("error");
    toast("저장 실패: " + e.message, "error");
    return false;
  } finally { State.syncing = false; }
}

async function fetchServer() {
  const url = getDataUrl();
  if (!url) return null;   // 비밀번호 없음 → 서버 조회 안 함
  const res = await fetch(url + "?t=" + Date.now());
  if (!res.ok) throw new Error(describeHttp(res.status));
  return await res.json();   // null 이면 서버에 데이터 없음
}

/* 서버 응답의 곁 목록(보고싶어요·관심없음)을 반영.
   나중에 추가된 필드라 예전 저장본에는 없다 → 없으면 이 기기 것을 그대로 둔다
   (구버전 데이터가 이 기기의 목록을 지워버리지 않도록). */
function adoptLists(d) {
  if (!d) return;
  if (Array.isArray(d.wishes)) {
    State.wishes = d.wishes;
    localStorage.setItem(LS_WISH, JSON.stringify(State.wishes));
  }
  if (Array.isArray(d.hides)) {
    State.hides = d.hides;
    localStorage.setItem(LS_HIDE, JSON.stringify(State.hides));
  }
  /* 화면 설정도 **있을 때만** — 설정이 생기기 전 저장본이 이 기기의 색을 지우지 않게 */
  if (d.prefs && typeof d.prefs === "object" && !Array.isArray(d.prefs)) {
    /* 추천의 [치우기]·뒤집은 카드(`recoFlip`)는 **두 기기 것을 합친다**(2026-10-06 — 회사에서 치운 줄이 집에서 그대로였다).
       설정은 문서째 오가서, 치운 기기가 올리기 전에(3초 몰아 보내기·창 닫기·다른 기기가 먼저 저장) 서버 것을 받으면
       치운 기록이 덮여 사라졌다. 같은 추천(`gen`)이면 합집합, 이 기기 추천이 더 새것이면 이 기기 것. 합쳐서 서버보다
       늘었으면 다시 올린다 */
    const loc = State.prefs && State.prefs.recoFlip, srv = d.prefs.recoFlip;
    let next = d.prefs, extra = false;
    if (loc && loc.gen && (!srv || loc.gen >= (srv.gen || ""))) {
      const same = srv && srv.gen === loc.gen;
      const uni = (k) => [...new Set([...(same ? srv[k] || [] : []), ...(loc[k] || [])])];
      const merged = { gen: loc.gen, all: same ? !!(srv.all || loc.all) : !!loc.all,
                       ids: uni("ids"), shown: uni("shown"), gone: uni("gone") };
      extra = JSON.stringify(merged) !== JSON.stringify(srv || null);
      next = { ...d.prefs, recoFlip: merged };
    }
    State.prefs = next;
    if (extra) { clearTimeout(_prefPush); _prefPush = setTimeout(() => saveLocal(), 3000); }
    localStorage.setItem(LS_PREFS, JSON.stringify(State.prefs));
    applyPrefs();
  }
  adoptCache(d.cache);
}

/* ---------- TMDB에서 받아온 참고 정보 (2026-08-07부터 같이 동기화) ----------
   내가 입력한 기록이 아니라 앱이 TMDB에서 받아 저장해둔 것들 — 배우 한글 이름, 시리즈 편 목록,
   추천 결과 등. 예전엔 "TMDB로 다시 만들 수 있으니 기기에만 두자"고 했는데, 그러면 기기를 옮길
   때마다 같은 작업을 처음부터 다시 돌려야 했다. 그래서 기록과 함께 올린다.

   API 키·동기화 비밀번호·백업·시드 표시는 **일부러 뺐다** — 그 기기에 남아야 하는 것들이다. */
const CACHE_KEYS = [
  "watchlog_person_ko",     // 배우·감독 한글 표기 (한글 표기가 "없다고 확인된" 사람 포함)
  "watchlog_collections",   // 컬렉션 편 정보
  "watchlog_franchises",    // 프랜차이즈(MCU 등) 목록
  "watchlog_reco",          // 추천 결과
  "watchlog_updated_at"     // 설정 탭의 "마지막 실행" 시각
];

/* 사람·컬렉션·프랜차이즈는 맵이라 **두 기기 것을 합친다** — 서로 다른 걸 조회해뒀을 수 있어서
   통째로 덮으면 한쪽이 한 일이 사라진다. 추천 결과·시각은 통째로 최신을 쓴다. */
const CACHE_MERGE = ["watchlog_person_ko", "watchlog_collections", "watchlog_franchises"];

function collectCache() {
  const out = {};
  CACHE_KEYS.forEach(k => {
    const raw = localStorage.getItem(k);
    if (raw == null) return;
    try { out[k] = JSON.parse(raw); } catch { /* 깨진 값은 올리지 않는다 */ }
  });
  return out;
}

/* 캐시만 바뀐 작업(이름 한글화·시리즈 정보·추천 등)도 서버에 반영되게 한다.
   `saveLocal()`을 불러야 수정 시각이 갱신돼 **다른 기기가 변경을 알아챈다** — 시각이 그대로면
   서버 내용이 바뀌어도 아무도 받아가지 않는다. 한 작업이 캐시를 여러 번 건드리므로 몰아서 한 번만. */
let _cacheTouch = null;
function touchCache() {
  clearTimeout(_cacheTouch);
  _cacheTouch = setTimeout(() => saveLocal(), 3000);
}

function adoptCache(cache) {
  if (!cache || typeof cache !== "object") return;   // 예전 저장본엔 없다 — 그땐 이 기기 것을 유지
  CACHE_KEYS.forEach(k => {
    if (cache[k] === undefined) return;
    let val = cache[k];
    if (CACHE_MERGE.includes(k)) {
      let mine = {};
      try { mine = JSON.parse(localStorage.getItem(k) || "{}"); } catch { mine = {}; }
      val = { ...val, ...mine };      // 겹치면 이 기기 것을 남긴다 (방금 조회한 값일 수 있다)
    }
    try { localStorage.setItem(k, JSON.stringify(val)); } catch { /* 저장 공간 문제면 넘어간다 */ }
  });
}

async function pullFromServer(silent) {
  if (!hasSyncPassword()) {
    if (!silent) { toast("먼저 동기화 비밀번호를 설정하세요", "error"); openSyncPwModal(); }
    return false;
  }
  try {
    const d = await fetchServer();
    if (!d || !Array.isArray(d.items)) {
      if (!silent) toast("서버에 데이터가 없습니다", "error");
      return false;
    }
    /* 서버가 **비었는데** 이 기기엔 기록이 있으면 받지 않는다 — 다른 기기가 빈 채로 올린 사고를
       실시간 구독이 모든 기기로 퍼뜨리게 된다(2026-09-23). 되돌릴 쪽이 남아 있어야 한다. */
    if (!d.items.length && State.items.length) {
      setSyncIcon("error");
      toast(`서버가 비어 있어 받지 않았어요 (이 기기 ${State.items.length}개 유지)`, "error");
      return false;
    }
    /* 이 기기에 아직 안 올린 변경이 있으면 통째로 받지 말고 **합친다**(2026-10-06) — 받은 뒤 합친 걸 올린다 */
    if (mergeIntoLocal(d) === "merged") {
      saveLocal();
      if (!silent) toast(`서버 것과 이 기기에서 바꾼 것을 합쳤어요 (${State.items.length}개)`, "success");
      return true;
    }
    State.items = d.items;
    adoptLists(d);
    localStorage.setItem(LS_KEY, JSON.stringify(State.items));
    localStorage.setItem(LS_MODIFIED, d.updatedAt || new Date().toISOString());
    State.serverStamp = d.updatedAt || "";
    saveBase(d);
    setSyncIcon("saved");
    if (!silent) toast(`서버에서 불러옴 (${State.items.length}개)`, "success");
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) toast("불러오기 실패: " + e.message, "error");
    return false;
  }
}

/* 헤더의 새로고침 버튼 — 서버 것을 지금 받아온다.
   평소엔 실시간 구독이 알아서 따라오고 새로고침(F5)으로도 되지만, **홈 화면에 추가해 쓰는 폰에는
   주소창이 없어서** 새로고침할 방법이 마땅찮다. 그래서 버튼으로 둔다.
   묻지 않고 그대로 받아온다 — 잘못 받아오면 설정 탭 [백업에서 되돌리기]로 돌아가면 된다. */
async function manualPull() {
  if (!hasSyncPassword()) { toast("먼저 동기화 비밀번호를 설정하세요", "error"); openSyncPwModal(); return; }

  const btn = $("#pullBtn");
  if (btn) btn.disabled = true;
  try {
    if (await pullFromServer()) {
      applyFilters();
      if (window.renderDiscover) renderDiscover();
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* 부팅 시 서버/로컬 중 최신본 자동 선택 */
async function syncOnBoot() {
  // 동기화 비밀번호가 없으면 서버를 건드리지 않고 이 기기 데이터만 사용
  if (!hasSyncPassword()) { setSyncIcon("local"); return; }

  setSyncIcon("saving");
  try {
    const d = await fetchServer();
    const localMod = localStorage.getItem(LS_MODIFIED) || "";
    const localCount = State.items.length;

    // 서버가 비어있음 → 로컬을 올림 (시드는 제외)
    if (!d || !Array.isArray(d.items)) {
      if (localCount && !isSeedData()) await autoPush();
      else setSyncIcon("idle");
      return;
    }

    const serverMod = d.updatedAt || "";
    const serverCount = d.items.length;

    /* 이 기기가 **비어 있으면** 시각과 무관하게 서버를 따른다 (2026-09-23 사고).
       새 폰은 기록이 없어도 화면 설정(`savePrefs`)만 저장되면 "방금 수정됨"이 되어,
       아래 "로컬이 더 최신" 분기로 가서 **0개를 서버에 올렸다** — 시드 사고와 같은 구조. */
    if (!localCount && serverCount) {
      State.items = d.items;
      adoptLists(d);
      localStorage.setItem(LS_KEY, JSON.stringify(State.items));
      localStorage.setItem(LS_MODIFIED, serverMod || new Date().toISOString());
      State.serverStamp = serverMod || "";
      saveBase(d);
      applyFilters();
      if (window.renderDiscover) renderDiscover();
      setSyncIcon("saved");
      toast(`서버에서 불러옴 (${State.items.length}개)`);
      return;
    }

    /* 로컬이 시드일 뿐이면 시각과 무관하게 무조건 서버를 따른다.
       시드는 부팅 때 자동으로 들어간 것이라 항상 "방금 수정됨"으로 보이는데,
       그걸 최신으로 믿으면 서버의 진짜 기록을 덮어쓴다. */
    if (isSeedData() && serverCount) {
      State.items = d.items;
      adoptLists(d);
      localStorage.setItem(LS_KEY, JSON.stringify(State.items));
      localStorage.setItem(LS_MODIFIED, serverMod || new Date().toISOString());
      State.serverStamp = serverMod || "";
      markSeed(false);
      applyFilters();
      if (window.renderDiscover) renderDiscover();
      setSyncIcon("saved");
      toast(`서버에서 불러옴 (${State.items.length}개)`);
      return;
    }

    // 서버가 더 최신
    if (serverMod > localMod) {
      /* 이 기기에 안 올린 변경이 있었으면(창을 닫아 못 올린 경우 등) 합쳐서 올린다(2026-10-06) */
      if (mergeIntoLocal(d) === "merged") {
        saveLocal();
        applyFilters();
        if (window.renderDiscover) renderDiscover();
        toast("이 기기에서 바꾼 것과 서버 것을 합쳤어요");
        return;
      }
      // 안전장치: 서버 데이터가 로컬보다 현저히 적으면 물어봄
      if (localCount > 0 && serverCount < localCount * 0.5) {
        const ok = confirm(
          `서버 데이터(${serverCount}개)가 이 기기 데이터(${localCount}개)보다 적습니다.\n` +
          `서버 것으로 덮어쓸까요?\n\n` +
          `[취소]를 누르면 이 기기 데이터를 유지하고 서버에 올립니다.`
        );
        if (!ok) { await autoPush(); return; }
      }
      State.items = d.items;
      adoptLists(d);
      localStorage.setItem(LS_KEY, JSON.stringify(State.items));
      localStorage.setItem(LS_MODIFIED, serverMod);
      State.serverStamp = serverMod;
      saveBase(d);
      applyFilters();
      if (window.renderDiscover) renderDiscover();
      setSyncIcon("saved");
      toast(`서버에서 불러옴 (${State.items.length}개)`);
      return;
    }

    // 로컬이 더 최신 — 단, 시드는 절대 올리지 않는다
    if (localMod > serverMod && !isSeedData()) { await autoPush(); return; }

    // 같다 — 처음 켠 기기면 지금을 합치기 기준으로 삼는다
    if (!loadBase()) saveBase(d);
    setSyncIcon("saved");
  } catch (e) {
    console.error("부팅 동기화 실패", e);
    setSyncIcon("error");
    toast("서버 연결 실패 — 이 기기에만 저장됩니다", "error");
  }
}

/* ============================================
   실시간 동기화
   Firebase Realtime Database는 REST로도 스트리밍을 지원한다(EventSource).
   전체 문서를 흘려보내면 저장할 때마다 수 MB가 오가므로, **`updatedAt` 한 줄만 구독**하고
   그게 바뀌면 그때 평소처럼 전체를 받아온다.

   이게 없을 때의 문제: 서버를 페이지 열 때 한 번만 읽어서, 폰이 열려 있는 동안 PC에서 고치면
   폰은 모른다. 그 상태로 폰에서 뭘 하나 고치면 폰의 옛 문서 전체가 PC 변경분을 덮어썼다. */
let _es = null;
let _esLast = 0;   // 실시간 연결에서 마지막으로 뭔가 받은 시각 — 서버가 30초쯤마다 keep-alive를 보낸다
let _pullPending = false;

function realtimeUrl() {
  const pw = getSyncPassword();
  if (!pw) return null;
  return `${FIREBASE_DB_URL}/${SYNC_BRANCH}/${encodeURIComponent(pw)}/updatedAt.json`;
}

function startRealtime() {
  stopRealtime();
  const url = realtimeUrl();
  if (!url || typeof EventSource === "undefined") return;
  try {
    _es = new EventSource(url);
    _esLast = Date.now();
    _es.addEventListener("put", onRemoteStamp);
    _es.addEventListener("patch", onRemoteStamp);
    _es.addEventListener("keep-alive", () => { _esLast = Date.now(); });
    _es.onerror = () => { /* 끊기면 브라우저가 자동 재연결. 탭 복귀 시에도 한 번 확인한다 */ };
  } catch (e) {
    console.warn("실시간 동기화를 켜지 못했습니다", e);
  }
}

function stopRealtime() {
  if (_es) { try { _es.close(); } catch {} _es = null; }
}

/* 서버의 updatedAt이 바뀌었을 때 */
function onRemoteStamp(e) {
  _esLast = Date.now();
  let stamp = null;
  try { stamp = (JSON.parse(e.data || "{}") || {}).data; } catch { return; }
  if (!stamp) return;

  // 내가 방금 올린 것이거나 이미 최신이면 받을 필요 없다 (에코 방지)
  const localMod = localStorage.getItem(LS_MODIFIED) || "";
  if (stamp <= localMod) return;

  // 편집 중이면 폼이 날아가므로 미뤘다가 닫힐 때 받는다
  const editing = $("#editModal") && !$("#editModal").classList.contains("hidden");
  if (editing) { _pullPending = true; return; }

  applyRemoteUpdate();
}

async function applyRemoteUpdate() {
  _pullPending = false;
  const ok = await pullFromServer(true);
  if (!ok) return;
  applyFilters();
  if (window.renderDiscover) renderDiscover();
  toast("다른 기기의 변경을 받아왔습니다");
}

/* 편집을 끝냈을 때 밀어둔 갱신이 있으면 그때 받는다 */
function flushPendingPull() {
  if (_pullPending) applyRemoteUpdate();
}
window.flushPendingPull = flushPendingPull;

/* 탭으로 돌아오면 한 번 확인 — 폰은 백그라운드에서 스트림이 끊기는 일이 잦다 */
function initVisibilitySync() {
  const check = async () => {
    if (document.visibilityState !== "visible") return;
    if (!hasSyncPassword()) return;
    startRealtime();                       // 끊겼으면 다시 연결
    try {
      const d = await fetchServer();
      const localMod = localStorage.getItem(LS_MODIFIED) || "";
      if (d && d.updatedAt && d.updatedAt > localMod) await applyRemoteUpdate();
    } catch { /* 네트워크가 없으면 조용히 넘어간다 */ }
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);

  /* **창을 내리거나 닫을 때 남은 저장을 바로 보낸다**(2026-10-06) — 2~3초 모았다 보내는 사이에 앱을 내리면
     그 기기에만 남았다(추천 [치우기]가 다른 기기에 안 따라온 경우) */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || !hasSyncPassword()) return;
    let pending = !!_syncTimer;
    if (_prefPush) { clearTimeout(_prefPush); _prefPush = null; saveLocal(true); pending = true; }
    if (pending) { clearTimeout(_syncTimer); _syncTimer = null; autoPush(); }
  });

  /* **끊긴 실시간 연결 알아채기**(2026-10-06). 서버는 연결이 살아 있으면 30초쯤마다 keep-alive를 보낸다.
     이 기기 안에서 시계만 본다 — 서버에 묻지 않는다. 2분 넘게 아무것도 안 왔으면 연결만 다시 붙인다
     (다시 붙으면 서버가 지금 시각을 보내주고, 바뀐 게 있을 때만 받아온다). 창이 보일 때만. */
  setInterval(() => {
    if (!hasSyncPassword() || document.visibilityState !== "visible") return;
    if (!_es || _es.readyState === 2 || Date.now() - _esLast > 120000) startRealtime();
  }, 30000);
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
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    autoPush();
    e.preventDefault();
    e.returnValue = "";
  }
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

/* 비밀번호를 저장하면 그게 곧 서버 데이터 경로가 됨 */
async function saveSyncPw() {
  const v = ($("#syncPwInput").value || "").trim();
  if (!v) { toast("비밀번호를 입력하세요", "error"); return; }

  const prev = getSyncPassword();
  localStorage.setItem(LS_SYNC_PW, v);
  closeSyncPwModal();

  /* 같은 비밀번호를 다시 넣은 것도 "받아와 달라"는 뜻으로 본다 — 예전엔 아무 일도 안 했다 */
  toast(v === prev ? "서버 확인 중..." : "동기화 비밀번호 저장됨 — 서버 확인 중...");
  await firstSyncAfterPw();
  applyFilters();
  updateSyncPwStatus();
  startRealtime();          // 방이 바뀌었으니 구독도 새 경로로
}

/* 비밀번호를 처음(또는 새로) 설정한 직후의 동기화 처리.
   새 방에 데이터가 있으면 평소 부팅 동기화로, 비어 있으면 이 기기 데이터를 올린다. */
async function firstSyncAfterPw() {
  const url = getDataUrl();
  if (!url) { setSyncIcon("local"); return; }
  setSyncIcon("saving");
  try {
    const d = await fetchServer();

    /* 방에 기록이 있으면 **서버 것을 받아오는 걸로 시작한다** (2026-09-23 요청).
       예전엔 시각 비교(`syncOnBoot`)로 넘겨서, 설정만 저장된 새 폰이 "더 최신"으로 잡혀
       비밀번호만 넣고 끝나거나 빈 채로 올리는 사고가 났다. 비밀번호를 넣는 건 곧
       "그 방의 기록을 쓰겠다"는 뜻이다. 이 기기에 **따로 적어둔 기록이 있을 때만** 묻는다. */
    if (d && Array.isArray(d.items) && d.items.length) {
      if (State.items.length && !isSeedData() && !confirm(
        `서버에 기록 ${d.items.length}개가 있어요. 받아올까요?\n\n` +
        `이 기기의 기록 ${State.items.length}개는 서버 것으로 바뀝니다.\n` +
        `[취소]를 누르면 아무것도 안 바뀝니다.`
      )) { setSyncIcon("idle"); return; }
      if (await pullFromServer(true)) {
        if (window.renderDiscover) renderDiscover();
        toast(`서버에서 불러옴 (${State.items.length}개)`, "success");
      } else setSyncIcon("error");
      return;
    }
    // 방은 있는데 기록이 0개 → 평소 부팅 동기화 로직으로
    if (d && Array.isArray(d.items)) { await syncOnBoot(); return; }

    // 이 기기 데이터를 새 방에 올림 — 시드는 올리지 않는다
    if (State.items.length && !isSeedData()) {
      await autoPush();
      toast(`이 기기 데이터 ${State.items.length}개를 올렸습니다`, "success");
    } else setSyncIcon("saved");
  } catch (e) {
    console.error("첫 동기화 실패", e);
    setSyncIcon("error");
    toast("서버 연결 실패 — 비밀번호/규칙을 확인하세요", "error");
  }
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

  // 서버 확인 후, 양쪽 다 비어있을 때만 노션 시드 사용
  bootSync();
}

/* ⚠ 별점 10점 만점 전환(2026-08-06)에 쓰던 `clearOldRatings`는 **없앴다** (2026-08-07).
   "이미 전환했음" 플래그를 localStorage에 뒀는데 그건 **기기마다 따로**라서, 새 기기에서 앱을 열면
   서버에서 받아온 별점(다른 기기에서 새로 매긴 것)을 "아직 안 지운 옛 별점"으로 보고 지워버렸다.
   실제로 폰에서 그 일이 났다. 시드 사고와 같은 구조다 — **부팅 때 데이터를 지우는 코드는
   기기별 플래그로 제어하면 안 된다.** 전환은 이미 끝났으므로 코드를 남길 이유도 없다. */

async function bootSync() {
  await syncOnBoot();
  startRealtime();

  /* ⚠ 예전엔 여기서 로컬이 비면 노션 시드 268개를 자동으로 넣었다. **그게 8월 1일 사고의 원인**이다
     — 빈 기기에서 앱을 열면 시드가 들어가고, 그게 "방금 수정됨"이 되어 서버의 진짜 기록을 덮어썼다.
     서버에 기록이 있는 지금은 시드를 쓸 일이 없어 `seed-data.js`째로 없앴다(2026-08-07).
     비어 보이면 그냥 비어 있는 것이다 — **앱이 데이터를 만들어내지 않는다.** */
  if (!State.items.length && hasSyncPassword()) {
    setSyncIcon("error");
    toast("서버에서 데이터를 가져오지 못했습니다. 새로고침해 보세요", "error");
  }
}

document.addEventListener("DOMContentLoaded", bootApp);
