import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';

const form = document.getElementById('loginForm');
const email = document.getElementById('loginEmail');
const password = document.getElementById('loginPassword');
const submit = document.getElementById('loginSubmit');
const message = document.getElementById('loginMessage');
const destination = new URLSearchParams(location.search).get('next') === 'payouts'
  ? './setup-payouts.html'
  : './dashboard/';

function showMessage(text, isError = true) {
  message.textContent = text;
  message.style.color = isError ? '#a42437' : '#216546';
  message.hidden = false;
}

async function isVenueOwner(user) {
  const [venue, business] = await Promise.all([
    getDoc(doc(db, 'venues', user.uid)),
    getDoc(doc(db, 'businessUsers', user.uid)),
  ]);
  return venue.exists() && business.exists() && business.data().accountType === 'venue';
}

onAuthStateChanged(auth, async user => {
  if (!user) return;
  try {
    if (await isVenueOwner(user)) location.replace(destination);
    else {
      await signOut(auth);
      showMessage('This account does not have an AVNT venue dashboard.');
    }
  } catch {
    showMessage('Could not verify this venue account. Please try again.');
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  try {
    const credential = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    if (!(await isVenueOwner(credential.user))) {
      await signOut(auth);
      showMessage('This account does not have an AVNT venue dashboard.');
      return;
    }
    location.replace(destination);
  } catch (error) {
    showMessage(error.code === 'auth/too-many-requests'
      ? 'Too many attempts. Please wait and try again.'
      : 'Could not sign in. Check your email and password.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Log in →';
  }
});

document.getElementById('resetPassword').addEventListener('click', async event => {
  event.preventDefault();
  const address = email.value.trim();
  if (!address) {
    showMessage('Enter your venue account email first.');
    email.focus();
    return;
  }
  try { await sendPasswordResetEmail(auth, address); } catch { /* Do not reveal account existence. */ }
  showMessage('If this email has an AVNT account, a reset link is on its way.', false);
});
