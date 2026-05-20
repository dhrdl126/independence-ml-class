import { auth, db, googleProvider } from "./firebase-config.js";
import { ROUTE_LABELS } from "./keywords.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const CLASS_NUMS = ["1", "3", "5", "7", "9"];
const MAX_STUDENTS = 25;
const ROUTES = Object.values(ROUTE_LABELS).map(({ title, color }) => ({ title, color }));
const ROUTE_TITLES = ROUTES.map((route) => route.title);
const ROUTE_ALIASES = Object.fromEntries(Object.entries(ROUTE_LABELS).map(([key, value]) => [key, value.title]));
const PHASES = [
  { value: "session1_label", label: "▶ 1차시: 라벨링 시작" },
  { value: "session1_card", label: "▶ 1차시: 인물카드 시작" },
  { value: "session2_concept", label: "▶ 2차시: ML 개념 시작" },
  { value: "session2_classify", label: "▶ 2차시: 분류 체험 시작" },
  { value: "session2_reflect", label: "▶ 2차시: 성찰일지 시작" },
  { value: "waiting", label: "⏹ 수업 종료 (대기화면으로)" }
];
const PHASE_LABELS = {
  waiting: "대기 중",
  session1_label: "1차시: 라벨링",
  session1_card: "1차시: 인물카드",
  session2_concept: "2차시: ML 개념",
  session2_classify: "2차시: 분류 체험",
  session2_reflect: "2차시: 성찰일지"
};

const teacherInfo = document.getElementById("teacherInfo");
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const classTabs = document.getElementById("classTabs");
const currentPhase = document.getElementById("currentPhase");
const phaseButtons = document.getElementById("phaseButtons");
const timerMinutes = document.getElementById("timerMinutes");
const startTimerButton = document.getElementById("startTimerButton");
const timerStatus = document.getElementById("timerStatus");
const studentCount = document.getElementById("studentCount");
const labelingCount = document.getElementById("labelingCount");
const cardCount = document.getElementById("cardCount");
const reflectionCount = document.getElementById("reflectionCount");
const studentList = document.getElementById("studentList");
const routeBars = document.getElementById("routeBars");
const disagreementList = document.getElementById("disagreementList");
const cardList = document.getElementById("cardList");
const reflectionList = document.getElementById("reflectionList");
const cloudGrid = document.getElementById("cloudGrid");
const exportAllButton = document.getElementById("exportAllButton");
const exportReflectionsButton = document.getElementById("exportReflectionsButton");
const resetUidInput = document.getElementById("resetUidInput");
const resetStudentButton = document.getElementById("resetStudentButton");
const resetClassButton = document.getElementById("resetClassButton");
const showAnswersButton = document.getElementById("showAnswersButton");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const closeModalButton = document.getElementById("closeModalButton");

let selectedClass = "1";
let currentControl = { phase: "waiting", timer: 0 };
let data = {
  students: [],
  labelings: [],
  cards: [],
  reflections: []
};
let unsubscribers = [];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function normalizeRouteLabel(label) {
  return ROUTE_ALIASES[label] || label || "미선택";
}

function routeColor(title) {
  return ROUTES.find((route) => route.title === title)?.color || "#647084";
}

function formatDate(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function csvDate() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function csvCell(value = "") {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function studentName(uid) {
  return data.students.find((student) => student.id === uid)?.name || "이름 없음";
}

function studentMap() {
  return new Map(data.students.map((student) => [student.id, student]));
}

function openModal(title, bodyHtml) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalBackdrop.classList.add("active");
}

function closeModal() {
  modalBackdrop.classList.remove("active");
}

function renderClassTabs() {
  classTabs.innerHTML = CLASS_NUMS.map((classNum) => `
    <button class="tab-button${classNum === selectedClass ? " active" : ""}" type="button" data-class="${classNum}">
      ${classNum}반
    </button>
  `).join("");
}

function renderPhaseButtons() {
  phaseButtons.innerHTML = PHASES.map((phase) => `
    <button class="phase-button${currentControl.phase === phase.value ? " active" : ""}" type="button" data-phase="${phase.value}">
      ${phase.label}
    </button>
  `).join("");
  currentPhase.textContent = `현재 phase: ${PHASE_LABELS[currentControl.phase] || currentControl.phase || "대기 중"}`;
}

async function setPhase(phase) {
  await setDoc(doc(db, "classes", selectedClass, "settings", "control"), {
    phase,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function startTimer() {
  const minutes = Number(timerMinutes.value) || 10;
  const now = new Date();
  const endsAt = new Date(now.getTime() + minutes * 60 * 1000);

  await setDoc(doc(db, "classes", selectedClass, "settings", "control"), {
    timer: minutes * 60,
    timerStartedAt: Timestamp.fromDate(now),
    timerEndsAt: Timestamp.fromDate(endsAt),
    timerDone: false,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function renderTimer() {
  if (!currentControl.timerEndsAt) {
    timerStatus.textContent = "타이머 대기 중";
    return;
  }

  const endsAt = currentControl.timerEndsAt.toDate ? currentControl.timerEndsAt.toDate() : new Date(currentControl.timerEndsAt);
  const seconds = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  timerStatus.textContent = seconds > 0 ? `남은 시간 ${mm}:${ss}` : "시간 종료";
}

function docsFromSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function stopSnapshots() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function watchClass() {
  stopSnapshots();
  data = { students: [], labelings: [], cards: [], reflections: [] };
  renderAll();

  unsubscribers.push(onSnapshot(doc(db, "classes", selectedClass, "settings", "control"), (snapshot) => {
    currentControl = snapshot.exists() ? { phase: "waiting", ...snapshot.data() } : { phase: "waiting" };
    renderPhaseButtons();
    renderTimer();
  }));

  unsubscribers.push(onSnapshot(collection(db, "classes", selectedClass, "students"), (snapshot) => {
    data.students = docsFromSnapshot(snapshot);
    renderAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "classes", selectedClass, "labelings"), (snapshot) => {
    data.labelings = docsFromSnapshot(snapshot);
    renderAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "classes", selectedClass, "cards"), (snapshot) => {
    data.cards = docsFromSnapshot(snapshot);
    renderAll();
  }));

  unsubscribers.push(onSnapshot(collection(db, "classes", selectedClass, "reflections"), (snapshot) => {
    data.reflections = docsFromSnapshot(snapshot);
    renderAll();
  }));
}

function summarizeLabelings() {
  const routeCounts = Object.fromEntries(ROUTE_TITLES.map((route) => [route, 0]));
  const routeWords = Object.fromEntries(ROUTE_TITLES.map((route) => [route, new Map()]));
  const keywordLabels = new Map();
  let total = 0;

  data.labelings.forEach((docData) => {
    (docData.results || []).forEach(({ keyword, label }) => {
      const route = normalizeRouteLabel(label);
      if (!routeCounts[route]) return;

      routeCounts[route] += 1;
      routeWords[route].set(keyword, (routeWords[route].get(keyword) || 0) + 1);
      if (!keywordLabels.has(keyword)) keywordLabels.set(keyword, new Set());
      keywordLabels.get(keyword).add(route);
      total += 1;
    });
  });

  const disagreements = [...keywordLabels.entries()]
    .filter(([, labels]) => labels.size > 1)
    .map(([keyword, labels]) => ({ keyword, labels: [...labels] }));

  return { routeCounts, routeWords, disagreements, total };
}

function renderStudents() {
  studentCount.textContent = `${data.students.length}명`;
  studentList.innerHTML = data.students.length
    ? data.students.map((student) => `
      <div class="list-row">
        <div>
          <strong>${escapeHtml(student.name || "이름 없음")}</strong>
          <span>${escapeHtml(student.number || "")}번 · ${formatDate(student.loginAt || student.firstLoginAt)}</span>
        </div>
        <button class="small-danger-button" type="button" data-reset-student="${student.id}">
          초기화
        </button>
      </div>
    `).join("")
    : "<p class=\"lead\">아직 접속한 학생이 없습니다.</p>";
}

function renderLabelings() {
  const totalStudents = data.students.length;
  labelingCount.textContent = `${data.labelings.length}/${totalStudents}`;
  const summary = summarizeLabelings();

  routeBars.innerHTML = ROUTE_TITLES.map((route) => {
    const ratio = summary.total ? Math.round((summary.routeCounts[route] / summary.total) * 100) : 0;
    return `
      <div class="bar-row">
        <div class="bar-meta">
          <span>${escapeHtml(route)}</span>
          <span>${ratio}%</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="--route-color:${routeColor(route)};width:${ratio}%"></div>
        </div>
      </div>
    `;
  }).join("");

  disagreementList.innerHTML = summary.disagreements.length
    ? summary.disagreements.map(({ keyword, labels }) => `
      <div class="list-row">
        <strong>${escapeHtml(keyword)}</strong>
        <span>${labels.map(escapeHtml).join(" · ")}</span>
      </div>
    `).join("")
    : "<p class=\"lead\">아직 엇갈린 키워드가 없습니다.</p>";

  renderWordClouds(summary.routeWords);
}

function renderWordClouds(routeWords) {
  cloudGrid.innerHTML = ROUTES.map((route, index) => `
    <div class="cloud-card panel">
      <h2 style="color:${route.color}">${escapeHtml(route.title)}</h2>
      <canvas id="teacher-cloud-${index}" width="360" height="180"></canvas>
      <div class="word-fallback"></div>
    </div>
  `).join("");

  ROUTES.forEach((route, index) => {
    const words = [...routeWords[route.title].entries()].sort((a, b) => b[1] - a[1]);
    const canvas = document.getElementById(`teacher-cloud-${index}`);
    const fallback = canvas.nextElementSibling;
    fallback.innerHTML = words.length
      ? words.slice(0, 20).map(([word, count]) => `<span>${escapeHtml(word)} ${count}</span>`).join("")
      : "<span>결과 없음</span>";

    if (window.WordCloud && words.length) {
      window.WordCloud(canvas, {
        list: words.map(([word, count]) => [word, 14 + count * 8]),
        color: route.color,
        backgroundColor: "#fbfcff",
        gridSize: 8,
        weightFactor: 1.1,
        fontFamily: "Arial, Noto Sans KR, sans-serif",
        rotateRatio: 0
      });
    }
  });
}

function renderCards() {
  cardCount.textContent = `${data.cards.length}명`;
  cardList.innerHTML = data.cards.length
    ? data.cards.map((card) => `
      <button class="list-row clickable-row" type="button" data-card="${card.id}">
        <strong>${escapeHtml(studentName(card.id))}</strong>
        <span>${escapeHtml(card.character || "인물 미입력")} · ${escapeHtml(normalizeRouteLabel(card.label))}</span>
      </button>
    `).join("")
    : "<p class=\"lead\">아직 제출된 인물카드가 없습니다.</p>";
}

function renderReflections() {
  reflectionCount.textContent = `${data.reflections.length}명`;
  reflectionList.innerHTML = data.reflections.length
    ? data.reflections.map((reflection) => `
      <button class="list-row clickable-row" type="button" data-reflection="${reflection.id}">
        <strong>${escapeHtml(studentName(reflection.id))}</strong>
        <span>${escapeHtml(reflection.journal?.classifiedRoute || "분류 결과 없음")} · ${formatDate(reflection.submittedAt)}</span>
      </button>
    `).join("")
    : "<p class=\"lead\">아직 제출된 성찰일지가 없습니다.</p>";
}

function renderAll() {
  renderStudents();
  renderLabelings();
  renderCards();
  renderReflections();
}

function showCardDetail(id) {
  const card = data.cards.find((item) => item.id === id);
  if (!card) return;
  openModal(`${studentName(id)} 인물카드`, `
    <div class="status-list">
      <p><strong>인물</strong> ${escapeHtml(card.character || "")}</p>
      <p><strong>노선</strong> ${escapeHtml(normalizeRouteLabel(card.label))}</p>
      <p><strong>목표</strong> ${escapeHtml(card.goal || "")}</p>
      <p><strong>상황</strong> ${escapeHtml(card.context || "")}</p>
      <p><strong>수단/행동</strong> ${escapeHtml(card.action || "")}</p>
      <p><strong>결과/영향</strong> ${escapeHtml(card.result || "")}</p>
    </div>
  `);
}

function showReflectionDetail(id) {
  const reflection = data.reflections.find((item) => item.id === id);
  if (!reflection) return;
  const situation = reflection.situationCard || {};
  const journal = reflection.journal || {};

  openModal(`${studentName(id)} 성찰일지`, `
    <div class="status-list">
      <h3>개인 상황카드</h3>
      <p><strong>유형</strong> ${escapeHtml(situation.type || "")}</p>
      <p><strong>목표</strong> ${escapeHtml(situation.goal || "")}</p>
      <p><strong>상황</strong> ${escapeHtml(situation.context || "")}</p>
      <p><strong>수단/행동</strong> ${escapeHtml(situation.action || "")}</p>
      <p><strong>결과/영향</strong> ${escapeHtml(situation.result || "")}</p>
      <h3>5문항 답변</h3>
      <p><strong>1. 분류 노선</strong> ${escapeHtml(journal.classifiedRoute || "")}</p>
      <p><strong>2. 예상과 실제</strong> ${escapeHtml(journal.expectedMatched || "")}</p>
      <p><strong>3. 다른 이유</strong> ${escapeHtml(journal.mismatchReason || "")}</p>
      <p><strong>4. AI의 한계</strong> ${escapeHtml(journal.aiLimit || "")}</p>
      <p><strong>5. 삶에 적용</strong> ${escapeHtml(journal.lifeApplication || "")}</p>
    </div>
  `);
}

function showAllAnswers() {
  const questions = [
    ["classifiedRoute", "1. 내가 작성한 합리적 설명은 어떤 노선으로 분류되었는가?"],
    ["expectedMatched", "2. 예상한 결과와 실제 AI 분류 결과가 같았는가?"],
    ["mismatchReason", "3. 결과가 달랐다면 왜 그런 것 같은가?"],
    ["aiLimit", "4. AI의 한계는 무엇이라고 느꼈는가?"],
    ["lifeApplication", "5. 합리적 설명을 내 삶에 적용하면 어떤 점이 도움될 것 같은가?"]
  ];

  openModal("문항별 전체 답변", questions.map(([key, label]) => `
    <section class="readonly-card">
      <h3>${escapeHtml(label)}</h3>
      ${data.reflections.map((reflection) => `
        <p><strong>${escapeHtml(studentName(reflection.id))}</strong>: ${escapeHtml(reflection.journal?.[key] || "")}</p>
      `).join("") || "<p>답변 없음</p>"}
    </section>
  `).join(""));
}

function labelRows() {
  const rows = [["구분", "반", "학생", "학번", "키워드", "라벨", "인물", "문항", "답변"]];
  const students = studentMap();

  data.labelings.forEach((labeling) => {
    const student = students.get(labeling.id) || {};
    (labeling.results || []).forEach((result) => {
      rows.push(["라벨링", selectedClass, student.name || "", student.number || "", result.keyword || "", normalizeRouteLabel(result.label), "", "", ""]);
    });
  });

  data.cards.forEach((card) => {
    const student = students.get(card.id) || {};
    rows.push(["인물카드", selectedClass, student.name || "", student.number || "", "", normalizeRouteLabel(card.label), card.character || "", "목표", card.goal || ""]);
    rows.push(["인물카드", selectedClass, student.name || "", student.number || "", "", normalizeRouteLabel(card.label), card.character || "", "상황", card.context || ""]);
    rows.push(["인물카드", selectedClass, student.name || "", student.number || "", "", normalizeRouteLabel(card.label), card.character || "", "수단/행동", card.action || ""]);
    rows.push(["인물카드", selectedClass, student.name || "", student.number || "", "", normalizeRouteLabel(card.label), card.character || "", "결과/영향", card.result || ""]);
  });

  return rows;
}

function reflectionRows() {
  const rows = [["구분", "반", "학생", "학번", "문항", "답변"]];
  const students = studentMap();

  data.reflections.forEach((reflection) => {
    const student = students.get(reflection.id) || {};
    const situation = reflection.situationCard || {};
    const journal = reflection.journal || {};
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "상황 유형", situation.type || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "목표", situation.goal || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "상황", situation.context || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "수단/행동", situation.action || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "결과/영향", situation.result || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "1. 분류 노선", journal.classifiedRoute || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "2. 예상과 실제", journal.expectedMatched || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "3. 다른 이유", journal.mismatchReason || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "4. AI의 한계", journal.aiLimit || ""]);
    rows.push(["성찰일지", selectedClass, student.name || "", student.number || "", "5. 삶에 적용", journal.lifeApplication || ""]);
  });

  return rows;
}

function downloadCsv(filename, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportAllCsv() {
  downloadCsv(`독립운동수업_${selectedClass}반_${csvDate()}.csv`, [...labelRows(), ...reflectionRows().slice(1)]);
}

function exportReflectionsCsv() {
  downloadCsv(`독립운동수업_성찰일지_${selectedClass}반_${csvDate()}.csv`, reflectionRows());
}

async function deleteStudentSubmissions(uid) {
  await Promise.all([
    deleteDoc(doc(db, "classes", selectedClass, "labelings", uid)),
    deleteDoc(doc(db, "classes", selectedClass, "cards", uid)),
    deleteDoc(doc(db, "classes", selectedClass, "reflections", uid))
  ]);
}

async function resetStudentData() {
  const uid = resetUidInput.value.trim();
  if (!uid) {
    alert("학생 UID를 입력해주세요.");
    return;
  }

  if (!confirm("정말 초기화하시겠습니까?")) return;

  await deleteStudentSubmissions(uid);
  resetUidInput.value = "";
  alert(`${selectedClass}반 학생 데이터가 초기화되었습니다.`);
}

async function resetListedStudentData(uid) {
  const target = data.students.find((student) => student.id === uid);
  const name = target?.name || "해당 학생";

  if (!confirm("정말 초기화하시겠습니까?")) return;

  await deleteStudentSubmissions(uid);
  alert(`${selectedClass}반 ${name} 학생 데이터가 초기화되었습니다.`);
}

async function deleteCollectionDocs(collectionName) {
  const snapshot = await getDocs(collection(db, "classes", selectedClass, collectionName));
  await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
}

async function resetClassData() {
  if (!confirm("정말 초기화하시겠습니까?")) return;

  await Promise.all([
    deleteCollectionDocs("labelings"),
    deleteCollectionDocs("cards"),
    deleteCollectionDocs("reflections")
  ]);
  alert(`${selectedClass}반 전체 제출 데이터가 초기화되었습니다.`);
}

async function verifyTeacher(user) {
  const teacherSnapshot = await getDoc(doc(db, "teachers", user.uid));
  if (!teacherSnapshot.exists()) {
    window.location.href = "index.html";
    return false;
  }

  teacherInfo.textContent = `${user.displayName || user.email} 교사`;
  loginButton.hidden = true;
  logoutButton.hidden = false;
  return true;
}

loginButton.addEventListener("click", () => signInWithPopup(auth, googleProvider));

logoutButton.addEventListener("click", async () => {
  stopSnapshots();
  await signOut(auth);
  window.location.href = "index.html";
});

classTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-class]");
  if (!button) return;

  selectedClass = button.dataset.class;
  renderClassTabs();
  watchClass();
});

phaseButtons.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-phase]");
  if (!button) return;
  await setPhase(button.dataset.phase);
});

startTimerButton.addEventListener("click", startTimer);
exportAllButton.addEventListener("click", exportAllCsv);
exportReflectionsButton.addEventListener("click", exportReflectionsCsv);
resetStudentButton.addEventListener("click", resetStudentData);
resetClassButton.addEventListener("click", resetClassData);
showAnswersButton.addEventListener("click", showAllAnswers);
closeModalButton.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});

studentList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-reset-student]");
  if (!button) return;
  await resetListedStudentData(button.dataset.resetStudent);
});

cardList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-card]");
  if (button) showCardDetail(button.dataset.card);
});

reflectionList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-reflection]");
  if (button) showReflectionDetail(button.dataset.reflection);
});

window.setInterval(renderTimer, 1000);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    teacherInfo.textContent = "교사 Google 로그인이 필요합니다.";
    loginButton.hidden = false;
    logoutButton.hidden = true;
    return;
  }

  const allowed = await verifyTeacher(user);
  if (!allowed) return;

  renderClassTabs();
  renderPhaseButtons();
  watchClass();
});
