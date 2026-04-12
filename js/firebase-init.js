/* =========================================================
   AttendIT — Firebase Initialization
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAnalytics,
  isSupported,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  query,
  orderByChild,
  equalTo,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAe1UnPoZigA6EjIhiCjh-wjKEJ4GW-xM4",
  authDomain: "attendit-350c6.firebaseapp.com",
  projectId: "attendit-350c6",
  storageBucket: "attendit-350c6.firebasestorage.app",
  databaseURL:
    "https://attendit-350c6-default-rtdb.asia-southeast1.firebasedatabase.app/",
  messagingSenderId: "283239444755",
  appId: "1:283239444755:web:2a935b552530c9d22a2ae6",
  measurementId: "G-F46L87WZFB",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

isSupported().then((yes) => {
  if (yes) getAnalytics(app);
});

export {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  query,
  orderByChild,
  equalTo,
  serverTimestamp,
};
