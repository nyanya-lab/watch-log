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
const LS_TMDB = "watchlog_tmdb_key";
const LS_SYNC_PW = "watchlog_sync_password";   // 동기화 비밀번호 = 서버 데이터 경로 (이 기기에만 저장, 깃에는 없음)
const LS_MODIFIED = "watchlog_modified";
const LS_BACKUP = "watchlog_items_backup";

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
  filtered: [],
  page: 1,
  perPage: 24,
  editingId: null,
  selectedTmdb: null,
  online: true,
  syncing: false,
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

function stars(n) {
  if (!n) return "";
  return "★".repeat(n) + "☆".repeat(5 - n);
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
  btn.className = `w-9 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 transition ${color}`;
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
    localStorage.setItem(LS_MODIFIED, new Date().toISOString());
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
}

/* ---------- 서버 통신 (Realtime Database REST) ---------- */
async function autoPush() {
  _syncTimer = null;
  if (State.syncing) return;
  const url = getDataUrl();
  if (!url) { setSyncIcon("local"); return; }   // 비밀번호 없음 → 로컬 전용
  State.syncing = true;
  setSyncIcon("saving");
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: State.items,
        updatedAt: localStorage.getItem(LS_MODIFIED) || new Date().toISOString(),
        count: State.items.length
      })
    });
    if (!res.ok) throw new Error(describeHttp(res.status));
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
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: State.items,
        updatedAt: new Date().toISOString(),
        count: State.items.length
      })
    });
    if (!res.ok) throw new Error(describeHttp(res.status));
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
    localStorage.setItem(LS_KEY, JSON.stringify(State.items));
    localStorage.setItem(LS_MODIFIED, d.updatedAt || new Date().toISOString());
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

    // 서버가 비어있음 → 로컬을 올림
    if (!d || !Array.isArray(d.items)) {
      if (localCount) await autoPush();
      else setSyncIcon("idle");
      return;
    }

    const serverMod = d.updatedAt || "";
    const serverCount = d.items.length;

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
      localStorage.setItem(LS_KEY, JSON.stringify(State.items));
      localStorage.setItem(LS_MODIFIED, serverMod);
      applyFilters();
      setSyncIcon("saved");
      toast(`서버에서 불러옴 (${State.items.length}개)`);
      return;
    }

    // 로컬이 더 최신
    if (localMod > serverMod) { await autoPush(); return; }

    setSyncIcon("saved");
  } catch (e) {
    console.error("부팅 동기화 실패", e);
    setSyncIcon("error");
    toast("서버 연결 실패 — 이 기기에만 저장됩니다", "error");
  }
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

    // 이 기기 데이터를 새 방에 올림
    if (State.items.length) { await autoPush(); toast(`이 기기 데이터 ${State.items.length}개를 올렸습니다`, "success"); }
    else setSyncIcon("saved");
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

/* ---------- 탭 ---------- */
function initTabs() {
  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      ["list", "stats", "settings"].forEach(t => {
        $("#tab-" + t).classList.toggle("hidden", t !== tab);
      });
      if (tab === "stats") renderStats();
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
  initWatchlog();
  initTmdb();
  initSettings();
  applyFilters();

  // 서버 확인 후, 양쪽 다 비어있을 때만 노션 시드 사용
  bootSync();
}

async function bootSync() {
  await syncOnBoot();
  if (State.items.length === 0 && window.SEED_DATA) {
    State.items = window.SEED_DATA.map(x => ({ ...x, createdAt: new Date().toISOString() }));
    applyFilters();
    saveLocal();
    toast(`노션 데이터 ${State.items.length}개를 불러왔습니다`);
  }
}

document.addEventListener("DOMContentLoaded", bootApp);
