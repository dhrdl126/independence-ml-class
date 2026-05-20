import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// TODO: Firebase 콘솔에서 복사한 값으로 교체
const firebaseConfig = {
  const firebaseConfig = {
  apiKey: "AIzaSyCBQ2xJQ9Wh_kVk47FB2maENF_ztiIzWhU",
  authDomain: "independence-ml-class.firebaseapp.com",
  projectId: "independence-ml-class",
  storageBucket: "independence-ml-class.firebasestorage.app",
  messagingSenderId: "905137308621",
  appId: "1:905137308621:web:58b8c16f2e27bac9023a84"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
