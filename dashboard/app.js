import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { Timestamp, addDoc, collection, deleteField, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, updateDoc, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getDownloadURL, ref as storageRef } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import { auth, db, functions, storage } from '../firebase.js';
import { sharedCoffeeImagePath } from './coffee-images.mjs';
import { coffeeStartersToSync, isUnpricedStarter } from './coffee-defaults.mjs';
import { coffeeSizePrices, isEspresso, usesCoffeeSizes, validCoffeeSizePrices } from './coffee-sizes.mjs';
import { coffeeModifierDefaults, coffeeModifierGroups, coffeeModifierTypes, validCoffeeModifierPrice } from './coffee-modifiers.mjs';
import { calculateMetrics } from './metrics.mjs';
import { createHistory } from './history.mjs';
import { createFloor } from './floor.mjs';
import { createTimeClock } from './timeclock.mjs';
import { createInventory, stockInfo } from './inventory.mjs';
import { payoutAlert } from './payout-status.mjs';

const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
const dollars = amount => money(Math.round((Number(amount) || 0) * 100));
const categories = ['hot_coffee', 'iced_coffee', 'cocktails', 'shots', 'beer', 'seltzers', 'wine', 'food', 'non_alcoholic', 'hookah', 'specials', 'modifiers'];
const categoryName = value => ({ hot_coffee: 'Hot coffee', iced_coffee: 'Iced coffee', non_alcoholic: 'Non-alcoholic' })[value] || (value ? value[0].toUpperCase() + value.slice(1) : 'Other');
const bundledDrinkImages = new Set([
  'bud-light', 'corona', 'cosmopolitan', 'dirty-shirley', 'draft-beer', 'espresso-martini',
  'green-tea-shot', 'heineken', 'high-noon', 'jack-and-coke', 'jager-bomb', 'lemon-drop',
  'long-island', 'margarita', 'mojito', 'old-fashioned', 'michelob-ultra', 'miller-lite',
  'red-bull', 'rum-and-coke', 'rum-pineapple', 'rum-shot', 'stella-artois', 'sun-cruiser',
  'tequila-pineapple', 'tequila-shot', 'tequila-soda', 'tequila-sunrise', 'vodka-cranberry',
  'vodka-red-bull', 'vodka-shot', 'vodka-soda', 'vodka-sprite', 'water', 'whiskey-shot',
  'whiskey-sour', 'white-tea-shot', 'yuengling', 'hookah',
]);
function bundledDrinkImage(drink) {
  for (const source of [drink.imagePath, drink.imageUrl, drink.name]) {
    const candidate = String(source || '').split('?')[0].split('/').pop().replace(/\.[^.]+$/, '')
      .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (bundledDrinkImages.has(candidate)) return `./drink-images/${candidate}.png`;
  }
  return drink.category === 'hookah' ? './drink-images/hookah.png' : null;
}
const sharedImageURLs = new Map();
function attachDrinkImage(container, drink) {
  const fallback = bundledDrinkImage(drink);
  const uploaded = typeof drink.imageUrl === 'string' && /^https:\/\//i.test(drink.imageUrl) ? drink.imageUrl : null;
  const sharedPath = uploaded ? null : sharedCoffeeImagePath(drink);
  if (!uploaded && !sharedPath && !fallback) return;

  const image = node('img'); image.alt = ''; image.loading = 'lazy';
  image.addEventListener('error', () => {
    if (fallback && image.src !== new URL(fallback, location.href).href) image.src = fallback;
    else image.remove();
  });
  if (uploaded || fallback) {
    image.src = uploaded || fallback;
    container.append(image);
  }
  if (sharedPath) {
    if (!sharedImageURLs.has(sharedPath)) {
      sharedImageURLs.set(sharedPath, getDownloadURL(storageRef(storage, sharedPath)).catch(() => null));
    }
    sharedImageURLs.get(sharedPath).then(url => {
      if (!url || !container.isConnected) return;
      image.src = url;
      if (!image.isConnected) container.append(image);
    });
  }
}
const state = { uid: null, venue: null, drinks: [], nights: [], specials: [], orders: [], yearOrders: [], yearLoaded: false, yearLoading: false, yearError: false, period: '7', selectedNightId: null, unsubscribers: [], specialUnsubscribe: null, editor: null, coffeeModifierEditing: null, ordersLoaded: false, ordersError: false, settingsDirty: false };
let yearLoadGeneration = 0;

async function loadYearOrders() {
  if (!state.uid || state.yearLoading || state.yearLoaded) return;
  const uid = state.uid;
  const generation = ++yearLoadGeneration;
  state.yearLoading = true;
  state.yearError = false;
  renderAnalytics();
  try {
    // Fetch every page in the requested window; a fixed document cap makes
    // busy venues' annual totals silently wrong.
    const cutoff = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    const base = collection(db, 'venues', uid, 'orders');
    let last = null;
    const result = [];
    while (true) {
      const constraints = [where('createdAt', '>=', Timestamp.fromDate(cutoff)), orderBy('createdAt', 'desc'), limit(500)];
      if (last) constraints.push(startAfter(last));
      const page = await getDocs(query(base, ...constraints));
      if (state.uid !== uid || yearLoadGeneration !== generation) return;
      result.push(...page.docs.map(item => ({ id: item.id, ...item.data() })));
      if (page.size < 500) break;
      last = page.docs[page.docs.length - 1];
    }
    state.yearOrders = result;
    state.yearLoaded = true;
  } catch (error) {
    if (state.uid !== uid || yearLoadGeneration !== generation) return;
    console.error('Could not load full-year sales', error);
    state.yearError = true;
  } finally {
    if (state.uid === uid && yearLoadGeneration === generation) {
      state.yearLoading = false;
      renderAnalytics();
    }
  }
}
const history = createHistory({ db, getUid: () => state.uid, getVenue: () => state.venue, getOrders: () => state.orders });
const floor = createFloor({ db, getUid: () => state.uid });
const clock = createTimeClock({ auth, db, getUid: () => state.uid });
const inventory = createInventory({ auth, db, getUid: () => state.uid, getDrinks: () => state.drinks, attachImage: attachDrinkImage });
let toastTimer;
const getStripeStatus = httpsCallable(functions, 'getPOSStripeConnectStatus');
let payoutCheckInFlight = null;
let lastPayoutCheck = 0;

async function refreshPayoutStatus() {
  if (!state.uid || payoutCheckInFlight === state.uid || Date.now() - lastPayoutCheck < 15000) return;
  const uid = state.uid;
  payoutCheckInFlight = uid;
  lastPayoutCheck = Date.now();
  try {
    const { data } = await getStripeStatus();
    if (state.uid !== uid) return;
    const alert = payoutAlert(data);
    $('payoutAlert').hidden = !alert;
    if (alert) {
      $('payoutAlertTitle').textContent = alert.title;
      $('payoutAlertDetail').textContent = alert.detail;
      $('payoutAlertAction').textContent = alert.action;
    }
  } catch (error) {
    if (state.uid !== uid) return;
    console.error('Could not check Stripe payout status', error);
    $('payoutAlertTitle').textContent = 'Could not verify payout setup';
    $('payoutAlertDetail').textContent = 'Check your Stripe connection before accepting card payments.';
    $('payoutAlertAction').textContent = 'Check Stripe status →';
    $('payoutAlert').hidden = false;
  } finally {
    if (payoutCheckInFlight === uid) payoutCheckInFlight = null;
  }
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function message(text) {
  const toast = $('toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function fail(error, context) {
  console.error(context, error);
  message(`${context}. Please try again.`);
}

function clearListeners() {
  yearLoadGeneration++;
  state.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
  state.specialUnsubscribe?.();
  state.specialUnsubscribe = null;
  floor.stop(); clock.stop(); history.reset(); inventory.stop();
}

function venueRef() { return doc(db, 'venues', state.uid); }
function drinksRef() { return collection(db, 'venues', state.uid, 'drinks'); }
function nightsRef() { return collection(db, 'venues', state.uid, 'nights'); }
function nightRef(id) { return doc(db, 'venues', state.uid, 'nights', id); }
function specialsRef(id) { return collection(db, 'venues', state.uid, 'nights', id, 'specials'); }

async function ensureCoffeeStarters(venueId) {
  const reference = collection(db, 'venues', venueId, 'drinks');
  const snapshot = await getDocs(reference);
  const pending = coffeeStartersToSync(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  for (const starter of pending) {
    const item = doc(reference, `coffee-${starter.slug}`);
    await runTransaction(db, async transaction => {
      const saved = await transaction.get(item);
      if (saved.exists()) {
        if (isUnpricedStarter({ id: item.id, ...saved.data() }, starter)) {
          transaction.update(item, { price: 5,
            sizePrices: { small: 5, medium: 6, large: 7 },
            updatedAt: serverTimestamp() });
        }
        return;
      }
      transaction.set(item, {
        name: starter.name,
        category: starter.category,
        price: 5,
        sizePrices: { small: 5, medium: 6, large: 7 },
        isAvailable: true,
        imagePath: `defaultDrinks/${starter.slug}.png`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }
}

async function ensureCoffeeModifiers(venueId) {
  const reference = collection(db, 'venues', venueId, 'drinks');
  const snapshot = await getDocs(reference);
  const present = new Set(snapshot.docs.map(item => item.id));
  for (const preset of coffeeModifierDefaults) {
    if (present.has(preset.id)) continue;
    const target = doc(reference, preset.id);
    await runTransaction(db, async transaction => {
      if ((await transaction.get(target)).exists()) return;
      transaction.set(target, {
        name: preset.name, category: 'modifiers', price: 0, modifierPricingType: 'fixed',
        modifierScope: 'coffee', modifierGroup: preset.modifierGroup,
        modifierCoffeeType: preset.modifierCoffeeType,
        ...(preset.modifierExclusiveGroup ? { modifierExclusiveGroup: preset.modifierExclusiveGroup } : {}),
        isAvailable: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
  }
}

function listen(reference, onData, context) {
  return onSnapshot(reference, onData, error => fail(error, `Could not load ${context}`));
}

async function start(user) {
  clearListeners();
  state.uid = null;
  state.venue = null;
  state.drinks = []; state.nights = []; state.specials = []; state.orders = [];
  state.yearOrders = []; state.yearLoaded = false; state.yearLoading = false; state.yearError = false;
  state.ordersLoaded = false; state.ordersError = false;
  lastPayoutCheck = 0;
  $('payoutAlert').hidden = true;
  $('appShell').hidden = true; $('authGate').hidden = false;
  $('authGate').textContent = 'Checking your AVNT account…';
  try {
    const [venue, business] = await Promise.all([
      getDoc(doc(db, 'venues', user.uid)),
      getDoc(doc(db, 'businessUsers', user.uid)),
    ]);
    if (!venue.exists() || !business.exists() || business.data().accountType !== 'venue') {
      await signOut(auth);
      $('authGate').textContent = 'This login does not have an AVNT venue dashboard. Returning to sign in…';
      setTimeout(() => location.replace('../client-login.html'), 1800);
      return;
    }
    state.uid = user.uid;
    state.venue = venue.data();
    if (state.venue.businessType === 'coffee_shop') {
      ensureCoffeeStarters(user.uid).catch(error => console.error('Could not add coffee starters', error));
      ensureCoffeeModifiers(user.uid).catch(error => console.error('Could not add coffee modifiers', error));
    }
    $('authGate').hidden = true;
    $('appShell').hidden = false;
    renderVenue();
    refreshPayoutStatus();
    floor.start(user.uid); clock.start(user.uid); inventory.start(user.uid);

    state.unsubscribers.push(listen(venueRef(), snapshot => {
      if (!snapshot.exists()) { $('appShell').hidden = true; $('authGate').hidden = false; $('authGate').textContent = 'Venue account no longer available.'; return; }
      state.venue = snapshot.data();
      renderVenue(); renderNights(); renderAnalytics(); history.render();
    }, 'venue'));
    state.unsubscribers.push(listen(drinksRef(), snapshot => {
      state.drinks = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      renderMenu(); renderCoffeeModifiers(); inventory.render();
    }, 'menu'));
    state.unsubscribers.push(listen(nightsRef(), snapshot => {
      state.nights = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      if (!state.selectedNightId || !state.nights.some(night => night.id === state.selectedNightId)) {
        selectNight(state.venue?.activeNightId || state.nights[0]?.id || null);
      } else renderNights();
    }, 'nights'));
    state.unsubscribers.push(onSnapshot(
      query(collection(db, 'venues', state.uid, 'orders'), orderBy('createdAt', 'desc'), limit(1000)),
      snapshot => {
        state.orders = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        state.ordersLoaded = true; state.ordersError = false; renderAnalytics(); history.render();
      },
      error => { state.ordersError = true; fail(error, 'Could not load sales'); renderAnalytics(); }
    ));
  } catch (error) {
    console.error('Could not verify AVNT owner account', error);
    $('authGate').textContent = 'Could not verify your venue account. Refresh to try again.';
  }
}

function renderVenue() {
  const venue = state.venue || {};
  const name = venue.venueName || venue.businessName || 'Your venue';
  $('topVenue').textContent = name;
  $('setupVenueName').textContent = name === 'Your venue' ? '' : name;
  $('coffeeModifiersTile').hidden = venue.businessType !== 'coffee_shop';
  renderSetupNight();
  if (state.settingsDirty || document.activeElement?.closest('#settingsForm')) return;
  $('settingVenueName').value = name === 'Your venue' ? '' : name;
  const tax = venue.venueTaxRateBps ?? venue.tax?.venueTaxRateBps ?? venue.tax?.salesTaxRateBps;
  $('settingTaxRate').value = Number.isFinite(Number(tax)) && tax !== undefined ? `${(Number(tax) / 100).toFixed(2)}%` : 'Not set';
  $('settingVenuePaysFees').checked = venue.venuePaysPOSFees === true;
  $('settingGratuityEnabled').checked = venue.automaticGratuityEnabled === true;
  $('settingGratuityRate').value = String([500, 1000, 1500, 2000].includes(Number(venue.automaticGratuityRateBps)) ? venue.automaticGratuityRateBps : 1000);
  $('settingTrainingMode').checked = venue.posTrainingModeEnabled === true;
  $('deletionStatus').textContent = venue.accountDeletionRequestedAt ? 'Deletion requested' : 'Account active';
  $('openAccountDeletion').disabled = !!venue.accountDeletionRequestedAt;
}

function setPage(page) {
  document.querySelectorAll('.page').forEach(item => item.classList.toggle('active', item.id === page));
  document.querySelectorAll('[data-page]').forEach(item => {
    const active = item.dataset.page === page;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  document.querySelector('.sidebar').classList.remove('open');
  $('mobileNav').setAttribute('aria-expanded', 'false');
  if (page === 'history') history.render();
  if (page === 'overview') refreshPayoutStatus();
  if (page === 'inventory') inventory.render();
  if (page === 'clock') clock.refreshStatus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAnalytics() {
  if (state.period === '365' && !state.yearLoaded) {
    $('analyticsNotice').hidden = false;
    $('analyticsNotice').textContent = state.yearError ? 'Could not load the full year. Select 1 year again to retry.' : 'Loading the full year of sales…';
    return;
  }
  if (!state.ordersLoaded || state.ordersError) {
    $('analyticsNotice').hidden = false;
    $('analyticsNotice').textContent = state.ordersError ? 'Sales data could not be loaded. Check your connection and refresh.' : 'Loading sales from AVNT…';
    return;
  }
  let zone = state.venue?.timeZone || state.venue?.timezone || 'America/New_York';
  let metrics;
  const metricOrders = state.period === '365'
    ? [...new Map([...state.yearOrders, ...state.orders].map(order => [order.id, order])).values()]
    : state.orders;
  try { metrics = calculateMetrics(metricOrders, state.period, { timeZone: zone }); }
  catch { zone = 'America/New_York'; metrics = calculateMetrics(metricOrders, state.period); }
  $('analyticsNotice').hidden = state.period === '365' || state.orders.length < 1000;
  $('analyticsNotice').textContent = state.period !== '365' && state.orders.length >= 1000 ? 'Showing analytics from the most recent 1,000 order records. Older sales may be excluded.' : '';
  $('periodEyebrow').textContent = state.period === 'tonight' ? '⌁  CURRENT NIGHT' : state.period === '365' ? '⌁  LAST 365 DAYS' : `⌁  LAST ${state.period} DAYS`;
  $('grossSales').textContent = money(metrics.salesCents);
  $('grossCollected').textContent = money(metrics.chargedCents);
  $('mixTotal').textContent = money(metrics.chargedCents);
  $('refunds').textContent = money(metrics.refundedCents);
  $('netCollected').textContent = money(metrics.netCollectedCents);
  $('orderCount').textContent = String(metrics.orders);
  $('itemsSold').textContent = String(metrics.items);
  $('averageSale').textContent = money(metrics.averageSaleCents);
  $('tips').textContent = money(metrics.tipsCents);
  $('tipRate').textContent = `${metrics.salesCents ? (metrics.tipsCents / metrics.salesCents * 100).toFixed(1) : '0.0'}% of sales`;
  $('salesTax').textContent = money(metrics.venueTaxCents + metrics.feeTaxCents);
  $('sellerPeriod').textContent = `Ranked by drink revenue · ${state.period === 'tonight' ? 'tonight' : state.period === '365' ? '1 year' : `${state.period} days`}`;
  $('sellerCount').textContent = `${metrics.items} drinks`;
  renderTrend(metrics, zone);
  renderMix(metrics);
  const sellers = $('bestSellers'); sellers.replaceChildren();
  if (!metrics.topSellers.length) sellers.append(node('p', 'empty-state', 'No paid items in this period.'));
  const topRevenue = Math.max(metrics.topSellers[0]?.revenueCents || 0, 1);
  metrics.topSellers.forEach((seller, index) => {
    const row = node('div', 'seller-row');
    const rank = node('span', 'seller-rank', String(index + 1));
    const main = node('div', 'seller-main');
    const nameRow = node('div', 'seller-name-row');
    nameRow.append(node('strong', '', seller.name), node('small', '', `${seller.quantity} sold`));
    const track = node('div', 'seller-track');
    const fill = node('span', 'seller-fill');
    fill.style.width = `${Math.max(4, seller.revenueCents / topRevenue * 100)}%`;
    track.append(fill); main.append(nameRow, track);
    row.append(rank, main, node('b', 'seller-amount', money(seller.revenueCents)));
    sellers.append(row);
  });
  const recent = $('recentSales'); recent.replaceChildren();
  if (!metrics.ordersList.length) recent.append(node('p', 'empty-state', 'No paid orders in this period.'));
  metrics.ordersList.slice(0, 8).forEach(order => {
    const row = node('div', 'list-row');
    row.append(node('span', 'name', `Order ${order.orderCode || String(order.id || '').slice(0, 6)}`),
      node('span', 'detail', order.saleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      node('strong', '', money(order.chargedCents)));
    recent.append(row);
  });
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function dayKey(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftedDay(key, offset) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function trendSeries(metrics, timeZone) {
  const now = new Date();
  if (state.period === 'tonight') {
    const hour = Number(zonedParts(now, timeZone).hour);
    const finalSlot = Math.min(12, Math.max(7, (hour + 6) % 24 + 2));
    const values = Array(finalSlot).fill(0);
    metrics.ordersList.forEach(order => {
      const orderHour = Number(zonedParts(order.saleDate, timeZone).hour);
      const slot = (orderHour + 6) % 24;
      if (slot < values.length) values[slot] += order.subtotalCents;
    });
    return values.map((value, slot) => ({ label: `${(slot + 5) % 12 + 1}${slot < 6 ? 'p' : 'a'}`, value }));
  }
  const count = Number(state.period);
  const today = dayKey(now, timeZone);
  const byDay = new Map(metrics.dailySales);
  const daily = Array.from({ length: count }, (_, index) => {
    const key = shiftedDay(today, index - count + 1);
    const date = new Date(`${key}T12:00:00Z`);
    const label = count === 7
      ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date)
      : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
    return { label, value: byDay.get(key) || 0 };
  });
  if (count !== 365) return daily;
  return Array.from({ length: 12 }, (_, index) => {
    const chunk = daily.slice(Math.floor(index * 365 / 12), Math.floor((index + 1) * 365 / 12));
    return { label: chunk[0]?.label?.split(' ')[0] || '', value: chunk.reduce((sum, day) => sum + day.value, 0) };
  });
}

function renderTrend(metrics, timeZone) {
  const chart = $('salesChart'); chart.replaceChildren();
  const points = trendSeries(metrics, timeZone);
  const width = 700, top = 12, bottom = 162, max = Math.max(...points.map(point => point.value), 1);
  const coordinates = points.map((point, index) => ({ x: points.length < 2 ? 0 : index * width / (points.length - 1), y: bottom - point.value / max * (bottom - top) }));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 700 175'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const path = (d, className) => { const element = document.createElementNS('http://www.w3.org/2000/svg', 'path'); element.setAttribute('d', d); element.setAttribute('class', className); svg.append(element); };
  for (let index = 0; index <= 3; index++) path(`M0 ${top + index * 50} H700`, 'trend-grid-line');
  const line = coordinates.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  path(`${line} L700 ${bottom} L0 ${bottom} Z`, 'trend-area');
  path(line, 'trend-line');
  coordinates.forEach((point, index) => {
    if (!points[index].value) return;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', point.x); circle.setAttribute('cy', point.y); circle.setAttribute('r', 3.5); circle.setAttribute('class', 'trend-point'); svg.append(circle);
  });
  chart.append(svg);
  const labels = node('div', 'trend-labels');
  const indices = state.period === '30' ? [0, 5, 11, 17, 23, 29] : state.period === '365' ? [0, 2, 4, 6, 8, 11] : points.map((_, index) => index);
  indices.forEach(index => labels.append(node('span', '', points[index]?.label || '')));
  chart.append(labels);
}

function renderMix(metrics) {
  const slices = [
    { label: 'Drink sales', value: metrics.salesCents, color: '#a447f5' },
    { label: 'Tips', value: metrics.tipsCents, color: '#2968df' },
    { label: 'Sales tax', value: metrics.venueTaxCents + metrics.feeTaxCents, color: '#ffb43b' },
    { label: 'POS fees', value: metrics.customerFeeCents, color: '#35c79a' },
  ];
  const partsTotal = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (metrics.chargedCents > partsTotal) slices.push({ label: 'Other', value: metrics.chargedCents - partsTotal, color: '#888' });
  const total = Math.max(partsTotal, metrics.chargedCents, 1);
  let start = 0;
  const stops = slices.filter(slice => slice.value > 0).map(slice => {
    const end = start + slice.value / total * 100;
    const stop = `${slice.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    start = end; return stop;
  });
  $('mixDonut').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(#292929 0 100%)';
  const legend = $('salesMix'); legend.replaceChildren();
  slices.filter(slice => slice.value > 0 || slice.label !== 'Other').forEach(slice => {
    const row = node('div', 'mix-legend-row');
    const swatch = node('i'); swatch.style.background = slice.color;
    row.append(swatch, node('span', '', slice.label), node('strong', '', money(slice.value)));
    legend.append(row);
  });
}

function thumbnail(url, label) {
  const container = node('span', 'thumb', label.slice(0, 1).toUpperCase());
  if (typeof url === 'string' && /^https:\/\//i.test(url)) {
    const image = node('img'); image.src = url; image.alt = ''; image.loading = 'lazy';
    image.addEventListener('load', () => { container.textContent = ''; container.append(image); });
  }
  return container;
}

function itemButton(label, handler) {
  const button = node('button', '', label); button.type = 'button'; button.addEventListener('click', handler); return button;
}

function renderMenu() {
  const search = $('menuSearch').value.trim().toLowerCase();
  const category = $('menuCategory').value;
  const menuItems = state.drinks.filter(drink => drink.modifierScope !== 'coffee');
  const items = menuItems.filter(drink => (category === 'all' || drink.category === category) && String(drink.name || '').toLowerCase().includes(search))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  $('menuSummary').textContent = `${items.length} shown · ${menuItems.length} menu items`;
  const list = $('menuList'); list.replaceChildren();
  if (!items.length) list.append(node('p', 'empty-state', 'No menu items match your filters.'));
  items.forEach(drink => {
    const stock = stockInfo(drink);
    const row = node('article', `menu-tile${drink.isAvailable === false ? ' unavailable' : ''}`);
    const pricing = drink.category === 'modifiers' && drink.modifierPricingType === 'percentage'
      ? `${(Number(drink.modifierPercentageBps) / 100).toFixed(2)}%`
      : usesCoffeeSizes(drink) ? `${dollars(coffeeSizePrices(drink).small)}–${dollars(coffeeSizePrices(drink).large)}`
        : dollars(drink.price);
    const main = itemButton('', () => openEditor('drink', drink));
    main.className = 'menu-tile-main';
    main.setAttribute('aria-label', `Edit ${drink.name || 'menu item'}, ${pricing}`);
    const visual = node('span', 'menu-photo');
    visual.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 9h38L44 35H20L13 9Zm19 26v16m-12 4h24" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    attachDrinkImage(visual, drink);
    const copy = node('span', 'menu-tile-copy');
    copy.append(node('strong', '', drink.name || 'Untitled item'), node('span', '', pricing));
    main.append(visual, node('span', 'menu-shade'), copy);
    if (stock.soldOut || stock.enabled && stock.available === 0) main.append(node('span', 'menu-unavailable', stock.soldOut ? 'SOLD OUT' : 'IN CHECKOUT'));
    else if (Number(drink.price) <= 0 && drink.category !== 'modifiers') main.append(node('span', 'menu-unavailable', 'SET PRICE'));
    else if (drink.isAvailable === false) main.append(node('span', 'menu-unavailable', 'UNAVAILABLE'));
    else if (stock.low) main.append(node('span', 'menu-stock-warning', `${stock.available} left`));
    const footer = node('div', 'menu-tile-footer');
    footer.append(node('span', '', categoryName(drink.category)));
    footer.append(itemButton('Edit', () => openEditor('drink', drink)));
    footer.append(itemButton(Number(drink.price) <= 0 && drink.category !== 'modifiers' ? 'Set price' : drink.isAvailable === false ? 'Show' : 'Hide', async () => {
      if (Number(drink.price) <= 0 && drink.category !== 'modifiers') { openEditor('drink', drink); return; }
      try { await updateDoc(doc(drinksRef(), drink.id), { isAvailable: drink.isAvailable === false, updatedAt: serverTimestamp() }); message('Menu availability updated.'); }
      catch (error) { fail(error, 'Could not update availability'); }
    }));
    row.append(main, footer);
    list.append(row);
  });
}

function renderCoffeeModifiers() {
  const modifiers = state.drinks.filter(item => item.modifierScope === 'coffee');
  $('coffeeModifierCount').textContent = `${modifiers.filter(item => item.isAvailable !== false).length} available`;
  const list = $('coffeeModifierList'); list.replaceChildren();
  for (const group of coffeeModifierGroups) {
    const items = modifiers.filter(item => (item.modifierGroup || 'Extras') === group)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!items.length) continue;
    const section = node('section', 'coffee-modifier-group');
    section.append(node('h3', '', group));
    for (const item of items) {
      const row = itemButton('', () => openCoffeeModifierEditor(item));
      row.className = 'coffee-modifier-row';
      const detail = node('span');
      detail.append(node('strong', '', item.name || 'Unnamed modifier'),
        node('small', '', `${coffeeModifierTypes[item.modifierCoffeeType] || 'All coffee'}${item.isAvailable === false ? ' · Hidden' : ''}`));
      row.append(detail, node('em', '', Number(item.price) === 0 ? 'Free' : dollars(item.price)));
      section.append(row);
    }
    list.append(section);
  }
  if (!modifiers.length) list.append(node('p', 'empty-state', 'Loading coffee options…'));
}

function openCoffeeModifierEditor(item = null) {
  $('coffeeModifiersDialog').close();
  state.coffeeModifierEditing = item;
  $('coffeeModifierEditorTitle').textContent = item ? 'Edit modifier' : 'Add modifier';
  $('coffeeModifierName').value = item?.name || '';
  $('coffeeModifierGroup').value = item?.modifierGroup || 'Syrups';
  $('coffeeModifierType').value = item?.modifierCoffeeType || 'all';
  $('coffeeModifierPrice').value = Number(item?.price || 0).toFixed(2);
  $('coffeeModifierAvailable').checked = item?.isAvailable !== false;
  $('coffeeModifierAvailable').closest('label').hidden = !item;
  $('coffeeModifierError').hidden = true;
  $('coffeeModifierEditor').showModal();
}

async function saveCoffeeModifier(event) {
  event.preventDefault();
  const item = state.coffeeModifierEditing;
  const name = $('coffeeModifierName').value.trim();
  const group = $('coffeeModifierGroup').value;
  const type = $('coffeeModifierType').value;
  const price = Number($('coffeeModifierPrice').value);
  if (!name || !coffeeModifierGroups.includes(group) || !Object.hasOwn(coffeeModifierTypes, type)
      || !validCoffeeModifierPrice(price)) {
    $('coffeeModifierError').textContent = 'Enter a name and a valid upcharge in cents.';
    $('coffeeModifierError').hidden = false; return;
  }
  const save = $('saveCoffeeModifier'); save.disabled = true; save.textContent = 'Saving…';
  try {
    const exclusive = item?.modifierGroup === group ? item?.modifierExclusiveGroup || null
      : group === 'Milk' ? 'milk' : null;
    const data = { name, modifierGroup: group, modifierCoffeeType: type,
      modifierExclusiveGroup: exclusive || deleteField(), price: Math.round(price * 100) / 100,
      isAvailable: $('coffeeModifierAvailable').checked, updatedAt: serverTimestamp() };
    if (item) await updateDoc(doc(drinksRef(), item.id), data);
    else await addDoc(drinksRef(), { ...data, modifierExclusiveGroup: exclusive || null,
      category: 'modifiers', modifierPricingType: 'fixed', modifierScope: 'coffee',
      createdAt: serverTimestamp() });
    $('coffeeModifierEditor').close();
    $('coffeeModifiersDialog').showModal();
    message('Coffee modifier saved. The POS will update automatically.');
  } catch (error) {
    fail(error, 'Could not save coffee modifier');
    $('coffeeModifierError').textContent = error.message || 'Could not save. Try again.';
    $('coffeeModifierError').hidden = false;
  } finally { save.disabled = false; save.textContent = 'Save modifier'; }
}

function renderSetupNight() {
  const active = state.nights.find(night => night.id === state.venue?.activeNightId);
  $('setupActiveNight').textContent = active?.name || (state.nights.length ? 'No night selected' : 'No saved nights');
}

function selectNight(id) {
  state.selectedNightId = id && state.nights.some(night => night.id === id) ? id : null;
  state.specialUnsubscribe?.(); state.specialUnsubscribe = null; state.specials = [];
  renderNights();
  if (state.selectedNightId) {
    state.specialUnsubscribe = listen(specialsRef(state.selectedNightId), snapshot => {
      state.specials = snapshot.docs.map(item => ({ id: item.id, ...item.data() })); renderSpecials();
    }, 'night specials');
  }
}

function renderNights() {
  renderSetupNight();
  const list = $('nightList'); list.replaceChildren();
  if (!state.nights.length) list.append(node('p', 'empty-state', 'No nights yet. Add one to get started.'));
  state.nights.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach(night => {
    const row = itemButton('', () => selectNight(night.id));
    row.className = `item-card ${night.id === state.selectedNightId ? 'selected' : ''}`;
    const main = node('span', 'item-main');
    main.append(node('strong', '', night.name || 'Untitled night'), node('small', '', night.id === state.venue?.activeNightId ? 'Active on POS' : night.note || ''));
    row.append(main); list.append(row);
  });
  const selected = state.nights.find(night => night.id === state.selectedNightId);
  $('selectedNightName').textContent = selected?.name || 'Choose a night';
  $('selectedNightNote').textContent = selected?.note || '';
  for (const id of ['editNight', 'activateNight', 'addSpecial']) $(id).hidden = !selected;
  if (selected) {
    $('activateNight').textContent = selected.id === state.venue?.activeNightId ? 'Active on POS' : 'Use on POS';
    $('activateNight').disabled = selected.id === state.venue?.activeNightId;
  }
  renderSpecials();
}

function renderSpecials() {
  const list = $('specialList'); list.replaceChildren();
  if (!state.selectedNightId) { list.append(node('p', 'empty-state', 'Select a night to view its specials.')); return; }
  if (!state.specials.length) list.append(node('p', 'empty-state', 'No specials for this night yet.'));
  state.specials.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach(special => {
    const row = node('div', 'item-card'); const main = node('span', 'item-main');
    main.append(node('strong', '', special.name || 'Untitled special'), node('small', '', `${categoryName(special.category)}${special.description ? ' · ' + special.description : ''}`));
    row.append(thumbnail(special.imageUrl, special.name || 'Special'), main, node('strong', 'price', dollars(special.price)));
    if (special.isAvailable === false) row.append(node('span', 'disabled-tag', 'Hidden'));
    row.append(itemButton('Edit', () => openEditor('special', special)));
    row.append(itemButton(special.isAvailable === false ? 'Show' : 'Hide', async () => {
      try { await updateDoc(doc(specialsRef(state.selectedNightId), special.id), { isAvailable: special.isAvailable === false, updatedAt: serverTimestamp() }); message('Special availability updated.'); }
      catch (error) { fail(error, 'Could not update special'); }
    }));
    list.append(row);
  });
}

function field(label, name, value = '', options = {}) {
  const wrapper = node('label', options.checkbox ? 'checkbox-field' : '');
  const input = options.choices ? node('select') : node(options.multiline ? 'textarea' : 'input');
  input.name = name;
  if (options.checkbox) { input.type = 'checkbox'; input.checked = value === true; }
  else if (options.choices) options.choices.forEach(choice => {
    const option = node('option', '', choice.label || categoryName(choice.value)); option.value = choice.value; input.append(option);
  });
  else if (!options.multiline) input.type = options.type || 'text';
  if (!options.checkbox) input.value = value ?? '';
  if (options.required) input.required = true;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.checkbox) wrapper.append(input, node('span', '', label));
  else wrapper.append(node('span', '', label), input);
  return wrapper;
}

function openEditor(kind, item = null) {
  state.editor = { kind, item, nightId: state.selectedNightId };
  $('editorTitle').textContent = `${item ? 'Edit' : 'Add'} ${kind === 'drink' ? 'menu item' : kind === 'night' ? 'night' : 'special'}`;
  $('editorError').hidden = true;
  const fields = $('editorFields'); fields.replaceChildren();
  fields.append(field('Name', 'name', item?.name || '', { required: true, maxLength: 80 }));
  if (kind === 'drink') {
    fields.append(field('Category', 'category', item?.category || (state.venue?.businessType === 'coffee_shop' ? 'iced_coffee' : 'cocktails'), { choices: categories.map(value => ({ value })) }));
    const prices = coffeeSizePrices(item);
    const smallField = field('Price ($)', 'price', item?.price ?? (state.venue?.businessType === 'coffee_shop' ? 5 : 0), { type: 'number', min: 0, max: 100000, step: .01, required: true });
    const mediumField = field('Medium ($)', 'mediumPrice', Number.isFinite(prices.medium) ? prices.medium : 6, { type: 'number', min: 0, max: 100000, step: .01 });
    const largeField = field('Large ($)', 'largePrice', Number.isFinite(prices.large) ? prices.large : 7, { type: 'number', min: 0, max: 100000, step: .01 });
    fields.append(smallField, mediumField, largeField);
    const refreshSizes = () => {
      const sized = usesCoffeeSizes({ name: fields.querySelector('[name="name"]').value, category: fields.querySelector('[name="category"]').value });
      const espresso = isEspresso({ name: fields.querySelector('[name="name"]').value, category: fields.querySelector('[name="category"]').value });
      smallField.querySelector('span').textContent = espresso ? 'Single ($)' : sized ? 'Small ($)' : 'Price ($)';
      mediumField.querySelector('span').textContent = espresso ? 'Double ($)' : 'Medium ($)';
      largeField.querySelector('span').textContent = espresso ? 'Triple ($)' : 'Large ($)';
      mediumField.hidden = !sized; largeField.hidden = !sized;
    };
    fields.querySelector('[name="name"]').addEventListener('input', refreshSizes);
    fields.querySelector('[name="category"]').addEventListener('change', refreshSizes);
    refreshSizes();
    fields.append(field('Ingredients (comma-separated)', 'ingredients', Array.isArray(item?.ingredients) ? item.ingredients.join(', ') : '', { multiline: true }));
    fields.append(field('Modifier pricing', 'modifierPricingType', item?.modifierPricingType || 'fixed', { choices: [{ value: 'fixed', label: 'Fixed amount' }, { value: 'percentage', label: 'Percentage' }] }));
    fields.append(field('Modifier percentage', 'modifierPercentage', item?.modifierPercentageBps ? (Number(item.modifierPercentageBps) / 100).toFixed(2) : '', { type: 'number', min: .01, max: 500, step: .01 }));
  } else if (kind === 'night') {
    fields.append(field('Description or note', 'note', item?.note || '', { multiline: true }));
  } else {
    fields.append(field('Category', 'category', item?.category || 'cocktail', { choices: ['beer', 'shot', 'cocktail'].map(value => ({ value })) }));
    fields.append(field('Price ($)', 'price', item?.price ?? 0, { type: 'number', min: 0, max: 100000, step: .01, required: true }));
    fields.append(field('Description', 'description', item?.description || '', { multiline: true }));
  }
  $('editorDialog').showModal();
}

async function saveEditor(event) {
  event.preventDefault();
  const { kind, item, nightId } = state.editor || {};
  if (!kind) return;
  const form = new FormData($('editorForm'));
  const name = String(form.get('name') || '').trim();
  if (!name) return;
  const save = $('saveEditor'); save.disabled = true; save.textContent = 'Saving…';
  $('editorError').hidden = true;
  try {
    const updatedAt = serverTimestamp();
    if (kind === 'drink') {
      const category = String(form.get('category'));
      const percentage = category === 'modifiers' && form.get('modifierPricingType') === 'percentage';
      const rate = Number(form.get('modifierPercentage'));
      const price = Number(form.get('price'));
      if (percentage && (!Number.isFinite(rate) || rate < .01 || rate > 500)) throw new Error('Enter a modifier percentage between 0.01% and 500%.');
      if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid price.');
      const ingredients = String(form.get('ingredients') || '').split(',').map(value => value.trim()).filter(Boolean);
      const data = { name, category, price: percentage ? 0 : Math.round(price * 100) / 100, updatedAt };
      if (usesCoffeeSizes({ name, category })) {
        const sizePrices = { small: price, medium: Number(form.get('mediumPrice')), large: Number(form.get('largePrice')) };
        if (!validCoffeeSizePrices(sizePrices)) throw new Error(isEspresso({ name, category })
          ? 'Enter valid Single, Double, and Triple prices in ascending order.'
          : 'Enter valid Small, Medium, and Large prices in ascending order.');
        data.sizePrices = sizePrices;
      } else if (item?.sizePrices) {
        data.sizePrices = deleteField();
      }
      if (category === 'modifiers') {
        data.modifierPricingType = percentage ? 'percentage' : 'fixed';
        if (percentage) data.modifierPercentageBps = Math.round(rate * 100);
        else if (item) data.modifierPercentageBps = deleteField();
      } else if (item?.category === 'modifiers') {
        data.modifierPricingType = deleteField(); data.modifierPercentageBps = deleteField();
      }
      if (item) {
        data.ingredients = ingredients.length ? ingredients : deleteField();
        await updateDoc(doc(drinksRef(), item.id), data);
      } else await addDoc(drinksRef(), { ...data, ingredients, isAvailable: true, createdAt: serverTimestamp() });
    } else if (kind === 'night') {
      const note = String(form.get('note') || '').trim();
      if (item) {
        await updateDoc(nightRef(item.id), { name, note: note || deleteField(), updatedAt });
        if (state.venue?.activeNightId === item.id) await updateDoc(venueRef(), { activeNightName: name, updatedAt: serverTimestamp() });
      } else await addDoc(nightsRef(), { name, note, createdAt: serverTimestamp(), updatedAt });
    } else {
      if (!nightId) throw new Error('Choose a night first.');
      const category = String(form.get('category'));
      const price = Number(form.get('price'));
      if (!['beer', 'shot', 'cocktail'].includes(category) || !Number.isFinite(price) || price < 0) throw new Error('Enter a valid special and price.');
      const description = String(form.get('description') || '').trim();
      const data = { name, category, price: Math.round(price * 100) / 100, updatedAt };
      if (item) await updateDoc(doc(specialsRef(nightId), item.id), { ...data, description: description || deleteField() });
      else await addDoc(specialsRef(nightId), { ...data, description, imageName: '', isAvailable: true, createdAt: serverTimestamp() });
    }
    $('editorDialog').close(); state.editor = null; message('Saved to AVNT.');
  } catch (error) {
    $('editorError').textContent = error.message?.startsWith('Enter ') || error.message === 'Choose a night first.' ? error.message : 'Could not save this change. Please try again.';
    $('editorError').hidden = false;
    console.error('Could not save editor', error);
  } finally { save.disabled = false; save.textContent = 'Save'; }
}

async function saveSettings(event) {
  event.preventDefault();
  const name = $('settingVenueName').value.trim();
  if (!name) return;
  const newFees = $('settingVenuePaysFees').checked;
  const newTraining = $('settingTrainingMode').checked;
  const warnings = [];
  if (newFees !== (state.venue?.venuePaysPOSFees === true)) warnings.push(`POS fees will be paid by the ${newFees ? 'venue' : 'customer'} on future checkouts.`);
  if (newTraining !== (state.venue?.posTrainingModeEnabled === true)) warnings.push(`Training mode will be ${newTraining ? 'turned on (real payments stop)' : 'turned off (real payments resume)'}.`);
  if (warnings.length && !confirm(`${warnings.join('\n')}\n\nSave these changes?`)) return;
  const save = $('saveSettings'); save.disabled = true; save.textContent = 'Saving…';
  try {
    await updateDoc(venueRef(), { venueName: name, venuePaysPOSFees: newFees,
      automaticGratuityEnabled: $('settingGratuityEnabled').checked,
      automaticGratuityRateBps: Number($('settingGratuityRate').value),
      posTrainingModeEnabled: newTraining, updatedAt: serverTimestamp() });
    state.settingsDirty = false;
    $('settingsStatus').textContent = 'Saved to AVNT.';
    message('Venue settings saved.');
  } catch (error) { fail(error, 'Could not save settings'); $('settingsStatus').textContent = 'Could not save. Try again.'; }
  finally { save.disabled = false; save.textContent = 'Save settings'; }
}

onAuthStateChanged(auth, user => {
  if (!user) { clearListeners(); location.replace('../client-login.html'); return; }
  if (state.uid === user.uid && !$('appShell').hidden) return;
  start(user);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshPayoutStatus();
});
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  state.period = button.dataset.period;
  if (state.period === '365' && !state.yearLoaded) {
    state.yearError = false;
    loadYearOrders();
  }
  document.querySelectorAll('[data-period]').forEach(item => item.classList.toggle('active', item === button));
  renderAnalytics();
}));
$('mobileNav').addEventListener('click', () => {
  const open = document.querySelector('.sidebar').classList.toggle('open');
  $('mobileNav').setAttribute('aria-expanded', String(open));
});
$('signOut').addEventListener('click', async () => { clearListeners(); await signOut(auth); location.replace('../client-login.html'); });
$('menuSearch').addEventListener('input', renderMenu);
$('menuCategory').addEventListener('change', renderMenu);
$('addDrink').addEventListener('click', () => openEditor('drink'));
$('addNight').addEventListener('click', () => openEditor('night'));
$('openNightsSetup').addEventListener('click', () => setPage('nights'));
$('openCoffeeModifiers').addEventListener('click', () => { renderCoffeeModifiers(); $('coffeeModifiersDialog').showModal(); });
$('closeCoffeeModifiers').addEventListener('click', () => $('coffeeModifiersDialog').close());
$('doneCoffeeModifiers').addEventListener('click', () => $('coffeeModifiersDialog').close());
$('addCoffeeModifier').addEventListener('click', () => openCoffeeModifierEditor());
$('closeCoffeeModifierEditor').addEventListener('click', () => { $('coffeeModifierEditor').close(); $('coffeeModifiersDialog').showModal(); });
$('cancelCoffeeModifierEditor').addEventListener('click', () => { $('coffeeModifierEditor').close(); $('coffeeModifiersDialog').showModal(); });
$('coffeeModifierForm').addEventListener('submit', saveCoffeeModifier);
$('openClockSetup').addEventListener('click', () => setPage('clock'));
$('editNight').addEventListener('click', () => openEditor('night', state.nights.find(night => night.id === state.selectedNightId)));
$('addSpecial').addEventListener('click', () => openEditor('special'));
$('activateNight').addEventListener('click', async () => {
  const night = state.nights.find(item => item.id === state.selectedNightId);
  if (!night) return;
  try { await updateDoc(venueRef(), { activeNightId: night.id, activeNightName: night.name, updatedAt: serverTimestamp() }); message(`${night.name} is active on the POS.`); }
  catch (error) { fail(error, 'Could not activate night'); }
});
$('settingsForm').addEventListener('input', () => { state.settingsDirty = true; $('settingsStatus').textContent = 'Unsaved changes'; });
$('settingsForm').addEventListener('submit', saveSettings);
$('openAccountDeletion').addEventListener('click', () => $('accountDeletionDialog').showModal());
$('accountDeletionClose').addEventListener('click', () => $('accountDeletionDialog').close());
$('accountDeletionCancel').addEventListener('click', () => $('accountDeletionDialog').close());
$('accountDeletionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('accountDeletionSubmit');
  const errorNode = $('accountDeletionError');
  const user = auth.currentUser;
  if (!user?.email || !state.uid) return;
  button.disabled = true;
  errorNode.hidden = true;
  try {
    const credential = EmailAuthProvider.credential(user.email, $('accountDeletionPassword').value);
    await reauthenticateWithCredential(user, credential);
    await user.getIdToken(true);
    await httpsCallable(functions, 'requestPOSAccountDeletion')({ confirmation: 'DELETE', source: 'website' });
    $('accountDeletionPassword').value = '';
    $('accountDeletionDialog').close();
    $('deletionStatus').textContent = 'Deletion requested';
    $('openAccountDeletion').disabled = true;
    message('Your deletion request was recorded. New sales are disabled.');
  } catch (error) {
    errorNode.textContent = error.message || 'Could not submit the request.';
    errorNode.hidden = false;
  } finally { button.disabled = false; }
});
$('editorForm').addEventListener('submit', saveEditor);
$('closeEditor').addEventListener('click', () => $('editorDialog').close());
$('cancelEditor').addEventListener('click', () => $('editorDialog').close());
