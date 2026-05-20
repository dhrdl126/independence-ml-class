import { auth, db, googleProvider } from "./firebase-config.js";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const TARGET_CLASSES = ["1", "3", "5", "7", "9"];
const PHASE_ROUTES = {
  session1_label: "session1.html",
  session1_card: "session1.html",
  session2_concept: "session2.html",
  session2_classify: "session2.html",
  session2_reflect: "session2.html"
};

const screens = {
  loading: document.getElementById("loadingScreen"),
  login: document.getElementById("loginScreen"),
  name: document.getElementById("nameScreen"),
  waiting: document.getElementById("waitingScreen")
};

const googleLoginButton = document.getElementById("googleLoginButton");
const logoutButton = document.getElementById("logoutButton");
const studentNameInput = document.getElementById("studentName");
const studentInfo = document.getElementById("studentInfo");
const authMessage = document.getElementById("authMessage");
const nameMessage = document.getElementById("nameMessage");
const phaseMessage = document.getElementById("phaseMessage");
const loadingMessage = document.getElementById("loadingMessage");
const nameForm = document.getElementById("nameScreen");

let currentStudent = null;
let unsubscribeControl = null;

export function parseStudentEmail(email) {
  const match = email.match(/26jj18h(\d{4})@g\.jbedu\.kr/);
  if (!match) return null;

  const code = match[1];
  return {
    grade: code[0],
    classNum: code[1],
    number: code.slice(2)
  };
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("active", key === name);
  });
}

function showMessage(text, isError = false) {
  authMessage.textContent = text;
  authMessage.classList.toggle("error", isError);
}

function setLoading(text = "계정을 확인하고 있습니다.") {
  loadingMessage.textContent = text;
  showMessage("");
  showScreen("loading");
}

function persistStudent({ name = "", grade, classNum, number, email }) {
  localStorage.setItem("studentName", name);
  localStorage.setItem("grade", grade);
  localStorage.setItem("classNum", classNum);
  localStorage.setItem("studentNumber", number);
  localStorage.setItem("studentEmail", email);
}

async function blockAccess(message) {
  showMessage(message, true);
  logoutButton.hidden = true;
  if (unsubscribeControl) unsubscribeControl();
  localStorage.removeItem("studentName");
  localStorage.removeItem("grade");
  localStorage.removeItem("classNum");
  localStorage.removeItem("studentNumber");
  localStorage.removeItem("studentEmail");
  await signOut(auth);
  showScreen("login");
}

async function checkTeacher(uid) {
  const teacherSnapshot = await getDoc(doc(db, "teachers", uid));
  return teacherSnapshot.exists();
}

async function getStudentProfile(uid) {
  const studentSnapshot = await getDoc(doc(db, "students", uid));
  return studentSnapshot.exists() ? studentSnapshot.data() : null;
}

async function syncClassStudent(uid, profile) {
  await setDoc(doc(db, "classes", profile.classNum, "students", uid), {
    name: profile.name,
    grade: profile.grade,
    classNum: profile.classNum,
    number: profile.number,
    email: profile.email,
    loginAt: serverTimestamp()
  }, { merge: true });
}

function showWaiting(profile) {
  const displayName = profile.name || "이름 미입력";
  persistStudent({ ...profile, name: displayName });
  studentInfo.textContent = `${profile.classNum}반 ${profile.number}번 ${displayName}`;
  logoutButton.hidden = false;
  showMessage("");
  showScreen("waiting");
  watchPhase(profile.classNum);
}

function watchPhase(classNum) {
  if (unsubscribeControl) unsubscribeControl();

  unsubscribeControl = onSnapshot(doc(db, "classes", classNum, "settings", "control"), (snapshot) => {
    const phase = snapshot.exists() ? snapshot.data().phase : "waiting";
    const route = PHASE_ROUTES[phase];

    if (route) {
      window.location.href = route;
      return;
    }

    phaseMessage.textContent = "수업 시작 신호를 기다리고 있습니다.";
  });
}

async function handleStudent(user, parsed) {
  const existingProfile = await getStudentProfile(user.uid);

  currentStudent = {
    uid: user.uid,
    email: user.email,
    grade: parsed.grade,
    classNum: parsed.classNum,
    number: parsed.number
  };

  if (existingProfile?.name) {
    const profile = { ...currentStudent, name: existingProfile.name };
    await Promise.all([
      setDoc(doc(db, "students", user.uid), profile, { merge: true }),
      syncClassStudent(user.uid, profile)
    ]);
    showWaiting(profile);
    return;
  }

  persistStudent(currentStudent);
  logoutButton.hidden = false;
  showMessage("");
  showScreen("name");
}

async function verifyAccount(user) {
  setLoading();
  logoutButton.hidden = false;

  if (!user.email?.endsWith("@g.jbedu.kr")) {
    await blockAccess("학교 계정으로만 접속할 수 있습니다");
    return;
  }

  if (await checkTeacher(user.uid)) {
    window.location.href = "teacher.html";
    return;
  }

  const parsed = parseStudentEmail(user.email);
  if (!parsed) {
    await blockAccess("해당 수업 대상이 아닙니다");
    return;
  }

  if (!TARGET_CLASSES.includes(parsed.classNum)) {
    await blockAccess("해당 수업 대상 반이 아닙니다");
    return;
  }

  await handleStudent(user, parsed);
}

googleLoginButton.addEventListener("click", async () => {
  try {
    setLoading("Google 로그인 창을 여는 중입니다.");
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    showScreen("login");
    showMessage("로그인에 실패했습니다. 잠시 후 다시 시도해주세요.", true);
    console.error(error);
  }
});

logoutButton.addEventListener("click", async () => {
  if (unsubscribeControl) unsubscribeControl();
  await signOut(auth);
  logoutButton.hidden = true;
  showMessage("");
  showScreen("login");
});

nameForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = studentNameInput.value.trim();
  if (!/^[가-힣]{2,5}$/.test(name)) {
    nameMessage.textContent = "한글 이름 2~5자로 입력해주세요.";
    nameMessage.classList.add("error");
    return;
  }

  if (!auth.currentUser || !currentStudent) return;

  setLoading("이름을 저장하고 있습니다.");
  const profile = {
    name,
    grade: currentStudent.grade,
    classNum: currentStudent.classNum,
    number: currentStudent.number,
    email: currentStudent.email,
    firstLoginAt: serverTimestamp()
  };

  await Promise.all([
    setDoc(doc(db, "students", auth.currentUser.uid), profile, { merge: true }),
    syncClassStudent(auth.currentUser.uid, profile)
  ]);
  showWaiting({ ...currentStudent, ...profile, name });
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    logoutButton.hidden = true;
    showScreen("login");
    return;
  }

  try {
    await verifyAccount(user);
  } catch (error) {
    showScreen("login");
    showMessage("계정 확인 중 오류가 발생했습니다. Firebase 설정을 확인해주세요.", true);
    console.error(error);
  }
});
