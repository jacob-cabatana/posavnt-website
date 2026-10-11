import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const kinds = {
  table: { title: 'Table', icon: '◉', width: .14, height: .17 },
  booth: { title: 'Booth', icon: '▰', width: .22, height: .14 },
  bar: { title: 'Bar', icon: '▥', width: .34, height: .12 },
  stage: { title: 'Stage', icon: '♫', width: .28, height: .18 },
  wall: { title: 'Wall', icon: '━', width: .36, height: .055 },
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);

export function createFloor({ db, getUid }) {
  let items = [];
  let checks = [];
  let selectedId = null;
  let editing = false;
  let unsubscribers = [];

  const itemRef = id => doc(db, 'venues', getUid(), 'floorPlanItems', id);
  const checkRef = id => doc(db, 'venues', getUid(), 'floorChecks', id);
  const activeCheck = item => checks.find(check => check.floorPlanItemId === item.id && check.status === 'open');

  function status(text) {
    $('floorStatus').hidden = !text;
    $('floorStatus').textContent = text || '';
  }

  function selectedItem() { return items.find(item => item.id === selectedId); }

  function renderInspector() {
    const item = selectedItem(); const inspector = $('floorInspector'); inspector.replaceChildren();
    inspector.hidden = !item;
    if (!item) return;
    const kind = kinds[item.kind] || kinds.table;
    const check = activeCheck(item);
    const header = make('div', 'floor-inspector-head');
    header.append(make('strong', '', `${kind.title}: ${item.label || kind.title}`));
    const close = make('button', 'quiet-button', 'Close'); close.type = 'button'; close.addEventListener('click', () => { selectedId = null; render(); }); header.append(close);
    inspector.append(header);
    if (!editing) {
      if (check) {
        inspector.append(make('p', '', `Open check · ${money(check.totalCents)} · ${(check.items || []).length} item${(check.items || []).length === 1 ? '' : 's'}`));
        const staff = [check.staffFirstName, check.staffLastName].filter(Boolean).join(' ');
        if (staff) inspector.append(make('small', '', `Started by ${staff}`));
      } else inspector.append(make('p', '', 'Available. Staff can start a check for this spot on the iPad.'));
      return;
    }
    const controls = make('div', 'floor-inspector-controls');
    const name = make('input'); name.type = 'text'; name.maxLength = 50; name.value = item.label || ''; name.setAttribute('aria-label', 'Floor item label');
    const saveName = make('button', 'secondary-button', 'Save name'); saveName.type = 'button';
    saveName.addEventListener('click', async () => { const label = name.value.trim(); if (label) await update(item, { label }); });
    name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveName.click(); } });
    controls.append(name, saveName);
    for (const [label, fields] of [
      ['Smaller', { width: clamp(item.width * .88, .07, .55), height: clamp(item.height * .88, .045, .40) }],
      ['Larger', { width: clamp(item.width * 1.14, .07, .55), height: clamp(item.height * 1.14, .045, .40) }],
      ['Rotate', { rotation: ((Number(item.rotation) || 0) + 45) % 360 }],
    ]) {
      const button = make('button', 'secondary-button', label); button.type = 'button';
      button.addEventListener('click', () => update(item, fields)); controls.append(button);
    }
    const remove = make('button', 'secondary-button destructive', 'Delete item'); remove.type = 'button';
    remove.disabled = Boolean(check);
    remove.title = check ? 'Close this check on the iPad before removing its floor item.' : '';
    remove.addEventListener('click', () => removeItem(item)); controls.append(remove); inspector.append(controls);
    if (check) inspector.append(make('small', 'floor-warning', 'This spot has an open check. Close it on the iPad before deleting the spot.'));
  }

  function itemNode(item) {
    const kind = kinds[item.kind] || kinds.table;
    const check = activeCheck(item);
    const button = make('button', `floor-item ${item.kind}${check ? ' occupied' : ''}${selectedId === item.id ? ' selected' : ''}`);
    button.type = 'button'; button.setAttribute('aria-label', `${item.label || kind.title}${check ? `, open check ${money(check.totalCents)}` : ''}`);
    button.style.left = `${clamp(item.x, .04, .96) * 100}%`;
    button.style.top = `${clamp(item.y, .06, .94) * 100}%`;
    button.style.width = `${clamp(item.width, .07, .55) * 100}%`;
    button.style.height = `${clamp(item.height, .045, .40) * 100}%`;
    button.style.setProperty('--floor-rotation', `${Number(item.rotation) || 0}deg`);
    button.append(make('span', 'floor-kind-icon', kind.icon), make('strong', '', item.label || kind.title));
    if (check) button.append(make('small', 'floor-check-badge', money(check.totalCents)));
    let ignoreClick = false;
    button.addEventListener('click', () => { if (ignoreClick) { ignoreClick = false; return; } selectedId = item.id; render(); });
    if (editing) {
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        event.preventDefault(); selectedId = item.id; button.setPointerCapture(event.pointerId);
        const canvas = $('floorCanvas'); const rect = canvas.getBoundingClientRect();
        const startX = event.clientX; const startY = event.clientY;
        const originalX = clamp(item.x, .04, .96); const originalY = clamp(item.y, .06, .94);
        let moved = false;
        const move = pointer => {
          const x = clamp(originalX + (pointer.clientX - startX) / rect.width, .04, .96);
          const y = clamp(originalY + (pointer.clientY - startY) / rect.height, .06, .94);
          if (Math.abs(x - originalX) > .002 || Math.abs(y - originalY) > .002) moved = true;
          button.style.left = `${x * 100}%`; button.style.top = `${y * 100}%`;
          return { x, y };
        };
        button.onpointermove = move;
        button.onpointerup = async pointer => {
          button.onpointermove = null; button.onpointerup = null;
          if (moved) { ignoreClick = true; await update(item, move(pointer)); } else render();
        };
        button.onpointercancel = () => { button.onpointermove = null; button.onpointerup = null; render(); };
      });
    }
    return button;
  }

  function render() {
    const canvas = $('floorCanvas'); canvas.querySelectorAll('.floor-item').forEach(element => element.remove());
    $('floorEmpty').hidden = items.length > 0;
    $('floorItemCount').textContent = `${items.length} floor item${items.length === 1 ? '' : 's'}`;
    $('floorOpenCount').textContent = `${checks.filter(check => check.status === 'open').length} open check${checks.filter(check => check.status === 'open').length === 1 ? '' : 's'}`;
    $('floorEditToggle').textContent = editing ? 'Done' : 'Edit layout';
    $('floorHint').textContent = editing ? 'Drag fixtures into place, then select one to rename, resize, or rotate it.' : 'See open checks and arrange tables, booths, and fixtures.';
    items.slice().sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)).forEach(item => canvas.append(itemNode(item)));
    if (selectedId && !selectedItem()) selectedId = null;
    renderInspector();
  }

  async function update(item, fields) {
    try { await updateDoc(itemRef(item.id), { ...fields, updatedAt: serverTimestamp() }); status(''); }
    catch (error) { console.error('Could not update floor item', error); status('Could not save that floor change. Try again.'); render(); }
  }

  async function removeItem(item) {
    if (activeCheck(item)) { status('Close the open check on the iPad before deleting this spot.'); return; }
    if (!window.confirm(`Delete ${item.label || kinds[item.kind]?.title || 'this floor item'} from the floor plan?`)) return;
    try {
      const batch = writeBatch(db); batch.delete(itemRef(item.id)); batch.delete(checkRef(item.id)); await batch.commit();
      selectedId = null; status('');
    } catch (error) { console.error('Could not delete floor item', error); status('Could not delete this floor item. Try again.'); }
  }

  async function add(kindName) {
    const kind = kinds[kindName]; if (!kind || !getUid()) return;
    const count = items.filter(item => item.kind === kindName).length + 1;
    const offset = items.length % 5;
    const position = .5 + (offset - 2) * .035;
    try {
      await addDoc(collection(db, 'venues', getUid(), 'floorPlanItems'), {
        kind: kindName, label: `${kind.title} ${count}`, x: position, y: position,
        width: kind.width, height: kind.height, rotation: 0, sortOrder: items.length,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      editing = true; status(''); render();
    } catch (error) { console.error('Could not add floor item', error); status('Could not add this floor item. Try again.'); }
  }

  $('floorAddKind').addEventListener('change', event => { const kind = event.target.value; event.target.value = ''; add(kind); });
  $('floorEditToggle').addEventListener('click', () => { editing = !editing; if (!editing) selectedId = null; render(); });
  $('floorCanvas').addEventListener('click', event => { if (event.target === $('floorCanvas')) { selectedId = null; render(); } });

  function start(uid) {
    stop();
    const venue = ['venues', uid];
    unsubscribers.push(onSnapshot(collection(db, ...venue, 'floorPlanItems'), snapshot => {
      items = snapshot.docs.map(value => ({ id: value.id, ...value.data() })); render();
    }, error => { console.error('Could not load floor plan', error); status('Could not load floor plan. Refresh to try again.'); }));
    unsubscribers.push(onSnapshot(collection(db, ...venue, 'floorChecks'), snapshot => {
      checks = snapshot.docs.map(value => ({ id: value.id, ...value.data() })); render();
    }, error => { console.error('Could not load floor checks', error); status('Could not load floor checks. Refresh to try again.'); }));
  }

  function stop() { unsubscribers.forEach(unsubscribe => unsubscribe()); unsubscribers = []; items = []; checks = []; selectedId = null; editing = false; render(); }
  return { start, stop, render };
}
