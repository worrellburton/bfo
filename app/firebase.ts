import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAtSSBoP5s0VsFuoqA1XqkD92Pkr62TYm0",
  authDomain: "bfoffice-89093.firebaseapp.com",
  projectId: "bfoffice-89093",
  storageBucket: "bfoffice-89093.firebasestorage.app",
  messagingSenderId: "743937608762",
  appId: "1:743937608762:web:5d2151f2c3cdf33c277903",
  measurementId: "G-VS67NK7HXM",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
