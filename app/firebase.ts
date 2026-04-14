import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAtSSBoP5s0VsFuoqA1XqkD92Pkr62TYm0",
  authDomain: "bfoffice-89093.firebaseapp.com",
  projectId: "bfoffice-89093",
  storageBucket: "bfoffice-89093.firebasestorage.app",
  messagingSenderId: "743937608762",
  appId: "1:743937608762:web:5d2151f2c3cdf33c277903",
  measurementId: "G-VS67NK7HXM",
  databaseURL: "https://bfoffice-89093-default-rtdb.firebaseio.com",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Sign in anonymously so database rules (auth != null) are satisfied
export const authReady: Promise<void> = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      resolve();
    } else {
      signInAnonymously(auth).catch(console.error);
    }
  });
});
