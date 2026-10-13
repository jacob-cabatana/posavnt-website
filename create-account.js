import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db, functions } from './firebase.js';

const form = document.getElementById('signupForm');
const email = document.getElementById('signupEmail');
const password = document.getElementById('signupPassword');
const confirmation = document.getElementById('confirmPassword');
const submit = document.getElementById('signupSubmit');
const message = document.getElementById('signupMessage');
const createVenue = httpsCallable(functions, 'createPOSVenueAccount');
let submitting = false;

function showMessage(text) {
  message.textContent = text;
  message.style.color = '#a42437';
  message.hidden = false;
}

onAuthStateChanged(auth, async user => {
  if (!user || submitting) return;
  email.value ||= user.email || '';
  try {
    const [venue, business] = await Promise.all([
      getDoc(doc(db, 'venues', user.uid)),
      getDoc(doc(db, 'businessUsers', user.uid)),
    ]);
    if (venue.exists() && business.exists() && business.data().accountType === 'venue') {
      location.replace('./setup-payouts.html');
    }
  } catch {
    // Keep the form available if the connection is interrupted.
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  message.hidden = true;

  const address = email.value.trim();
  if (password.value !== confirmation.value) {
    showMessage('Passwords do not match.');
    confirmation.focus();
    return;
  }
  if (password.value.length < 8) {
    showMessage('Use a password with at least 8 characters.');
    password.focus();
    return;
  }

  submitting = true;
  submit.disabled = true;
  submit.textContent = 'Creating your venue…';
  try {
    let user = auth.currentUser;
    if (user && user.email?.toLowerCase() !== address.toLowerCase()) {
      showMessage('You are signed in with a different email. Log out before creating another venue.');
      return;
    }
    if (!user) {
      try {
        user = (await createUserWithEmailAndPassword(auth, address, password.value)).user;
      } catch (error) {
        if (error.code !== 'auth/email-already-in-use') throw error;
        try {
          // Also lets an owner finish setup if their first attempt was interrupted.
          user = (await signInWithEmailAndPassword(auth, address, password.value)).user;
        } catch {
          showMessage('An account already uses this email. Log in or reset your password.');
          return;
        }
      }
    }

    await createVenue({
      ownerName: document.getElementById('ownerName').value.trim(),
      venueName: document.getElementById('venueName').value.trim(),
      businessType: document.getElementById('businessType').value,
      acceptedTerms: document.getElementById('acceptTerms').checked,
    });
    if (!user.emailVerified) {
      try { await sendEmailVerification(user); } catch { /* Account creation still succeeded. */ }
    }
    location.replace('./setup-payouts.html');
  } catch (error) {
    if (error.code === 'auth/weak-password') showMessage('Choose a stronger password and try again.');
    else if (error.code === 'auth/invalid-email') showMessage('Enter a valid email address.');
    else if (error.code === 'auth/too-many-requests' || error.code === 'functions/resource-exhausted') {
      showMessage('Too many attempts. Please wait a moment and try again.');
    } else if (error.code === 'functions/already-exists') {
      showMessage('This account needs AVNT support before a venue can be created.');
    } else if (error.code === 'functions/unavailable' || error.code === 'auth/network-request-failed') {
      showMessage('Connection lost. Try again—your login is saved, and the venue setup can resume.');
    } else {
      showMessage('Could not finish account setup. Try again or contact AVNT support.');
    }
  } finally {
    submitting = false;
    submit.disabled = false;
    submit.textContent = 'Create account →';
  }
});
