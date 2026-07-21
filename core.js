/* ============================================
   core.js — Firebase, 인증, 상태, 공통 유틸
   ============================================ */

/* ---------- 설정 (여기를 수정하세요) ---------- */
const APP_PASSWORD = "1234";        // ← 원하는 비밀번호로 변경

const FIREBASE_CONFIG = {
  apiKey: "여기에_apiKey",
  authDomain: "여기에_authDomain",
  projectId: "여기에_projectId",
  storageBucket: "여기에_storageBucket",
  messagingSenderId: "여기에_messagingSenderId",
  appId: "여기에_appId"
};

const FB_COLLECTION = "watchlog";   // Firestore 컬렉션명
const FB_DOC = "data";              // 문서명
/* --------------------------------------------- */

const LS_KEY = "watchlog_items";
const LS_TMDB = "watchlog_tmdb_key";
const LS_AUTH = "watchlog_auth";

const State = {
  items: [],
  filtered: [],
  page: 1,
  perPage: 24,
  editingId: null,
  selectedTmdb: null,
  db: null
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
  t._timer = setTimeout(() => t.classList.add("hidden"), 2600);
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

/* ---------- 로컬 저장 ---------- */
function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify(State.items));
}

function loadLocal() {
  try {
    State.items = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch { State.items = []; }
}

/* ---------- Firebase ---------- */
function initFirebase() {
  if (!FIREBASE_CONFIG.projectId || FIREBASE_CONFIG.projectId.startsWith("여기에")) {
    console.warn("Firebase 설정이 비어있습니다. 로컬 저장만 동작합니다.");
    return false;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    State.db = firebase.firestore();
    return true;
  } catch (e) {
    console.error("Firebase 초기화 실패", e);
    return false;
  }
}

async function pushToServer() {
  if (!State.db) { toast("Firebase 설정이 필요합니다", "error"); return false; }
  try {
    await State.db.collection(FB_COLLECTION).doc(FB_DOC).set({
      items: State.items,
      updatedAt: new Date().toISOString(),
      count: State.items.length
    });
    toast(`서버에 저장 완료 (${State.items.length}개)`, "success");
    return true;
  } catch (e) {
    console.error(e);
    toast("저장 실패: " + e.message, "error");
    return false;
  }
}

async function pullFromServer() {
  if (!State.db) { toast("Firebase 설정이 필요합니다", "error"); return false; }
  try {
    const snap = await State.db.collection(FB_COLLECTION).doc(FB_DOC).get();
    if (!snap.exists) { toast("서버에 데이터가 없습니다", "error"); return false; }
    const d = snap.data();
    State.items = d.items || [];
    saveLocal();
    toast(`서버에서 불러옴 (${State.items.length}개)`, "success");
    return true;
  } catch (e) {
    console.error(e);
    toast("불러오기 실패: " + e.message, "error");
    return false;
  }
}

/* ---------- 로그인 ---------- */
function initLogin() {
  const doLogin = () => {
    const v = $("#pwInput").value;
    if (v === APP_PASSWORD) {
      sessionStorage.setItem(LS_AUTH, "1");
      $("#loginScreen").classList.add("hidden");
      $("#app").classList.remove("hidden");
      bootApp();
    } else {
      const err = $("#pwError");
      err.textContent = "비밀번호가 올바르지 않습니다";
      err.classList.remove("hidden");
      $("#pwInput").value = "";
    }
  };
  $("#loginBtn").addEventListener("click", doLogin);
  $("#pwInput").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });

  if (sessionStorage.getItem(LS_AUTH) === "1") {
    $("#loginScreen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    bootApp();
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

/* ---------- 부팅 ---------- */
let _booted = false;
function bootApp() {
  if (_booted) return;
  _booted = true;

  initFirebase();
  loadLocal();

  if (State.items.length === 0 && window.SEED_DATA) {
    State.items = window.SEED_DATA.map(x => ({ ...x, createdAt: new Date().toISOString() }));
    saveLocal();
  }

  initTabs();
  initWatchlog();
  initTmdb();
  initSettings();
  applyFilters();
}

document.addEventListener("DOMContentLoaded", initLogin);
