import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { addDoc, collection, deleteField, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getDownloadURL, ref as storageRef } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import { auth, db, storage } from '../firebase.js';
import { sharedCoffeeImagePath } from './coffee-images.mjs';
import { calculateMetrics } from './metrics.mjs';
import { createHistory } from './history.mjs';
import { createFloor } from './floor.mjs';
import { createTimeClock } from './timeclock.mjs';
import { createInventory, stockInfo } from './inventory.mjs';

const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
const dollars = amount => money(Math.round((Number(amount) || 0) * 100));
const categories = ['cocktails', 'shots', 'beer', 'seltzers', 'wine', 'food', 'non_alcoholic', 'hookah', 'specials', 'modifiers'];
const categoryName = value => ({ non_alcoholic: 'Non-alcoholic' })[value] || (value ? value[0].toUpperCase() + value.slice(1) : 'Other');
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
const state = { uid: null, venue: null, drinks: [], nights: [], specials: [], orders: [], period: '7', selectedNightId: null, unsubscribers: [], specialUnsubscribe: null, editor: null, ordersLoaded: false, ordersError: false, settingsDirty: false };
const history = createHistory({ db, getUid: () => state.uid, getVenue: () => state.venue, getOrders: () => state.orders });
const floor = createFloor({ db, getUid: () => state.uid });
const clock = createTimeClock({ auth, db, getUid: () => state.uid });
const inventory = createInventory({ auth, db, getUid: () => state.uid, getDrinks: () => state.drinks, attachImage: attachDrinkImage });
let toastTimer;

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

function listen(reference, onData, context) {
  return onSnapshot(reference, onData, error => fail(error, `Could not load ${context}`));
}

async function start(user) {
  clearListeners();
  state.uid = null;
  state.venue = null;
  state.drinks = []; state.nights = []; state.specials = []; state.orders = [];
  state.ordersLoaded = false; state.ordersError = false;
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
    $('authGate').hidden = true;
    $('appShell').hidden = false;
    renderVenue();
    floor.start(user.uid); clock.start(user.uid); inventory.start(user.uid);

    state.unsubscribers.push(listen(venueRef(), snapshot => {
      if (!snapshot.exists()) { $('appShell').hidden = true; $('authGate').hidden = false; $('authGate').textContent = 'Venue account no longer available.'; return; }
      state.venue = snapshot.data();
      renderVenue(); renderNights(); renderAnalytics(); history.render();
    }, 'venue'));
    state.unsubscribers.push(listen(drinksRef(), snapshot => {
      state.drinks = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      renderMenu(); inventory.render();
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
  renderSetupNight();
  if (state.settingsDirty || document.activeElement?.closest('#settingsForm')) return;
  $('settingVenueName').value = name === 'Your venue' ? '' : name;
  const tax = venue.venueTaxRateBps ?? venue.tax?.venueTaxRateBps ?? venue.tax?.salesTaxRateBps;
  $('settingTaxRate').value = Number.isFinite(Number(tax)) && tax !== undefined ? `${(Number(tax) / 100).toFixed(2)}%` : 'Not set';
  $('settingVenuePaysFees').checked = venue.venuePaysPOSFees === true;
  $('settingGratuityEnabled').checked = venue.automaticGratuityEnabled === true;
  $('settingGratuityRate').value = String([500, 1000, 1500, 2000].includes(Number(venue.automaticGratuityRateBps)) ? venue.automaticGratuityRateBps : 1000);
  $('settingTrainingMode').checked = venue.posTrainingModeEnabled === true;
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
  if (page === 'inventory') inventory.render();
  if (page === 'clock') clock.refreshStatus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAnalytics() {
  if (!state.ordersLoaded || state.ordersError) {
    $('analyticsNotice').hidden = false;
    $('analyticsNotice').textContent = state.ordersError ? 'Sales data could not be loaded. Check your connection and refresh.' : 'Loading sales from AVNT…';
    return;
  }
  let zone = state.venue?.timeZone || state.venue?.timezone || 'America/New_York';
  let metrics;
  try { metrics = calculateMetrics(state.orders, state.period, { timeZone: zone }); }
  catch { zone = 'America/New_York'; metrics = calculateMetrics(state.orders, state.period); }
  $('analyticsNotice').hidden = state.orders.length < 1000;
  $('analyticsNotice').textContent = state.orders.length >= 1000 ? 'Showing analytics from the most recent 1,000 order records. Older sales may be excluded.' : '';
  $('periodEyebrow').textContent = state.period === 'tonight' ? '⌁  CURRENT NIGHT' : `⌁  LAST ${state.period} DAYS`;
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
  $('sellerPeriod').textContent = `Ranked by drink revenue · ${state.period === 'tonight' ? 'tonight' : `${state.period} days`}`;
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
  return Array.from({ length: count }, (_, index) => {
    const key = shiftedDay(today, index - count + 1);
    const date = new Date(`${key}T12:00:00Z`);
    const label = count === 7
      ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date)
      : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
    return { label, value: byDay.get(key) || 0 };
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
  const indices = state.period === '30' ? [0, 5, 11, 17, 23, 29] : points.map((_, index) => index);
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
  const items = state.drinks.filter(drink => (category === 'all' || drink.category === category) && String(drink.name || '').toLowerCase().includes(search))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  $('menuSummary').textContent = `${items.length} shown · ${state.drinks.length} menu items`;
  const list = $('menuList'); list.replaceChildren();
  if (!items.length) list.append(node('p', 'empty-state', 'No menu items match your filters.'));
  items.forEach(drink => {
    const stock = stockInfo(drink);
    const row = node('article', `menu-tile${drink.isAvailable === false ? ' unavailable' : ''}`);
    const pricing = drink.category === 'modifiers' && drink.modifierPricingType === 'percentage'
      ? `${(Number(drink.modifierPercentageBps) / 100).toFixed(2)}%` : dollars(drink.price);
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
    else if (drink.isAvailable === false) main.append(node('span', 'menu-unavailable', 'UNAVAILABLE'));
    else if (stock.low) main.append(node('span', 'menu-stock-warning', `${stock.available} left`));
    const footer = node('div', 'menu-tile-footer');
    footer.append(node('span', '', categoryName(drink.category)));
    footer.append(itemButton('Edit', () => openEditor('drink', drink)));
    footer.append(itemButton(drink.isAvailable === false ? 'Show' : 'Hide', async () => {
      try { await updateDoc(doc(drinksRef(), drink.id), { isAvailable: drink.isAvailable === false, updatedAt: serverTimestamp() }); message('Menu availability updated.'); }
      catch (error) { fail(error, 'Could not update availability'); }
    }));
    row.append(main, footer);
    list.append(row);
  });
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
    fields.append(field('Category', 'category', item?.category || 'cocktails', { choices: categories.map(value => ({ value })) }));
    fields.append(field('Price ($)', 'price', item?.price ?? 0, { type: 'number', min: 0, max: 100000, step: .01, required: true }));
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
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  state.period = button.dataset.period;
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
$('editorForm').addEventListener('submit', saveEditor);
$('closeEditor').addEventListener('click', () => $('editorDialog').close());
$('cancelEditor').addEventListener('click', () => $('editorDialog').close());
