import { auth, db } from "./firebase-config.js";
import { KEYWORDS, ROUTE_LABELS } from "./keywords.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const ROUTES = Object.values(ROUTE_LABELS).map(({ title, color }) => ({ title, color }));
const ACTIVITY_PHASES = ["session1_label", "session1_card"];

const views = {
  loading: document.getElementById("loadingView"),
  label: document.getElementById("labelView"),
  card: document.getElementById("cardView")
};

const studentBadge = document.getElementById("studentBadge");
const timerBadge = document.getElementById("timerBadge");
const logoutButton = document.getElementById("logoutButton");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const keywordText = document.getElementById("keywordText");
const labelButtons = document.getElementById("labelButtons");
const labelStatus = document.getElementById("labelStatus");
const labelComplete = document.getElementById("labelComplete");
const cloudGrid = document.getElementById("cloudGrid");
const disagreementList = document.getElementById("disagreementList");
const cardForm = document.getElementById("cardForm");
const cardRouteButtons = document.getElementById("cardRouteButtons");
const cardSaveStatus = document.getElementById("cardSaveStatus");
const classCardsSection = document.getElementById("classCardsSection");
const classCards = document.getElementById("classCards");

let student = null;
let labelState = null;
let selectedCardRoute = "";
let unsubscribePhase = null;
let unsubscribeLabelings = null;
let unsubscribeCards = null;
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
  return `session1.${name}.${student.uid}`;
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

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
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

function renderRouteButtons() {
  labelButtons.innerHTML = ROUTES.map((route) => routeButtonHtml(route)).join("");
  cardRouteButtons.innerHTML = ROUTES.map((route) => routeButtonHtml(route, selectedCardRoute)).join("");
}

function updateProgress() {
  const total = labelState.order.length;
  const done = labelState.results.length;
  progressText.textContent = `${done}/${total} 완료`;
  progressFill.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
}

function showCurrentKeyword() {
  updateProgress();

  if (labelState.submitted || labelState.results.length >= labelState.order.length) {
    showLabelComplete();
    return;
  }

  keywordText.textContent = labelState.order[labelState.index];
}

function saveLabelState() {
  writeStorage(storageKey("labeling"), labelState);
}

async function loadLabelState() {
  const submittedSnapshot = await getDoc(doc(db, "classes", student.classNum, "labelings", student.uid));
  if (submittedSnapshot.exists()) {
    labelState = {
      order: KEYWORDS,
      index: KEYWORDS.length,
      results: submittedSnapshot.data().results || [],
      submitted: true
    };
    saveLabelState();
    return;
  }

  labelState = readStorage(storageKey("labeling"), null);
  if (!labelState || !Array.isArray(labelState.order)) {
    labelState = {
      order: shuffle(KEYWORDS),
      index: 0,
      results: [],
      submitted: false
    };
  }
}

async function submitLabeling() {
  const payload = {
    results: labelState.results,
    completedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, "classes", student.classNum, "labelings", student.uid), payload);
    labelState.submitted = true;
    saveLabelState();
    localStorage.removeItem(storageKey("labelingPending"));
    labelStatus.textContent = "제출 완료! 선생님을 기다려주세요 ✅";
    labelStatus.classList.remove("error");
    showLabelComplete();
  } catch (error) {
    writeStorage(storageKey("labelingPending"), { results: labelState.results });
    labelStatus.textContent = "임시저장됨, 연결 복구 시 자동 제출";
    labelStatus.classList.add("error");
    console.error(error);
  }
}

async function retryPendingLabeling() {
  if (!student) return;
  const pending = readStorage(storageKey("labelingPending"), null);
  if (!pending) return;

  labelState = labelState || {
    order: KEYWORDS,
    index: KEYWORDS.length,
    results: pending.results,
    submitted: false
  };
  labelState.results = pending.results;
  await submitLabeling();
}

async function chooseLabel(label) {
  const keyword = labelState.order[labelState.index];
  labelState.results.push({ keyword, label });
  labelState.index += 1;
  saveLabelState();

  if (labelState.results.length >= labelState.order.length) {
    await submitLabeling();
    return;
  }

  showCurrentKeyword();
}

function showLabelComplete() {
  keywordText.textContent = "완료";
  updateProgress();
  labelComplete.classList.add("active");
  watchLabelingSummary();
}

function summarizeLabelings(snapshot) {
  const byRoute = Object.fromEntries(ROUTES.map((route) => [route.title, new Map()]));
  const byKeyword = new Map();

  snapshot.forEach((docSnapshot) => {
    const results = docSnapshot.data().results || [];
    results.forEach(({ keyword, label }) => {
      if (!byRoute[label]) return;

      byRoute[label].set(keyword, (byRoute[label].get(keyword) || 0) + 1);
      if (!byKeyword.has(keyword)) byKeyword.set(keyword, new Set());
      byKeyword.get(keyword).add(label);
    });
  });

  return { byRoute, byKeyword };
}

function renderWordCloud(canvas, words, color) {
  const list = words.map(([word, count]) => [word, 14 + count * 8]);
  const fallback = canvas.nextElementSibling;

  fallback.innerHTML = words.length
    ? words.map(([word, count]) => `<span style="font-size:${0.9 + count * 0.12}rem">${escapeHtml(word)} ${count}</span>`).join("")
    : "<span>아직 결과가 없습니다</span>";

  if (!window.WordCloud || !list.length) return;

  window.WordCloud(canvas, {
    list,
    color,
    backgroundColor: "#fbfcff",
    gridSize: 8,
    weightFactor: 1.2,
    fontFamily: "Arial, Noto Sans KR, sans-serif",
    rotateRatio: 0
  });
}

function renderLabelingSummary(snapshot) {
  const { byRoute, byKeyword } = summarizeLabelings(snapshot);

  cloudGrid.innerHTML = ROUTES.map((route, index) => `
    <div class="cloud-card panel">
      <h2 style="color:${route.color}">${escapeHtml(route.title)}</h2>
      <canvas id="cloud-${index}" width="360" height="180"></canvas>
      <div class="word-fallback"></div>
    </div>
  `).join("");

  ROUTES.forEach((route, index) => {
    const words = [...byRoute[route.title].entries()].sort((a, b) => b[1] - a[1]);
    renderWordCloud(document.getElementById(`cloud-${index}`), words, route.color);
  });

  const disagreements = [...byKeyword.entries()]
    .filter(([, labels]) => labels.size > 1)
    .map(([keyword, labels]) => ({ keyword, labels: [...labels] }));

  disagreementList.innerHTML = disagreements.length
    ? disagreements.map(({ keyword, labels }) => `
      <div class="readonly-card">
        <strong>${escapeHtml(keyword)}</strong>
        <p>${labels.map(escapeHtml).join(" · ")}</p>
      </div>
    `).join("")
    : "<p class=\"lead\">아직 엇갈린 키워드가 없습니다.</p>";
}

function watchLabelingSummary() {
  if (unsubscribeLabelings) return;
  unsubscribeLabelings = onSnapshot(
    collection(db, "classes", student.classNum, "labelings"),
    renderLabelingSummary
  );
}

async function initLabeling() {
  showView("label");
  await loadLabelState();
  renderRouteButtons();
  showCurrentKeyword();
  await retryPendingLabeling();
}

function cardDraft() {
  return {
    character: document.getElementById("character").value.trim(),
    label: selectedCardRoute,
    goal: document.getElementById("goal").value.trim(),
    context: document.getElementById("context").value.trim(),
    action: document.getElementById("action").value.trim(),
    result: document.getElementById("result").value.trim()
  };
}

function setCardSaveStatus(text, isError = false) {
  cardSaveStatus.textContent = text;
  cardSaveStatus.classList.toggle("error", isError);
}

function saveCardDraft() {
  setCardSaveStatus("저장 중...");
  writeStorage(storageKey("cardDraft"), cardDraft());
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => setCardSaveStatus("임시저장됨 🟢"), 250);
}

function restoreCardDraft() {
  const draft = readStorage(storageKey("cardDraft"), {});
  ["character", "goal", "context", "action", "result"].forEach((id) => {
    document.getElementById(id).value = draft[id] || "";
  });
  selectedCardRoute = draft.label || "";
  renderRouteButtons();
}

async function submitCard() {
  const payload = cardDraft();
  if (!payload.character || !payload.label || !payload.goal || !payload.context || !payload.action || !payload.result) {
    setCardSaveStatus("모든 항목과 노선을 입력해주세요.", true);
    return;
  }

  setCardSaveStatus("저장 중...");
  await setDoc(doc(db, "classes", student.classNum, "cards", student.uid), {
    ...payload,
    submittedAt: serverTimestamp()
  });
  localStorage.removeItem(storageKey("cardDraft"));
  setCardSaveStatus("제출 완료! 우리 반 카드 목록을 볼 수 있습니다.");
  classCardsSection.classList.add("active");
  watchClassCards();
}

function renderClassCards(snapshot) {
  if (snapshot.empty) {
    classCards.innerHTML = "<p class=\"lead\">아직 제출된 카드가 없습니다.</p>";
    return;
  }

  classCards.innerHTML = "";
  snapshot.forEach((docSnapshot) => {
    const card = docSnapshot.data();
    classCards.insertAdjacentHTML("beforeend", `
      <article class="readonly-card">
        <h2>${escapeHtml(card.character || "이름 없음")} · ${escapeHtml(card.label || "노선 미선택")}</h2>
        <p><strong>목표</strong> ${escapeHtml(card.goal || "")}</p>
        <p><strong>상황</strong> ${escapeHtml(card.context || "")}</p>
        <p><strong>수단/행동</strong> ${escapeHtml(card.action || "")}</p>
        <p><strong>결과/영향</strong> ${escapeHtml(card.result || "")}</p>
      </article>
    `);
  });
}

function watchClassCards() {
  if (unsubscribeCards) return;
  unsubscribeCards = onSnapshot(
    collection(db, "classes", student.classNum, "cards"),
    renderClassCards
  );
}

async function initCard() {
  showView("card");
  restoreCardDraft();

  const existing = await getDoc(doc(db, "classes", student.classNum, "cards", student.uid));
  if (existing.exists()) {
    classCardsSection.classList.add("active");
    watchClassCards();
  }
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

    if (phase === "session1_label") await initLabeling();
    if (phase === "session1_card") await initCard();
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

labelButtons.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-route]");
  if (!button || !labelState || labelState.submitted) return;
  await chooseLabel(button.dataset.route);
});

cardRouteButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-route]");
  if (!button) return;

  selectedCardRoute = button.dataset.route;
  renderRouteButtons();
  saveCardDraft();
});

cardForm.addEventListener("input", saveCardDraft);

cardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await submitCard();
  } catch (error) {
    setCardSaveStatus("저장에 실패했습니다. 임시저장된 내용을 확인해주세요.", true);
    console.error(error);
  }
});

logoutButton.addEventListener("click", async () => {
  if (unsubscribePhase) unsubscribePhase();
  if (unsubscribeLabelings) unsubscribeLabelings();
  if (unsubscribeCards) unsubscribeCards();
  await signOut(auth);
  window.location.href = "index.html";
});

window.addEventListener("online", retryPendingLabeling);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  student = await resolveStudent(user);
  if (!student) return;

  studentBadge.textContent = `${student.classNum}반 ${student.number}번 ${student.name}`;
  renderRouteButtons();
  watchPhase();

  retryTimer = window.setInterval(retryPendingLabeling, 15000);
});

window.addEventListener("beforeunload", () => {
  if (retryTimer) window.clearInterval(retryTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
});
