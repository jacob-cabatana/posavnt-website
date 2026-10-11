import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const permissions = [
  ['sell', 'Sell'], ['orders', 'Orders'], ['menu', 'Menu'], ['crm', 'CRM'],
  ['history', 'History'], ['analytics', 'Analytics'], ['setup', 'Setup'],
];
const datetime = value => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const localInput = date => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const errorText = error => String(error?.message || '').replace(/^Firebase:\s*/, '').replace(/\s*\(functions\/[^)]*\)\.?$/, '');

export function createTimeClock({ auth, db, getUid }) {
  const functions = getFunctions(auth.app, 'us-central1');
  const call = (name, data = {}) => httpsCallable(functions, name)(data);
  let staff = [];
  let active = new Map();
  let shifts = [];
  let truncated = false;
  let days = 30;
  let unlockedUntil = 0;
  let relockTimer;
  let unsubscribe;
  let editor = null;

  const staffRef = id => doc(db, 'venues', getUid(), 'staff', id);
  const unlocked = () => Date.now() < unlockedUntil;
  const staffName = member => [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Staff member';

  function status(text) {
    $('clockStatus').hidden = !text;
    $('clockStatus').textContent = text || '';
  }

  function lock() {
    unlockedUntil = 0; clearTimeout(relockTimer); shifts = [];
    $('clockUnlock').hidden = false; $('clockReportArea').hidden = true;
    renderStaff();
  }

  function renderStaff() {
    const list = $('clockStaff'); list.replaceChildren();
    $('clockAddStaff').disabled = !unlocked();
    if (!unlocked()) list.append(make('p', 'clock-hint', 'Unlock manager controls to add staff, change PINs, or edit shifts.'));
    if (!staff.length) list.append(make('p', 'empty-state', 'No staff profiles yet. Add one to enable iPad clock punches.'));
    staff.slice().sort((a, b) => staffName(a).localeCompare(staffName(b))).forEach(member => {
      const row = make('div', 'clock-staff-row');
      const info = make('div');
      info.append(make('strong', '', staffName(member)));
      const state = member.active === false ? 'Inactive' : active.has(member.id) ? `Clocked in · ${datetime(active.get(member.id))}` : 'Clocked out';
      info.append(make('small', '', state)); row.append(info);
      const edit = make('button', 'secondary-button', 'Edit'); edit.type = 'button'; edit.disabled = !unlocked();
      edit.addEventListener('click', () => openStaffEditor(member)); row.append(edit); list.append(row);
    });
  }

  function renderShifts() {
    const list = $('clockShifts'); list.replaceChildren();
    $('clockReportNote').textContent = truncated ? 'Showing the newest 1,000 shifts. Choose a shorter period for a complete review.' : 'Times are shown in your device’s local time zone. Every correction requires a reason and is logged.';
    if (!shifts.length) list.append(make('p', 'empty-state', 'No shifts in this period.'));
    shifts.forEach(shift => {
      const row = make('div', 'clock-shift-row');
      const person = make('div'); person.append(make('strong', '', shift.staffName || 'Staff member'), make('small', '', shift.corrected ? 'Manager corrected' : 'Staff PIN'));
      const dates = make('div'); dates.append(make('span', '', datetime(shift.clockInMs)), make('small', '', shift.clockOutMs ? datetime(shift.clockOutMs) : 'Clocked in'));
      const hours = shift.clockOutMs ? `${Math.max(0, (shift.clockOutMs - shift.clockInMs) / 3600000).toFixed(2)} h` : '—';
      const edit = make('button', 'secondary-button', 'Edit'); edit.type = 'button'; edit.addEventListener('click', () => openShiftEditor(shift));
      row.append(person, dates, make('b', '', hours), edit); list.append(row);
    });
  }

  async function refreshStatus() {
    if (!getUid()) return;
    try {
      const response = await call('getPOSClockStatus');
      active = new Map((response.data?.active || []).filter(row => row.staffId && row.clockInMs).map(row => [row.staffId, row.clockInMs]));
      renderStaff(); status('');
    } catch (error) { console.error('Could not load clock status', error); status('Could not load staff clock status. Try Refresh.'); }
  }

  async function loadReport() {
    if (!unlocked()) { lock(); return; }
    try {
      const response = await call('getPOSClockReport', { days });
      shifts = response.data?.shifts || []; truncated = response.data?.truncated === true;
      renderShifts(); status('');
    } catch (error) {
      console.error('Could not load timesheets', error);
      if (error.code === 'functions/permission-denied') { lock(); status('Manager access expired. Enter the venue password again.'); }
      else status('Could not load timesheets. Try Refresh.');
    }
  }

  async function unlock(event) {
    event.preventDefault();
    const user = auth.currentUser; const password = $('clockPassword').value;
    if (!user?.email || !password) return;
    const submit = $('clockUnlockForm').querySelector('button'); submit.disabled = true; submit.textContent = 'Checking…';
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      await user.getIdToken(true);
      unlockedUntil = Date.now() + 4.5 * 60 * 1000;
      clearTimeout(relockTimer); relockTimer = setTimeout(() => { lock(); status('Manager access expired. Unlock again to continue.'); }, 4.5 * 60 * 1000);
      $('clockPassword').value = '';
      $('clockUnlock').hidden = true; $('clockReportArea').hidden = false;
      renderStaff(); await loadReport();
    } catch (error) { console.error('Could not unlock time clock', error); status('Password could not be verified. Try again.'); }
    finally { $('clockPassword').value = ''; submit.disabled = false; submit.textContent = 'Unlock timesheets'; }
  }

  function input(label, name, value = '', type = 'text') {
    const wrapper = make('label'); wrapper.append(make('span', '', label));
    const element = make('input'); element.name = name; element.type = type; element.value = value; wrapper.append(element);
    return wrapper;
  }

  function openStaffEditor(member = null) {
    if (!unlocked()) { lock(); return; }
    editor = { kind: 'staff', member };
    $('clockEditorTitle').textContent = member ? 'Edit staff' : 'Add staff';
    $('clockEditorError').hidden = true;
    const fields = $('clockEditorFields'); fields.replaceChildren();
    fields.append(input('First name', 'firstName', member?.firstName || ''), input('Last name', 'lastName', member?.lastName || ''));
    fields.append(input(member ? 'New 4-digit PIN (leave blank to keep)' : '4-digit PIN', 'pin', '', 'password'));
    const pin = fields.querySelector('[name=pin]'); pin.inputMode = 'numeric'; pin.maxLength = 4; pin.autocomplete = 'new-password';
    if (member) {
      const row = make('label', 'checkbox-field'); const activeInput = make('input'); activeInput.type = 'checkbox'; activeInput.name = 'active'; activeInput.checked = member.active !== false;
      row.append(activeInput, make('span', '', 'Active on the iPad')); fields.append(row);
    }
    const group = make('fieldset', 'permission-grid'); group.append(make('legend', '', 'App access'));
    const selected = member?.allowedSections || permissions.map(([value]) => value);
    permissions.forEach(([value, title]) => {
      const row = make('label', 'checkbox-field'); const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.name = 'permission'; checkbox.value = value;
      checkbox.checked = member ? selected.includes(value) : value === 'sell'; row.append(checkbox, make('span', '', title)); group.append(row);
    });
    fields.append(group); $('clockEditorDialog').showModal();
  }

  function openShiftEditor(shift = null) {
    if (!unlocked()) { lock(); return; }
    editor = { kind: 'shift', shift };
    $('clockEditorTitle').textContent = shift ? 'Correct shift' : 'Add missed shift';
    $('clockEditorError').hidden = true;
    const fields = $('clockEditorFields'); fields.replaceChildren();
    if (!shift) {
      const label = make('label'); label.append(make('span', '', 'Staff member'));
      const select = make('select'); select.name = 'staffId';
      staff.forEach(member => { const option = make('option', '', staffName(member)); option.value = member.id; select.append(option); });
      label.append(select); fields.append(label);
    } else fields.append(make('p', 'clock-shift-person', shift.staffName || 'Staff member'));
    const now = new Date();
    const inField = input('Clock in', 'clockIn', localInput(shift ? new Date(shift.clockInMs) : new Date(now.getTime() - 3600000)), 'datetime-local');
    const outField = input('Clock out', 'clockOut', localInput(shift?.clockOutMs ? new Date(shift.clockOutMs) : now), 'datetime-local');
    fields.append(inField, outField);
    const reason = make('label'); reason.append(make('span', '', 'Reason for correction'));
    const note = make('textarea'); note.name = 'reason'; note.maxLength = 300; note.rows = 3; reason.append(note); fields.append(reason);
    fields.append(make('small', 'clock-audit-note', 'Corrections are logged; shifts are never deleted.'));
    $('clockEditorDialog').showModal();
  }

  async function digestPIN(pin) {
    const data = new TextEncoder().encode(`avent-staff-pin:${getUid()}:${pin}`);
    const bytes = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function saveEditor(event) {
    event.preventDefault(); if (!editor || !unlocked()) { lock(); return; }
    const fields = new FormData($('clockEditorForm')); const button = $('saveClockEditor');
    const errorBox = $('clockEditorError'); errorBox.hidden = true;
    button.disabled = true; button.textContent = 'Saving…';
    try {
      if (editor.kind === 'staff') {
        const firstName = String(fields.get('firstName') || '').trim();
        const lastName = String(fields.get('lastName') || '').trim();
        const pin = String(fields.get('pin') || '').trim();
        const allowedSections = fields.getAll('permission');
        if (!firstName || !lastName) throw new Error('Enter a first and last name.');
        if (!allowedSections.length) throw new Error('Choose at least one app area.');
        if ((!editor.member && !/^\d{4}$/.test(pin)) || (pin && !/^\d{4}$/.test(pin))) throw new Error('Use a unique four-digit PIN.');
        const data = { firstName, lastName, allowedSections, active: editor.member ? fields.get('active') === 'on' : true, updatedAt: serverTimestamp() };
        if (pin) {
          const digest = await digestPIN(pin);
          if (staff.some(member => member.id !== editor.member?.id && member.pinDigest === digest)) throw new Error('That PIN is already assigned to another staff member.');
          data.pinDigest = digest;
        }
        if (editor.member) await updateDoc(staffRef(editor.member.id), data);
        else await addDoc(collection(db, 'venues', getUid(), 'staff'), { ...data, createdAt: serverTimestamp() });
      } else {
        const shift = editor.shift;
        const staffId = shift?.staffId || String(fields.get('staffId') || '');
        const clockInMs = new Date(String(fields.get('clockIn') || '')).getTime();
        const clockOutMs = new Date(String(fields.get('clockOut') || '')).getTime();
        const reason = String(fields.get('reason') || '').trim();
        if (!staffId || !Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs) || clockOutMs <= clockInMs || reason.length < 3) throw new Error('Enter valid shift times and a correction reason.');
        await call('savePOSClockCorrection', { staffId, ...(shift ? { shiftId: shift.id } : {}), clockInMs, clockOutMs, reason });
        await Promise.all([loadReport(), refreshStatus()]);
      }
      $('clockEditorDialog').close(); editor = null; status('Saved to AVNT.');
    } catch (error) {
      console.error('Could not save time clock change', error);
      errorBox.textContent = error instanceof Error && !String(error.code || '').startsWith('functions/') ? error.message : errorText(error) || 'Could not save this change.';
      errorBox.hidden = false;
    } finally { button.disabled = false; button.textContent = 'Save'; }
  }

  $('clockUnlockForm').addEventListener('submit', unlock);
  $('clockRefresh').addEventListener('click', async () => { await refreshStatus(); if (unlocked()) await loadReport(); });
  $('clockDays').addEventListener('change', event => { days = Number(event.target.value); loadReport(); });
  $('clockAddStaff').addEventListener('click', () => openStaffEditor());
  $('clockAddShift').addEventListener('click', () => openShiftEditor());
  $('clockEditorForm').addEventListener('submit', saveEditor);
  $('closeClockEditor').addEventListener('click', () => $('clockEditorDialog').close());
  $('cancelClockEditor').addEventListener('click', () => $('clockEditorDialog').close());

  function start(uid) {
    stop();
    status('');
    unsubscribe = onSnapshot(collection(db, 'venues', uid, 'staff'), snapshot => {
      staff = snapshot.docs.map(value => ({ id: value.id, ...value.data() })); renderStaff();
    }, error => { console.error('Could not load clock staff', error); status('Could not load staff profiles. Refresh to try again.'); });
    refreshStatus();
  }
  function stop() { unsubscribe?.(); unsubscribe = null; staff = []; active = new Map(); lock(); }
  renderStaff();
  return { start, stop, refreshStatus };
}
