import { auth, db } from "./firebase-config.js";
import { ROUTE_LABELS } from "./keywords.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const ROUTES = Object.values(ROUTE_LABELS).map(({ title, color }) => ({ title, color }));
const ROUTE_TITLES = ROUTES.map((route) => route.title);
const ROUTE_ALIASES = Object.fromEntries(
  Object.entries(ROUTE_LABELS).map(([key, value]) => [key, value.title])
);
const ACTIVITY_PHASES = ["session2_concept", "session2_classify", "session2_reflect"];

const CONCEPTS = [
  {
    term: "머신러닝",
    description: "데이터를 통해 스스로 학습하는 AI 기술"
  },
  {
    term: "훈련(Training)",
    description: "데이터를 넣어 모델을 학습시키는 과정"
  },
  {
    term: "라벨(Label)",
    description: "데이터에 붙이는 분류 기준 이름\n👉 우리가 방금 키워드에 노선을 붙인 게 바로 라벨링이야!"
  },
  {
    term: "편향(Bias)",
    description: "편향된 데이터로 학습하면 결과도 편향됨"
  },
  {
    term: "오분류(Misclassification)",
    description: "AI가 잘못 분류하는 경우"
  },
  {
    term: "패턴(Pattern)",
    description: "AI가 데이터에서 찾아내는 공통 특징"
  }
];

const views = {
  loading: document.getElementById("loadingView"),
  concept: document.getElementById("conceptView"),
  classify: document.getElementById("classifyView"),
  reflect: document.getElementById("reflectView")
};

const studentBadge = document.getElementById("studentBadge");
const timerBadge = document.getElementById("timerBadge");
const logoutButton = document.getElementById("logoutButton");
const flashcard = document.getElementById("flashcard");
const conceptTerm = document.getElementById("conceptTerm");
const conceptDescription = document.getElementById("conceptDescription");
const conceptProgress = document.getElementById("conceptProgress");
const prevConcept = document.getElementById("prevConcept");
const nextConcept = document.getElementById("nextConcept");
const completeConcept = document.getElementById("completeConcept");
const datasetStatus = document.getElementById("datasetStatus");
const classifyText = document.getElementById("classifyText");
const expectedButtons = document.getElementById("expectedButtons");
const smallModeButton = document.getElementById("smallModeButton");
const largeModeButton = document.getElementById("largeModeButton");
const classifyButton = document.getElementById("classifyButton");
const classificationResult = document.getElementById("classificationResult");
const historyList = document.getElementById("historyList");
const reflectionForm = document.getElementById("reflectionForm");
const reflectionPrediction = document.getElementById("reflectionPrediction");
const classifyReflectionButton = document.getElementById("classifyReflectionButton");
const reflectionStatus = document.getElementById("reflectionStatus");
const completeView = document.getElementById("completeView");
const completionCount = document.getElementById("completionCount");

let student = null;
let conceptIndex = 0;
let seenConcepts = new Set();
let expectedRoute = "";
let selectedMode = "small";
let keywordBank = emptyKeywordBank();
let history = [];
let lastReflectionPrediction = null;
let unsubscribePhase = null;
let unsubscribeReflections = null;
let retryTimer = null;
let countdownTimer = null;
let saveTimer = null;
let lastTimerEndedKey = "";

function parseStudentEmail(email) {
  const match = email.match(/26jj18h(\d{4})@g\.jbedu\.kr/);
  if (!match) return null;

  const code = match[1];
  return {
    grade: code[0],
    classNum: code[1],
    number: code.slice(2)
  };
}

function emptyKeywordBank() {
  return Object.fromEntries(ROUTE_TITLES.map((title) => [title, new Map()]));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function showView(name) {
  Object.entries(views).forEach(([key, view]) => {
    view.classList.toggle("active", key === name);
  });
}

function renderTimer(control = {}) {
  if (countdownTimer) window.clearInterval(countdownTimer);

  if (!control.timerEndsAt) {
    timerBadge.textContent = "타이머 대기";
    return;
  }

  const endsAt = control.timerEndsAt.toDate ? control.timerEndsAt.toDate() : new Date(control.timerEndsAt);
  const endedKey = `${student.classNum}-${endsAt.getTime()}`;

  function tick() {
    const seconds = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 1000));
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    timerBadge.textContent = seconds > 0 ? `남은 시간 ${mm}:${ss}` : "시간 종료";

    if (seconds === 0 && lastTimerEndedKey !== endedKey) {
      lastTimerEndedKey = endedKey;
      alert("시간 종료");
    }
  }

  tick();
  countdownTimer = window.setInterval(tick, 1000);
}

function storageKey(name) {
  return `session2.${name}.${student.uid}`;
}

function readStorage(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function routeColor(title) {
  return ROUTES.find((route) => route.title === title)?.color || "#647084";
}

function normalizeRouteLabel(label) {
  return ROUTE_ALIASES[label] || label;
}

function routeButtonHtml(route, selected = "") {
  const isSelected = route.title === selected ? " selected" : "";
  return `
    <button
      class="route-button${isSelected}"
      type="button"
      data-route="${escapeHtml(route.title)}"
      style="--route-color:${route.color}"
    >
      ${escapeHtml(route.title)}
    </button>
  `;
}

function renderExpectedButtons() {
  expectedButtons.innerHTML = ROUTES.map((route) => routeButtonHtml(route, expectedRoute)).join("");
}

function tokenize(text) {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const chunks = [];
  normalized.forEach((token) => {
    chunks.push(token);
    for (let size = 2; size <= Math.min(4, token.length); size += 1) {
      for (let start = 0; start <= token.length - size; start += 1) {
        chunks.push(token.slice(start, start + size));
      }
    }
  });

  return [...new Set(chunks)];
}

function keywordEntries(mode) {
  const limit = mode === "small" ? 30 : Number.POSITIVE_INFINITY;
  return Object.fromEntries(ROUTE_TITLES.map((title) => [
    title,
    [...keywordBank[title].entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  ]));
}

function classifyWithMode(text, mode) {
  const entries = keywordEntries(mode);
  const tokens = tokenize(text);
  const compactText = text.replace(/\s+/g, "").toLowerCase();
  const scores = Object.fromEntries(ROUTE_TITLES.map((title) => [title, 0]));
  const matches = Object.fromEntries(ROUTE_TITLES.map((title) => [title, []]));

  ROUTE_TITLES.forEach((title) => {
    entries[title].forEach(([keyword, weight]) => {
      const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, "");
      const hit = compactText.includes(normalizedKeyword)
        || tokens.some((token) => normalizedKeyword.includes(token) || token.includes(normalizedKeyword));

      if (hit) {
        scores[title] += weight;
        matches[title].push(keyword);
      }
    });
  });

  const max = Math.max(...Object.values(scores));
  const winners = ROUTE_TITLES.filter((title) => scores[title] === max && max > 0);
  const label = winners.length === 0
    ? "판단 보류"
    : winners.length > 1
      ? "복합 노선"
      : winners[0];
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);

  return {
    mode,
    label,
    winners,
    scores,
    confidence: Object.fromEntries(ROUTE_TITLES.map((title) => [
      title,
      total ? Math.round((scores[title] / total) * 100) : 0
    ])),
    matches
  };
}

function compareText(expected, result) {
  if (!expected) return "예상 노선을 먼저 선택하면 비교할 수 있어요.";
  if (result.label === "복합 노선") {
    return result.winners.includes(expected) ? "예상과 일부 일치 ✅" : "불일치 ❌";
  }
  return expected === result.label ? "일치 ✅" : "불일치 ❌";
}

function resultCard(title, result) {
  const labelColor = result.label === "복합 노선" ? "#7c3aed" : routeColor(result.label);
  return `
    <article class="panel">
      <h2>${escapeHtml(title)}</h2>
      <p><strong style="color:${labelColor}">${escapeHtml(result.label)}</strong></p>
      <p>${escapeHtml(compareText(expectedRoute, result))}</p>
      <div class="bars">
        ${ROUTE_TITLES.map((route) => `
          <div class="bar-row">
            <div class="bar-meta">
              <span>${escapeHtml(route)}</span>
              <span>${result.confidence[route]}%</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="--route-color:${routeColor(route)};width:${result.confidence[route]}%"></div>
            </div>
          </div>
        `).join("")}
      </div>
      <p class="lead">근거: ${escapeHtml(Object.values(result.matches).flat().slice(0, 8).join(", ") || "일치한 키워드 없음")}</p>
    </article>
  `;
}

function renderHistory() {
  historyList.innerHTML = history.length
    ? history.map((item) => `
      <div class="readonly-card">
        <strong>${escapeHtml(item.text)}</strong>
        <p>예상: ${escapeHtml(item.expected || "미선택")} · 소량: ${escapeHtml(item.small.label)} · 대량: ${escapeHtml(item.large.label)}</p>
      </div>
    `).join("")
    : "<p class=\"lead\">아직 분류 이력이 없습니다.</p>";
}

async function loadKeywordBank() {
  keywordBank = emptyKeywordBank();
  const snapshot = await getDocs(collection(db, "classes", student.classNum, "labelings"));
  let resultCount = 0;

  snapshot.forEach((docSnapshot) => {
    const results = docSnapshot.data().results || [];
    results.forEach(({ keyword, label }) => {
      const route = normalizeRouteLabel(label);
      if (!keywordBank[route]) return;
      keywordBank[route].set(keyword, (keywordBank[route].get(keyword) || 0) + 1);
      resultCount += 1;
    });
  });

  datasetStatus.textContent = `우리 반 라벨링 데이터 ${resultCount}개를 불러왔습니다.`;
}

function classifyCurrentText() {
  const text = classifyText.value.trim();
  if (!text) {
    classificationResult.innerHTML = "<div class=\"panel\"><p class=\"lead\">분류할 문장을 입력해주세요.</p></div>";
    return null;
  }

  const small = classifyWithMode(text, "small");
  const large = classifyWithMode(text, "large");
  classificationResult.innerHTML = resultCard("📦 소량 데이터 (30개)", small) + resultCard("📚 대량 데이터 (전체)", large);

  const selected = selectedMode === "small" ? small : large;
  history.unshift({ text, expected: expectedRoute, small, large, selectedMode, selected });
  history = history.slice(0, 8);
  writeStorage(storageKey("history"), history);
  renderHistory();
  return { small, large, selected };
}

function renderConcept() {
  const current = CONCEPTS[conceptIndex];
  conceptTerm.textContent = current.term;
  conceptDescription.innerHTML = escapeHtml(current.description).replace(/\n/g, "<br>");
  conceptProgress.textContent = `${conceptIndex + 1}/${CONCEPTS.length}`;
  flashcard.classList.remove("flipped");
  seenConcepts.add(conceptIndex);
  completeConcept.disabled = seenConcepts.size < CONCEPTS.length;
  prevConcept.disabled = conceptIndex === 0;
  nextConcept.disabled = conceptIndex === CONCEPTS.length - 1;
}

function initConcept() {
  showView("concept");
  renderConcept();
}

async function initClassify() {
  showView("classify");
  renderExpectedButtons();
  history = readStorage(storageKey("history"), []);
  renderHistory();
  await loadKeywordBank();
}

function reflectionDraft() {
  return {
    situationType: document.getElementById("situationType").value,
    lifeGoal: document.getElementById("lifeGoal").value.trim(),
    lifeContext: document.getElementById("lifeContext").value.trim(),
    lifeAction: document.getElementById("lifeAction").value.trim(),
    lifeResult: document.getElementById("lifeResult").value.trim(),
    journalRoute: document.getElementById("journalRoute").value.trim(),
    journalMatch: document.getElementById("journalMatch").value,
    journalReason: document.getElementById("journalReason").value.trim(),
    journalLimit: document.getElementById("journalLimit").value.trim(),
    journalApply: document.getElementById("journalApply").value.trim(),
    prediction: lastReflectionPrediction
  };
}

function fillReflectionDraft(draft) {
  if (!draft) return;
  Object.entries(draft).forEach(([key, value]) => {
    const node = document.getElementById(key);
    if (node && typeof value === "string") node.value = value;
  });
  lastReflectionPrediction = draft.prediction || null;
  renderReflectionPrediction();
}

function setReflectionStatus(text, isError = false) {
  reflectionStatus.textContent = text;
  reflectionStatus.classList.toggle("error", isError);
}

function saveReflectionDraft() {
  setReflectionStatus("저장 중...");
  writeStorage(storageKey("reflectionDraft"), reflectionDraft());
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => setReflectionStatus("임시저장됨 🟢"), 250);
}

function reflectionText() {
  return [
    document.getElementById("lifeGoal").value,
    document.getElementById("lifeContext").value,
    document.getElementById("lifeAction").value,
    document.getElementById("lifeResult").value
  ].join(" ");
}

function renderReflectionPrediction() {
  if (!lastReflectionPrediction) {
    reflectionPrediction.textContent = "분류 결과가 여기에 표시됩니다.";
    return;
  }

  reflectionPrediction.innerHTML = `
    <strong style="color:${routeColor(lastReflectionPrediction.label)}">${escapeHtml(lastReflectionPrediction.label)}</strong>
    <p>대량 데이터 기준으로 내 설명을 분류했습니다.</p>
  `;
  document.getElementById("journalRoute").value = lastReflectionPrediction.label;
}

async function retryPendingReflection() {
  if (!student) return;
  const pending = readStorage(storageKey("reflectionPending"), null);
  if (!pending) return;

  try {
    await setDoc(doc(db, "classes", student.classNum, "reflections", student.uid), {
      ...pending,
      submittedAt: serverTimestamp()
    });
    localStorage.removeItem(storageKey("reflectionPending"));
    localStorage.removeItem(storageKey("reflectionDraft"));
    showComplete();
  } catch (error) {
    setReflectionStatus("임시저장됨, 연결 복구 시 자동 제출", true);
    console.error(error);
  }
}

async function submitReflection() {
  const draft = reflectionDraft();
  const required = [
    draft.lifeGoal,
    draft.lifeContext,
    draft.lifeAction,
    draft.lifeResult,
    draft.journalRoute,
    draft.journalLimit,
    draft.journalApply
  ];

  if (required.some((value) => !value)) {
    setReflectionStatus("상황카드, 분류 결과, 성찰 문항을 모두 입력해주세요.", true);
    return;
  }

  const payload = {
    situationCard: {
      type: draft.situationType,
      goal: draft.lifeGoal,
      context: draft.lifeContext,
      action: draft.lifeAction,
      result: draft.lifeResult,
      prediction: draft.prediction
    },
    journal: {
      classifiedRoute: draft.journalRoute,
      expectedMatched: draft.journalMatch,
      mismatchReason: draft.journalReason,
      aiLimit: draft.journalLimit,
      lifeApplication: draft.journalApply
    }
  };

  try {
    await setDoc(doc(db, "classes", student.classNum, "reflections", student.uid), {
      ...payload,
      submittedAt: serverTimestamp()
    });
    localStorage.removeItem(storageKey("reflectionDraft"));
    localStorage.removeItem(storageKey("reflectionPending"));
    showComplete();
  } catch (error) {
    writeStorage(storageKey("reflectionPending"), payload);
    setReflectionStatus("임시저장됨, 연결 복구 시 자동 제출", true);
    console.error(error);
  }
}

function watchReflectionCount() {
  if (unsubscribeReflections) return;
  unsubscribeReflections = onSnapshot(collection(db, "classes", student.classNum, "reflections"), (snapshot) => {
    completionCount.textContent = `우리 반 전체 제출 현황: ${snapshot.size}/25명 완료`;
  });
}

function showComplete() {
  reflectionForm.style.display = "none";
  completeView.classList.add("active");
  watchReflectionCount();
}

async function initReflect() {
  showView("reflect");
  reflectionForm.style.display = "grid";
  completeView.classList.remove("active");
  await loadKeywordBank();
  fillReflectionDraft(readStorage(storageKey("reflectionDraft"), null));

  const existing = await getDoc(doc(db, "classes", student.classNum, "reflections", student.uid));
  if (existing.exists()) showComplete();
  await retryPendingReflection();
}

function watchPhase() {
  if (unsubscribePhase) unsubscribePhase();

  unsubscribePhase = onSnapshot(doc(db, "classes", student.classNum, "settings", "control"), async (snapshot) => {
    const phase = snapshot.exists() ? snapshot.data().phase : "waiting";
    renderTimer(snapshot.exists() ? snapshot.data() : {});

    if (!ACTIVITY_PHASES.includes(phase)) {
      window.location.href = "index.html";
      return;
    }

    if (phase === "session2_concept") initConcept();
    if (phase === "session2_classify") await initClassify();
    if (phase === "session2_reflect") await initReflect();
  });
}

async function resolveStudent(user) {
  const topLevelStudent = await getDoc(doc(db, "students", user.uid));
  const parsed = parseStudentEmail(user.email || "");
  const data = topLevelStudent.exists() ? topLevelStudent.data() : {};
  const classNum = data.classNum || localStorage.getItem("classNum") || parsed?.classNum;
  const number = data.number || localStorage.getItem("studentNumber") || parsed?.number;
  const name = data.name || localStorage.getItem("studentName") || user.displayName || "학생";

  if (!classNum) {
    window.location.href = "index.html";
    return null;
  }

  return {
    uid: user.uid,
    email: user.email || data.email || "",
    name,
    classNum,
    number: number || ""
  };
}

flashcard.addEventListener("click", () => flashcard.classList.toggle("flipped"));
flashcard.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    flashcard.classList.toggle("flipped");
  }
});

prevConcept.addEventListener("click", () => {
  conceptIndex = Math.max(0, conceptIndex - 1);
  renderConcept();
});

nextConcept.addEventListener("click", () => {
  conceptIndex = Math.min(CONCEPTS.length - 1, conceptIndex + 1);
  renderConcept();
});

completeConcept.addEventListener("click", () => {
  completeConcept.textContent = "확인 완료";
});

expectedButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-route]");
  if (!button) return;
  expectedRoute = button.dataset.route;
  renderExpectedButtons();
});

smallModeButton.addEventListener("click", () => {
  selectedMode = "small";
  smallModeButton.classList.add("selected");
  largeModeButton.classList.remove("selected");
});

largeModeButton.addEventListener("click", () => {
  selectedMode = "large";
  largeModeButton.classList.add("selected");
  smallModeButton.classList.remove("selected");
});

classifyButton.addEventListener("click", classifyCurrentText);

classifyReflectionButton.addEventListener("click", () => {
  lastReflectionPrediction = classifyWithMode(reflectionText(), "large");
  renderReflectionPrediction();
  saveReflectionDraft();
});

reflectionForm.addEventListener("input", saveReflectionDraft);
reflectionForm.addEventListener("change", saveReflectionDraft);
reflectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitReflection();
});

logoutButton.addEventListener("click", async () => {
  if (unsubscribePhase) unsubscribePhase();
  if (unsubscribeReflections) unsubscribeReflections();
  await signOut(auth);
  window.location.href = "index.html";
});

window.addEventListener("online", retryPendingReflection);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  student = await resolveStudent(user);
  if (!student) return;

  studentBadge.textContent = `${student.classNum}반 ${student.number}번 ${student.name}`;
  renderExpectedButtons();
  watchPhase();

  retryTimer = window.setInterval(retryPendingReflection, 15000);
});

window.addEventListener("beforeunload", () => {
  if (retryTimer) window.clearInterval(retryTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
});
