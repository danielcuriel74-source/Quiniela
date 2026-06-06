import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyB39ejmc36199Xsd9xf1eA6UGZn5ujstCs",
  authDomain: "quiniela-3fe77.firebaseapp.com",
  projectId: "quiniela-3fe77",
  storageBucket: "quiniela-3fe77.firebasestorage.app",
  messagingSenderId: "410238905888",
  appId: "1:410238905888:web:76d796f89610369e5f5645"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);