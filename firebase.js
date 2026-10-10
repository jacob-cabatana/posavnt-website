import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// This configuration is public; AVNT Security Rules protect venue data.
const app = initializeApp({
  apiKey: 'AIzaSyDzL7pUeu5FjDG3K_88lbwhmpdy0kVR33g',
  authDomain: 'avnt-832d8.firebaseapp.com',
  projectId: 'avnt-832d8',
  storageBucket: 'avnt-832d8.firebasestorage.app',
  messagingSenderId: '668414936850',
  appId: '1:668414936850:web:a4e48ae8cf2754c2dc55cb',
});

export const auth = getAuth(app);
export const db = getFirestore(app);
