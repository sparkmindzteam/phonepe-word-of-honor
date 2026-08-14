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
let state = {
  screen: Screen.ENTER_DETAILS,
  playerName: "",
  employeeId: "",
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
  const id = state.employeeId ? ` · ${escapeHtml(state.employeeId)}` : "";
  return `<span class="chip">${escapeHtml(state.playerName)}${id}</span>`;
}

function validateName(value) {
  const v = String(value || "").trim();
  if (v.length < 2) return "Please enter your name (at least 2 characters).";
  if (v.length > 60) return "Name is too long.";
  return null;
}

function validateEmployeeId(value) {
  const v = String(value || "").trim();
  if (v.length < 2) return "Please enter your Employee ID (at least 2 characters).";
  if (v.length > 30) return "Employee ID is too long.";
  if (!/^[A-Za-z0-9\-_.]+$/.test(v)) return "Employee ID can only use letters, numbers, - _ .";
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

function goReady() {
  state.screen = Screen.START;
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

  state.remainingMs = (cfg.wordFindSeconds ?? 20) * 1000;
  state.wordFindStartedAt = nowMs();
  state.screen = Screen.WORDFIND;
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.locked = false;

  clearTimers();
  state.wordFindTimer = setInterval(() => {
    const elapsed = nowMs() - state.wordFindStartedAt;
    state.remainingMs = Math.max(0, (cfg.wordFindSeconds ?? 20) * 1000 - elapsed);
    if (state.remainingMs <= 0) {
      onWordFindTimeout();
    } else {
      updateWordFindTimerUI();
    }
  }, 200);

  render();
}

async function answerQuiz(optionIndex) {
  if (state.locked || state.screen !== Screen.QUIZ) return;
  state.locked = true;

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
  if (!state.playerName && !state.employeeId) return;
  state.scoreSaved = true;
  const rec = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(state.playerName || "").trim(),
    employeeId: String(state.employeeId || "").trim(),
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
  render();
}

function goStart() {
  recordsOpen = false;
  clearTimers();
  clearGridHandlers();
  state.screen = Screen.ENTER_DETAILS;
  state.playerName = "";
  state.employeeId = "";
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
function renderBrandBanner() {
  return `
    <div class="brand-banner" data-ui="brand-banner">
      <h1 class="brand-banner-title" data-ui="brand-title">Word of Honor</h1>
      <p class="brand-banner-sub" data-ui="brand-sub">Integrity Challenge</p>
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

function updateWordFindTimerUI() {
  if (state.screen !== Screen.WORDFIND) return;
  const totalMs = (cfg.wordFindSeconds ?? 20) * 1000;
  const host = document.querySelector("[data-timer-host]");
  if (host) host.innerHTML = renderTimerBlock(state.remainingMs, totalMs);
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

function renderEnterDetails() {
  $app.innerHTML = `
    <div class="screen screen-onboard">
      ${renderHeader()}
      <div class="screen-body form-body">
        ${renderBrandBanner()}
        <div class="panel form-card" data-ui="form-card">
          <h2 class="form-title">Enter your details</h2>
          <p class="form-lead">Name and Employee ID to begin the Integrity challenge.</p>
          <form class="player-form" data-form="details">
            <div class="field-group">
              <label class="field-label" for="player-name">Name</label>
              <input id="player-name" class="field-input" name="name" type="text"
                autocomplete="name" enterkeyhint="next" maxlength="60"
                placeholder="Your full name" value="${escapeHtml(state.playerName)}" />
            </div>
            <div class="field-group">
              <label class="field-label" for="employee-id">Employee ID</label>
              <input id="employee-id" class="field-input" name="employeeId" type="text"
                inputmode="text" enterkeyhint="go" maxlength="30"
                placeholder="Employee ID" value="${escapeHtml(state.employeeId)}" />
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
    const id = String(fd.get("employeeId") || "").trim();
    const nameErr = validateName(name);
    if (nameErr) {
      state.formError = nameErr;
      state.playerName = name;
      state.employeeId = id;
      render();
      return;
    }
    const idErr = validateEmployeeId(id);
    if (idErr) {
      state.formError = idErr;
      state.playerName = name;
      state.employeeId = id;
      render();
      document.getElementById("employee-id")?.focus();
      return;
    }
    state.playerName = name;
    state.employeeId = id;
    goRules();
  });
}

function renderRules() {
  const pts = sectionPoints();
  const maxScore = roundsPerGame() * pts * 2;
  const wordSec = cfg.wordFindSeconds ?? 20;
  $app.innerHTML = `
    <div class="screen screen-onboard">
      ${renderHeader("", "", playerChip())}
      <div class="screen-body rules-body">
        ${renderBrandBanner()}
        <div class="panel rules-panel" data-ui="rules-panel">
          <div class="panel-kicker">Game rules</div>
          <h2 class="form-title">Play across 4 rounds</h2>
          <p class="form-lead">
            Answer quizzes, then find integrity keywords on the touch screen.
            Each correct section awards <strong>${pts} points</strong> (max ${maxScore}).
          </p>
          <ol class="rules-flow">
            <li><strong>Question 1</strong> — correct answer unlocks Find the word.</li>
            <li><strong>Find the word</strong> — drag left→right or top→bottom (${wordSec}s).</li>
            <li><strong>Question 2</strong> — wrong answer ends the game.</li>
            <li><strong>Final keyword</strong> — maximize your score.</li>
          </ol>
          <div class="rules-grid">
            <div class="rules-box">
              <div class="rules-box-title">Score messages</div>
              <ul class="rules-mini">
                <li>0 — Oops!</li>
                <li>25 — Not bad!</li>
                <li>50 — Good Job!</li>
                <li>75 — Great job!</li>
                <li>100 — Flawless!</li>
              </ul>
            </div>
            <div class="rules-box">
              <div class="rules-box-title">Progression</div>
              <ul class="rules-mini">
                <li>Wrong Q1 → skip word search</li>
                <li>Wrong final Q → game over</li>
                <li>Wrong keyword / timeout → 0 pts</li>
                <li>Words read L→R and top→bottom</li>
              </ul>
            </div>
          </div>
          <button class="btn btn-primary" data-continue>I Understand</button>
        </div>
      </div>
    </div>
  `;
  document.querySelector("[data-continue]")?.addEventListener("pointerdown", goReady);
}

function renderStart() {
  const pts = sectionPoints();
  const maxScore = roundsPerGame() * pts * 2;
  const total = roundsPerGame();
  $app.innerHTML = `
    <div class="screen screen-ready">
      ${renderHeader("", "", playerChip())}
      <div class="start-hero" data-ui="start-hero">
        ${renderBrandBanner()}
        <h2 class="start-hero-title">Ready, <span>${escapeHtml(state.playerName)}</span>?</h2>
        <p class="lead">
          ${total} questions · find the keyword after each correct answer · max
          <strong>${maxScore} points</strong>
        </p>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-title">Answer</div>
            <div class="step-desc">Pick the right option · +${pts} pts</div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-title">Find the word</div>
            <div class="step-desc">Locate the keyword · +${pts} pts</div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-title">Repeat</div>
            <div class="step-desc">Question 2 until the game ends</div>
          </div>
        </div>
        <button class="btn btn-primary btn-hero" data-start>Start Game</button>
      </div>
    </div>
  `;
  document.querySelector("[data-start]")?.addEventListener("pointerdown", () => {
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
            <span class="quiz-topic">${escapeHtml(q.allegation || "Integrity")}</span>
            <span class="quiz-progress">${qLabel} · ${state.questionIndex + 1} / ${total}</span>
          </div>
          <h2 class="quiz-question">${escapeHtml(q.clue)}</h2>
          <p class="quiz-hint">${
            reveal
              ? reveal.picked === reveal.correct
                ? "Correct — unlocking Find the word"
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
  const totalMs = (cfg.wordFindSeconds ?? 20) * 1000;
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

  const rows = state.roundScores
    .map((r, i) => {
      const q = state.roundQuestions[i];
      const qName = questionLabel(i);
      const kwName = "Find the word";
      return `
        <div class="score-row">
          <div class="score-q">${qName}: ${escapeHtml(q.allegation || q.clue)}</div>
          <div class="score-detail">
            ${qName}: ${r.quizCorrect ? `+${r.quiz}` : "0"}
            · ${kwName}: ${r.keywordSkipped ? "NA" : r.quizCorrect ? (r.word > 0 ? `+${r.word}` : "0") : "NA"}
            · <strong>${r.total} pts</strong>
          </div>
        </div>`;
    })
    .join("");

  $app.innerHTML = `
    <div class="screen screen-end">
      ${renderHeader("", "", playerChip())}
      <div class="screen-body end-body">
        ${renderBrandBanner()}
        <div class="panel end-score-card" data-ui="end-card">
          <div class="player-recap">${escapeHtml(state.playerName)} · ${escapeHtml(state.employeeId)}</div>
          <div class="final-score">${state.totalScore}</div>
          <div class="final-score-label">out of ${maxScore}</div>
          <div class="end-feedback">${escapeHtml(feedback)}</div>
          <div class="score-breakdown">${rows}</div>
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
  const header = ["Time", "Name", "Employee ID", "Score", "Max", "Feedback"];
  const lines = [
    header.join(","),
    ...list.map((r) =>
      [r.at, r.name, r.employeeId, r.score, r.maxScore, r.feedback]
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
          String(r.employeeId || "").toLowerCase().includes(q),
      )
    : all;
  const rows = list
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(formatRecordTime(r.at))}</td>
        <td>${escapeHtml(r.name || "")}</td>
        <td>${escapeHtml(r.employeeId || "")}</td>
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
          <p class="form-lead">Saved on this kiosk only · Name, Employee ID, Score · Ctrl+D to close</p>
          <div class="records-toolbar">
            <input data-records-q type="search" placeholder="Search name or Employee ID" value="${escapeHtml(q)}" />
            <button class="btn btn-primary" type="button" data-csv>Download CSV</button>
            <button class="btn" type="button" data-clear-db style="background:#f4ecff;color:var(--pp-purple)">Clear</button>
          </div>
          <p class="records-count">${list.length} of ${all.length} games</p>
          <div class="records-table-wrap">
            ${
              rows
                ? `<table class="records-table">
              <thead><tr><th>Time</th><th>Name</th><th>Employee ID</th><th>Score</th><th>Result</th></tr></thead>
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
  if (recordsOpen || new URLSearchParams(location.search).get("records") === "1") return renderRecords();
  if (state.screen === Screen.ENTER_DETAILS) return renderEnterDetails();
  if (state.screen === Screen.RULES) return renderRules();
  if (state.screen === Screen.START) return renderStart();
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
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.code !== "KeyD" && e.key !== "d" && e.key !== "D") return;
    e.preventDefault();
    recordsOpen = !recordsOpen;
    render();
  });
})();
