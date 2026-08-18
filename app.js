const $app = document.getElementById("app");

// ---- Kiosk hardening (only when ?kiosk=1) ----
function shouldHardenKiosk() {
  const params = new URLSearchParams(location.search);
  if (params.get("kiosk") === "1") return true;
  if (params.get("debug") === "1" || params.get("design") === "1") return false;
  return localStorage.getItem("phonepe_kiosk_mode") === "1";
}

function hardenKiosk() {
  if (!shouldHardenKiosk()) return;

  window.addEventListener("contextmenu", (e) => e.preventDefault(), { passive: false });
  window.addEventListener("selectstart", (e) => {
    if (e.target.closest("input, textarea")) return;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

  try {
    history.pushState(null, "", location.href);
    window.addEventListener("popstate", () => history.pushState(null, "", location.href));
  } catch {}

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 280) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update?.().catch(() => {}))
      .catch(() => {});

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      try {
        location.reload();
      } catch {}
    });
  }
}

// ---- Config ----
async function loadConfig() {
  const res = await fetch("./questions.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load questions.json");
  const data = await res.json();
  validateConfig(data);
  return data;
}

function validateConfig(data) {
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error("questions.json must include at least one question");
  }
  data.questions.forEach((q, i) => {
    if (!q.clue || !Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Question ${i + 1} needs clue and at least 2 options`);
    }
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`Question ${i + 1} has invalid correctIndex`);
    }
    const word = getCategoryWord(q);
    if (!word || word.length < 2) {
      throw new Error(`Question ${i + 1} categoryWord is too short after normalization`);
    }
    if (word.length > (data.grid?.maxSize ?? 24)) {
      throw new Error(`Question ${i + 1} category "${word}" exceeds grid maxSize`);
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Puzzle target = category / keyword of the question (Game Rules #2). */
function getCategoryWord(q) {
  if (q.categoryWord) return normalizeAnswer(q.categoryWord);
  if (q.answer) return normalizeAnswer(q.answer);
  return normalizeAnswer(q.options[q.correctIndex]);
}

function getCategoryLabel(q) {
  if (q.categoryWord) return String(q.categoryWord).trim();
  return getCategoryWord(q);
}

function getAnswerLabel(q) {
  return q.options[q.correctIndex];
}

function normalizeAnswer(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** End-screen message per Game Rules point matrix (0 / 25 / 50 / 75 / 100). */
function getScoreFeedback(total) {
  const table = cfg.scoreFeedback ?? {
    0: "Oops!",
    25: "Not bad!",
    50: "Good Job!",
    75: "Great job!",
    100: "Flawless, perfect score!",
  };
  return table[total] ?? table[String(total)] ?? "Thanks for playing!";
}

function sectionPoints() {
  return cfg.sectionPoints ?? cfg.quizPoints ?? 25;
}

function quizSeconds() {
  return loadSettings().quizSeconds;
}

function wordFindSeconds() {
  return loadSettings().wordFindSeconds;
}

function idleResetSeconds() {
  return loadSettings().idleResetSeconds;
}

function isFinalMcqRound() {
  return state.questionIndex >= state.roundQuestions.length - 1;
}

/** Official Excel options only — Option A and Option B. */
function buildShuffledQuizOptions(q, seed) {
  const items = [
    { text: q.options?.[0] ?? "", isCorrect: q.correctIndex === 0 },
    { text: q.options?.[1] ?? "", isCorrect: q.correctIndex === 1 },
  ];
  shuffleInPlace(items, seededRandom(seed));
  return {
    options: items.map((x) => x.text),
    correctIndex: items.findIndex((x) => x.isCorrect),
  };
}

function ensureShuffledQuiz() {
  const qIndex = state.questionIndex;
  if (!state.shuffledQuiz || state.shuffledQuiz.forQuestion !== qIndex) {
    const seed = state.puzzleVariant * 5003 + qIndex * 89 + 17;
    const built = buildShuffledQuizOptions(activeQuestion(), seed);
    state.shuffledQuiz = { forQuestion: qIndex, ...built };
  }
  return state.shuffledQuiz;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Same clue text = same question to the player, even if category differs. */
function questionKey(q, fallbackIndex) {
  if (q?.id != null && String(q.id).trim() !== "") return String(q.id);
  const clue = String(q?.clue || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (clue) return clue;
  const fromFields = `${q?.allegation || ""}::${q?.clue || ""}`;
  return fromFields !== "::" ? fromFields : String(fallbackIndex);
}

function loadRecentList(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function rememberList(key, values, maxKeep) {
  try {
    const merged = [...loadRecentList(key), ...values.map(String)];
    localStorage.setItem(key, JSON.stringify(merged.slice(-maxKeep)));
  } catch {}
}

function loadRecentQuestionKeys() {
  return loadRecentList("phonepe_recent_questions");
}

function rememberQuestionKeys(keys) {
  const bankSize = cfg?.questions?.length ?? 100;
  const maxKeep = Math.max(bankSize - 4, Math.floor(bankSize * 0.92));
  rememberList("phonepe_recent_questions", keys, maxKeep);
}

function loadRecentKeywords() {
  return loadRecentList("phonepe_recent_keywords");
}

function rememberKeywords(words) {
  rememberList("phonepe_recent_keywords", words.filter(Boolean), 12);
}

function pickRoundQuestions(all, count) {
  const recentQ = loadRecentQuestionKeys();
  const recentQSet = new Set(recentQ);
  const recentKw = loadRecentKeywords();
  const recentKwSet = new Set(recentKw);

  const items = all.map((q, i) => ({
    q,
    key: questionKey(q, i),
    kw: getCategoryWord(q),
  }));
  shuffleInPlace(items, Math.random);

  items.sort((a, b) => {
    const aSeen = recentQSet.has(a.key) ? 1 : 0;
    const bSeen = recentQSet.has(b.key) ? 1 : 0;
    if (aSeen !== bSeen) return aSeen - bSeen;
    const aKw = recentKwSet.has(a.kw) ? 1 : 0;
    const bKw = recentKwSet.has(b.kw) ? 1 : 0;
    if (aKw !== bKw) return aKw - bKw;
    if (aSeen) return recentQ.indexOf(a.key) - recentQ.indexOf(b.key);
    return 0;
  });

  const picked = [];
  const usedKey = new Set();
  const usedKw = new Set();

  const take = (allowRecentQ, allowRecentKw, allowSameKw) => {
    for (const item of items) {
      if (picked.length >= count) return;
      if (usedKey.has(item.key)) continue;
      if (!allowRecentQ && recentQSet.has(item.key)) continue;
      if (!allowSameKw && usedKw.has(item.kw)) continue;
      if (!allowRecentKw && recentKwSet.has(item.kw)) continue;
      picked.push(item);
      usedKey.add(item.key);
      if (item.kw) usedKw.add(item.kw);
    }
  };

  take(false, false, false);
  take(false, true, false);
  take(true, true, false);
  take(true, true, true);

  rememberQuestionKeys(picked.map((p) => p.key));
  rememberKeywords(picked.map((p) => p.kw));
  return picked.map((p) => p.q);
}

/** Recent crossword placements (word + direction + start cell) to avoid repeats. */
function loadRecentPlacements() {
  return loadRecentList("phonepe_recent_placements");
}

function rememberPlacements(keys) {
  rememberList("phonepe_recent_placements", keys, 160);
}

function placementSignature(word, dir, start, size) {
  return `${word}|${dir.dr},${dir.dc}|${start.r},${start.c}|${size}`;
}

function placementStartKey(word, start, size) {
  return `${word}|@|${start.r},${start.c}|${size}`;
}

/** All keywords for this player's 10 questions — target first, others jumbled. */
function buildKeywordListForPuzzle(questions, targetWord, seed) {
  const seen = new Set();
  const unique = [];
  for (const q of questions) {
    const w = getCategoryWord(q);
    if (!w || seen.has(w)) continue;
    seen.add(w);
    unique.push(w);
  }
  const others = unique.filter((w) => w !== targetWord);
  shuffleInPlace(others, seededRandom(seed));
  return targetWord ? [targetWord, ...others] : others;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Puzzle variant rotation (10 variants, no repeat for consecutive players) ----
function getNextVariantIndex(maxVariants) {
  const key = "phonepe_puzzle_variant";
  try {
    let idx = parseInt(localStorage.getItem(key) || "0", 10);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    localStorage.setItem(key, String((idx + 1) % maxVariants));
    return idx;
  } catch {
    return Math.floor(Math.random() * maxVariants);
  }
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ---- Audio ----
let audioCtx;
function beep(type) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = type === "good" ? 740 : 180;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(type === "good" ? 0.22 : 0.12, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (type === "good" ? 0.12 : 0.18));
    o.stop(now + (type === "good" ? 0.14 : 0.22));
  } catch {}
}

// ---- Word search generator ----
// Horizontal L→R and vertical top→bottom only (no diagonals, no reverse).
const DIRS = [
  { dr: 0, dc: 1 }, // left → right
  { dr: 1, dc: 0 }, // top → bottom
];

function randInt(n, rng = Math.random) {
  return Math.floor(rng() * n);
}
function choice(arr, rng = Math.random) {
  return arr[randInt(arr.length, rng)];
}
function randomLetter(rng = Math.random) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return letters[randInt(letters.length, rng)];
}

function computeGridSize(words, minSize, maxSize) {
  const longest = Math.max(...words.map((a) => a.length));
  // Grow with word count so ~10 keywords still fit (H/V only).
  const byCount = Math.ceil(Math.sqrt(words.reduce((s, w) => s + w.length, 0) * 1.6));
  const base = Math.max(minSize, longest + 2, byCount);
  return Math.min(maxSize, Math.max(base, minSize));
}

function listPlacementCandidates(size, wordLen) {
  const out = [];
  for (const dir of DIRS) {
    const rMax = dir.dr === 1 ? size - wordLen : size - 1;
    const cMax = dir.dc === 1 ? size - wordLen : size - 1;
    if (rMax < 0 || cMax < 0) continue;
    for (let r = 0; r <= rMax; r++) {
      for (let c = 0; c <= cMax; c++) out.push({ dir, r, c });
    }
  }
  return out;
}

function tryPlaceWord(grid, word, wordIndex, rng, forbidden = new Set()) {
  const size = grid.length;
  const letters = word.split("");
  const cands = listPlacementCandidates(size, letters.length);
  shuffleInPlace(cands, rng);
  const allowed = [];
  const blocked = [];
  for (const cand of cands) {
    const start = { r: cand.r, c: cand.c };
    const sig = placementSignature(word, cand.dir, start, size);
    const startKey = placementStartKey(word, start, size);
    if (forbidden.has(sig) || forbidden.has(startKey)) blocked.push(cand);
    else allowed.push(cand);
  }

  const tryCand = (cand) => {
    const dr = cand.dir.dr;
    const dc = cand.dir.dc;
    const cells = [];
    for (let i = 0; i < letters.length; i++) {
      const r = cand.r + dr * i;
      const c = cand.c + dc * i;
      const cur = grid[r][c];
      if (cur.letter && cur.letter !== letters[i]) return null;
      cells.push({ r, c });
    }
    for (let i = 0; i < letters.length; i++) {
      const { r, c } = cells[i];
      grid[r][c].letter = letters[i];
      grid[r][c].belongsTo.add(wordIndex);
    }
    const start = { r: cand.r, c: cand.c };
    return {
      dir: cand.dir,
      reversed: false,
      start,
      cells,
      word,
      signature: placementSignature(word, cand.dir, start, size),
      startKey: placementStartKey(word, start, size),
    };
  };

  for (const cand of allowed) {
    const placed = tryCand(cand);
    if (placed) return placed;
  }
  for (const cand of blocked) {
    const placed = tryCand(cand);
    if (placed) return placed;
  }
  return null;
}

function generateWordSearch(words, cfgGrid, seed, forbiddenPlacements = new Set()) {
  const normalized = words.map(normalizeAnswer).filter(Boolean);
  const minSize = cfgGrid.minSize ?? 14;
  const maxSize = cfgGrid.maxSize ?? 24;
  let size = computeGridSize(normalized, minSize, maxSize);
  const baseSeed =
    ((seed >>> 0) ^
      ((Date.now() * 2654435761) >>> 0) ^
      ((Math.random() * 0xffffffff) >>> 0)) >>>
    0;

  const attemptBuild = (forbidden, seedSalt) => {
    const rng = seededRandom(baseSeed ^ seedSalt);
    for (let grow = 0; grow < 6; grow++) {
      const trySize = Math.min(maxSize, size + grow);
      for (let attempt = 0; attempt < 80; attempt++) {
        const grid = Array.from({ length: trySize }, () =>
          Array.from({ length: trySize }, () => ({ letter: "", belongsTo: new Set() })),
        );
        const usedThisGrid = new Set();
        let ok = true;

        const order = normalized
          .map((w, i) => ({ w, i }))
          .sort((a, b) => b.w.length - a.w.length);

        const placedByOrig = new Array(normalized.length);
        for (const { w, i } of order) {
          let placed = null;
          for (let tries = 0; tries < 500; tries++) {
            placed = tryPlaceWord(grid, w, i, rng, forbidden);
            if (!placed) continue;
            if (usedThisGrid.has(placed.signature)) {
              for (const { r, c } of placed.cells) {
                const cell = grid[r][c];
                cell.belongsTo.delete(i);
                if (cell.belongsTo.size === 0) cell.letter = "";
              }
              placed = null;
              continue;
            }
            break;
          }
          if (!placed) {
            ok = false;
            break;
          }
          usedThisGrid.add(placed.signature);
          placedByOrig[i] = placed;
        }
        if (!ok) continue;

        for (let r = 0; r < trySize; r++) {
          for (let c = 0; c < trySize; c++) {
            if (!grid[r][c].letter) grid[r][c].letter = randomLetter(rng);
          }
        }

        const signatures = placedByOrig
          .filter(Boolean)
          .flatMap((p) => [p.signature, p.startKey].filter(Boolean));
        rememberPlacements(signatures);

        return {
          size: trySize,
          grid,
          words: normalized,
          placements: placedByOrig,
          targetIndex: 0,
        };
      }
    }
    return null;
  };

  const preferred = attemptBuild(new Set(forbiddenPlacements), 0x9e3779b9);
  if (preferred) return preferred;

  // If history blocks packing, still build a fresh layout rather than failing the round.
  const fallback = attemptBuild(new Set(), 0x85ebca6b);
  if (fallback) return fallback;

  throw new Error("Failed to generate grid");
}

// ---- State machine ----
const Screen = {
  ENTER_DETAILS: "enter_details",
  RULES: "rules",
  START: "start",
  QUIZ: "quiz",
  WORDFIND: "wordfind",
  END: "end",
};

let cfg;
let gridAbort = null;
let recordsOpen = false;
let adminOpen = false;
let vkTargetId = null;
let vkShift = false;

const KEYBOARD_MODE_KEY = "phonepe_keyboard_mode";
const SETTINGS_KEY = "phonepe_kiosk_settings";
const KEYBOARD_MODES = ["both", "virtual", "usb"];
const TIMER_LIMITS = {
  quizSeconds: { min: 5, max: 120, step: 5, fallback: 30, presets: [15, 20, 30, 45, 60] },
  wordFindSeconds: { min: 5, max: 90, step: 5, fallback: 20, presets: [10, 15, 20, 30, 45] },
  idleResetSeconds: { min: 3, max: 60, step: 1, fallback: 7, presets: [5, 7, 10, 15, 20] },
};

function clampTimer(key, value) {
  const lim = TIMER_LIMITS[key];
  const n = Math.round(Number(value));
  if (!lim || !Number.isFinite(n)) return lim?.fallback ?? 30;
  return Math.max(lim.min, Math.min(lim.max, n));
}

function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
  } catch {}
  let keyboardMode = stored.keyboardMode;
  if (!KEYBOARD_MODES.includes(keyboardMode)) {
    try {
      keyboardMode = localStorage.getItem(KEYBOARD_MODE_KEY);
    } catch {}
  }
  if (!KEYBOARD_MODES.includes(keyboardMode)) keyboardMode = "both";
  return {
    keyboardMode,
    quizSeconds: clampTimer("quizSeconds", stored.quizSeconds ?? cfg?.quizSeconds ?? 30),
    wordFindSeconds: clampTimer("wordFindSeconds", stored.wordFindSeconds ?? cfg?.wordFindSeconds ?? 20),
    idleResetSeconds: clampTimer("idleResetSeconds", stored.idleResetSeconds ?? cfg?.idleResetSeconds ?? 7),
  };
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  next.quizSeconds = clampTimer("quizSeconds", next.quizSeconds);
  next.wordFindSeconds = clampTimer("wordFindSeconds", next.wordFindSeconds);
  next.idleResetSeconds = clampTimer("idleResetSeconds", next.idleResetSeconds);
  if (!KEYBOARD_MODES.includes(next.keyboardMode)) next.keyboardMode = "both";
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    localStorage.setItem(KEYBOARD_MODE_KEY, next.keyboardMode);
  } catch {}
  return next;
}

function isAdminLink() {
  const params = new URLSearchParams(location.search);
  if (params.get("admin") === "1") return true;
  const path = String(location.pathname || "").replace(/\/+$/, "").toLowerCase();
  return path.endsWith("/admin") || path.endsWith("/admin.html");
}

function getKeyboardMode() {
  return loadSettings().keyboardMode;
}

function setKeyboardMode(mode) {
  if (!KEYBOARD_MODES.includes(mode)) return;
  saveSettings({ keyboardMode: mode });
}

function virtualKeyboardEnabled() {
  const mode = getKeyboardMode();
  return mode === "virtual" || mode === "both";
}

function usbKeyboardEnabled() {
  const mode = getKeyboardMode();
  return mode === "usb" || mode === "both";
}

function ensureHost(id, className) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    if (className) el.className = className;
    document.body.appendChild(el);
  }
  return el;
}

function snapshotDetailsForm() {
  const nameEl = document.getElementById("player-name");
  const emailEl = document.getElementById("player-email");
  if (nameEl) state.playerName = nameEl.value;
  if (emailEl) state.playerEmail = toOfficialEmail(emailEl.value);
}
let state = {
  screen: Screen.ENTER_DETAILS,
  playerName: "",
  employeeId: "",
  playerEmail: "",
  formError: null,
  questionIndex: 0,
  puzzleVariant: 0,
  roundQuestions: [],
  totalScore: 0,
  roundScores: [],
  currentRound: null,
  gridData: null,
  feedback: null,
  idleResetTimer: null,
  wordFindTimer: null,
  remainingMs: 20000,
  wordFindStartedAt: 0,
  selecting: false,
  selStart: null,
  selEnd: null,
  locked: false,
  quizReveal: null,
  shuffledQuiz: null,
  revealTarget: false,
  scoreSaved: false,
};

function playerChip() {
  if (!state.playerName) return "";
  return `<span class="chip">${escapeHtml(state.playerName)}</span>`;
}

function validateName(value) {
  const v = String(value || "").trim();
  if (v.length < 2) return "Please enter your name (at least 2 characters).";
  if (v.length > 60) return "Name is too long.";
  return null;
}

const EMAIL_SUFFIX = "@phonepe.com";

function emailLocalPart(value) {
  const v = String(value || "").trim();
  const at = v.indexOf("@");
  return (at >= 0 ? v.slice(0, at) : v).trim();
}

function toOfficialEmail(value) {
  return `${emailLocalPart(value)}${EMAIL_SUFFIX}`;
}

function validateEmail(value) {
  const local = emailLocalPart(value);
  if (local.length < 2) return "Please enter your email before @phonepe.com.";
  if (local.length > 64) return "Email is too long.";
  if (!/^[A-Za-z0-9._+-]+$/.test(local)) return "Email can only use letters, numbers, . _ + -";
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return "Please enter a valid email.";
  }
  return null;
}

function questionLabel(index) {
  return `Question ${index + 1}`;
}

function wordFindLabel(index) {
  return index === 0 ? "Find the word" : `Find the word · Round ${index + 1}`;
}

function activeQuestion() {
  return state.roundQuestions[state.questionIndex];
}

function goEnterDetails() {
  state.screen = Screen.ENTER_DETAILS;
  state.formError = null;
  render();
}

function goRules() {
  state.screen = Screen.RULES;
  state.formError = null;
  render();
}

function roundsPerGame() {
  return Math.min(cfg.roundsPerGame ?? 2, cfg.questions.length);
}

function clearGridHandlers() {
  if (gridAbort) {
    gridAbort.abort();
    gridAbort = null;
  }
}

function clearTimers() {
  if (state.wordFindTimer) clearInterval(state.wordFindTimer);
  state.wordFindTimer = null;
  if (state.idleResetTimer) clearTimeout(state.idleResetTimer);
  state.idleResetTimer = null;
}

function scheduleIdleReset() {
  if (state.idleResetTimer) clearTimeout(state.idleResetTimer);
  const sec = idleResetSeconds();
  state.idleResetTimer = setTimeout(() => goStart(), sec * 1000);
}

function nowMs() {
  return Date.now();
}

function startGame() {
  clearTimers();
  const variantCount = cfg.puzzleVariants ?? 10;
  state.puzzleVariant = getNextVariantIndex(variantCount);
  state.roundQuestions = pickRoundQuestions(cfg.questions, roundsPerGame());
  state.questionIndex = 0;
  state.totalScore = 0;
  state.roundScores = [];
  state.currentRound = null;
  state.gridData = null;
  state.feedback = null;
  state.locked = false;
  state.quizReveal = null;
  state.shuffledQuiz = null;
  state.revealTarget = false;
  state.scoreSaved = false;
  state.screen = Screen.QUIZ;
  startQuizClock();
  render();
}

function startWordFind() {
  const q = activeQuestion();
  const target = getCategoryWord(q);
  const keywords = buildKeywordListForPuzzle(
    state.roundQuestions,
    target,
    state.puzzleVariant * 1000 + state.questionIndex * 37 + 11,
  );

  state.locked = true;
  try {
    const seed = state.puzzleVariant * 1000 + state.questionIndex * 37 + 11;
    const forbidden = new Set(loadRecentPlacements());
    state.gridData = generateWordSearch(keywords, cfg.grid ?? {}, seed, forbidden);
  } catch {
    state.currentRound.word = 0;
    finishRound();
    return;
  }

  state.remainingMs = wordFindSeconds() * 1000;
  state.wordFindStartedAt = nowMs();
  state.screen = Screen.WORDFIND;
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.locked = false;

  clearTimers();
  state.wordFindTimer = setInterval(() => {
    const elapsed = nowMs() - state.wordFindStartedAt;
    state.remainingMs = Math.max(0, wordFindSeconds() * 1000 - elapsed);
    if (state.remainingMs <= 0) {
      onWordFindTimeout();
    } else {
      updateWordFindTimerUI();
    }
  }, 200);

  render();
}

function startQuizClock() {
  state.remainingMs = quizSeconds() * 1000;
  state.wordFindStartedAt = nowMs();
  clearTimers();
  state.wordFindTimer = setInterval(() => {
    if (state.screen !== Screen.QUIZ || state.locked) return;
    const elapsed = nowMs() - state.wordFindStartedAt;
    state.remainingMs = Math.max(0, quizSeconds() * 1000 - elapsed);
    if (state.remainingMs <= 0) {
      void onQuizTimeout();
    } else {
      updateQuizTimerUI();
    }
  }, 200);
}

async function onQuizTimeout() {
  if (state.screen !== Screen.QUIZ || state.locked) return;
  state.locked = true;
  clearTimers();
  const shuffled = ensureShuffledQuiz();
  state.currentRound = { quiz: 0, word: 0, quizCorrect: false, keywordSkipped: true };
  state.quizReveal = { picked: -1, correct: shuffled.correctIndex };
  beep("bad");
  render();
  await delay(isFinalMcqRound() ? 2200 : 2000);
  if (state.screen !== Screen.QUIZ) return;
  state.quizReveal = null;
  state.shuffledQuiz = null;
  finishRound();
}

async function answerQuiz(optionIndex) {
  if (state.locked || state.screen !== Screen.QUIZ) return;
  state.locked = true;
  clearTimers();

  const shuffled = ensureShuffledQuiz();
  const correct = optionIndex === shuffled.correctIndex;
  const pts = sectionPoints();
  const quizPts = correct ? pts : 0;
  const mcqLabel = questionLabel(state.questionIndex);

  state.currentRound = { quiz: quizPts, word: 0, quizCorrect: correct, keywordSkipped: !correct };
  state.quizReveal = { picked: optionIndex, correct: shuffled.correctIndex };

  if (!correct) {
    beep("bad");
    // Show green/red option highlight only — no overlay toast
    render();
    await delay(isFinalMcqRound() ? 2200 : 2000);
    state.quizReveal = null;
    state.shuffledQuiz = null;
    finishRound();
    return;
  }

  beep("good");
  const kwLabel = wordFindLabel(state.questionIndex);
  state.feedback = {
    type: "good",
    text: `${mcqLabel} correct! — ${kwLabel}`,
    points: quizPts,
  };
  render();
  await delay(1400);
  if (state.screen !== Screen.QUIZ) return;
  state.feedback = null;
  state.quizReveal = null;
  startWordFind();
}

function getTargetPlacementCells() {
  const place = state.gridData?.placements?.[0];
  return place?.cells ?? [];
}

function paintTargetReveal() {
  const cells = getTargetPlacementCells();
  const set = new Set(cells.map((p) => `${p.r},${p.c}`));
  document.querySelectorAll("[data-cell]").forEach((el) => {
    const key = el.getAttribute("data-cell");
    el.classList.toggle("reveal", set.has(key));
    el.classList.remove("sel");
  });
}

async function revealKeywordThenFinish(_message, _type = "bad", waitMs = 2200) {
  state.revealTarget = true;
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.feedback = null;
  render();
  paintTargetReveal();
  await delay(waitMs);
  if (state.screen !== Screen.WORDFIND) return;
  state.revealTarget = false;
  finishRound();
}

function onWordFindTimeout() {
  if (state.screen !== Screen.WORDFIND || state.locked) return;
  state.locked = true;
  clearTimers();
  state.currentRound.word = 0;
  const label = getCategoryLabel(activeQuestion());
  void revealKeywordThenFinish(`Time's up — correct keyword highlighted: ${label}`);
}

async function onWordSelected(matchIdx) {
  if (state.screen !== Screen.WORDFIND || state.locked) return;
  state.locked = true;

  const full = sectionPoints();
  const label = getCategoryLabel(activeQuestion());

  if (matchIdx === 0) {
    clearTimers();
    beep("good");
    state.currentRound.word = full;
    state.revealTarget = true;
    state.feedback = {
      type: "good",
      text: "Keyword found!",
      points: full,
    };
    render();
    paintTargetReveal();
    document.querySelectorAll(".cell.reveal").forEach((el) => {
      el.classList.remove("reveal");
      el.classList.add("foundA");
    });
    await delay(1600);
    if (state.screen !== Screen.WORDFIND) return;
    state.feedback = null;
    state.revealTarget = false;
    finishRound();
    return;
  }

  if (matchIdx > 0) {
    clearTimers();
    beep("bad");
    state.currentRound.word = 0;
    await revealKeywordThenFinish(
      `Wrong keyword — no points for this section. Correct: ${label}`,
      "warn",
      3000,
    );
    return;
  }

  beep("bad");
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.feedback = null;
  flashBad();
  render();
  await delay(500);
  if (state.screen !== Screen.WORDFIND) return;
  state.locked = false;
  render();
}

function finishRound() {
  if (!state.currentRound) return;
  const pts = (state.currentRound.quiz ?? 0) + (state.currentRound.word ?? 0);
  state.totalScore += pts;
  state.roundScores.push({ ...state.currentRound, total: pts });
  state.currentRound = null;
  state.gridData = null;
  state.locked = false;
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.quizReveal = null;
  state.shuffledQuiz = null;
  state.revealTarget = false;
  clearGridHandlers();
  state.questionIndex++;

  if (state.questionIndex >= state.roundQuestions.length) {
    endGame();
  } else {
    state.screen = Screen.QUIZ;
    startQuizClock();
    render();
  }
}

const SCORE_DB_KEY = "phonepe_score_db";
const SCORE_IDB_NAME = "phonepe_kiosk_db";
const SCORE_IDB_STORE = "scores";

function loadScoreDb() {
  try {
    const raw = localStorage.getItem(SCORE_DB_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveScoreDb(list) {
  localStorage.setItem(SCORE_DB_KEY, JSON.stringify(list));
}

function openScoreIdb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(SCORE_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SCORE_IDB_STORE)) {
        const store = db.createObjectStore(SCORE_IDB_STORE, { keyPath: "id" });
        store.createIndex("employeeId", "employeeId", { unique: false });
        store.createIndex("at", "at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPutScore(rec) {
  return openScoreIdb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SCORE_IDB_STORE, "readwrite");
        tx.objectStore(SCORE_IDB_STORE).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbGetAllScores() {
  return openScoreIdb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SCORE_IDB_STORE, "readonly");
        const req = tx.objectStore(SCORE_IDB_STORE).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbReplaceAllScores(list) {
  return openScoreIdb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SCORE_IDB_STORE, "readwrite");
        const store = tx.objectStore(SCORE_IDB_STORE);
        store.clear();
        list.forEach((rec) => store.put(rec));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

async function hydrateScoreDb() {
  try {
    const local = loadScoreDb();
    let idb = [];
    try {
      idb = await idbGetAllScores();
    } catch {}
    const map = new Map();
    [...local, ...idb].forEach((r) => {
      if (r?.id) map.set(String(r.id), r);
    });
    const merged = [...map.values()].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    saveScoreDb(merged);
    try {
      await idbReplaceAllScores(merged);
    } catch {}
    return merged;
  } catch {
    return loadScoreDb();
  }
}

function saveScoreRecord() {
  if (state.scoreSaved) return;
  if (!state.playerName && !state.playerEmail) return;
  state.scoreSaved = true;
  const rec = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(state.playerName || "").trim(),
    employeeId: String(state.employeeId || "").trim(),
    email: String(state.playerEmail || "").trim(),
    score: Number(state.totalScore) || 0,
    maxScore: roundsPerGame() * sectionPoints() * 2,
    feedback: getScoreFeedback(state.totalScore),
    at: new Date().toISOString(),
    rounds: state.roundScores || [],
  };
  const list = loadScoreDb();
  list.push(rec);
  saveScoreDb(list);
  idbPutScore(rec).catch(() => {});
  fetch("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rec),
  }).catch(() => {});
}

function endGame() {
  clearTimers();
  saveScoreRecord();
  state.screen = Screen.END;
  scheduleIdleReset();
  render();
}

function goStart() {
  recordsOpen = false;
  closeAdminPanel();
  hideVirtualKeyboard();
  clearTimers();
  clearGridHandlers();
  state.screen = Screen.ENTER_DETAILS;
  state.playerName = "";
  state.employeeId = "";
  state.playerEmail = "";
  state.formError = null;
  state.questionIndex = 0;
  state.roundQuestions = [];
  state.totalScore = 0;
  state.roundScores = [];
  state.currentRound = null;
  state.gridData = null;
  state.feedback = null;
  state.locked = false;
  state.quizReveal = null;
  state.shuffledQuiz = null;
  state.revealTarget = false;
  state.scoreSaved = false;
  render();
}

// ---- Selection logic ----
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function sign(n) {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}
function cellsOnLine(a, b) {
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  const sdr = sign(dr);
  const sdc = sign(dc);
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  // Horizontal or vertical only — no diagonals
  if (!(absR === 0 || absC === 0)) return [];
  const steps = Math.max(absR, absC);
  const out = [];
  for (let i = 0; i <= steps; i++) out.push({ r: a.r + sdr * i, c: a.c + sdc * i });
  return out;
}
function readWordFromCells(cells, gridData) {
  // Always read L→R or top→bottom regardless of drag direction.
  const ordered = [...cells].sort((a, b) => (a.r - b.r) || (a.c - b.c));
  return ordered.map(({ r, c }) => gridData.grid[r][c].letter).join("");
}
function whichWordMatch(selectedWord, gridData) {
  return gridData.words.findIndex((w) => w === selectedWord);
}

function flashBad() {
  beep("bad");
  const el = document.querySelector("[data-grid]");
  if (!el) return;
  el.classList.remove("flashBad");
  void el.offsetWidth;
  el.classList.add("flashBad");
}

// ---- Rendering helpers ----
function fmtSeconds(ms) {
  return Math.ceil(ms / 1000);
}
function timerColor(ms, totalMs) {
  const p = ms / totalMs;
  if (p > 0.5) return "good";
  if (p > 0.2) return "warn";
  return "bad";
}

function renderHeader(_title, _subtitle, chips = "") {
  return `
    <header class="header" data-ui="header">
      <button type="button" class="brand" data-ui="logo-wrap" data-home aria-label="Home">
        <img class="logo-img" data-ui="logo" src="./assets/logo.png" alt="PhonePe" width="148" height="40" />
      </button>
      <div class="header-meta" data-ui="header-meta">${chips}</div>
    </header>
  `;
}

/** Global page title — outside white panels, on every screen. */
function renderBrandBanner({ home = false } = {}) {
  if (home) {
    return `
    <div class="brand-banner brand-banner-home" data-ui="brand-banner">
      <p class="brand-banner-welcome" data-ui="brand-welcome">Welcome to the</p>
      <h1 class="brand-banner-title" data-ui="brand-title">Word of Honor!</h1>
    </div>
  `;
  }
  return `
    <div class="brand-banner" data-ui="brand-banner">
      <h1 class="brand-banner-title" data-ui="brand-title">Word of Honor</h1>
    </div>
  `;
}

function renderTimerBlock(remaining, totalMs) {
  const sec = fmtSeconds(remaining);
  const tColor = timerColor(remaining, totalMs);
  const pct = clamp(remaining / totalMs, 0, 1);
  const stroke =
    tColor === "good" ? "var(--pp-good)" : tColor === "warn" ? "var(--pp-warn)" : "var(--pp-bad)";
  const r = 24;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return `
    <div class="timer-block" data-ui="timer">
      <div class="timer-ring" aria-hidden="true">
        <svg viewBox="0 0 56 56">
          <circle class="track" cx="28" cy="28" r="${r}" />
          <circle class="fill" cx="28" cy="28" r="${r}"
            stroke="${stroke}" stroke-dasharray="${circ.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}" />
        </svg>
      </div>
      <div class="timer-info">
        <div class="label">Time left</div>
        <div class="value ${tColor}">${sec}s</div>
        <div class="progress-bar"><div style="width:${(pct * 100).toFixed(1)}%;background:${stroke}"></div></div>
      </div>
    </div>
  `;
}

function displayScore() {
  const pending = state.currentRound?.quiz ?? 0;
  return state.totalScore + pending;
}

function updateTimerHost(totalMs) {
  const host = document.querySelector("[data-timer-host]");
  if (host) host.innerHTML = renderTimerBlock(state.remainingMs, totalMs);
}

function updateWordFindTimerUI() {
  if (state.screen !== Screen.WORDFIND) return;
  updateTimerHost(wordFindSeconds() * 1000);
}

function updateQuizTimerUI() {
  if (state.screen !== Screen.QUIZ) return;
  updateTimerHost(quizSeconds() * 1000);
}

function renderFeedback() {
  // Never show red/warn overlay toasts — only brief success feedback.
  if (!state.feedback || state.feedback.type === "bad" || state.feedback.type === "warn") {
    return "";
  }
  const pts = Number(state.feedback.points) || 0;
  const sparks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 360;
    return `<span class="pts-spark" style="--a:${angle}deg;--d:${0.35 + (i % 4) * 0.08}s;--h:${i % 3}"></span>`;
  }).join("");
  return `
    <div class="pts-celebration" aria-live="polite">
      <div class="pts-burst" aria-hidden="true">${sparks}</div>
      <div class="pts-pop">
        <span class="pts-plus">+</span><span class="pts-num">${pts}</span>
        <span class="pts-label">pts</span>
      </div>
      <div class="feedback feedback-good feedback-animated">${escapeHtml(state.feedback.text)}</div>
    </div>
  `;
}

function buildGridHtml(gridData, interactive = true) {
  const size = gridData.size;
  const large = size > 14 ? " large" : "";
  const selCells =
    interactive && state.selStart && state.selEnd ? cellsOnLine(state.selStart, state.selEnd) : [];
  const selSet = new Set(selCells.map((p) => `${p.r},${p.c}`));
  const revealSet = state.revealTarget
    ? new Set(getTargetPlacementCells().map((p) => `${p.r},${p.c}`))
    : new Set();
  let html = `<div class="grid-fit" data-ui="grid-fit"><div class="grid${large}" data-ui="grid" data-grid data-cols="${size}" style="--cols:${size};--rows:${size}">`;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const key = `${r},${c}`;
      const cell = gridData.grid[r][c];
      const isSel = selSet.has(key);
      const isReveal = revealSet.has(key);
      const cls = [isSel ? "sel" : "", isReveal ? "reveal" : ""].filter(Boolean).join(" ");
      html += `<div class="cell ${cls}" data-cell="${r},${c}" role="button"
        aria-label="Letter ${cell.letter}">${cell.letter}</div>`;
    }
  }
  html += `</div></div>`;
  return html;
}

function renderFlowStep(_step, _total, _label) {
  return "";
}

function renderFormError() {
  if (!state.formError) return "";
  return `<div class="form-error">${escapeHtml(state.formError)}</div>`;
}

function attachFormSubmit(selector, onSubmit) {
  const form = document.querySelector(selector);
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    onSubmit(new FormData(form));
  });
  const input = form.querySelector("input");
  input?.focus();
}

function vkTarget() {
  return vkTargetId ? document.getElementById(vkTargetId) : null;
}

function hideVirtualKeyboard() {
  const root = document.getElementById("vk-root");
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
  document.body.classList.remove("vk-open");
  document.body.style.removeProperty("--vk-h");
}

function focusPlayerField(el) {
  if (!el) return;
  vkTargetId = el.id;
  document.querySelectorAll(".field-input").forEach((n) => n.classList.toggle("vk-focus", n === el));
  try {
    el.focus({ preventScroll: true });
    // Ensure caret shows on kiosk browsers when using on-screen keyboard.
    el.style.caretColor = "var(--pp-purple)";
    const len = el.value.length;
    el.setSelectionRange(len, len);
  } catch {}
  if (virtualKeyboardEnabled() && !adminOpen) showVirtualKeyboard();
}

function vkApplyValue(el, next, caret) {
  const max = Number(el.getAttribute("maxlength")) || 80;
  let value = next.slice(0, max);
  if (el.id === "player-email") value = emailLocalPart(value);
  el.value = value;
  const pos = Math.max(0, Math.min(value.length, caret));
  try {
    el.setSelectionRange(pos, pos);
  } catch {}
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function vkInsert(text) {
  const el = vkTarget();
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
  vkApplyValue(el, next, start + text.length);
}

function vkBackspace() {
  const el = vkTarget();
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  if (start !== end) {
    vkApplyValue(el, `${el.value.slice(0, start)}${el.value.slice(end)}`, start);
    return;
  }
  if (start <= 0) return;
  vkApplyValue(el, `${el.value.slice(0, start - 1)}${el.value.slice(start)}`, start - 1);
}

function vkGoNext() {
  const nameEl = document.getElementById("player-name");
  const emailEl = document.getElementById("player-email");
  if (vkTargetId === "player-name" && emailEl) {
    focusPlayerField(emailEl);
    return;
  }
  document.querySelector("[data-form=details]")?.requestSubmit();
}

function vkKeyLabel(key) {
  if (key.length !== 1) return key;
  return vkShift ? key.toUpperCase() : key.toLowerCase();
}

function showVirtualKeyboard() {
  if (!virtualKeyboardEnabled() || adminOpen) return;
  const root = ensureHost("vk-root", "vk-root");
  const row = (keys, extra = "") =>
    `<div class="vk-row ${extra}">${keys
      .map((k) => {
        if (k === "shift") {
          return `<button type="button" class="vk-key vk-wide ${vkShift ? "is-on" : ""}" data-vk-act="shift">Shift</button>`;
        }
        if (k === "back") {
          return `<button type="button" class="vk-key vk-wide vk-danger" data-vk-act="back">⌫</button>`;
        }
        if (k === "space") {
          return `<button type="button" class="vk-key vk-space" data-vk-act="space">Space</button>`;
        }
        if (k === "next") {
          const last = vkTargetId === "player-email";
          return `<button type="button" class="vk-key vk-wide vk-accent" data-vk-act="next">${last ? "Done" : "Next"}</button>`;
        }
        const label = vkKeyLabel(k);
        return `<button type="button" class="vk-key" data-vk-act="char" data-vk-char="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
      })
      .join("")}</div>`;

  root.hidden = false;
  root.innerHTML = `
    <div class="vk-shell" data-vk>
      ${row(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"])}
      ${row(["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"])}
      ${row(["a", "s", "d", "f", "g", "h", "j", "k", "l"])}
      ${row(["shift", "z", "x", "c", "v", "b", "n", "m", "back"])}
      ${row([".", "_", "-", "+", "@", "space", "next"], "vk-row-action")}
    </div>
  `;
  document.body.classList.add("vk-open");
  requestAnimationFrame(() => {
    const shell = root.querySelector(".vk-shell");
    if (shell) document.body.style.setProperty("--vk-h", `${shell.offsetHeight + 22}px`);
  });
  root.querySelectorAll("[data-vk-act]").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const act = btn.getAttribute("data-vk-act");
      if (act === "shift") {
        vkShift = !vkShift;
        showVirtualKeyboard();
        return;
      }
      if (act === "back") vkBackspace();
      else if (act === "space") vkInsert(" ");
      else if (act === "next") vkGoNext();
      else if (act === "char") {
        vkInsert(btn.getAttribute("data-vk-char") || "");
        if (vkShift) {
          vkShift = false;
          showVirtualKeyboard();
        }
      }
      focusPlayerField(vkTarget());
    });
  });
}

function attachPlayerKeyboard() {
  const inputs = [document.getElementById("player-name"), document.getElementById("player-email")].filter(Boolean);
  const useVk = virtualKeyboardEnabled();
  inputs.forEach((el) => {
    el.setAttribute("autocomplete", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("inputmode", "none");
    if (useVk) {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        focusPlayerField(el);
      });
    } else {
      el.removeAttribute("readonly");
      el.setAttribute("inputmode", el.id === "player-email" ? "email" : "text");
    }
  });
  if (useVk && !adminOpen) {
    const prefer = vkTarget() || document.getElementById("player-name");
    focusPlayerField(prefer);
  } else {
    hideVirtualKeyboard();
    document.getElementById("player-name")?.focus();
  }
}

function handleUsbTyping(e) {
  if (adminOpen || recordsOpen) return false;
  if (state.screen !== Screen.ENTER_DETAILS) return false;
  const el = document.activeElement?.classList?.contains("field-input")
    ? document.activeElement
    : vkTarget();
  if (!el?.classList?.contains("field-input")) return false;

  const mode = getKeyboardMode();
  if (mode === "virtual") {
    e.preventDefault();
    return true;
  }
  if (mode === "usb") return false;
  // both: inject so the OS keyboard stays closed on kiosk TVs
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === "Tab") {
    e.preventDefault();
    vkTargetId = el.id;
    vkGoNext();
    return true;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    vkTargetId = el.id;
    vkGoNext();
    return true;
  }
  if (e.key === "Backspace") {
    e.preventDefault();
    vkTargetId = el.id;
    vkBackspace();
    return true;
  }
  if (e.key === " ") {
    e.preventDefault();
    vkTargetId = el.id;
    vkInsert(" ");
    return true;
  }
  if (e.key.length === 1) {
    e.preventDefault();
    vkTargetId = el.id;
    vkInsert(e.key);
    return true;
  }
  return false;
}

function closeAdminPanel() {
  adminOpen = false;
  const root = document.getElementById("admin-root");
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
  document.body.classList.remove("admin-open");
  if (state.screen === Screen.ENTER_DETAILS && virtualKeyboardEnabled()) {
    showVirtualKeyboard();
    focusPlayerField(vkTarget() || document.getElementById("player-name"));
  }
}

async function openAdminPanel() {
  if (!isAdminLink()) return;
  adminOpen = true;
  hideVirtualKeyboard();
  snapshotDetailsForm();
  const root = ensureHost("admin-root", "admin-root");
  root.hidden = false;
  document.body.classList.add("admin-open");
  await hydrateScoreDb();
  const q = String(root.querySelector("[data-admin-q]")?.value || "").trim().toLowerCase();
  const all = loadScoreDb().slice().reverse();
  const list = q
    ? all.filter(
        (r) =>
          String(r.name || "").toLowerCase().includes(q) ||
          String(r.email || "").toLowerCase().includes(q),
      )
    : all;
  const rows = list
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(formatRecordTime(r.at))}</td>
        <td>${escapeHtml(r.name || "")}</td>
        <td>${escapeHtml(r.email || "")}</td>
        <td><strong>${Number(r.score) || 0}</strong> / ${Number(r.maxScore) || 0}</td>
        <td>${escapeHtml(r.feedback || "")}</td>
      </tr>`,
    )
    .join("");
  const settings = loadSettings();
  const mode = settings.keyboardMode;
  const modeBtn = (id, title, desc) => `
    <button type="button" class="admin-mode ${mode === id ? "is-on" : ""}" data-kb-mode="${id}">
      <strong>${title}</strong>
      <span>${desc}</span>
    </button>`;
  const timerCard = (key, title, hint) => {
    const lim = TIMER_LIMITS[key];
    const value = settings[key];
    const pills = lim.presets
      .map(
        (n) =>
          `<button type="button" class="admin-pill ${value === n ? "is-on" : ""}" data-timer-key="${key}" data-timer-set="${n}">${n}s</button>`,
      )
      .join("");
    return `
      <div class="admin-timer">
        <div class="admin-timer-top">
          <div>
            <strong>${title}</strong>
            <span>${hint}</span>
          </div>
          <div class="admin-step">
            <button type="button" data-timer-key="${key}" data-timer-dir="-">−</button>
            <b>${value}s</b>
            <button type="button" data-timer-key="${key}" data-timer-dir="+">+</button>
          </div>
        </div>
        <div class="admin-pills">${pills}</div>
      </div>`;
  };
  root.innerHTML = `
    <div class="admin-overlay" data-admin>
      <div class="admin-panel">
        <div class="admin-head">
          <div>
            <p class="admin-kicker">Admin</p>
            <h2 class="admin-title">Kiosk controls</h2>
            <p class="admin-sub">Press Ctrl+Shift+L to close. Use a USB keyboard in this panel.</p>
          </div>
          <button type="button" class="btn btn-primary" data-admin-close>Close</button>
        </div>
        <div class="admin-block">
          <h3 class="admin-h">Keyboard in use</h3>
          <div class="admin-modes">
            ${modeBtn("both", "Both", "On-screen keyboard and USB keyboard")}
            ${modeBtn("virtual", "Virtual only", "Touchscreen keyboard. USB typing is off for players.")}
            ${modeBtn("usb", "USB only", "Physical keyboard. Hide the on-screen keyboard.")}
          </div>
        </div>
        <div class="admin-block">
          <h3 class="admin-h">Game timers</h3>
          <div class="admin-timers">
            ${timerCard("quizSeconds", "Question timer", "Time to answer each quiz question")}
            ${timerCard("wordFindSeconds", "Word search timer", "Time to find the hidden keyword")}
            ${timerCard("idleResetSeconds", "Return home", "Wait on the end screen before starting over")}
          </div>
        </div>
        <div class="admin-block admin-records">
          <h3 class="admin-h">Player records</h3>
          <div class="records-toolbar">
            <input data-admin-q class="admin-search" type="search" placeholder="Search name or Email ID" value="${escapeHtml(q)}" />
            <button class="btn btn-primary" type="button" data-csv>Download CSV</button>
            <button class="btn admin-clear" type="button" data-clear-db>Clear</button>
          </div>
          <p class="admin-count">${list.length} of ${all.length} games</p>
          <div class="records-table-wrap">
            ${
              rows
                ? `<table class="records-table">
              <thead><tr><th>Time</th><th>Name</th><th>Email ID</th><th>Score</th><th>Result</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
                : `<p class="records-empty">No scores yet. Play a game to add a record.</p>`
            }
          </div>
        </div>
      </div>
    </div>
  `;
  root.querySelector("[data-admin-close]")?.addEventListener("pointerdown", () => closeAdminPanel());
  root.querySelectorAll("[data-kb-mode]").forEach((btn) => {
    btn.addEventListener("pointerdown", () => {
      snapshotDetailsForm();
      setKeyboardMode(btn.getAttribute("data-kb-mode"));
      render();
      void openAdminPanel();
    });
  });
  const applyTimer = (key, value) => {
    saveSettings({ [key]: clampTimer(key, value) });
    void openAdminPanel();
  };
  root.querySelectorAll("[data-timer-dir]").forEach((btn) => {
    btn.addEventListener("pointerdown", () => {
      const key = btn.getAttribute("data-timer-key");
      const lim = TIMER_LIMITS[key];
      const dir = btn.getAttribute("data-timer-dir") === "+" ? 1 : -1;
      applyTimer(key, loadSettings()[key] + dir * lim.step);
    });
  });
  root.querySelectorAll("[data-timer-set]").forEach((btn) => {
    btn.addEventListener("pointerdown", () => {
      applyTimer(btn.getAttribute("data-timer-key"), btn.getAttribute("data-timer-set"));
    });
  });
  const search = root.querySelector("[data-admin-q]");
  search?.addEventListener("input", () => openAdminPanel());
  search?.focus();
  root.querySelector("[data-csv]")?.addEventListener("pointerdown", () => downloadScoreCsv(list));
  root.querySelector("[data-clear-db]")?.addEventListener("pointerdown", async () => {
    if (!confirm("Clear all score records on this kiosk?")) return;
    saveScoreDb([]);
    try {
      await idbReplaceAllScores([]);
    } catch {}
    void openAdminPanel();
  });
}

function toggleAdminPanel() {
  if (!isAdminLink()) return;
  if (adminOpen) closeAdminPanel();
  else void openAdminPanel();
}

function renderEnterDetails() {
  $app.innerHTML = `
    <div class="screen screen-onboard">
      ${renderHeader()}
      <div class="screen-body form-body">
        ${renderBrandBanner({ home: true })}
        <div class="panel form-card" data-ui="form-card">
          <h2 class="form-title">Enter your details</h2>
          <p class="form-lead">Name and Email ID to begin.${
            virtualKeyboardEnabled() ? " Use the on-screen keyboard or a USB keyboard." : ""
          }</p>
          <form class="player-form" data-form="details">
            <div class="field-group">
              <label class="field-label" for="player-name">Name</label>
              <input id="player-name" class="field-input" name="name" type="text"
                autocomplete="name" enterkeyhint="next" maxlength="60"
                placeholder="Your full name" value="${escapeHtml(state.playerName)}" />
            </div>
            <div class="field-group">
              <label class="field-label" for="player-email">Email ID</label>
              <div class="field-email">
                <input id="player-email" class="field-input" name="email" type="text"
                  inputmode="email" enterkeyhint="go" maxlength="64" autocomplete="email"
                  placeholder="your.name" value="${escapeHtml(emailLocalPart(state.playerEmail))}" />
                <span class="field-email-suffix">${EMAIL_SUFFIX}</span>
              </div>
            </div>
            ${renderFormError()}
            <button class="btn btn-primary" type="submit">Continue</button>
          </form>
        </div>
      </div>
    </div>
  `;
  attachFormSubmit("[data-form=details]", (fd) => {
    const name = String(fd.get("name") || "").trim();
    const emailLocal = emailLocalPart(fd.get("email"));
    const email = toOfficialEmail(emailLocal);
    const nameErr = validateName(name);
    if (nameErr) {
      state.formError = nameErr;
      state.playerName = name;
      state.playerEmail = email;
      vkTargetId = "player-name";
      render();
      return;
    }
    const emailErr = validateEmail(emailLocal);
    if (emailErr) {
      state.formError = emailErr;
      state.playerName = name;
      state.playerEmail = email;
      vkTargetId = "player-email";
      render();
      return;
    }
    state.playerName = name;
    state.employeeId = "";
    state.playerEmail = email;
    goRules();
  });
  document.getElementById("player-email")?.addEventListener("input", (e) => {
    const el = e.target;
    if (el.value.includes("@")) el.value = emailLocalPart(el.value);
  });
  attachPlayerKeyboard();
}

function renderRules() {
  $app.innerHTML = `
    <div class="screen screen-onboard">
      ${renderHeader("", "", playerChip())}
      <div class="screen-body rules-body">
        ${renderBrandBanner({ home: true })}
        <div class="panel rules-panel" data-ui="rules-panel">
          <div class="panel-kicker">Game rules</div>
          <div class="rules-copy">
            <p class="form-lead">
              Test your knowledge, sharp eyes, and speed across 2 interactive rounds.
            </p>
            <div class="rules-round">
              <div class="rules-round-title">Round 1</div>
              <ul>
                <li><strong>Question 1:</strong> Choose the correct answer within 30 seconds to unlock the first Word Search. (An incorrect answer skips the word search and moves you directly to Round 2.)</li>
                <li><strong>Word Search 1:</strong> Find the hidden keyword on the touch screen within 20 seconds to earn extra points! (Drag Left-to-Right or Top-to-Bottom)</li>
              </ul>
            </div>
            <div class="rules-round">
              <div class="rules-round-title">Round 2</div>
              <ul>
                <li><strong>Question 2:</strong> Choose the correct answer within 30 seconds to unlock the final Word Search. (An incorrect answer ends the game.)</li>
                <li><strong>Word Search 2:</strong> Find the final keyword within 20 seconds to maximize your total score!</li>
              </ul>
            </div>
          </div>
          <button class="btn btn-primary" data-start-game>Start the game</button>
        </div>
      </div>
    </div>
  `;
  document.querySelector("[data-start-game]")?.addEventListener("pointerdown", () => {
    try {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {}
    startGame();
  });
}

function renderQuiz() {
  const q = activeQuestion();
  const total = state.roundQuestions.length;
  const reveal = state.quizReveal;
  const shuffled = ensureShuffledQuiz();
  const opts = shuffled.options
    .map((opt, i) => {
      let extra = "";
      if (reveal) {
        if (i === reveal.correct) extra = " quiz-option-correct";
        else if (i === reveal.picked) extra = " quiz-option-wrong";
        else extra = " quiz-option-dim";
      }
      return `
      <button class="quiz-option${extra}" data-opt="${i}" type="button" ${reveal ? "disabled" : ""}>
        <span class="opt-letter">${String.fromCharCode(65 + i)}</span>
        <span class="opt-text">${escapeHtml(opt)}</span>
      </button>`;
    })
    .join("");

  const qLabel = questionLabel(state.questionIndex);
  $app.innerHTML = `
    <div class="screen screen-quiz">
      ${renderHeader(
        "",
        "",
        `<span class="chip chip-strong${state.feedback?.points ? " chip-score-pop" : ""}">Score ${displayScore()}</span> ${playerChip()}`,
      )}
      <div class="screen-body quiz-body">
        ${renderBrandBanner()}
        <div class="panel quiz-card" data-ui="quiz-card">
          <div class="quiz-meta">
            <div data-timer-host class="quiz-timer">${renderTimerBlock(state.remainingMs, quizSeconds() * 1000)}</div>
            <span class="quiz-progress">${qLabel} · ${state.questionIndex + 1} / ${total}</span>
          </div>
          <h2 class="quiz-question">${escapeHtml(q.clue)}</h2>
          <p class="quiz-hint">${
            reveal
              ? reveal.picked === reveal.correct
                ? "Correct — unlocking Find the word"
                : reveal.picked < 0
                  ? "Time's up — green option is correct"
                  : "Incorrect — green option is correct"
              : "Tap the correct answer"
          }</p>
          <div class="quiz-options">${opts}</div>
        </div>
      </div>
      ${renderFeedback()}
    </div>
  `;

  if (!reveal) {
    document.querySelectorAll("[data-opt]").forEach((btn) => {
      btn.addEventListener("pointerdown", () => answerQuiz(parseInt(btn.dataset.opt, 10)));
    });
  }
}

function renderWordFind() {
  const q = activeQuestion();
  const categoryLabel = getCategoryLabel(q);
  const answerLabel = getAnswerLabel(q);
  const totalMs = wordFindSeconds() * 1000;
  const pts = sectionPoints();
  const keywordCount = state.gridData?.words?.length ?? state.roundQuestions.length;
  const gridHtml = buildGridHtml(state.gridData, !state.revealTarget);

  $app.innerHTML = `
    <div class="screen screen-wordfind">
      ${renderHeader(
        "",
        "",
        `<span class="chip chip-strong${state.feedback?.points ? " chip-score-pop" : ""}">Score ${displayScore()}</span> ${playerChip()}`,
      )}
      <div class="screen-body wordfind-body">
        ${renderBrandBanner()}
        <div class="play-layout wordfind-layout">
          <div class="panel puzzle-card" data-ui="puzzle-card">
            <div class="puzzle-top" data-ui="puzzle-top">
              <div data-timer-host>${renderTimerBlock(state.remainingMs, totalMs)}</div>
              <div class="find-target" data-ui="find-target">
                <span class="find-target-label">Find this keyword</span>
                <strong>${escapeHtml(categoryLabel)}</strong>
              </div>
            </div>
            <div class="grid-section" data-ui="grid-section">
              ${gridHtml}
            </div>
            <p class="grid-hint" data-ui="grid-hint">Drag left→right or top→bottom · ${keywordCount} keywords hidden</p>
            <div class="puzzle-rules" data-ui="wordfind-rules">
              <div class="puzzle-footer-col">
                <div class="section-label">Rules</div>
                <ul class="rules-list rules-list-compact">
                  <li>Find this question’s <strong>keyword</strong></li>
                  <li>Both game keywords are in the crossword</li>
                  <li>Correct → <strong>+${pts} pts</strong> · Wrong / timeout → <strong>0 pts</strong></li>
                </ul>
              </div>
              <div class="quiz-recap puzzle-footer-recap" data-ui="wordfind-recap">
                <div class="section-label">You answered</div>
                <p class="recap-q">${escapeHtml(q.clue)}</p>
                <p class="recap-a">✓ ${escapeHtml(answerLabel)}</p>
              </div>
            </div>
          </div>
          <div class="panel rules-card" data-ui="rules-card">
            <div class="section-label">Rules</div>
            <ul class="rules-list">
              <li>Find this question’s <strong>keyword</strong></li>
              <li>Both game keywords are in the crossword</li>
              <li>Correct → <strong>+${pts} pts</strong></li>
              <li>Wrong / timeout → <strong>0 pts</strong></li>
            </ul>
            <div class="quiz-recap" data-ui="quiz-recap">
              <div class="section-label">You answered</div>
              <p class="recap-q">${escapeHtml(q.clue)}</p>
              <p class="recap-a">✓ ${escapeHtml(answerLabel)}</p>
            </div>
          </div>
        </div>
      </div>
      ${renderFeedback()}
    </div>
  `;
  attachGridHandlers();
  syncWordfindLayout();
}

function syncWordfindLayout() {
  const el = document.querySelector(".screen-wordfind");
  if (!el) return;
  const vertical = window.innerHeight >= window.innerWidth || window.innerWidth <= 900;
  el.classList.toggle("is-vertical", vertical);
  el.classList.toggle("is-horizontal", !vertical);
}

function renderEnd() {
  const pts = sectionPoints();
  const maxScore = roundsPerGame() * pts * 2;
  const feedback = getScoreFeedback(state.totalScore);

  $app.innerHTML = `
    <div class="screen screen-end">
      ${renderHeader("", "", playerChip())}
      <div class="screen-body end-body">
        ${renderBrandBanner()}
        <div class="panel end-score-card" data-ui="end-card">
          <div class="player-recap">${escapeHtml(state.playerName)} · ${escapeHtml(state.playerEmail)}</div>
          <div class="final-score">${state.totalScore}</div>
          <div class="final-score-label">out of ${maxScore}</div>
          <div class="end-feedback">${escapeHtml(feedback)}</div>
        </div>
      </div>
    </div>
  `;
}

function formatRecordTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso || "";
  }
}

function downloadScoreCsv(list) {
  const header = ["Time", "Name", "Email ID", "Score", "Max", "Feedback"];
  const lines = [
    header.join(","),
    ...list.map((r) =>
      [r.at, r.name, r.email, r.score, r.maxScore, r.feedback]
        .map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phonepe-scores-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function renderRecords() {
  await hydrateScoreDb();
  const q = String(document.querySelector("[data-records-q]")?.value || "").trim().toLowerCase();
  const all = loadScoreDb().slice().reverse();
  const list = q
    ? all.filter(
        (r) =>
          String(r.name || "").toLowerCase().includes(q) ||
          String(r.email || "").toLowerCase().includes(q),
      )
    : all;
  const rows = list
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(formatRecordTime(r.at))}</td>
        <td>${escapeHtml(r.name || "")}</td>
        <td>${escapeHtml(r.email || "")}</td>
        <td><strong>${Number(r.score) || 0}</strong> / ${Number(r.maxScore) || 0}</td>
        <td>${escapeHtml(r.feedback || "")}</td>
      </tr>`,
    )
    .join("");

  $app.innerHTML = `
    <div class="screen">
      ${renderHeader("", "", `<span class="chip">${all.length} records</span>`)}
      <div class="screen-body form-body">
        ${renderBrandBanner()}
        <div class="panel records-card">
          <div class="panel-kicker">Local database</div>
          <h2 class="form-title">Player records</h2>
          <p class="form-lead">Saved on this kiosk only · Name, Email ID, Score · Ctrl+D to close</p>
          <div class="records-toolbar">
            <input data-records-q type="search" placeholder="Search name or Email ID" value="${escapeHtml(q)}" />
            <button class="btn btn-primary" type="button" data-csv>Download CSV</button>
            <button class="btn" type="button" data-clear-db style="background:#f4ecff;color:var(--pp-purple)">Clear</button>
          </div>
          <p class="records-count">${list.length} of ${all.length} games</p>
          <div class="records-table-wrap">
            ${
              rows
                ? `<table class="records-table">
              <thead><tr><th>Time</th><th>Name</th><th>Email ID</th><th>Score</th><th>Result</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
                : `<p class="records-empty">No scores yet. Play a game to add a record.</p>`
            }
          </div>
        </div>
      </div>
    </div>
  `;
  const search = document.querySelector("[data-records-q]");
  search?.addEventListener("input", () => renderRecords());
  search?.focus();
  document.querySelector("[data-csv]")?.addEventListener("pointerdown", () => downloadScoreCsv(list));
  document.querySelector("[data-clear-db]")?.addEventListener("pointerdown", async () => {
    if (!confirm("Clear all score records on this kiosk?")) return;
    saveScoreDb([]);
    try {
      await idbReplaceAllScores([]);
    } catch {}
    renderRecords();
  });
}

function render() {
  if (!cfg) return;
  if (state.screen !== Screen.ENTER_DETAILS) hideVirtualKeyboard();
  if (recordsOpen || new URLSearchParams(location.search).get("records") === "1") return renderRecords();
  if (state.screen === Screen.ENTER_DETAILS) return renderEnterDetails();
  if (state.screen === Screen.RULES) return renderRules();
  if (state.screen === Screen.QUIZ) return renderQuiz();
  if (state.screen === Screen.WORDFIND) return renderWordFind();
  if (state.screen === Screen.END) return renderEnd();
}

// ---- Grid touch handlers ----
function parseCellAttr(v) {
  const [r, c] = String(v).split(",").map((x) => parseInt(x, 10));
  return { r, c };
}
function nearestCellFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const cell = el?.closest?.("[data-cell]");
  if (!cell) return null;
  return { el: cell, pos: parseCellAttr(cell.getAttribute("data-cell")) };
}

function attachGridHandlers() {
  clearGridHandlers();
  const gridEl = document.querySelector("[data-grid]");
  if (!gridEl) return;

  gridAbort = new AbortController();
  const { signal } = gridAbort;
  let upHandled = false;

  const onDown = (e) => {
    if (state.screen !== Screen.WORDFIND || state.locked) return;
    const hit = nearestCellFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    upHandled = false;
    state.selecting = true;
    state.selStart = hit.pos;
    state.selEnd = hit.pos;
    try {
      gridEl.setPointerCapture(e.pointerId);
    } catch {}
    updateGridSelectionUI();
  };

  const onMove = (e) => {
    if (!state.selecting || state.locked) return;
    const hit = nearestCellFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    state.selEnd = hit.pos;
    updateGridSelectionUI();
  };

  const onUp = () => {
    if (!state.selecting || state.locked || upHandled) return;
    upHandled = true;
    state.selecting = false;
    if (!state.selStart || !state.selEnd) return;

    const cells = cellsOnLine(state.selStart, state.selEnd);
    state.selStart = null;
    state.selEnd = null;
    updateGridSelectionUI();

    if (!cells.length) {
      flashBad();
      return;
    }
    const word = readWordFromCells(cells, state.gridData);
    const match = whichWordMatch(word, state.gridData);
    if (match === -1) {
      flashBad();
      return;
    }
    onWordSelected(match);
  };

  gridEl.addEventListener("pointerdown", onDown, { passive: false, signal });
  gridEl.addEventListener("pointermove", onMove, { passive: false, signal });
  gridEl.addEventListener("pointerup", onUp, { passive: true, signal });
  gridEl.addEventListener("pointercancel", onUp, { passive: true, signal });
}

function updateGridSelectionUI() {
  if (!state.gridData) return;
  const selCells =
    state.selStart && state.selEnd ? cellsOnLine(state.selStart, state.selEnd) : [];
  const selSet = new Set(selCells.map((p) => `${p.r},${p.c}`));
  document.querySelectorAll("[data-cell]").forEach((cell) => {
    const pos = parseCellAttr(cell.getAttribute("data-cell"));
    cell.classList.toggle("sel", selSet.has(`${pos.r},${pos.c}`));
  });
}

// ---- Boot ----
(async function main() {
  hardenKiosk();
  hydrateScoreDb().catch(() => {});
  try {
    cfg = await loadConfig();
    goStart();
  } catch (err) {
    $app.innerHTML = `<div class="screen"><div class="card card-sm" style="margin:40px auto;max-width:600px">
      <h2>Config error</h2><p>${escapeHtml(err.message)}</p></div></div>`;
  }
  $app.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("[data-home]")) return;
    e.preventDefault();
    goStart();
  });
  window.addEventListener("resize", syncWordfindLayout);
  window.addEventListener("orientationchange", () => setTimeout(syncWordfindLayout, 80));
  window.addEventListener(
    "keydown",
    (e) => {
    if (e.key === "Escape" && adminOpen) {
      e.preventDefault();
      closeAdminPanel();
      return;
    }
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.code === "KeyL" || e.key === "l" || e.key === "L")) {
      if (!isAdminLink()) return;
      e.preventDefault();
      toggleAdminPanel();
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.code === "KeyD" || e.key === "d" || e.key === "D")) {
      if (!isAdminLink()) return;
      e.preventDefault();
      recordsOpen = !recordsOpen;
      if (recordsOpen) closeAdminPanel();
      render();
      return;
    }
    handleUsbTyping(e);
    },
    true,
  );
})();
