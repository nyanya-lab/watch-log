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

const LEGACY_KEY = "data";          // 예전 고정 경로 (/watchlog/data). 마이그레이션용으로만 참조.

const AUTO_SYNC_DELAY = 2500;       // 자동 저장 대기시간(ms)
/* --------------------------------------------- */

const LS_KEY = "watchlog_items";
const LS_WISH = "watchlog_wishes";  // 보고싶어요 목록. 시청 기록과 섞지 않고 따로 둔다(통계 오염 방지)
const LS_HIDE = "watchlog_hides";   // 관심없음 목록. 추천·검색에서 걸러낼 작품
const LS_TMDB = "watchlog_tmdb_key";
const LS_SYNC_PW = "watchlog_sync_password";   // 동기화 비밀번호 = 서버 데이터 경로 (이 기기에만 저장, 깃에는 없음)
const LS_MODIFIED = "watchlog_modified";
const LS_BACKUP = "watchlog_items_backup";
/* 지금 로컬 데이터가 "부팅 때 자동으로 넣은 시드"일 뿐인지 표시.
   시드는 사용자가 만든 기록이 아니므로 **절대 서버로 올리지 않는다.**
   (이 표시가 없어서 실제 사고가 났다: 빈 기기에서 앱을 열면 시드 268개가 들어가고,
    그 뒤 동기화 비밀번호를 넣으면 "로컬이 더 최신"으로 판정돼 서버의 진짜 기록을 덮어썼다.) */
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
/* 예전 고정 경로 (/watchlog/data) — 최초 비밀번호 설정 시 데이터 이사용 */
const LEGACY_URL = `${FIREBASE_DB_URL}/${SYNC_BRANCH}/${LEGACY_KEY}.json`;

const State = {
  items: [],
  wishes: [],        // 보고싶어요 (아직 안 본 작품) — items와 별도
  hides: [],         // 관심없음 — 추천·검색에서 제외할 작품
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
    saving:  ["fa-spinner fa-spin",   "text-indigo-500",  "서버 저장 중..."],
    saved:   ["fa-cloud",             "text-emerald-600", "서버에 저장됨"],
    error:   ["fa-triangle-exclamation", "text-red-500",  "저장 실패 — 클릭해서 재시도"],
    local:   ["fa-cloud-slash",       "text-slate-400",   "이 기기에만 저장 중 — 클릭해서 동기화 비밀번호 설정"]
  };
  const [icon, color, title] = map[state] || map.idle;
  btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  btn.className = `btn-icon ${color}`;
  btn.title = title;
}

/* ---------- 로컬 저장 ---------- */
let _syncTimer = null;

function saveLocal(skipCloud) {
  try {
    // 직전 상태를 백업으로 하나 남겨둠 (사고 대비)
    const prev = localStorage.getItem(LS_KEY);
    if (prev && prev.length > 20) localStorage.setItem(LS_BACKUP, prev);

    localStorage.setItem(LS_KEY, JSON.stringify(State.items));
    localStorage.setItem(LS_WISH, JSON.stringify(State.wishes));
    localStorage.setItem(LS_HIDE, JSON.stringify(State.hides));
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
}

/* ---------- 서버 통신 (Realtime Database REST) ---------- */
/* 서버에 내가 모르는 변경이 있는지 확인.
   실시간 구독이 있어도 끊겨 있던 동안의 변경은 놓칠 수 있어서, 올리기 직전에 한 번 더 본다.
   있으면 **덮어쓰지 않는다** — 조용히 덮는 게 8월 1일 사고의 본질이었다. */
async function serverChangedBehindUs() {
  try {
    const d = await fetchServer();
    if (!d || !d.updatedAt) return false;
    const known = State.serverStamp || localStorage.getItem(LS_MODIFIED) || "";
    return d.updatedAt > known;
  } catch { return false; }   // 확인 실패는 막지 않는다 (오프라인에서도 저장은 되어야 함)
}

async function autoPush() {
  _syncTimer = null;
  if (State.syncing) return;
  const url = getDataUrl();
  if (!url) { setSyncIcon("local"); return; }   // 비밀번호 없음 → 로컬 전용

  if (await serverChangedBehindUs()) {
    setSyncIcon("error");
    toast("다른 기기에서 먼저 저장했어요. 구름 아이콘을 눌러 확인하세요", "error");
    return;
  }

  State.syncing = true;
  setSyncIcon("saving");
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: State.items,
        wishes: State.wishes,
        hides: State.hides,
        updatedAt: localStorage.getItem(LS_MODIFIED) || new Date().toISOString(),
        count: State.items.length
      })
    });
    if (!res.ok) throw new Error(describeHttp(res.status));
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
  State.syncing = true;
  setSyncIcon("saving");
  const stamp = new Date().toISOString();
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: State.items,
        wishes: State.wishes,
        hides: State.hides,
        updatedAt: stamp,
        count: State.items.length
      })
    });
    if (!res.ok) throw new Error(describeHttp(res.status));
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
    State.items = d.items;
    adoptLists(d);
    localStorage.setItem(LS_KEY, JSON.stringify(State.items));
    localStorage.setItem(LS_MODIFIED, d.updatedAt || new Date().toISOString());
    State.serverStamp = d.updatedAt || "";
    setSyncIcon("saved");
    if (!silent) toast(`서버에서 불러옴 (${State.items.length}개)`, "success");
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) toast("불러오기 실패: " + e.message, "error");
    return false;
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
      applyFilters();
      if (window.renderDiscover) renderDiscover();
      setSyncIcon("saved");
      toast(`서버에서 불러옴 (${State.items.length}개)`);
      return;
    }

    // 로컬이 더 최신 — 단, 시드는 절대 올리지 않는다
    if (localMod > serverMod && !isSeedData()) { await autoPush(); return; }

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
    _es.addEventListener("put", onRemoteStamp);
    _es.addEventListener("patch", onRemoteStamp);
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

  if (v === prev) { toast("동기화 비밀번호가 그대로입니다"); return; }

  toast("동기화 비밀번호 저장됨 — 서버 확인 중...");
  await firstSyncAfterPw();
  applyFilters();
  updateSyncPwStatus();
  startRealtime();          // 방이 바뀌었으니 구독도 새 경로로
}

/* 비밀번호를 처음(또는 새로) 설정한 직후의 동기화 처리.
   새 방이 비어 있으면 → 예전 고정 경로(/watchlog/data) 데이터를 옮길지 물어보고,
   그것도 없으면 이 기기 데이터를 새 방에 올린다. */
async function firstSyncAfterPw() {
  const url = getDataUrl();
  if (!url) { setSyncIcon("local"); return; }
  setSyncIcon("saving");
  try {
    const d = await fetchServer();

    // 새 방에 이미 데이터가 있음 → 평소 부팅 동기화 로직으로
    if (d && Array.isArray(d.items)) { await syncOnBoot(); return; }

    // 새 방이 비어 있음 → 예전 고정 경로에 데이터가 있는지 확인 (마이그레이션)
    let legacy = null;
    try {
      const r = await fetch(LEGACY_URL + "?t=" + Date.now());
      if (r.ok) legacy = await r.json();
    } catch {}

    if (legacy && Array.isArray(legacy.items) && legacy.items.length) {
      const ok = confirm(
        `기존 서버 데이터 ${legacy.items.length}개를 이 비밀번호(방)로 옮길까요?\n\n` +
        `[확인] 예전 데이터를 이 비밀번호로 복사합니다.\n` +
        `[취소] 이 기기의 현재 데이터(${State.items.length}개)를 올립니다.`
      );
      if (ok) {
        State.items = legacy.items;
        localStorage.setItem(LS_KEY, JSON.stringify(State.items));
        localStorage.setItem(LS_MODIFIED, legacy.updatedAt || new Date().toISOString());
        await pushToServer();
        toast(`기존 데이터 ${State.items.length}개를 옮겼습니다`, "success");
        return;
      }
    }

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

/* ---------- Escape 키로 모달 닫기 ----------
   위에 겹쳐 뜬 것부터 하나씩 닫는다 (Escape 한 번에 전부 닫히면 뒤에 있던 것까지 사라진다).
   등록/수정 모달은 State도 정리해야 하므로 closeEdit()을 쓴다. */
function initEscapeKey() {
  const layers = [
    { sel: "#quickRateModal", close: () => closeQuickRate() },
    { sel: "#dcModal" },
    { sel: "#detailModal" },
    { sel: "#filterModal", close: () => closeFilterModal() },
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
  const scrollPos = { list: 0, discover: 0, stats: 0, settings: 0 };
  let curTab = "list";

  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      scrollPos[curTab] = window.scrollY;      // 떠나는 탭 위치 저장

      $$(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      ["list", "discover", "stats", "settings"].forEach(t => {
        $("#tab-" + t).classList.toggle("hidden", t !== tab);
      });
      if (tab === "stats") renderStats();
      if (tab === "discover") renderDiscover();
      curTab = tab;

      // 렌더 끝난 뒤 이전 위치로 복원
      requestAnimationFrame(() => window.scrollTo(0, scrollPos[tab] || 0));
    });
  });
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
  initWatchlog();
  initTmdb();
  initDiscover();
  initSettings();
  applyFilters();

  // 서버 확인 후, 양쪽 다 비어있을 때만 노션 시드 사용
  bootSync();
}

/* ---------- 별점 10점 만점 전환 (2026-08-06) ----------
   5점 만점으로 매긴 값을 그대로 두면 4.5점이 10점 만점의 4.5점(45%)으로 읽힌다.
   2배로 환산하는 대신 **비우고 다시 매기기로 했다**(사용자 결정) — 5점 기준으로 매긴 감각과
   10점 기준은 다르고, 환산된 어중간한 숫자가 남으면 다시 매길 때 기준이 흔들리기 때문.
   목록 탭 "별점 채우기"로 한 장씩 넘기며 채우면 된다.

   **서버 데이터를 채택한 뒤에** 부른다. 먼저 지우면 서버에서 온 별점이 그대로 살아남는다.
   플래그로 딱 한 번만 실행한다 — 안 그러면 새로 매긴 별점도 새로고침마다 지워진다. */
const LS_RATE10 = "watchlog_rating10";

function clearOldRatings() {
  if (localStorage.getItem(LS_RATE10)) return;
  const n = State.items.filter(i => i.rating).length;
  localStorage.setItem(LS_RATE10, "1");
  if (!n) return;

  State.items.forEach(i => { i.rating = null; });
  saveLocal();               // 덮어쓰기 직전 상태는 watchlog_items_backup에 남는다
  applyFilters();
  toast(`별점을 10점 만점으로 바꿨습니다 — 예전 별점 ${n}개는 비웠어요`, "success");
}

async function bootSync() {
  await syncOnBoot();
  clearOldRatings();          // 서버 것을 채택한 다음에 비운다
  startRealtime();
  if (State.items.length) return;
  if (!window.SEED_DATA) return;

  /* 동기화 비밀번호가 있는데 비어 있다면, 서버 조회가 실패했거나 방이 빈 것이다.
     이때 시드를 넣으면 그게 "최신"으로 보여 서버의 진짜 기록을 덮어쓸 수 있으므로 넣지 않는다.
     (필요하면 설정 → 노션 데이터 불러오기로 직접 넣을 수 있다) */
  if (hasSyncPassword()) {
    setSyncIcon("error");
    toast("서버에서 데이터를 가져오지 못했습니다. 새로고침해 보세요", "error");
    return;
  }

  State.items = window.SEED_DATA.map(x => ({ ...x, createdAt: new Date().toISOString() }));
  applyFilters();
  saveLocal(true);     // 서버로 보내지 않음
  markSeed(true);      // 아직 "시드일 뿐"이라고 표시 (saveLocal이 지우므로 그 뒤에)
  toast(`노션 데이터 ${State.items.length}개를 불러왔습니다`);
}

document.addEventListener("DOMContentLoaded", bootApp);
