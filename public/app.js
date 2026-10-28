// ==================== STATE ====================
let customers = [];
let currentCustomer = null;
let customerInvoiceFilter = 'all'; // 'all' | 'unpaid' | 'paid'
let newInvoicePaidState = false;
let globalInvoices = [];
let appSettings = null;
let auditLogs = [];
let deferredPwaPrompt = null;

// ==================== PWA SERVICE WORKER & INSTALL PROMPT ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredPwaPrompt = null;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.classList.add('hidden');
  showToast('Rechnungs-LOG wurde als App installiert!');
});

async function installPwaApp() {
  if (!deferredPwaPrompt) return;
  deferredPwaPrompt.prompt();
  await deferredPwaPrompt.userChoice;
  deferredPwaPrompt = null;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.classList.add('hidden');
}

// ==================== INITIALIZATION & AUTH ====================
document.addEventListener('DOMContentLoaded', async () => {
  setTodayOnInvoiceInput();
  await checkAuthAndInit();
});

async function checkAuthAndInit() {
  const res = await fetch('/api/auth/status');
  if (res.ok) {
    const data = await res.json();
    document.getElementById('login-overlay').classList.add('hidden');
    const newUserField = document.getElementById('cred-new-user');
    if (newUserField) newUserField.value = data.username || 'admin';
    await loadSettings();
    await Promise.all([
      loadCustomers(),
      loadAuditLogs()
    ]);
  } else {
    document.getElementById('login-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('login-username')?.focus(), 100);
  }
}

async function submitLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (res.ok) {
    document.getElementById('login-password').value = '';
    await checkAuthAndInit();
    showToast('Erfolgreich angemeldet!');
  } else {
    const err = await res.json();
    errEl.textContent = err.error || 'Anmeldung fehlgeschlagen';
    errEl.classList.remove('hidden');
  }
}

async function logoutUser() {
  await fetch('/api/auth/logout', { method: 'POST' });
  document.getElementById('login-overlay').classList.remove('hidden');
  showToast('Erfolgreich abgemeldet.');
}

async function saveCredentials(e) {
  e.preventDefault();
  const current_password = document.getElementById('cred-current-pw').value;
  const new_username = document.getElementById('cred-new-user').value;
  const new_password = document.getElementById('cred-new-pw').value;

  const res = await fetch('/api/auth/credentials', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password, new_username, new_password })
  });

  if (res.ok) {
    document.getElementById('cred-current-pw').value = '';
    document.getElementById('cred-new-pw').value = '';
    showToast('Zugangsdaten erfolgreich aktualisiert!');
  } else {
    const err = await res.json();
    showToast(err.error || 'Fehler beim Aktualisieren der Zugangsdaten', 'error');
  }
}

function setTodayOnInvoiceInput() {
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById('inv-date');
  if (dateInput) dateInput.value = today;
}

// ==================== HELPERS ====================
function formatCurrency(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatDateDE(isoDate) {
  if (!isoDate) return '-';
  const parts = isoDate.slice(0, 10).split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, type = 'success', showUndo = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-rose-600' : 'bg-slate-900';

  toast.className = `${bg} text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 text-sm flex items-center gap-3 transition-all duration-300`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    ${showUndo ? `<button onclick="undoLastAction(); this.parentElement.remove();" class="px-2.5 py-1 bg-amber-400 text-slate-950 font-bold text-xs rounded-md hover:bg-amber-300 transition">↩ Rückgängig</button>` : ''}
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ==================== TAB NAVIGATION ====================
function switchTab(tab) {
  const tabs = ['customers', 'global', 'settings'];
  tabs.forEach(t => {
    const view = document.getElementById(`view-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (t === tab) {
      view.classList.remove('hidden');
      btn.className = 'px-3.5 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-2 bg-emerald-600 text-white';
    } else {
      view.classList.add('hidden');
      btn.className = 'px-3.5 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-2 text-slate-300 hover:text-white hover:bg-slate-700';
    }
  });

  if (tab === 'global') {
    loadGlobalInvoices();
  } else if (tab === 'settings') {
    loadSettings();
  } else if (tab === 'customers') {
    loadCustomers(currentCustomer ? currentCustomer.id : null);
  }
}

// ==================== SETTINGS & INVOICE NUMBER GENERATOR ====================
async function loadSettings() {
  const dateInput = document.getElementById('inv-date');
  const dateVal = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().slice(0, 10);
  const res = await fetch(`/api/settings?date=${encodeURIComponent(dateVal)}`);
  appSettings = await res.json();

  // Populate settings form
  document.getElementById('set-prefix').value = appSettings.prefix_schema || '';
  document.getElementById('set-suffix').value = appSettings.suffix_schema || '';
  document.getElementById('set-digits').value = appSettings.number_digits || 5;
  document.getElementById('set-next-seq').value = appSettings.next_sequence || 1;
  document.getElementById('set-yearly-reset').checked = Boolean(appSettings.yearly_reset);

  const defaultSort = appSettings.default_sort_order || 'date_desc';
  const defaultSortEl = document.getElementById('set-default-sort');
  if (defaultSortEl) defaultSortEl.value = defaultSort;

  const custSortEl = document.getElementById('cust-invoice-sort');
  if (custSortEl) custSortEl.value = defaultSort;

  updateSettingsLivePreview();

  const invNumberInput = document.getElementById('inv-number');
  if (invNumberInput && !invNumberInput.value) {
    invNumberInput.value = appSettings.preview_next;
  }
}

async function updateInvoiceNumberPreview(force = false) {
  const dateVal = document.getElementById('inv-date').value || new Date().toISOString().slice(0, 10);
  const res = await fetch(`/api/settings?date=${encodeURIComponent(dateVal)}`);
  const data = await res.json();
  appSettings = data;
  const invNumberInput = document.getElementById('inv-number');
  if (force || !invNumberInput.value) {
    invNumberInput.value = data.preview_next;
  }
}

function applySchemaPreset(prefix, suffix, digits) {
  document.getElementById('set-prefix').value = prefix;
  document.getElementById('set-suffix').value = suffix;
  document.getElementById('set-digits').value = digits;
  updateSettingsLivePreview();
}

function updateSettingsLivePreview() {
  const prefix = document.getElementById('set-prefix').value || '';
  const suffix = document.getElementById('set-suffix').value || '';
  const digits = Math.max(1, Math.min(12, parseInt(document.getElementById('set-digits').value, 10) || 5));
  const seq = Math.max(1, parseInt(document.getElementById('set-next-seq').value, 10) || 1);

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  const replaceTokens = (str) =>
    str
      .replace(/\{YYYY\}/gi, yyyy)
      .replace(/\{YY\}/gi, yy)
      .replace(/\{MM\}/gi, mm)
      .replace(/\{DD\}/gi, dd);

  const preview = `${replaceTokens(prefix)}${String(seq).padStart(digits, '0')}${replaceTokens(suffix)}`;
  document.getElementById('set-live-preview').textContent = preview;
}

async function saveSettings(e) {
  e.preventDefault();
  const payload = {
    prefix_schema: document.getElementById('set-prefix').value,
    suffix_schema: document.getElementById('set-suffix').value,
    number_digits: parseInt(document.getElementById('set-digits').value, 10) || 5,
    next_sequence: parseInt(document.getElementById('set-next-seq').value, 10) || 1,
    yearly_reset: document.getElementById('set-yearly-reset').checked ? 1 : 0,
    default_sort_order: document.getElementById('set-default-sort').value || 'date_desc'
  };

  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    appSettings = await res.json();
    document.getElementById('inv-number').value = appSettings.preview_next;
    const custSortEl = document.getElementById('cust-invoice-sort');
    if (custSortEl) custSortEl.value = appSettings.default_sort_order || 'date_desc';
    if (currentCustomer) renderCustomerInvoices();
    await loadAuditLogs();
    showToast('Einstellungen gespeichert!', 'success', true);
  } else {
    showToast('Fehler beim Speichern der Einstellungen', 'error');
  }
}

// ==================== CUSTOMERS ====================
async function loadCustomers(selectCustomerId = null) {
  const res = await fetch('/api/customers');
  customers = await res.json();
  renderCustomerList();

  if (selectCustomerId) {
    await selectCustomer(selectCustomerId);
  } else if (currentCustomer) {
    const stillExists = customers.find(c => c.id === currentCustomer.id);
    if (stillExists) {
      await selectCustomer(currentCustomer.id);
    } else {
      currentCustomer = null;
      updateCustomerDetailView();
    }
  } else if (customers.length > 0) {
    await selectCustomer(customers[0].id);
  } else {
    updateCustomerDetailView();
  }
}

function renderCustomerList() {
  const listEl = document.getElementById('customer-list');
  const totalBadge = document.getElementById('customer-total-badge');
  if (totalBadge) {
    totalBadge.textContent = `${customers.length} ${customers.length === 1 ? 'Kunde' : 'Kunden'}`;
  }

  const query = (document.getElementById('customer-search').value || '').toLowerCase().trim();

  const filtered = customers.filter(c => {
    const full = `${c.last_name} ${c.first_name} ${c.city} ${c.zip_code} ${c.street}`.toLowerCase();
    return full.includes(query);
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="col-span-full py-4 text-center text-xs text-slate-400">Keine passenden Kunden gefunden.</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(c => {
    const isSelected = currentCustomer && currentCustomer.id === c.id;
    const unpaidBadge = c.unpaid_count > 0
      ? `<span class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-700" title="Offene Rechnungen">❌ ${c.unpaid_count} (${formatCurrency(c.unpaid_amount)})</span>`
      : (c.invoice_count > 0 ? `<span class="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700">✅</span>` : '');

    return `
      <div onclick="selectCustomer(${c.id})"
        class="p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between gap-2 ${isSelected ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500/20 shadow-xs' : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'}">
        <div class="min-w-0">
          <div class="font-bold text-xs text-slate-900 truncate">
            ${escapeHtml(c.last_name)}${c.first_name ? ', ' + escapeHtml(c.first_name) : ''}
          </div>
          <div class="text-[11px] text-slate-500 truncate">
            ${escapeHtml(c.zip_code)} ${escapeHtml(c.city)}
          </div>
        </div>
        <div class="shrink-0 flex flex-col items-end gap-0.5">
          ${unpaidBadge}
          <span class="text-[10px] text-slate-400">${c.invoice_count || 0} Rechn.</span>
        </div>
      </div>
    `;
  }).join('');
}

async function selectCustomer(id) {
  const res = await fetch(`/api/customers/${id}`);
  if (!res.ok) return;
  currentCustomer = await res.json();
  renderCustomerList();
  updateCustomerDetailView();
  await updateInvoiceNumberPreview(true);
}

function updateCustomerDetailView() {
  const emptyEl = document.getElementById('no-customer-selected');
  const detailEl = document.getElementById('customer-detail-container');

  if (!currentCustomer) {
    emptyEl.classList.remove('hidden');
    detailEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  detailEl.classList.remove('hidden');

  const fullName = `${currentCustomer.last_name}${currentCustomer.first_name ? ', ' + currentCustomer.first_name : ''}`;
  document.getElementById('detail-customer-name').textContent = fullName;

  const addressLines = [
    `${currentCustomer.first_name ? currentCustomer.first_name + ' ' : ''}${currentCustomer.last_name}`,
    currentCustomer.street,
    `${currentCustomer.zip_code} ${currentCustomer.city}`.trim()
  ].filter(Boolean).join('\n');

  document.getElementById('detail-customer-address').textContent = addressLines || 'Keine Adresse hinterlegt';
  document.getElementById('detail-customer-phone').textContent = currentCustomer.phone || '—';
  document.getElementById('detail-customer-email').textContent = currentCustomer.email || '—';
  document.getElementById('detail-customer-notes').value = currentCustomer.notes || '';

  renderCustomerDocuments();
  renderCustomerInvoices();
}

function copyShippingAddress() {
  if (!currentCustomer) return;
  const text = [
    `${currentCustomer.first_name ? currentCustomer.first_name + ' ' : ''}${currentCustomer.last_name}`,
    currentCustomer.street,
    `${currentCustomer.zip_code} ${currentCustomer.city}`.trim()
  ].filter(Boolean).join('\n');

  navigator.clipboard.writeText(text);
  showToast('Versandadresse in die Zwischenablage kopiert!');
}

async function saveCustomerNotes() {
  if (!currentCustomer) return;
  const newNotes = document.getElementById('detail-customer-notes').value;
  if (newNotes === currentCustomer.notes) return;

  const res = await fetch(`/api/customers/${currentCustomer.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...currentCustomer, notes: newNotes })
  });

  if (res.ok) {
    currentCustomer.notes = newNotes;
    const ind = document.getElementById('notes-save-indicator');
    ind.classList.remove('hidden');
    setTimeout(() => ind.classList.add('hidden'), 2000);
    await loadAuditLogs();
  }
}

function openCustomerModal(editId = null) {
  const modal = document.getElementById('customer-modal');
  const title = document.getElementById('customer-modal-title');

  if (editId && currentCustomer && currentCustomer.id === editId) {
    title.textContent = 'Kundenstammdaten bearbeiten';
    document.getElementById('cust-modal-id').value = currentCustomer.id;
    document.getElementById('cust-modal-lastname').value = currentCustomer.last_name || '';
    document.getElementById('cust-modal-firstname').value = currentCustomer.first_name || '';
    document.getElementById('cust-modal-street').value = currentCustomer.street || '';
    document.getElementById('cust-modal-zip').value = currentCustomer.zip_code || '';
    document.getElementById('cust-modal-city').value = currentCustomer.city || '';
    document.getElementById('cust-modal-phone').value = currentCustomer.phone || '';
    document.getElementById('cust-modal-email').value = currentCustomer.email || '';
    document.getElementById('cust-modal-notes').value = currentCustomer.notes || '';
  } else {
    title.textContent = 'Neuen Kunden anlegen';
    document.getElementById('customer-modal-form').reset();
    document.getElementById('cust-modal-id').value = '';
  }

  modal.classList.remove('hidden');
}

function closeCustomerModal() {
  document.getElementById('customer-modal').classList.add('hidden');
}

async function submitCustomerModal(e) {
  e.preventDefault();
  const id = document.getElementById('cust-modal-id').value;
  const payload = {
    last_name: document.getElementById('cust-modal-lastname').value,
    first_name: document.getElementById('cust-modal-firstname').value,
    street: document.getElementById('cust-modal-street').value,
    zip_code: document.getElementById('cust-modal-zip').value,
    city: document.getElementById('cust-modal-city').value,
    phone: document.getElementById('cust-modal-phone').value,
    email: document.getElementById('cust-modal-email').value,
    notes: document.getElementById('cust-modal-notes').value
  };

  const url = id ? `/api/customers/${id}` : '/api/customers';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    const saved = await res.json();
    closeCustomerModal();
    await loadCustomers(saved.id);
    await loadAuditLogs();
    showToast(id ? 'Kundendaten aktualisiert!' : 'Neuer Kunde angelegt!', 'success', true);
  } else {
    const err = await res.json();
    showToast(err.error || 'Fehler beim Speichern', 'error');
  }
}

async function deleteCurrentCustomer() {
  if (!currentCustomer) return;
  if (!confirm(`Möchtest du den Kunden "${currentCustomer.last_name}" inklusive aller zugehörigen Rechnungen wirklich löschen? (Kann über "Rückgängig" wiederhergestellt werden)`)) {
    return;
  }

  const res = await fetch(`/api/customers/${currentCustomer.id}`, { method: 'DELETE' });
  if (res.ok) {
    currentCustomer = null;
    await loadCustomers();
    await loadAuditLogs();
    showToast('Kunde wurde gelöscht.', 'success', true);
  }
}

// ==================== CUSTOMER PDF DOCUMENTS ====================
function renderCustomerDocuments() {
  const docs = (currentCustomer && currentCustomer.documents) || [];
  document.getElementById('detail-doc-count').textContent = `${docs.length} PDF${docs.length === 1 ? '' : 's'}`;
  const listEl = document.getElementById('customer-doc-list');

  if (docs.length === 0) {
    listEl.innerHTML = `<div class="py-4 text-center text-slate-400">Noch keine PDF-Dokumente hinterlegt.</div>`;
    return;
  }

  listEl.innerHTML = docs.map(d => `
    <div class="py-2 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <a href="/uploads/${encodeURIComponent(d.file_name)}" target="_blank"
          class="font-semibold text-blue-600 hover:underline flex items-center gap-1 truncate">
          <span>📄</span> ${escapeHtml(d.original_name)}
        </a>
        ${d.description ? `<div class="text-[11px] text-slate-500 truncate">${escapeHtml(d.description)}</div>` : ''}
      </div>
      <button onclick="deleteCustomerDocument(${d.id})"
        class="text-slate-400 hover:text-rose-600 px-1.5 py-0.5 rounded" title="PDF löschen">
        🗑️
      </button>
    </div>
  `).join('');
}

async function uploadCustomerPdf(e) {
  e.preventDefault();
  if (!currentCustomer) return;
  const fileInput = document.getElementById('customer-pdf-input');
  const descInput = document.getElementById('customer-pdf-desc');
  if (!fileInput.files.length) return;

  const formData = new FormData();
  formData.append('pdf', fileInput.files[0]);
  formData.append('description', descInput.value || '');

  const res = await fetch(`/api/customers/${currentCustomer.id}/documents`, {
    method: 'POST',
    body: formData
  });

  if (res.ok) {
    document.getElementById('customer-pdf-form').reset();
    await selectCustomer(currentCustomer.id);
    await loadAuditLogs();
    showToast('PDF-Dokument erfolgreich gespeichert!', 'success', true);
  } else {
    showToast('Fehler beim PDF-Upload', 'error');
  }
}

async function deleteCustomerDocument(docId) {
  const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
  if (res.ok) {
    await selectCustomer(currentCustomer.id);
    await loadAuditLogs();
    showToast('PDF-Dokument gelöscht.', 'success', true);
  }
}

// ==================== CUSTOMER CHRONOLOGICAL INVOICES ====================
function toggleNewInvoicePaidState() {
  newInvoicePaidState = !newInvoicePaidState;
  const btn = document.getElementById('inv-paid-toggle');
  if (newInvoicePaidState) {
    btn.textContent = '✅';
    btn.className = 'px-2.5 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 font-bold text-sm hover:bg-emerald-100 transition shrink-0';
  } else {
    btn.textContent = '❌';
    btn.className = 'px-2.5 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 font-bold text-sm hover:bg-rose-100 transition shrink-0';
  }
}

function setCustomerInvoiceFilter(filter) {
  customerInvoiceFilter = filter;
  ['all', 'unpaid', 'paid'].forEach(f => {
    const btn = document.getElementById(`cust-filter-${f}`);
    if (f === filter) {
      btn.className = 'px-2.5 py-1 rounded-md bg-slate-800 text-white transition';
    } else {
      btn.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:bg-slate-100 transition';
    }
  });
  renderCustomerInvoices();
}

function renderCustomerInvoices() {
  if (!currentCustomer) return;
  const tbody = document.getElementById('customer-invoices-tbody');
  const tfoot = document.getElementById('customer-invoices-tfoot');
  const sortMode = document.getElementById('cust-invoice-sort').value;

  let list = [...(currentCustomer.invoices || [])];

  if (customerInvoiceFilter === 'unpaid') {
    list = list.filter(i => !i.is_paid);
  } else if (customerInvoiceFilter === 'paid') {
    list = list.filter(i => Boolean(i.is_paid));
  }

  list.sort((a, b) => {
    if (sortMode === 'date_asc') return a.invoice_date.localeCompare(b.invoice_date) || (a.id - b.id);
    if (sortMode === 'date_desc') return b.invoice_date.localeCompare(a.invoice_date) || (b.id - a.id);
    if (sortMode === 'number_asc') return a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true });
    if (sortMode === 'number_desc') return b.invoice_number.localeCompare(a.invoice_number, undefined, { numeric: true });
    return 0;
  });

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-slate-400">
          Keine Rechnungseinträge für diese Ansicht vorhanden.
        </td>
      </tr>
    `;
    tfoot.innerHTML = '';
    return;
  }

  let totalSum = 0;
  let paidSum = 0;
  let unpaidSum = 0;

  tbody.innerHTML = list.map(inv => {
    const amt = Number(inv.amount) || 0;
    totalSum += amt;
    if (inv.is_paid) paidSum += amt;
    else unpaidSum += amt;

    const statusBtn = inv.is_paid
      ? `<button onclick="toggleInvoicePaid(${inv.id})"
           class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300 transition shadow-2xs"
           title="Klicken, um auf UNBEZAHLT (Rotes X) umzuschalten">
           <span>✅</span> Bezahlt
         </button>`
      : `<button onclick="toggleInvoicePaid(${inv.id})"
           class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300 transition shadow-2xs"
           title="Klicken, um auf BEZAHLT (Grüner Haken) umzuschalten">
           <span>❌</span> Offen
         </button>`;

    const pdfLink = inv.pdf_filename
      ? `<a href="/uploads/${encodeURIComponent(inv.pdf_filename)}" target="_blank"
           class="inline-flex items-center justify-center text-xs font-medium text-blue-600 hover:underline"
           title="${escapeHtml(inv.pdf_original_name || 'PDF öffnen')}">
           📄 PDF
         </a>`
      : `<span class="text-xs text-slate-300">—</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition ${inv.is_paid ? '' : 'bg-rose-50/20'}">
        <td class="py-2.5 px-3 text-xs font-medium text-slate-600 whitespace-nowrap">${formatDateDE(inv.invoice_date)}</td>
        <td class="py-2.5 px-3 text-xs font-mono font-bold text-slate-900 whitespace-nowrap">${escapeHtml(inv.invoice_number)}</td>
        <td class="py-2.5 px-4 text-sm text-slate-800 w-full break-words">${escapeHtml(inv.description) || '<span class="text-slate-300 italic">Kein Text</span>'}</td>
        <td class="py-2.5 px-2 text-center whitespace-nowrap">${pdfLink}</td>
        <td class="py-2.5 px-3 text-xs text-right font-bold whitespace-nowrap ${inv.is_paid ? 'text-slate-800' : 'text-rose-700'}">${formatCurrency(amt)}</td>
        <td class="py-2.5 px-3 text-center whitespace-nowrap">${statusBtn}</td>
        <td class="py-2.5 px-3 text-right whitespace-nowrap">
          <button onclick='openInvoiceModal(${JSON.stringify(inv).replace(/'/g, "&#39;")})'
            class="text-slate-400 hover:text-blue-600 px-1 py-0.5 rounded" title="Eintrag bearbeiten">✏️</button>
          <button onclick="deleteInvoice(${inv.id})"
            class="text-slate-400 hover:text-rose-600 px-1 py-0.5 rounded" title="Eintrag löschen">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  tfoot.innerHTML = `
    <tr>
      <td colspan="4" class="py-2.5 px-3 text-xs text-slate-600">
        Summe (${list.length} ${list.length === 1 ? 'Rechnung' : 'Rechnungen'}) •
        <span class="text-emerald-700">✅ Bezahlt: ${formatCurrency(paidSum)}</span> •
        <span class="text-rose-700">❌ Offen: ${formatCurrency(unpaidSum)}</span>
      </td>
      <td class="py-2.5 px-3 text-xs text-right text-slate-900 font-bold whitespace-nowrap">${formatCurrency(totalSum)}</td>
      <td colspan="2"></td>
    </tr>
  `;
}

async function createCustomerInvoice(e) {
  e.preventDefault();
  if (!currentCustomer) return;

  const formData = new FormData();
  formData.append('customer_id', currentCustomer.id);
  formData.append('invoice_date', document.getElementById('inv-date').value);
  formData.append('invoice_number', document.getElementById('inv-number').value);
  formData.append('description', document.getElementById('inv-desc').value);
  formData.append('amount', document.getElementById('inv-amount').value);
  formData.append('is_paid', newInvoicePaidState ? '1' : '0');

  const pdfInput = document.getElementById('inv-pdf');
  if (pdfInput.files.length > 0) {
    formData.append('pdf', pdfInput.files[0]);
  }

  const res = await fetch('/api/invoices', {
    method: 'POST',
    body: formData
  });

  if (res.ok) {
    document.getElementById('inv-desc').value = '';
    document.getElementById('inv-amount').value = '';
    document.getElementById('inv-pdf').value = '';
    if (newInvoicePaidState) toggleNewInvoicePaidState(); // Reset back to ❌ unpaid default
    setTodayOnInvoiceInput();

    await loadCustomers(currentCustomer.id);
    await updateInvoiceNumberPreview(true);
    await loadAuditLogs();
    showToast('Rechnung gebucht!', 'success', true);
  } else {
    const err = await res.json();
    showToast(err.error || 'Fehler beim Anlegen der Rechnung', 'error');
  }
}

async function toggleInvoicePaid(invoiceId) {
  const res = await fetch(`/api/invoices/${invoiceId}/toggle-paid`, { method: 'PATCH' });
  if (res.ok) {
    const updated = await res.json();
    if (currentCustomer) {
      await loadCustomers(currentCustomer.id);
    }
    if (!document.getElementById('view-global').classList.contains('hidden')) {
      await loadGlobalInvoices();
    }
    await loadAuditLogs();
    showToast(
      `Rechnung ${updated.invoice_number} als ${updated.is_paid ? 'BEZAHLT ✅' : 'OFFEN ❌'} markiert`,
      'success',
      true
    );
  }
}

function openInvoiceModal(inv) {
  document.getElementById('edit-inv-id').value = inv.id;
  document.getElementById('edit-inv-date').value = inv.invoice_date;
  document.getElementById('edit-inv-number').value = inv.invoice_number;
  document.getElementById('edit-inv-desc').value = inv.description || '';
  document.getElementById('edit-inv-amount').value = inv.amount;
  document.getElementById('edit-inv-paid').value = inv.is_paid ? '1' : '0';
  document.getElementById('edit-inv-pdf').value = '';
  document.getElementById('invoice-modal').classList.remove('hidden');
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.add('hidden');
}

async function submitInvoiceModal(e) {
  e.preventDefault();
  const id = document.getElementById('edit-inv-id').value;
  const formData = new FormData();
  formData.append('invoice_date', document.getElementById('edit-inv-date').value);
  formData.append('invoice_number', document.getElementById('edit-inv-number').value);
  formData.append('description', document.getElementById('edit-inv-desc').value);
  formData.append('amount', document.getElementById('edit-inv-amount').value);
  formData.append('is_paid', document.getElementById('edit-inv-paid').value);

  const pdfFile = document.getElementById('edit-inv-pdf').files[0];
  if (pdfFile) formData.append('pdf', pdfFile);

  const res = await fetch(`/api/invoices/${id}`, {
    method: 'PUT',
    body: formData
  });

  if (res.ok) {
    closeInvoiceModal();
    if (currentCustomer) await loadCustomers(currentCustomer.id);
    if (!document.getElementById('view-global').classList.contains('hidden')) await loadGlobalInvoices();
    await loadAuditLogs();
    showToast('Rechnung aktualisiert!', 'success', true);
  }
}

async function deleteInvoice(id) {
  if (!confirm('Diesen Rechnungseintrag wirklich löschen?')) return;
  const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
  if (res.ok) {
    if (currentCustomer) await loadCustomers(currentCustomer.id);
    if (!document.getElementById('view-global').classList.contains('hidden')) await loadGlobalInvoices();
    await loadAuditLogs();
    showToast('Rechnung gelöscht.', 'success', true);
  }
}

// ==================== GLOBAL INVOICE LIST (PERIOD & SORTED BY INVOICE NUMBER) ====================
function setGlobalPeriod(preset) {
  const fromEl = document.getElementById('global-from');
  const toEl = document.getElementById('global-to');
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();

  if (preset === 'all') {
    fromEl.value = '';
    toEl.value = '';
  } else if (preset === 'this_month') {
    const first = new Date(yyyy, mm, 1).toISOString().slice(0, 10);
    const last = new Date(yyyy, mm + 1, 0).toISOString().slice(0, 10);
    fromEl.value = first;
    toEl.value = last;
  } else if (preset === 'last_month') {
    const first = new Date(yyyy, mm - 1, 1).toISOString().slice(0, 10);
    const last = new Date(yyyy, mm, 0).toISOString().slice(0, 10);
    fromEl.value = first;
    toEl.value = last;
  } else if (preset === 'this_year') {
    fromEl.value = `${yyyy}-01-01`;
    toEl.value = `${yyyy}-12-31`;
  }
  loadGlobalInvoices();
}

async function loadGlobalInvoices() {
  const from = document.getElementById('global-from').value;
  const to = document.getElementById('global-to').value;
  const status = document.getElementById('global-status').value;
  const sort = document.getElementById('global-sort').value;
  const search = document.getElementById('global-search').value;

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status && status !== 'all') params.set('status', status);
  if (sort) params.set('sort', sort);
  if (search) params.set('search', search);

  const res = await fetch(`/api/invoices?${params.toString()}`);
  globalInvoices = await res.json();
  renderGlobalInvoices();
}

function renderGlobalInvoices() {
  const tbody = document.getElementById('global-invoices-tbody');

  let totalAmt = 0, paidAmt = 0, unpaidAmt = 0;
  let paidCount = 0, unpaidCount = 0;

  globalInvoices.forEach(i => {
    const a = Number(i.amount) || 0;
    totalAmt += a;
    if (i.is_paid) {
      paidAmt += a;
      paidCount++;
    } else {
      unpaidAmt += a;
      unpaidCount++;
    }
  });

  document.getElementById('global-sum-total').textContent = formatCurrency(totalAmt);
  document.getElementById('global-count-total').textContent = `${globalInvoices.length} Rechnungen`;
  document.getElementById('global-sum-paid').textContent = formatCurrency(paidAmt);
  document.getElementById('global-count-paid').textContent = `${paidCount} bezahlt`;
  document.getElementById('global-sum-unpaid').textContent = formatCurrency(unpaidAmt);
  document.getElementById('global-count-unpaid').textContent = `${unpaidCount} offen`;

  if (globalInvoices.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-10 text-center text-slate-400">
          Keine Rechnungen im gewählten Zeitraum / Filter gefunden.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = globalInvoices.map(inv => {
    const statusBtn = inv.is_paid
      ? `<button onclick="toggleInvoicePaid(${inv.id})"
           class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300 transition">
           <span>✅</span> Bezahlt
         </button>`
      : `<button onclick="toggleInvoicePaid(${inv.id})"
           class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300 transition">
           <span>❌</span> Offen
         </button>`;

    const pdfCell = inv.pdf_filename
      ? `<a href="/uploads/${encodeURIComponent(inv.pdf_filename)}" target="_blank" class="text-xs font-semibold text-blue-600 hover:underline">📄 PDF</a>`
      : `<span class="text-slate-300 text-xs">—</span>`;

    return `
      <tr class="hover:bg-slate-50 transition ${inv.is_paid ? '' : 'bg-rose-50/20'}">
        <td class="py-2.5 px-3 text-xs font-mono font-bold text-slate-900 whitespace-nowrap">${escapeHtml(inv.invoice_number)}</td>
        <td class="py-2.5 px-3 text-xs text-slate-600 whitespace-nowrap">${formatDateDE(inv.invoice_date)}</td>
        <td class="py-2.5 px-3 whitespace-nowrap">
          <button onclick="jumpToCustomer(${inv.customer_id})" class="font-bold text-xs text-slate-900 hover:text-emerald-700 hover:underline text-left">
            ${escapeHtml(inv.last_name)}${inv.first_name ? ', ' + escapeHtml(inv.first_name) : ''}
          </button>
          <div class="text-[11px] text-slate-400">${escapeHtml(inv.zip_code)} ${escapeHtml(inv.city)}</div>
        </td>
        <td class="py-2.5 px-4 text-sm text-slate-800 w-full break-words">${escapeHtml(inv.description) || '—'}</td>
        <td class="py-2.5 px-2 text-center whitespace-nowrap">${pdfCell}</td>
        <td class="py-2.5 px-3 text-xs text-right font-bold whitespace-nowrap ${inv.is_paid ? 'text-slate-800' : 'text-rose-700'}">${formatCurrency(inv.amount)}</td>
        <td class="py-2.5 px-3 text-center whitespace-nowrap">${statusBtn}</td>
      </tr>
    `;
  }).join('');
}

async function jumpToCustomer(customerId) {
  switchTab('customers');
  await selectCustomer(customerId);
}

function exportGlobalCsv() {
  if (!globalInvoices.length) {
    showToast('Keine Daten zum Exportieren vorhanden', 'error');
    return;
  }

  const headers = ['Rechnungsnummer', 'Datum', 'Nachname', 'Vorname', 'Strasse', 'PLZ', 'Ort', 'Beschreibung', 'Betrag_EUR', 'Status'];
  const rows = globalInvoices.map(i => [
    i.invoice_number,
    i.invoice_date,
    i.last_name,
    i.first_name,
    i.street,
    i.zip_code,
    i.city,
    i.description,
    Number(i.amount || 0).toFixed(2).replace('.', ','),
    i.is_paid ? 'Bezahlt' : 'Offen'
  ]);

  const csvContent = '\uFEFF' + [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rechnungs-Liste_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== UNDO / AUDIT LOG ====================
async function loadAuditLogs() {
  const res = await fetch('/api/audit-log');
  auditLogs = await res.json();

  const undoBtn = document.getElementById('undo-btn');
  const badge = document.getElementById('audit-count-badge');
  badge.textContent = auditLogs.length;

  if (auditLogs.length > 0) {
    undoBtn.disabled = false;
    undoBtn.title = `Rückgängig: ${auditLogs[0].summary}`;
  } else {
    undoBtn.disabled = true;
    undoBtn.title = 'Keine Aktion zum Rückgängigmachen vorhanden';
  }

  const listEl = document.getElementById('audit-list');
  if (auditLogs.length === 0) {
    listEl.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs">Noch keine Änderungen protokolliert.</div>`;
    return;
  }

  listEl.innerHTML = auditLogs.map((log, idx) => `
    <div class="p-3 hover:bg-slate-50 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-xs font-medium text-slate-800">${escapeHtml(log.summary)}</div>
        <div class="text-[11px] text-slate-400">${escapeHtml(log.timestamp)}</div>
      </div>
      ${idx === 0 ? `
        <button onclick="undoLastAction(${log.id})"
          class="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-xs rounded-md shrink-0 transition">
          ↩ Undo
        </button>
      ` : ''}
    </div>
  `).join('');
}

function toggleAuditDropdown() {
  const dd = document.getElementById('audit-dropdown');
  dd.classList.toggle('hidden');
}

async function undoLastAction(logId = null) {
  const res = await fetch('/api/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(logId ? { log_id: logId } : {})
  });

  if (res.ok) {
    const data = await res.json();
    await loadSettings();
    await loadCustomers(currentCustomer ? currentCustomer.id : null);
    if (!document.getElementById('view-global').classList.contains('hidden')) {
      await loadGlobalInvoices();
    }
    await loadAuditLogs();
    showToast(`Rückgängig gemacht: ${data.undone_log.summary}`);
  } else {
    const err = await res.json();
    showToast(err.error || 'Rückgängig nicht möglich', 'error');
  }
}
