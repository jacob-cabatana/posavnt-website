const pages = [...document.querySelectorAll('.page')];
const navItems = [...document.querySelectorAll('.nav-item')];
const sidebar = document.querySelector('.sidebar');
const mobileNavToggle = document.getElementById('mobileNavToggle');
const toast = document.getElementById('toast');
let toastTimer;

function navigate(pageId) {
  pages.forEach(page => page.classList.toggle('active', page.id === pageId));
  navItems.forEach(item => {
    const active = item.dataset.page === pageId;
    item.classList.toggle('active', active);
    active ? item.setAttribute('aria-current', 'page') : item.removeAttribute('aria-current');
  });
  sidebar.classList.remove('open');
  mobileNavToggle.setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  history.replaceState(null, '', `#${pageId}`);
}

navItems.forEach(item => item.addEventListener('click', () => navigate(item.dataset.page)));
document.querySelectorAll('[data-page-link]').forEach(item => item.addEventListener('click', () => navigate(item.dataset.pageLink)));
mobileNavToggle.addEventListener('click', () => {
  const open = sidebar.classList.toggle('open');
  mobileNavToggle.setAttribute('aria-expanded', String(open));
});

const periodData = {
  'Tonight': ['$4,512.53', '$5,944.77', '$5,944'],
  '7 days': ['$13,842.68', '$18,161.55', '$18,161'],
  '30 days': ['$48,921.40', '$63,834.12', '$63,834']
};
document.querySelectorAll('.period-control button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.period-control button').forEach(item => item.classList.toggle('active', item === button));
  const [gross, collected, total] = periodData[button.dataset.period];
  document.getElementById('periodLabel').textContent = button.dataset.period.toUpperCase();
  document.getElementById('grossSales').textContent = gross;
  document.getElementById('totalCollected').textContent = collected;
  document.getElementById('donutTotal').textContent = total;
}));

function showToast(message) {
  clearTimeout(toastTimer);
  toast.querySelector('p').textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
document.querySelectorAll('[data-toast]').forEach(button => button.addEventListener('click', () => showToast(button.dataset.toast)));

const menuRows = [...document.querySelectorAll('.menu-row')];
const menuSearch = document.getElementById('menuSearch');
let activeFilter = 'all';
function filterMenu() {
  const query = menuSearch.value.trim().toLowerCase();
  let visible = 0;
  menuRows.forEach(row => {
    const match = (activeFilter === 'all' || row.dataset.category === activeFilter) && row.dataset.name.includes(query);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  document.getElementById('menuEmpty').style.display = visible ? 'none' : 'block';
}
menuSearch.addEventListener('input', filterMenu);
document.querySelectorAll('.filter-tabs button').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter-tabs button').forEach(item => item.classList.toggle('active', item === button));
  filterMenu();
}));
document.querySelectorAll('.menu-row .switch input').forEach(input => input.addEventListener('change', () => {
  input.closest('.menu-row').classList.toggle('muted', !input.checked);
  showToast(input.checked ? 'Item marked available in preview' : 'Item hidden in preview');
}));

const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalDescription = document.getElementById('modalDescription');
const modalForm = document.getElementById('modalForm');
const modalSubmit = document.getElementById('modalSubmit');
function openModal(type) {
  if (type === 'staff') {
    modalTitle.textContent = 'Invite staff';
    modalDescription.textContent = 'Set a role now. No live invitation will be sent.';
    modalForm.innerHTML = '<label>Email address<input type="email" placeholder="name@waveclub.com"></label><label>Role<select><option>Bartender</option><option>Manager</option><option>Viewer</option></select></label>';
    modalSubmit.textContent = 'Create preview invite';
    modalSubmit.dataset.message = 'Preview invite created — no email was sent';
  } else if (type === 'menu') {
    modalTitle.textContent = 'Add menu item';
    modalDescription.textContent = 'Create a draft item for this preview only.';
    modalForm.innerHTML = '<label>Item name<input type="text" placeholder="Drink name"></label><label>Category<select><option>Cocktails</option><option>Spirits</option><option>Beer</option><option>Zero proof</option></select></label><label>Price<input type="text" inputmode="decimal" placeholder="$0.00"></label>';
    modalSubmit.textContent = 'Add draft item';
    modalSubmit.dataset.message = 'Draft item added in preview mode';
  } else {
    modalTitle.textContent = 'Welcome back';
    modalDescription.textContent = 'This is the dashboard sign-in preview. Live authentication is not connected.';
    modalForm.innerHTML = '<label>Email address<input type="email" value="mohammed@waveclub.com"></label><label>Password<input type="password" value="previewonly"></label>';
    modalSubmit.textContent = 'Sign in to preview';
    modalSubmit.dataset.message = 'Signed in to dashboard preview';
  }
  modalBackdrop.hidden = false;
  setTimeout(() => modalForm.querySelector('input')?.focus(), 0);
}
function closeModal() { modalBackdrop.hidden = true; }
document.getElementById('inviteStaff').addEventListener('click', () => openModal('staff'));
document.getElementById('addMenuItem').addEventListener('click', () => openModal('menu'));
document.getElementById('signOut').addEventListener('click', () => { window.location.href = '../client-login.html'; });
document.getElementById('modalClose').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', event => { if (event.target === modalBackdrop) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
modalSubmit.addEventListener('click', () => { closeModal(); showToast(modalSubmit.dataset.message); });
document.getElementById('saveSettings').addEventListener('click', () => showToast('Settings saved locally for this preview'));
document.getElementById('venueSwitcher').addEventListener('click', () => showToast('Wave Club is the only venue in this preview'));

const initialPage = location.hash.slice(1);
if (pages.some(page => page.id === initialPage)) navigate(initialPage);

// Let supported browsers expose the same safe preview actions to assistants.
const modelContext = document.modelContext;
if (modelContext?.registerTool) {
  const pageIds = pages.map(page => page.id);
  Promise.resolve(modelContext.registerTool({
    name: 'navigate_dashboard_preview',
    title: 'Open dashboard section',
    description: 'Navigate the AVNT dashboard preview to Overview, Money, Menu, Staff, or Account.',
    inputSchema: {
      type: 'object',
      properties: { section: { type: 'string', enum: pageIds } },
      required: ['section'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input) {
      if (!pageIds.includes(input?.section)) throw new Error('Unknown dashboard section.');
      navigate(input.section);
      return { section: input.section, mode: 'preview' };
    }
  })).catch(() => {});

  Promise.resolve(modelContext.registerTool({
    name: 'filter_menu_preview',
    title: 'Filter the preview menu',
    description: 'Open the Menu section and filter its temporary preview rows by category or search text.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['all', 'cocktails', 'spirits', 'beer', 'non-alcoholic'] },
        search: { type: 'string', maxLength: 80 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input = {}) {
      const category = input.category || 'all';
      if (!['all', 'cocktails', 'spirits', 'beer', 'non-alcoholic'].includes(category)) throw new Error('Unknown menu category.');
      activeFilter = category;
      menuSearch.value = typeof input.search === 'string' ? input.search.slice(0, 80) : '';
      document.querySelectorAll('.filter-tabs button').forEach(item => item.classList.toggle('active', item.dataset.filter === activeFilter));
      navigate('menu');
      filterMenu();
      return { category: activeFilter, search: menuSearch.value, visibleItems: menuRows.filter(row => row.style.display !== 'none').length, mode: 'preview' };
    }
  })).catch(() => {});
}
