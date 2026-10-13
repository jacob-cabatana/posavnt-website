import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db, functions } from './firebase.js';

const $ = id => document.getElementById(id);
const startButton = $('startStripe');
const checkButton = $('checkStatus');
const dashboardLink = $('dashboardLink');
const manualLink = $('manualStripeLink');
const passwordArea = $('reauthArea');
const ownerPassword = $('ownerPassword');
const errorMessage = $('errorMessage');
const getStatus = httpsCallable(functions, 'getPOSStripeConnectStatus');
const createLink = httpsCallable(functions, 'createPOSStripeOnboardingLink');
let checking = false;
let starting = false;
let signedInUser = null;

function setStatus(title, detail) {
  $('statusTitle').textContent = title;
  $('statusDetail').textContent = detail;
}

function showError(text) {
  errorMessage.textContent = text;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}

function showReady(testMode) {
  setStatus(
    testMode ? 'Stripe test setup is complete' : 'Your venue is ready for payments',
    testMode
      ? 'This is a test connection only. Real payments and payouts require live Stripe setup later.'
      : 'Stripe has enabled card payments and payouts for this venue.'
  );
  startButton.hidden = true;
  checkButton.hidden = true;
  manualLink.hidden = true;
  dashboardLink.hidden = false;
}

async function refreshStatus() {
  if (!signedInUser || checking || starting) return;
  checking = true;
  checkButton.disabled = true;
  clearError();
  try {
    const { data } = await getStatus();
    $('modeBadge').hidden = !data.testMode;
    if (data.ready) {
      showReady(data.testMode);
      return;
    }
    setStatus(
      data.connected ? 'Stripe needs a little more information' : 'Stripe setup is not complete yet',
      data.testMode
        ? 'AVNT is currently using Stripe test mode. This setup cannot receive real payouts.'
        : data.connected
          ? 'Return to Stripe to complete any remaining bank or business requirements.'
          : 'Add your payout details securely through Stripe to get started.'
    );
    startButton.hidden = false;
    startButton.disabled = false;
    dashboardLink.hidden = true;
    checkButton.hidden = false;
  } catch {
    setStatus('Could not check Stripe right now', 'Your account is saved. Try checking again in a moment.');
    showError('Stripe status is temporarily unavailable. You can retry without creating another AVNT account.');
    startButton.disabled = false;
    checkButton.hidden = false;
  } finally {
    checking = false;
    checkButton.disabled = false;
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace('./client-login.html?next=payouts');
    return;
  }
  signedInUser = user;
  try {
    const [venue, business] = await Promise.all([
      getDoc(doc(db, 'venues', user.uid)),
      getDoc(doc(db, 'businessUsers', user.uid)),
    ]);
    if (!venue.exists() || !business.exists() || business.data().accountType !== 'venue') {
      location.replace('./create-account.html');
      return;
    }
    await refreshStatus();
  } catch {
    setStatus('Could not verify your venue', 'Check your connection and reload this page.');
    showError('We could not load your venue account right now.');
  }
});

checkButton.addEventListener('click', refreshStatus);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && signedInUser && !dashboardLink.hidden) return;
  if (!document.hidden) refreshStatus();
});

startButton.addEventListener('click', async () => {
  if (starting || !signedInUser) return;
  if (!passwordArea.hidden && !ownerPassword.value) {
    showError('Enter your owner password to continue.');
    ownerPassword.focus();
    return;
  }
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  starting = true;
  startButton.disabled = true;
  startButton.textContent = 'Preparing Stripe…';
  clearError();
  try {
    if (!passwordArea.hidden) {
      await reauthenticateWithCredential(
        signedInUser,
        EmailAuthProvider.credential(signedInUser.email, ownerPassword.value)
      );
      ownerPassword.value = '';
      passwordArea.hidden = true;
    }
    const { data } = await createLink();
    if (data.ready) {
      popup?.close();
      starting = false;
      await refreshStatus();
      return;
    }
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || url.hostname !== 'connect.stripe.com') {
      throw new Error('Invalid Stripe onboarding address');
    }
    manualLink.href = url.href;
    manualLink.hidden = false;
    checkButton.hidden = false;
    setStatus('Continue on Stripe', 'Complete your bank and business details in the Stripe tab, then return here to check your status.');
    if (popup && !popup.closed) popup.location.assign(url.href);
    else showError('Your browser blocked the new tab. Use the Open your Stripe setup link below.');
  } catch (error) {
    popup?.close();
    if (error.code === 'functions/permission-denied') {
      passwordArea.hidden = false;
      showError('For security, confirm your owner password before opening Stripe.');
      ownerPassword.focus();
    } else if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      passwordArea.hidden = false;
      showError('That password did not match your owner account. Try again.');
      ownerPassword.focus();
    } else if (error.code === 'functions/failed-precondition') {
      showError(error.message || 'Stripe setup is not available for this venue yet. Contact AVNT support.');
    } else {
      showError('Could not open Stripe right now. Please try again.');
    }
  } finally {
    starting = false;
    startButton.disabled = false;
    startButton.textContent = 'Continue to Stripe →';
  }
});
