import { auth, db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { ROUTE_LABELS } from "./keywords.js";

const SYNC_QUEUE_KEY = "independenceLesson.syncQueue";

export const CLASS_NUMS = ["1", "3", "5", "7", "9"];
export const MAX_STUDENTS_PER_CLASS = 25;

export const PHASE_LABELS = {
  waiting: "대기",
  session1_label: "1차시: 키워드 라벨링",
  session1_card: "1차시: 인물카드",
  session2_concept: "2차시: ML 개념",
  session2_classify: "2차시: 분류 체험",
  session2_reflect: "2차시: 성찰일지"
};

export function saveLocal(key, data) {
  localStorage.setItem(key, JSON.stringify({
    data,
    savedAt: new Date().toISOString()
  }));
}

export function loadLocal(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return Object.prototype.hasOwnProperty.call(parsed, "data") ? parsed.data : parsed;
  } catch {
    return null;
  }
}

export function clearLocal(key) {
  localStorage.removeItem(key);
}

function readSyncQueue() {
  return loadLocal(SYNC_QUEUE_KEY) || [];
}

function writeSyncQueue(queue) {
  saveLocal(SYNC_QUEUE_KEY, queue);
}

export function addToSyncQueue(collectionPath, docId, data) {
  const queue = readSyncQueue();
  queue.push({
    collectionPath,
    docId,
    data,
    queuedAt: new Date().toISOString()
  });
  writeSyncQueue(queue);

  if (navigator.onLine) {
    flushSyncQueue();
  }
}

export async function flushSyncQueue() {
  if (!navigator.onLine) return;

  const queue = readSyncQueue();
  if (!queue.length) return;

  const failed = [];
  for (const item of queue) {
    try {
      await setDoc(doc(db, item.collectionPath, item.docId), {
        ...item.data,
        syncedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      failed.push(item);
      console.error("Sync queue item failed", error);
    }
  }

  writeSyncQueue(failed);
}

export function formatDateForFilename(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

window.addEventListener("online", flushSyncQueue);

// Backward-compatible aliases used by earlier page scripts.
export const saveDraft = saveLocal;
export const loadDraft = (key, fallback = null) => {
  const value = loadLocal(key);
  return value === null ? fallback : value;
};
export const clearDraft = clearLocal;

export function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

export function getSelectedClass() {
  return localStorage.getItem("classNum");
}

export function getStudentName() {
  return localStorage.getItem("studentName");
}

export function requireStudent(callback) {
  onAuthStateChanged(auth, (user) => {
    const classNum = getSelectedClass();
    if (!user || !classNum) {
      window.location.href = "index.html";
      return;
    }

    callback({ user, classNum, name: getStudentName() || user.displayName || "학생" });
  });
}

export function watchClassControl(classNum, callback) {
  const ref = doc(db, "classes", classNum, "settings", "control");
  return onSnapshot(ref, (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : { phase: "waiting", timer: 0 });
  });
}

export async function ensureStudentProfile({ user, classNum, name }) {
  await setDoc(doc(db, "classes", classNum, "students", user.uid), {
    name,
    classNum,
    loginAt: serverTimestamp()
  }, { merge: true });
}

export async function isTeacher(uid) {
  const snapshot = await getDoc(doc(db, "teachers", uid));
  return snapshot.exists();
}

export async function countClassDocs(classNum) {
  const [students, labelings, cards, reflections] = await Promise.all([
    getDocs(collection(db, "classes", classNum, "students")),
    getDocs(collection(db, "classes", classNum, "labelings")),
    getDocs(collection(db, "classes", classNum, "cards")),
    getDocs(collection(db, "classes", classNum, "reflections"))
  ]);

  return {
    students: students.size,
    labelings: labelings.size,
    cards: cards.size,
    reflections: reflections.size
  };
}

export function labelOptionHtml(selected = "") {
  return Object.entries(ROUTE_LABELS).map(([key, route]) => {
    const isSelected = key === selected ? "selected" : "";
    return `<option value="${key}" ${isSelected}>${route.title} (${key})</option>`;
  }).join("");
}

export function routeChip(label) {
  const route = ROUTE_LABELS[label] || Object.values(ROUTE_LABELS).find((item) => item.title === label);
  if (!route) return "";
  return `<span class="label-chip" style="color:${route.color}"><span class="label-dot"></span>${route.title}</span>`;
}
