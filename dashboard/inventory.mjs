import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { collection, limit, onSnapshot, orderBy, query } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const el = document.createElement(tag); if (className) el.className = className;
  if (text !== undefined) el.textContent = text; return el;
};
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function stockInfo(item) {
  const enabled = item.inventoryEnabled === true;
  const quantity = integer(item.inventoryQuantity), reserved = integer(item.inventoryReserved);
  const available = Math.max(0, quantity - reserved);
  const threshold = item.inventoryLowStockThreshold === undefined ? 10 : integer(item.inventoryLowStockThreshold);
  const low = enabled && available > 0 && available <= threshold, soldOut = enabled && quantity === 0;
  return { enabled, quantity, reserved, available, threshold, low, soldOut,
    label: !enabled ? 'Not tracked' : soldOut ? 'Sold out' : available === 0 ? 'In checkout' : low ? `Low stock · ${available} left` : `${available} available` };
}

export function createInventory({auth, db, getUid, getDrinks, getImage}) {
  const saveInventory = httpsCallable(getFunctions(auth.app, 'us-central1'), 'savePOSInventory');
  let unsubscribe, selected, operationId, lastPayload, busy = false, unlockedUntil = 0;
  const notice = text => { $('inventoryNotice').textContent = text || ''; $('inventoryNotice').hidden = !text; };

  function render() {
    const items = getDrinks().filter(item => item.category !== 'modifiers');
    const tracked = items.filter(item => stockInfo(item).enabled);
    const low = tracked.filter(item => stockInfo(item).low), soldOut = tracked.filter(item => stockInfo(item).soldOut);
    $('inventoryTracked').textContent = tracked.length;
    $('inventoryLow').textContent = low.length;
    $('inventoryOut').textContent = soldOut.length;
    $('inventoryAlert').textContent = low.length + soldOut.length;
    $('inventoryAlert').hidden = low.length + soldOut.length === 0;
    const search = $('inventorySearch').value.trim().toLowerCase(), filter = $('inventoryFilter').value;
    const shown = items.filter(item => {
      const stock = stockInfo(item);
      return String(item.name || '').toLowerCase().includes(search) &&
        (filter === 'all' || filter === 'tracked' && stock.enabled || filter === 'low' && stock.low || filter === 'out' && stock.soldOut);
    }).sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));
    const list = $('inventoryList'); list.replaceChildren();
    if (!shown.length) list.append(make('p', 'empty-state', 'No items match your filters.'));
    shown.forEach(item => {
      const stock = stockInfo(item), row = make('article', 'inventory-row');
      const artwork = make('div', 'inventory-art', '▣');
      const remote = typeof item.imageUrl === 'string' && /^https:\/\//i.test(item.imageUrl) ? item.imageUrl : null;
      const fallback = getImage(item);
      if (remote || fallback) {
        const image = make('img'); image.src = remote || fallback; image.alt = ''; image.loading = 'lazy';
        image.addEventListener('error', () => { if (fallback && image.src !== new URL(fallback, location.href).href) image.src = fallback; else image.remove(); });
        artwork.append(image);
      }
      const info = make('div', 'inventory-name'); info.append(make('strong', '', item.name || 'Item'), make('small', '', String(item.category || 'Menu').replaceAll('_',' ')));
      const count = make('div', 'inventory-count'); count.append(make('b', '', stock.enabled ? stock.quantity : '—'), make('span', '', stock.enabled ? 'on hand' : 'not tracked'));
      const state = make('div', `inventory-state${stock.soldOut ? ' sold-out' : stock.low ? ' low-stock' : ''}`);
      state.append(make('strong', '', stock.label));
      if (stock.enabled) state.append(make('small', '', `Warn at ${stock.threshold}${stock.reserved ? ` · ${stock.reserved} finishing payment` : ''}`));
      const button = make('button', 'secondary-button', stock.enabled ? 'Update stock' : 'Start tracking'); button.type = 'button';
      button.addEventListener('click', () => open(item)); row.append(artwork, info, count, state, button); list.append(row);
    });
  }

  function open(item) {
    selected = {...item}; operationId = crypto.randomUUID(); lastPayload = null;
    const stock = stockInfo(item);
    $('inventoryEditorTitle').textContent = item.name || 'Inventory';
    $('inventoryEditorSummary').textContent = `${stock.quantity} on hand · ${stock.reserved} finishing payment`;
    $('inventoryEnabled').checked = stock.enabled;
    $('inventoryMode').value = 'set'; $('inventoryQuantity').value = stock.quantity;
    $('inventoryThreshold').value = stock.threshold; $('inventoryReason').value = stock.enabled ? '' : 'Opening count';
    $('inventoryPassword').value = ''; $('inventoryEditorError').hidden = true;
    updateFields(); $('inventoryDialog').showModal();
  }

  function updateFields() {
    $('inventoryCountFields').hidden = !$('inventoryEnabled').checked;
    const mode = $('inventoryMode').value;
    $('inventoryQuantityField').hidden = mode === 'settings';
    $('inventoryQuantityLabel').textContent = mode === 'set' ? 'Count on hand' : mode === 'add' ? 'Quantity received' : 'Quantity removed';
    $('inventoryManagerAccess').hidden = Date.now() < unlockedUntil;
  }

  async function save(event) {
    event.preventDefault(); if (!selected || busy) return;
    const quantity = Number($('inventoryQuantity').value), lowStockThreshold = Number($('inventoryThreshold').value);
    const reason = $('inventoryReason').value.trim();
    const errorBox = $('inventoryEditorError'); errorBox.hidden = true;
    if (![quantity, lowStockThreshold].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000) || reason.length < 3) {
      errorBox.textContent = 'Enter whole-number quantities and a reason.'; errorBox.hidden = false; return;
    }
    busy = true; $('inventorySave').disabled = true; $('inventorySave').textContent = 'Saving…';
    $('inventoryCancel').disabled = true; $('inventoryClose').disabled = true;
    try {
      if (Date.now() >= unlockedUntil) {
        const user = auth.currentUser, password = $('inventoryPassword').value;
        if (!user?.email || !password) throw new Error('Enter the venue account password.');
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
        await user.getIdToken(true); unlockedUntil = Date.now() + 270000;
      }
      const payload = {itemId: selected.id, enabled: $('inventoryEnabled').checked,
        mode: $('inventoryEnabled').checked ? $('inventoryMode').value : 'settings',
        quantity, lowStockThreshold, expectedRevision: integer(selected.inventoryRevision), reason};
      const fingerprint = JSON.stringify(payload);
      if (lastPayload && lastPayload !== fingerprint) operationId = crypto.randomUUID();
      lastPayload = fingerprint;
      await saveInventory({...payload, operationId});
      $('inventoryDialog').close(); selected = null; notice('Inventory updated.');
    } catch (error) {
      console.error('Inventory save failed', error);
      if (error.code === 'functions/permission-denied') unlockedUntil = 0;
      errorBox.textContent = String(error.code || '').startsWith('auth/') ? 'The password could not be verified. Try again.' : error.message || 'Could not save inventory. Try again.';
      errorBox.hidden = false; updateFields();
    } finally {
      $('inventoryPassword').value = ''; busy = false;
      $('inventorySave').disabled = false; $('inventorySave').textContent = 'Save inventory';
      $('inventoryCancel').disabled = false; $('inventoryClose').disabled = false;
    }
  }

  function start(uid) {
    stop(); notice('');
    unsubscribe = onSnapshot(query(collection(db, 'venues', uid, 'inventoryAdjustments'), orderBy('createdAt', 'desc'), limit(30)), snapshot => {
      const list = $('inventoryChanges'); list.replaceChildren();
      if (snapshot.empty) list.append(make('p', 'empty-state', 'Stock changes will appear here.'));
      snapshot.docs.forEach(doc => {
        const data = doc.data(), row = make('div', 'inventory-change'), detail = make('div');
        detail.append(make('strong', '', data.itemName || 'Item'), make('small', '', data.reason || 'Stock update'));
        const date = data.createdAt?.toDate?.();
        const delta = Number(data.change) || 0;
        row.append(detail, make('time', '', date ? date.toLocaleString([], {dateStyle:'short',timeStyle:'short'}) : 'Saving…'), make('b', '', `${delta > 0 ? '+' : ''}${delta}`)); list.append(row);
      });
    }, () => notice('Could not load stock history. Refresh to try again.'));
  }
  function stop() { unsubscribe?.(); unsubscribe = null; unlockedUntil = 0; selected = null; $('inventoryDialog').close(); $('inventoryChanges').replaceChildren(); }
  $('inventorySearch').addEventListener('input', render);
  $('inventoryFilter').addEventListener('change', render);
  $('inventoryEnabled').addEventListener('change', updateFields);
  $('inventoryMode').addEventListener('change', () => { $('inventoryQuantity').value = $('inventoryMode').value === 'set' ? stockInfo(selected).quantity : 0; updateFields(); });
  $('inventoryForm').addEventListener('submit', save);
  $('inventoryDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  for (const id of ['inventoryCancel', 'inventoryClose']) $(id).addEventListener('click', () => $('inventoryDialog').close());
  return {start, stop, render, open};
}
