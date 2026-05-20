import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// TODO: Firebase 콘솔에서 복사한 값으로 교체
const firebaseConfig = {
  apiKey: "TODO",
  authDomain: "TODO",
  projectId: "TODO",
  storageBucket: "TODO",
  messagingSenderId: "TODO",
  appId: "TODO"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
