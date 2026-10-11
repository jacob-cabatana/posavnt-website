import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { calculateMetrics, isReportableSale, normalizedOrder } from './metrics.mjs';

const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
const $ = id => document.getElementById(id);
const make = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};
const dateOf = value => value?.toDate?.() || (value ? new Date(value) : null);
const orderDate = order => dateOf(order.paidAt) || dateOf(order.pickedUpAt) || dateOf(order.createdAt);
const cents = (value, fallback) => Number.isFinite(Number(value)) && value != null ? Math.round(Number(value)) : Math.round((Number(fallback) || 0) * 100);

function summaryOf(orders) {
  const result = { salesCents: 0, tipsCents: 0, taxCents: 0, orders: orders.length, chargedCents: 0 };
  for (const order of orders) {
    const normalized = normalizedOrder(order);
    result.salesCents += normalized.subtotalCents;
    result.tipsCents += normalized.tipTotalCents;
    result.taxCents += normalized.venueTaxCents + normalized.feeTaxCents;
    result.chargedCents += normalized.chargedCents;
  }
  return result;
}

function receiptLine(label, amount, prominent = false) {
  const row = make('div', prominent ? 'receipt-line prominent' : 'receipt-line');
  row.append(make('span', '', label), make('strong', '', money(amount)));
  return row;
}

function cardLabel(order) {
  if (order.paymentMethod === 'cash') return 'Cash';
  const brand = String(order.cardBrand || 'Card');
  return `${brand[0].toUpperCase()}${brand.slice(1).toLowerCase()}${/^\d{4}$/.test(order.cardLast4 || '') ? `  •••• ${order.cardLast4}` : ''}`;
}

function signature(strokes) {
  if (!Array.isArray(strokes) || !strokes.length) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 300 72'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Customer signature');
  for (const stroke of strokes) {
    const points = (Array.isArray(stroke.points) ? stroke.points : []).filter(point => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
    if (!points.length) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'}${Math.min(1, Math.max(0, Number(point.x))) * 300} ${Math.min(1, Math.max(0, Number(point.y))) * 72}`).join(' '));
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#151515');
    path.setAttribute('stroke-width', '2.3'); path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
  }
  return svg.childNodes.length ? svg : null;
}

function buildReceipt(order, venueName, compact = false) {
  const normalized = normalizedOrder(order);
  const paper = make('article', compact ? 'receipt-paper compact' : 'receipt-paper');
  const header = make('div', 'receipt-header');
  const title = make('div'); title.append(make('strong', '', String(order.venueName || venueName || 'AVNT venue').toUpperCase()), make('small', '', `RECEIPT #${order.orderCode || String(order.id || '').slice(0, 6).toUpperCase()}`));
  const refunded = normalized.refundedCents > 0 || order.paymentStatus === 'refunded';
  header.append(title, make('b', refunded ? 'paid-badge refunded' : 'paid-badge', refunded ? 'REFUNDED' : 'PAID')); paper.append(header);
  const date = orderDate(order);
  const meta = make('div', 'receipt-meta');
  meta.append(make('span', '', date && !Number.isNaN(date.getTime()) ? date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Completed sale'), make('span', '', `${normalized.itemCount} item${normalized.itemCount === 1 ? '' : 's'}`));
  paper.append(meta, make('div', 'receipt-rule'));
  const itemList = make('div', 'receipt-items');
  const items = Array.isArray(order.items) ? order.items : [];
  items.slice(0, compact ? 4 : 100).forEach(item => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers.map(value => value.name).filter(Boolean).join(' · ') : '';
    const label = `${quantity}×  ${item.name || 'Item'}${modifiers ? ` · ${modifiers}` : ''}`;
    itemList.append(receiptLine(label, cents(item.lineTotalCents, item.lineTotal ?? ((Number(item.price) || Number(item.priceCents) / 100 || 0) * quantity))));
  });
  if (compact && items.length > 4) itemList.append(make('small', 'receipt-more', `+ ${items.length - 4} more item${items.length === 5 ? '' : 's'}`));
  if (!items.length) itemList.append(make('small', 'receipt-more', 'Items not available on this receipt.'));
  paper.append(itemList);
  const totals = make('div', 'receipt-totals');
  totals.append(receiptLine('Subtotal', normalized.subtotalCents));
  if (cents(order.automaticGratuityCents) > 0) totals.append(receiptLine('Automatic gratuity', cents(order.automaticGratuityCents)));
  if (cents(order.tipCents, order.tip) > 0) totals.append(receiptLine('Additional tip', cents(order.tipCents, order.tip)));
  if (normalized.venueTaxCents + normalized.feeTaxCents > 0) totals.append(receiptLine('Sales tax', normalized.venueTaxCents + normalized.feeTaxCents));
  if (normalized.customerFeeCents > 0) totals.append(receiptLine('POS fee', normalized.customerFeeCents));
  totals.append(receiptLine('TOTAL', normalized.chargedCents, true)); paper.append(totals, make('div', 'receipt-rule'));
  const details = make('div', 'receipt-details');
  const staff = [order.staffFirstName, order.staffLastName].filter(Boolean).join(' ');
  const customer = order.customerName || [order.userFirstName, order.userLastName].filter(Boolean).join(' ');
  if (customer) details.append(make('strong', '', customer));
  if (staff) details.append(make('span', '', `Served by ${staff}`));
  details.append(make('span', '', cardLabel(order)));
  if (order.paymentMethod === 'cash' && order.cashReceivedCents != null) details.append(make('span', '', `Received ${money(order.cashReceivedCents)} · Change ${money(order.changeDueCents)}`));
  if (normalized.refundedCents > 0) details.append(make('strong', '', `Refunded ${money(normalized.refundedCents)}`));
  paper.append(details);
  const drawn = signature(order.signatureStrokes);
  if (drawn) {
    const sign = make('div', 'receipt-signature');
    sign.append(make('small', '', 'CUSTOMER SIGNATURE'), drawn);
    if (!compact) sign.append(make('p', '', order.receiptAcknowledgment || 'CUSTOMER ACKNOWLEDGES RECEIPT OF GOODS AND/OR SERVICES IN THE AMOUNT OF THE TOTAL SHOWN HEREON.'));
    paper.append(sign);
  }
  return paper;
}

export function createHistory({ db, getUid, getVenue, getOrders }) {
  let period = '7';
  let search = '';
  let searchResults = [];
  let searching = false;
  let searchError = '';
  let searchRequest = 0;
  let searchTimer;
  let visibleOrders = [];
  let visibleLimit = 60;

  function filteredOrders() {
    const orders = getOrders().filter(isReportableSale);
    if (search.length === 4) {
      const combined = new Map([...orders, ...searchResults].filter(order => order.cardLast4 === search).map(order => [order.id, order]));
      return [...combined.values()].sort((a, b) => (orderDate(b)?.getTime() || 0) - (orderDate(a)?.getTime() || 0));
    }
    if (period === 'all') return orders.sort((a, b) => (orderDate(b)?.getTime() || 0) - (orderDate(a)?.getTime() || 0));
    let zone = getVenue()?.timeZone || getVenue()?.timezone || 'America/New_York';
    try { return calculateMetrics(orders, period, { timeZone: zone }).ordersList; }
    catch { return calculateMetrics(orders, period).ordersList; }
  }

  function render() {
    if (!getUid()) return;
    visibleOrders = filteredOrders();
    const notice = $('historyNotice');
    const capped = getOrders().length >= 1000 && search.length !== 4;
    notice.hidden = !searching && !searchError && !capped;
    notice.textContent = searching ? 'Searching all venue receipts for this card…' : searchError || (capped ? 'Showing the newest 1,000 order records. Search a card’s last four digits to find older matching receipts.' : '');
    $('historyResultsTitle').textContent = search.length === 4 ? `Card •••• ${search}` : 'Receipts';
    $('historySort').textContent = search.length === 4 ? 'All matching transactions' : 'Newest first';
    $('historyCount').textContent = visibleOrders.length > visibleLimit ? `Showing ${visibleLimit} of ${visibleOrders.length} receipts` : `${visibleOrders.length} receipt${visibleOrders.length === 1 ? '' : 's'}`;
    $('historyLoadMore').hidden = visibleOrders.length <= visibleLimit;
    const stats = summaryOf(visibleOrders);
    const cards = [
      ['REVENUE', money(stats.salesCents), 'gross drink sales', 'purple', '$'],
      ['TIPS', money(stats.tipsCents), 'added by guests', 'pink', '♥'],
      ['SALES TAX', money(stats.taxCents), 'collected', 'amber', '▤'],
      ['ORDERS', String(stats.orders), 'completed receipts', 'blue', '▥'],
      ['AVERAGE SALE', money(stats.orders ? Math.round(stats.salesCents / stats.orders) : 0), 'before tip and tax', 'green', '▥'],
    ];
    const metrics = $('historyMetrics'); metrics.replaceChildren();
    cards.forEach(([label, value, detail, color, icon]) => {
      const card = make('article', 'card metric-card');
      const content = make('div'); content.append(make('span', '', label), make('strong', '', value), make('small', '', detail));
      card.append(make('span', `metric-icon ${color}`, icon), content); metrics.append(card);
    });
    const list = $('historyReceipts'); list.replaceChildren();
    if (!visibleOrders.length) list.append(make('p', 'empty-state', searching ? 'Searching…' : search.length === 4 ? 'No transactions found for this card.' : 'No completed receipts in this period.'));
    visibleOrders.slice(0, visibleLimit).forEach(order => {
      const card = make('div', 'receipt-card');
      card.append(buildReceipt(order, getVenue()?.venueName || getVenue()?.businessName, true));
      const button = make('button', 'receipt-view', 'View receipt'); button.type = 'button';
      button.addEventListener('click', () => openReceipt(order)); card.append(button); list.append(card);
    });
  }

  function openReceipt(order) {
    $('receiptDetail').replaceChildren(buildReceipt(order, getVenue()?.venueName || getVenue()?.businessName));
    $('receiptDialogTitle').textContent = `Receipt #${order.orderCode || String(order.id || '').slice(0, 6).toUpperCase()}`;
    $('receiptDialog').showModal();
  }

  async function findCard(digits) {
    const requestId = ++searchRequest;
    searching = true; searchError = ''; searchResults = []; render();
    try {
      const result = await getDocs(query(collection(db, 'venues', getUid(), 'orders'), where('cardLast4', '==', digits)));
      if (requestId !== searchRequest) return;
      searchResults = result.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(isReportableSale);
    } catch (error) {
      if (requestId !== searchRequest) return;
      console.error('Could not search card receipts', error);
      searchError = 'Could not search this card. Try again.';
    } finally {
      if (requestId === searchRequest) { searching = false; render(); }
    }
  }

  $('historyLast4').addEventListener('input', event => {
    search = String(event.target.value || '').replace(/\D/g, '').slice(0, 4);
    event.target.value = search;
    clearTimeout(searchTimer); searchRequest++; searchResults = []; searchError = ''; searching = false; visibleLimit = 60;
    render();
    if (search.length === 4) searchTimer = setTimeout(() => findCard(search), 250);
  });
  document.querySelectorAll('[data-history-period]').forEach(button => button.addEventListener('click', () => {
    period = button.dataset.historyPeriod;
    visibleLimit = 60;
    document.querySelectorAll('[data-history-period]').forEach(item => item.classList.toggle('active', item === button));
    render();
  }));
  $('closeReceipt').addEventListener('click', () => $('receiptDialog').close());
  $('doneReceipt').addEventListener('click', () => $('receiptDialog').close());
  $('printReceipt').addEventListener('click', () => window.print());
  $('historyLoadMore').addEventListener('click', () => { visibleLimit += 60; render(); });
  return { render, reset: () => { clearTimeout(searchTimer); searchRequest++; search = ''; searchResults = []; $('historyLast4').value = ''; } };
}
