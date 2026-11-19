// ==================== COSMOTERRA DIGITAL INVOICE STATE ====================
let ctItemsState = {};
let ctManualRows = [];
let ctPaidState = false;
let ctDescManuallyEdited = false;
let ctGiftTarget = null;
let ctBusy = false;

// ==================== UTILITIES ====================
function ctParseNum(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  if (val === null || val === undefined) return NaN;
  let s = String(val).trim().replace(/[€\s]/g, '');
  if (!s) return NaN;
  s = s.replace(/,\s*[-–—]+$/, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function ctFormatGermanDecimal(absNum) {
  const fixed = absNum.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withThousands},${decPart}`;
}

function ctFormatEur(val) {
  const num = Math.round((Number(val) || 0) * 100) / 100;
  if (num < 0) {
    return `- € ${ctFormatGermanDecimal(Math.abs(num))}`;
  }
  return `€ ${ctFormatGermanDecimal(num)}`;
}

function ctFormatPricePlain(val) {
  const num = Math.round((Number(val) || 0) * 100) / 100;
  return (num < 0 ? '-' : '') + ctFormatGermanDecimal(Math.abs(num));
}

function ctEscapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

const DEFAULT_COSMOTERRA_GIFT_TEXT = 'Geschenk von Herzen von deinem Berater {NAME}';

function resolveCosmoterraGiftText(settings) {
  const tpl = (settings && settings.cosmoterra_gift_text ? String(settings.cosmoterra_gift_text).trim() : '') || DEFAULT_COSMOTERRA_GIFT_TEXT;
  const partnerName = settings && settings.cosmoterra_partner_name ? String(settings.cosmoterra_partner_name).trim() : '';
  return tpl.replace(/\{NAME\}/gi, partnerName).replace(/\s+/g, ' ').trim();
}

// ==================== SETTINGS SYNC & PARTNER CONFIG ====================
function syncCosmoterraUI() {
  const enabled = Boolean(appSettings && appSettings.cosmoterra_enabled);

  // Customer view button near PDF-Ablage
  const openBtn = document.getElementById('btn-open-cosmoterra');
  if (openBtn) {
    if (enabled && typeof currentCustomer !== 'undefined' && currentCustomer) {
      openBtn.classList.remove('hidden');
    } else {
      openBtn.classList.add('hidden');
    }
  }

  // Settings tab fields
  const cbEnabled = document.getElementById('ct-set-enabled');
  if (cbEnabled && appSettings) {
    cbEnabled.checked = enabled;
    document.getElementById('ct-set-partner-name').value = appSettings.cosmoterra_partner_name || '';
    document.getElementById('ct-set-partner-address').value = appSettings.cosmoterra_partner_address || '';
    document.getElementById('ct-set-partner-gp-nr').value = appSettings.cosmoterra_partner_gp_nr || '';
    const giftTextEl = document.getElementById('ct-set-gift-text');
    if (giftTextEl) {
      giftTextEl.value = (appSettings.cosmoterra_gift_text || '').trim() || DEFAULT_COSMOTERRA_GIFT_TEXT;
    }

    const mode = appSettings.cosmoterra_partner_mode === 'image' ? 'image' : 'text';
    const radios = document.querySelectorAll('input[name="ct-set-partner-mode"]');
    radios.forEach((r) => {
      r.checked = r.value === mode;
    });
    toggleCosmoterraPartnerModeUI();

    const prevWrap = document.getElementById('ct-set-image-preview-wrap');
    const prevImg = document.getElementById('ct-set-image-preview');
    if (appSettings.cosmoterra_partner_image) {
      prevImg.src = `/uploads/${encodeUploadPath(appSettings.cosmoterra_partner_image)}?t=${Date.now()}`;
      prevWrap.classList.remove('hidden');
    } else {
      prevImg.src = '';
      prevWrap.classList.add('hidden');
    }
  }
}

function toggleCosmoterraPartnerModeUI() {
  const selected = document.querySelector('input[name="ct-set-partner-mode"]:checked');
  const mode = selected ? selected.value : 'text';
  const textBox = document.getElementById('ct-set-text-box');
  const imageBox = document.getElementById('ct-set-image-box');
  if (!textBox || !imageBox) return;

  if (mode === 'image') {
    textBox.classList.add('hidden');
    imageBox.classList.remove('hidden');
  } else {
    textBox.classList.remove('hidden');
    imageBox.classList.add('hidden');
  }
}

async function saveCosmoterraSettings(e) {
  e.preventDefault();
  const modeRadio = document.querySelector('input[name="ct-set-partner-mode"]:checked');
  const giftTextVal = (document.getElementById('ct-set-gift-text')?.value || '').trim() || DEFAULT_COSMOTERRA_GIFT_TEXT;
  const payload = {
    cosmoterra_enabled: document.getElementById('ct-set-enabled').checked ? 1 : 0,
    cosmoterra_partner_name: document.getElementById('ct-set-partner-name').value.trim(),
    cosmoterra_partner_address: document.getElementById('ct-set-partner-address').value.trim(),
    cosmoterra_partner_gp_nr: document.getElementById('ct-set-partner-gp-nr').value.trim(),
    cosmoterra_partner_mode: modeRadio ? modeRadio.value : 'text',
    cosmoterra_gift_text: giftTextVal
  };

  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    appSettings = await res.json();
    syncCosmoterraUI();
    await loadAuditLogs();
    showToast('Cosmoterra-Einstellungen gespeichert!', 'success', true);
  } else {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || 'Fehler beim Speichern der Cosmoterra-Einstellungen', 'error');
  }
}

function convertImageFileToPngBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 400;
        canvas.height = img.naturalHeight || img.height || 120;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Bild-Konvertierung fehlgeschlagen'));
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bilddatei konnte nicht gelesen werden'));
    };
    img.src = url;
  });
}

async function uploadCosmoterraPartnerImage(event) {
  const fileInput = event.target;
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  try {
    let uploadFile = file;
    let fileName = file.name || 'partner.png';
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      uploadFile = await convertImageFileToPngBlob(file);
      fileName = fileName.replace(/\.[^.]+$/, '') + '.png';
    }

    const formData = new FormData();
    formData.append('image', uploadFile, fileName);

    const res = await fetch('/api/settings/cosmoterra-image', {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      appSettings = await res.json();
      syncCosmoterraUI();
      await loadAuditLogs();
      showToast('Berater-Grafik hochgeladen und aktiviert!', 'success', true);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Fehler beim Hochladen der Grafik', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Grafik konnte nicht verarbeitet werden', 'error');
  } finally {
    fileInput.value = '';
  }
}

async function deleteCosmoterraPartnerImage() {
  if (!confirm('Hinterlegte Berater-Grafik wirklich entfernen?')) return;
  const res = await fetch('/api/settings/cosmoterra-image', { method: 'DELETE' });
  if (res.ok) {
    appSettings = await res.json();
    syncCosmoterraUI();
    await loadAuditLogs();
    showToast('Berater-Grafik entfernt.', 'success', true);
  } else {
    showToast('Fehler beim Entfernen der Grafik', 'error');
  }
}

// ==================== EDITOR MODAL LIFECYCLE ====================
function resetCosmoterraEditorState() {
  const cat = window.COSMOTERRA_CATALOG;
  ctItemsState = {};
  for (const p of [...cat.LEFT_PRODUCTS, ...cat.RIGHT_PRODUCTS]) {
    const key = `${p.side}:${p.rowIndex}`;
    ctItemsState[key] = {
      side: p.side,
      rowIndex: p.rowIndex,
      nr: p.nr,
      name: p.name,
      ust: p.ust,
      defaultPrice: p.price,
      wertmarken: Number(p.wertmarken) || 0,
      missingEq: Boolean(p.missingEq),
      qty: '',
      unitPrice: p.price,
      isAction: false,
      isGift: false
    };
  }

  ctManualRows = cat.MANUAL_ROW_INDICES.map(() => createEmptyManualRow());

  ctPaidState = false;
  ctDescManuallyEdited = false;
  ctGiftTarget = null;
}

function createEmptyManualRow() {
  return {
    nr: '',
    name: '',
    ust: '',
    qty: '',
    unitPrice: '',
    total: '',
    manualTotalOverride: false,
    isAction: false,
    isGift: false,
    isAutoWertmarken: false
  };
}

function openCosmoterraModal() {
  if (!currentCustomer) {
    showToast('Bitte zuerst einen Kunden auswählen.', 'error');
    return;
  }

  resetCosmoterraEditorState();

  // Header Left: Customer + Invoice defaults
  const today = new Date().toISOString().slice(0, 10);
  const mainInvNumber = document.getElementById('inv-number')?.value?.trim() || (appSettings?.preview_next || '');
  const custName = `${currentCustomer.first_name ? currentCustomer.first_name + ' ' : ''}${currentCustomer.last_name}`.trim();
  const custAddr = [
    currentCustomer.street || '',
    `${currentCustomer.zip_code || ''} ${currentCustomer.city || ''}`.trim()
  ].filter(Boolean).join(', ');

  document.getElementById('ct-head-inv-number').value = mainInvNumber;
  document.getElementById('ct-head-inv-date').value = today;
  document.getElementById('ct-head-cust-name').value = custName;
  document.getElementById('ct-head-cust-address').value = custAddr;

  // Header Right: Advisor details from Settings
  const partnerName = (appSettings?.cosmoterra_partner_name || '').trim();
  const partnerAddress = (appSettings?.cosmoterra_partner_address || '').trim();
  const partnerGp = (appSettings?.cosmoterra_partner_gp_nr || '').trim();
  const partnerMode = appSettings?.cosmoterra_partner_mode === 'image' ? 'image' : 'text';
  const partnerImg = (appSettings?.cosmoterra_partner_image || '').trim();

  document.getElementById('ct-head-partner-name').textContent = partnerName || '—';
  document.getElementById('ct-head-partner-address').textContent = partnerAddress || '—';
  document.getElementById('ct-head-partner-gp').textContent = partnerGp || '—';

  const textBlock = document.getElementById('ct-head-partner-text-block');
  const imgBlock = document.getElementById('ct-head-partner-image-block');
  const headImg = document.getElementById('ct-head-partner-img');
  if (partnerMode === 'image' && partnerImg) {
    headImg.src = `/uploads/${encodeUploadPath(partnerImg)}?t=${Date.now()}`;
    textBlock.classList.add('hidden');
    imgBlock.classList.remove('hidden');
  } else {
    headImg.src = '';
    textBlock.classList.remove('hidden');
    imgBlock.classList.add('hidden');
  }

  document.getElementById('ct-gift-footer-text').textContent = resolveCosmoterraGiftText(appSettings);

  document.getElementById('ct-product-search').value = '';
  document.getElementById('ct-inv-desc').value = '';
  updateCosmoterraPaidToggleUI();

  renderCosmoterraTables();
  recalcCosmoterraTotals();

  document.getElementById('cosmoterra-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('ct-product-search')?.focus(), 50);
}

function closeCosmoterraModal() {
  closeCosmoterraGiftPopover();
  document.getElementById('cosmoterra-modal').classList.add('hidden');
}

function toggleCosmoterraPaidState() {
  ctPaidState = !ctPaidState;
  updateCosmoterraPaidToggleUI();
}

function updateCosmoterraPaidToggleUI() {
  const btn = document.getElementById('ct-inv-paid-toggle');
  if (!btn) return;
  if (ctPaidState) {
    btn.textContent = '✅ Bezahlt';
    btn.className = 'px-2.5 py-1.5 rounded-lg border border-emerald-400/60 bg-emerald-500/20 text-emerald-200 text-xs font-bold hover:bg-emerald-500/30 transition';
  } else {
    btn.textContent = '❌ Offen';
    btn.className = 'px-2.5 py-1.5 rounded-lg border border-rose-400/60 bg-rose-500/20 text-rose-200 text-xs font-bold hover:bg-rose-500/30 transition';
  }
}

function onCosmoterraDescInput() {
  ctDescManuallyEdited = document.getElementById('ct-inv-desc').value.trim().length > 0;
}

// ==================== TABLE RENDERING ====================
function buildPreprintedRowHtml(item) {
  const key = `${item.side}:${item.rowIndex}`;
  const isProgram = item.side === 'right' && item.rowIndex >= 33;
  const rowClass = isProgram ? 'bg-emerald-50/35 hover:bg-emerald-50/70' : 'hover:bg-slate-50';

  return `
    <tr id="ct-row-${key}" data-search="${ctEscapeAttr((item.nr + ' ' + item.name).toLowerCase())}"
        class="border-b border-slate-300 ${rowClass} transition-colors">
      <td class="border-r border-slate-300 px-1 py-0.5 font-mono text-[10px] text-slate-500 whitespace-nowrap">${escapeHtml(item.nr)}</td>
      <td class="border-r border-slate-300 px-1.5 py-0.5 text-slate-900 font-medium">
        <div class="flex items-center justify-between gap-1">
          <span class="truncate">${escapeHtml(item.name)}</span>
          <span id="ct-action-badge-${key}" class="hidden font-bold text-red-600 text-xs shrink-0" title="Aktionspreis aktiv">A</span>
        </div>
      </td>
      <td class="border-r border-slate-300 px-1 py-0.5 text-center text-[10px] text-slate-500">${escapeHtml(item.ust)}</td>
      <td class="border-r border-slate-300 p-0.5 text-center">
        <input type="text" inputmode="decimal" id="ct-qty-${key}" value="${ctEscapeAttr(item.qty)}"
          oninput="onCosmoterraQtyChange('${key}', this.value)"
          placeholder=""
          class="w-12 px-1 py-0.5 text-center font-bold text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
      </td>
      <td class="border-r border-slate-300 px-0.5 py-0.5 text-center text-slate-400">x</td>
      <td id="ct-price-cell-${key}" ondblclick="startEditCosmoterraPrice('${key}')"
          title="Doppelklick zum Ändern (Aktionspreis)"
          class="border-r border-slate-300 px-1.5 py-0.5 text-right whitespace-nowrap cursor-pointer select-none hover:bg-amber-50/80 transition">
        ${ctFormatEur(item.unitPrice)}
      </td>
      <td class="border-r border-slate-300 px-0.5 py-0.5 text-center text-slate-400">=</td>
      <td id="ct-total-cell-${key}" ondblclick="openCosmoterraGiftPopover(event, 'item', '${key}')"
          title="Doppelklick: Als Geschenk ❤️ markieren"
          class="px-1.5 py-0.5 text-right font-bold whitespace-nowrap cursor-pointer select-none hover:bg-rose-50/70 transition text-slate-800">
      </td>
    </tr>
  `;
}

function buildManualRowHtml(idx) {
  const row = ctManualRows[idx];
  const rowBg = row.isAutoWertmarken ? 'bg-emerald-50/50 hover:bg-emerald-50/70' : 'bg-amber-50/20 hover:bg-amber-50/40';
  return `
    <tr id="ct-manual-row-${idx}" class="border-b border-slate-300 ${rowBg}">
      <td class="border-r border-slate-300 p-0.5">
        <input type="text" id="ct-m-nr-${idx}" value="${ctEscapeAttr(row.nr)}" placeholder="Nr."
          oninput="onCosmoterraManualField(${idx}, 'nr', this.value)"
          onkeydown="handleCosmoterraManualKeydown(event, ${idx})"
          class="w-full px-1 py-0.5 font-mono text-[10px] border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded bg-transparent focus:bg-white focus:outline-none" />
      </td>
      <td class="border-r border-slate-300 p-0.5">
        <div class="flex items-center gap-1">
          <input type="text" id="ct-m-name-${idx}" value="${ctEscapeAttr(row.name)}" placeholder="Freie Zeile / Artikel..."
            oninput="onCosmoterraManualField(${idx}, 'name', this.value)"
            onkeydown="handleCosmoterraManualKeydown(event, ${idx})"
            class="flex-1 min-w-0 px-1 py-0.5 text-[11px] ${row.isAutoWertmarken ? 'font-semibold text-emerald-900' : ''} border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded bg-transparent focus:bg-white focus:outline-none" />
          <button type="button" id="ct-m-action-btn-${idx}" onclick="toggleCosmoterraManualAction(${idx})"
            title="Als Aktion (A) markieren — Tastenkombination: Alt+A / Alt+Umschalt+A / F8"
            class="px-1 rounded text-[11px] font-bold shrink-0 transition ${row.isAction ? 'text-red-600 bg-red-50 border border-red-300' : 'text-slate-300 hover:text-red-500 hover:bg-red-50/60'}">
            A
          </button>
        </div>
      </td>
      <td class="border-r border-slate-300 p-0.5">
        <input type="text" id="ct-m-ust-${idx}" value="${ctEscapeAttr(row.ust)}" placeholder="10%"
          oninput="onCosmoterraManualField(${idx}, 'ust', this.value)"
          onkeydown="handleCosmoterraManualKeydown(event, ${idx})"
          class="w-9 px-0.5 py-0.5 text-center text-[10px] border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded bg-transparent focus:bg-white focus:outline-none" />
      </td>
      <td class="border-r border-slate-300 p-0.5 text-center">
        <input type="text" inputmode="decimal" id="ct-m-qty-${idx}" value="${ctEscapeAttr(row.qty)}" placeholder=""
          oninput="onCosmoterraManualField(${idx}, 'qty', this.value)"
          onkeydown="handleCosmoterraManualKeydown(event, ${idx})"
          class="w-12 px-1 py-0.5 text-center font-bold text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500" />
      </td>
      <td class="border-r border-slate-300 px-0.5 py-0.5 text-center text-slate-400">x</td>
      <td class="border-r border-slate-300 p-0.5">
        <input type="text" inputmode="decimal" id="ct-m-price-${idx}" value="${ctEscapeAttr(row.unitPrice)}" placeholder="€"
          oninput="onCosmoterraManualField(${idx}, 'unitPrice', this.value)"
          onblur="onCosmoterraManualPriceBlur(${idx})"
          onkeydown="handleCosmoterraManualKeydown(event, ${idx})"
          class="w-16 px-1 py-0.5 text-right text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500" />
      </td>
      <td class="border-r border-slate-300 px-0.5 py-0.5 text-center text-slate-400">=</td>
      <td id="ct-m-total-cell-${idx}" ondblclick="openCosmoterraGiftPopover(event, 'manual', ${idx})"
          title="Doppelklick: Als Geschenk ❤️ markieren (oder direkt Betrag / Minusbetrag z. B. -30,- eingeben)"
          class="p-0.5 text-right cursor-pointer select-none">
        ${renderManualTotalInnerHtml(idx)}
      </td>
    </tr>
  `;
}

function getManualTotalInputClass(valStr) {
  const num = ctParseNum(valStr);
  let toneClass = 'text-slate-800';
  if (!isNaN(num)) {
    if (num < 0) toneClass = 'text-rose-700';
    else if (num > 0) toneClass = 'text-emerald-700';
  }
  return `w-20 px-1 py-0.5 text-right font-bold text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 ${toneClass}`;
}

function renderManualTotalInnerHtml(idx) {
  const row = ctManualRows[idx];
  if (row.isGift) {
    return `<div ondblclick="openCosmoterraGiftPopover(event, 'manual', ${idx})" class="px-1 py-0.5 font-bold text-rose-600 flex items-center justify-center gap-1" title="Geschenk (Doppelklick zum Aufheben)"><span>-</span><span>❤️</span></div>`;
  }
  return `<input type="text" inputmode="text" id="ct-m-total-${idx}" value="${ctEscapeAttr(row.total)}" placeholder="0,00"
    oninput="onCosmoterraManualField(${idx}, 'total', this.value)"
    onblur="onCosmoterraManualTotalBlur(${idx})"
    ondblclick="openCosmoterraGiftPopover(event, 'manual', ${idx})"
    onkeydown="handleCosmoterraManualKeydown(event, ${idx})"
    class="${getManualTotalInputClass(row.total)}" />`;
}

function renderCosmoterraTables() {
  const cat = window.COSMOTERRA_CATALOG;
  const leftBody = document.getElementById('ct-left-tbody');
  const rightBody = document.getElementById('ct-right-tbody');

  leftBody.innerHTML = cat.LEFT_PRODUCTS.map((p) => buildPreprintedRowHtml(ctItemsState[`left:${p.rowIndex}`])).join('');

  const rightRowsHtml = [];
  for (const p of cat.RIGHT_PRODUCTS) {
    if (p.rowIndex === 33) {
      rightRowsHtml.push(`<tr class="h-3 bg-slate-100 border-b border-slate-400"><td colspan="8"></td></tr>`);
    }
    rightRowsHtml.push(buildPreprintedRowHtml(ctItemsState[`right:${p.rowIndex}`]));
  }
  rightRowsHtml.push(
    `<tr class="bg-amber-50/60 border-b border-slate-400"><td colspan="8" class="px-2 py-0.5 text-[10px] font-semibold text-amber-800">Freie Zeilen (Alt+A / Alt+Umschalt+A / F8 oder „A“-Button = Aktion)</td></tr>`
  );
  for (let i = 0; i < cat.MANUAL_ROW_INDICES.length; i++) {
    rightRowsHtml.push(buildManualRowHtml(i));
  }
  rightBody.innerHTML = rightRowsHtml.join('');

  for (const key of Object.keys(ctItemsState)) {
    updatePreprintedRowVisual(key);
  }
}

// ==================== PRODUCT ROW INTERACTIONS ====================
function filterCosmoterraProducts() {
  const q = (document.getElementById('ct-product-search').value || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#ct-left-tbody tr[data-search], #ct-right-tbody tr[data-search]');
  rows.forEach((tr) => {
    const match = !q || tr.getAttribute('data-search').includes(q);
    tr.classList.toggle('hidden', !match);
  });
}

function onCosmoterraQtyChange(key, rawVal) {
  const item = ctItemsState[key];
  if (!item) return;
  item.qty = rawVal;
  const q = ctParseNum(rawVal);
  if ((isNaN(q) || q <= 0) && item.isGift) {
    item.isGift = false;
  }
  updatePreprintedRowVisual(key);
  recalcCosmoterraTotals();
}

function updatePreprintedRowVisual(key) {
  const item = ctItemsState[key];
  if (!item) return;

  const badgeEl = document.getElementById(`ct-action-badge-${key}`);
  const priceCell = document.getElementById(`ct-price-cell-${key}`);
  const totalCell = document.getElementById(`ct-total-cell-${key}`);
  const rowEl = document.getElementById(`ct-row-${key}`);

  if (badgeEl) badgeEl.classList.toggle('hidden', !item.isAction);

  if (priceCell && !priceCell.querySelector('input')) {
    priceCell.textContent = ctFormatEur(item.unitPrice);
    if (item.isAction) {
      priceCell.classList.add('text-red-600', 'font-bold', 'bg-amber-50/70');
      priceCell.classList.remove('text-slate-700');
    } else {
      priceCell.classList.remove('text-red-600', 'font-bold', 'bg-amber-50/70');
      priceCell.classList.add('text-slate-700');
    }
  }

  const q = ctParseNum(item.qty);
  const activeQty = !isNaN(q) && q > 0 ? q : 0;

  if (rowEl) {
    rowEl.classList.toggle('bg-emerald-50/70', activeQty > 0 && !item.isGift);
    rowEl.classList.toggle('bg-rose-50/60', activeQty > 0 && item.isGift);
  }

  if (totalCell) {
    if (activeQty > 0 && item.isGift) {
      totalCell.innerHTML = `<span class="text-rose-600 font-bold inline-flex items-center gap-1">- <span>❤️</span></span>`;
    } else if (activeQty > 0) {
      const lineTotal = Math.round(activeQty * item.unitPrice * 100) / 100;
      totalCell.textContent = ctFormatEur(lineTotal);
      totalCell.classList.add('text-emerald-700');
      totalCell.classList.remove('text-slate-400');
    } else {
      totalCell.textContent = '';
      totalCell.classList.remove('text-emerald-700');
    }
  }
}

function startEditCosmoterraPrice(key) {
  const item = ctItemsState[key];
  const cell = document.getElementById(`ct-price-cell-${key}`);
  if (!item || !cell || cell.querySelector('input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.value = ctFormatPricePlain(item.unitPrice);
  input.className = 'w-16 px-1 py-0.5 text-right text-xs font-bold border border-amber-400 rounded bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400';

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const parsed = ctParseNum(input.value);
      if (!isNaN(parsed) && parsed >= 0) {
        item.unitPrice = Math.round(parsed * 100) / 100;
        item.isAction = Math.abs(item.unitPrice - item.defaultPrice) > 0.001;
      }
    }
    cell.innerHTML = '';
    updatePreprintedRowVisual(key);
    recalcCosmoterraTotals();
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));

  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();
}

// ==================== MANUAL ROW & WERTMARKEN INTERACTIONS ====================
function isManualRowUsed(row) {
  if (!row) return false;
  return Boolean(
    (row.nr || '').trim() ||
    (row.name || '').trim() ||
    (row.ust || '').trim() ||
    String(row.qty || '').trim() ||
    String(row.unitPrice || '').trim() ||
    String(row.total || '').trim() ||
    row.isAction ||
    row.isGift
  );
}

function computeTotalWertmarken() {
  let totalWm = 0;
  for (const item of Object.values(ctItemsState)) {
    if (item.isAction || item.isGift) continue;
    const q = ctParseNum(item.qty);
    if (isNaN(q) || q <= 0) continue;
    totalWm += q * (Number(item.wertmarken) || 0);
  }

  const wmLookup = (window.COSMOTERRA_CATALOG && window.COSMOTERRA_CATALOG.WERTMARKEN_BY_NR) || {};
  for (const row of ctManualRows) {
    if (row.isAutoWertmarken || row.isAction || row.isGift) continue;
    const nr = (row.nr || '').trim();
    const wm = nr ? Number(wmLookup[nr] || 0) : 0;
    if (wm <= 0) continue;
    const q = ctParseNum(row.qty);
    if (!isNaN(q) && q > 0) {
      totalWm += q * wm;
    }
  }

  return Math.round(totalWm * 100) / 100;
}

function syncManualRowDomInPlace(idx) {
  const row = ctManualRows[idx];
  const tr = document.getElementById(`ct-manual-row-${idx}`);
  if (!row || !tr) return;

  tr.classList.toggle('bg-emerald-50/50', Boolean(row.isAutoWertmarken));
  tr.classList.toggle('hover:bg-emerald-50/70', Boolean(row.isAutoWertmarken));
  tr.classList.toggle('bg-amber-50/20', !row.isAutoWertmarken);
  tr.classList.toggle('hover:bg-amber-50/40', !row.isAutoWertmarken);

  const nrEl = document.getElementById(`ct-m-nr-${idx}`);
  const nameEl = document.getElementById(`ct-m-name-${idx}`);
  const ustEl = document.getElementById(`ct-m-ust-${idx}`);
  const qtyEl = document.getElementById(`ct-m-qty-${idx}`);
  const priceEl = document.getElementById(`ct-m-price-${idx}`);
  const totalEl = document.getElementById(`ct-m-total-${idx}`);

  if (nrEl && document.activeElement !== nrEl) nrEl.value = row.nr || '';
  if (nameEl && document.activeElement !== nameEl) {
    nameEl.value = row.name || '';
    nameEl.classList.toggle('font-semibold', Boolean(row.isAutoWertmarken));
    nameEl.classList.toggle('text-emerald-900', Boolean(row.isAutoWertmarken));
  }
  if (ustEl && document.activeElement !== ustEl) ustEl.value = row.ust || '';
  if (qtyEl && document.activeElement !== qtyEl) qtyEl.value = row.qty || '';
  if (priceEl && document.activeElement !== priceEl) priceEl.value = row.unitPrice || '';
  if (totalEl && document.activeElement !== totalEl) {
    totalEl.value = row.total || '';
    totalEl.className = getManualTotalInputClass(row.total);
  }
}

function rerenderAllManualRows() {
  for (let i = 0; i < ctManualRows.length; i++) {
    const tr = document.getElementById(`ct-manual-row-${i}`);
    if (tr) {
      tr.outerHTML = buildManualRowHtml(i);
    }
  }
}

function syncAutoWertmarkenRow() {
  const totalWm = computeTotalWertmarken();
  const existingIdx = ctManualRows.findIndex((r) => r.isAutoWertmarken);
  const qtyStr = totalWm > 0 ? (Number.isInteger(totalWm) ? String(totalWm) : totalWm.toLocaleString('de-DE')) : '';

  if (totalWm > 0) {
    if (existingIdx !== -1) {
      ctManualRows[existingIdx].name = 'Wertmarken';
      ctManualRows[existingIdx].qty = qtyStr;
      syncManualRowDomInPlace(existingIdx);
    } else if (!isManualRowUsed(ctManualRows[0])) {
      ctManualRows[0] = {
        ...createEmptyManualRow(),
        name: 'Wertmarken',
        qty: qtyStr,
        isAutoWertmarken: true
      };
      syncManualRowDomInPlace(0);
    } else if (!isManualRowUsed(ctManualRows[ctManualRows.length - 1])) {
      for (let i = ctManualRows.length - 1; i >= 1; i--) {
        ctManualRows[i] = ctManualRows[i - 1];
      }
      ctManualRows[0] = {
        ...createEmptyManualRow(),
        name: 'Wertmarken',
        qty: qtyStr,
        isAutoWertmarken: true
      };
      rerenderAllManualRows();
    }
  } else if (existingIdx !== -1) {
    ctManualRows[existingIdx] = createEmptyManualRow();
    syncManualRowDomInPlace(existingIdx);
  }

  return totalWm;
}

function onCosmoterraManualField(idx, field, val) {
  const row = ctManualRows[idx];
  if (!row) return;
  row[field] = val;

  if (field === 'name' && row.isAutoWertmarken && val.trim() !== 'Wertmarken') {
    row.isAutoWertmarken = false;
    syncManualRowDomInPlace(idx);
  }

  if (field === 'total') {
    row.manualTotalOverride = String(val).trim() !== '';
    const totalEl = document.getElementById(`ct-m-total-${idx}`);
    if (totalEl) totalEl.className = getManualTotalInputClass(val);
  } else if ((field === 'qty' || field === 'unitPrice') && !row.manualTotalOverride && !row.isGift) {
    const q = ctParseNum(row.qty);
    const p = ctParseNum(row.unitPrice);
    if (!isNaN(q) && q > 0 && !isNaN(p)) {
      row.total = ctFormatEur(Math.round(q * p * 100) / 100);
    } else {
      row.total = '';
    }
    const totalEl = document.getElementById(`ct-m-total-${idx}`);
    if (totalEl && document.activeElement !== totalEl) {
      totalEl.value = row.total;
      totalEl.className = getManualTotalInputClass(row.total);
    }
  }

  recalcCosmoterraTotals();
}

function onCosmoterraManualPriceBlur(idx) {
  const row = ctManualRows[idx];
  if (!row) return;
  const parsed = ctParseNum(row.unitPrice);
  if (!isNaN(parsed)) {
    row.unitPrice = ctFormatEur(Math.round(parsed * 100) / 100);
    const el = document.getElementById(`ct-m-price-${idx}`);
    if (el) el.value = row.unitPrice;
  }
}

function onCosmoterraManualTotalBlur(idx) {
  const row = ctManualRows[idx];
  if (!row) return;
  const parsed = ctParseNum(row.total);
  if (!isNaN(parsed)) {
    row.total = ctFormatEur(Math.round(parsed * 100) / 100);
    const el = document.getElementById(`ct-m-total-${idx}`);
    if (el) {
      el.value = row.total;
      el.className = getManualTotalInputClass(row.total);
    }
  }
}

function handleCosmoterraManualKeydown(event, idx) {
  const isAltA = event.altKey && !event.ctrlKey && !event.metaKey && (event.code === 'KeyA' || event.key.toLowerCase() === 'a');
  const isF8 = event.key === 'F8';
  if (isAltA || isF8) {
    event.preventDefault();
    event.stopPropagation();
    toggleCosmoterraManualAction(idx);
  }
}

function toggleCosmoterraManualAction(idx) {
  const row = ctManualRows[idx];
  if (!row) return;
  row.isAction = !row.isAction;
  const btn = document.getElementById(`ct-m-action-btn-${idx}`);
  if (btn) {
    btn.className = row.isAction
      ? 'px-1 rounded text-[11px] font-bold shrink-0 transition text-red-600 bg-red-50 border border-red-300'
      : 'px-1 rounded text-[11px] font-bold shrink-0 transition text-slate-300 hover:text-red-500 hover:bg-red-50/60';
  }
  recalcCosmoterraTotals();
}

// ==================== GIFT POPOVER ====================
function openCosmoterraGiftPopover(event, kind, idOrIdx) {
  event.preventDefault();
  event.stopPropagation();
  ctGiftTarget = { kind, idOrIdx };

  let currentlyGift = false;
  if (kind === 'item') {
    currentlyGift = Boolean(ctItemsState[idOrIdx]?.isGift);
  } else {
    currentlyGift = Boolean(ctManualRows[idOrIdx]?.isGift);
  }

  document.getElementById('ct-gift-toggle-label').textContent = currentlyGift
    ? 'Geschenk-Markierung entfernen'
    : 'Als Geschenk markieren ❤️';

  const pop = document.getElementById('ct-gift-popover');
  pop.classList.remove('hidden');

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popW = pop.offsetWidth || 220;
  const popH = pop.offsetHeight || 90;
  const left = Math.max(8, Math.min(vw - popW - 8, event.clientX - popW / 2));
  const top = Math.max(8, Math.min(vh - popH - 8, event.clientY + 12));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closeCosmoterraGiftPopover() {
  const pop = document.getElementById('ct-gift-popover');
  if (pop) pop.classList.add('hidden');
  ctGiftTarget = null;
}

function confirmToggleCosmoterraGift() {
  if (!ctGiftTarget) return;
  const { kind, idOrIdx } = ctGiftTarget;

  if (kind === 'item') {
    const item = ctItemsState[idOrIdx];
    if (item) {
      item.isGift = !item.isGift;
      if (item.isGift) {
        const q = ctParseNum(item.qty);
        if (isNaN(q) || q <= 0) {
          item.qty = '1';
          const qtyEl = document.getElementById(`ct-qty-${idOrIdx}`);
          if (qtyEl) qtyEl.value = '1';
        }
      }
      updatePreprintedRowVisual(idOrIdx);
    }
  } else if (kind === 'manual') {
    const row = ctManualRows[idOrIdx];
    if (row) {
      row.isGift = !row.isGift;
      const cell = document.getElementById(`ct-m-total-cell-${idOrIdx}`);
      if (cell) cell.innerHTML = renderManualTotalInnerHtml(idOrIdx);
    }
  }

  closeCosmoterraGiftPopover();
  recalcCosmoterraTotals();
}

document.addEventListener('click', (e) => {
  const pop = document.getElementById('ct-gift-popover');
  if (pop && !pop.classList.contains('hidden') && !pop.contains(e.target)) {
    closeCosmoterraGiftPopover();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const pop = document.getElementById('ct-gift-popover');
    if (pop && !pop.classList.contains('hidden')) {
      closeCosmoterraGiftPopover();
    }
  }
});

// ==================== TOTALS & PAYLOAD COLLECTION ====================
function recalcCosmoterraTotals() {
  const totalWm = syncAutoWertmarkenRow();

  let grandTotal = 0;
  let count = 0;
  let anyGift = false;
  const descParts = [];

  for (const item of Object.values(ctItemsState)) {
    const q = ctParseNum(item.qty);
    if (isNaN(q) || q <= 0) continue;
    count++;
    if (item.isGift) {
      anyGift = true;
    } else {
      grandTotal += Math.round(q * item.unitPrice * 100) / 100;
    }
    let label = `${q}x ${item.name}`;
    if (item.isAction) label += ' (A)';
    if (item.isGift) label += ' (Geschenk)';
    descParts.push(label);
  }

  for (const row of ctManualRows) {
    const nr = (row.nr || '').trim();
    const name = (row.name || '').trim();
    const q = ctParseNum(row.qty);
    const p = ctParseNum(row.unitPrice);
    const mTotal = ctParseNum(row.total);
    const hasContent = Boolean(nr || name || (!isNaN(q) && q > 0) || !isNaN(p) || !isNaN(mTotal) || row.isGift);
    if (!hasContent) continue;

    count++;
    let rowTotal = null;
    if (row.isGift) {
      anyGift = true;
    } else if (row.manualTotalOverride && !isNaN(mTotal)) {
      rowTotal = Math.round(mTotal * 100) / 100;
    } else if (!isNaN(q) && q > 0 && !isNaN(p)) {
      rowTotal = Math.round(q * p * 100) / 100;
    } else if (!isNaN(mTotal)) {
      rowTotal = Math.round(mTotal * 100) / 100;
    }

    if (rowTotal !== null) {
      grandTotal += rowTotal;
    }

    const baseName = name || (nr ? `Art. ${nr}` : 'Freie Position');
    let label;
    if (baseName.toLowerCase() === 'wertmarken' && !isNaN(q) && q > 0 && isNaN(p) && isNaN(mTotal)) {
      label = `Wertmarken: ${q}`;
    } else if (rowTotal !== null && rowTotal < 0) {
      label = `${baseName} (-${ctFormatGermanDecimal(Math.abs(rowTotal))} €)`;
    } else {
      label = !isNaN(q) && q > 0 ? `${q}x ${baseName}` : baseName;
    }
    if (row.isAction) label += ' (A)';
    if (row.isGift) label += ' (Geschenk)';
    descParts.push(label);
  }

  grandTotal = Math.round(grandTotal * 100) / 100;

  document.getElementById('ct-gift-footer-row').classList.toggle('hidden', !anyGift);
  document.getElementById('ct-grand-total-cell').textContent = ctFormatEur(grandTotal);
  const wmBadge = totalWm > 0 ? ` • 🎫 ${totalWm} Wertmarken` : '';
  document.getElementById('ct-live-summary').textContent =
    `${count} ${count === 1 ? 'Position' : 'Positionen'} • Gesamt: ${ctFormatEur(grandTotal)}${wmBadge}`;

  if (!ctDescManuallyEdited) {
    document.getElementById('ct-inv-desc').value = descParts.join(', ');
  }

  return { grandTotal, count, anyGift, totalWm, autoDescription: descParts.join(', ') };
}

function collectCosmoterraPayload() {
  const items = [];
  for (const item of Object.values(ctItemsState)) {
    const q = ctParseNum(item.qty);
    const activeQty = !isNaN(q) && q > 0 ? q : 0;
    const priceChanged = Math.abs(item.unitPrice - item.defaultPrice) > 0.001;
    if (activeQty > 0 || item.isAction || priceChanged) {
      items.push({
        side: item.side,
        rowIndex: item.rowIndex,
        qty: activeQty,
        unitPrice: item.unitPrice,
        isAction: item.isAction,
        isGift: activeQty > 0 ? Boolean(item.isGift) : false
      });
    }
  }

  const manualRows = ctManualRows.map((row) => {
    const q = ctParseNum(row.qty);
    const p = ctParseNum(row.unitPrice);
    const t = ctParseNum(row.total);
    const hasAutoTotal = !isNaN(q) && q > 0 && !isNaN(p);
    const useExplicitTotal = !row.isGift && (row.manualTotalOverride || !hasAutoTotal) && !isNaN(t);
    return {
      nr: (row.nr || '').trim(),
      name: (row.name || '').trim(),
      ust: (row.ust || '').trim(),
      qty: !isNaN(q) && q > 0 ? q : 0,
      unitPrice: !isNaN(p) ? Math.round(p * 100) / 100 : null,
      total: useExplicitTotal ? Math.round(t * 100) / 100 : null,
      isAction: Boolean(row.isAction),
      isGift: Boolean(row.isGift)
    };
  });

  return {
    customer_id: currentCustomer ? currentCustomer.id : null,
    invoice_date: document.getElementById('ct-head-inv-date').value || new Date().toISOString().slice(0, 10),
    invoice_number: document.getElementById('ct-head-inv-number').value.trim(),
    customer_name: document.getElementById('ct-head-cust-name').value.trim(),
    customer_address: document.getElementById('ct-head-cust-address').value.trim(),
    description: document.getElementById('ct-inv-desc').value.trim(),
    is_paid: ctPaidState ? 1 : 0,
    items,
    manualRows
  };
}

// ==================== PREVIEW, SAVE, BOOK & PRINT ====================
async function previewCosmoterraPdf() {
  const payload = collectCosmoterraPayload();
  const res = await fetch('/api/cosmoterra/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || 'PDF-Vorschau konnte nicht erstellt werden', 'error');
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function triggerPdfPrintFromUrl(pdfUrl) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';
  iframe.src = pdfUrl;

  let printed = false;
  iframe.onload = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      window.open(pdfUrl, '_blank');
    }
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 60000);
  };

  iframe.onerror = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    window.open(pdfUrl, '_blank');
  };

  document.body.appendChild(iframe);
}

async function saveCosmoterraInvoice(shouldPrint) {
  if (ctBusy || !currentCustomer) return;
  const stats = recalcCosmoterraTotals();
  if (stats.count === 0) {
    showToast('Bitte mindestens ein Produkt, eine freie Zeile oder ein Geschenk erfassen.', 'error');
    return;
  }

  ctBusy = true;
  const saveBtn = document.getElementById('ct-btn-save');
  const printBtn = document.getElementById('ct-btn-print');
  if (saveBtn) saveBtn.disabled = true;
  if (printBtn) printBtn.disabled = true;

  try {
    const payload = collectCosmoterraPayload();
    const res = await fetch('/api/cosmoterra/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Fehler beim Buchen der Cosmoterra-Rechnung', 'error');
      return;
    }

    const created = await res.json();
    closeCosmoterraModal();

    await loadCustomers(currentCustomer.id);
    await updateInvoiceNumberPreview(true);
    await loadAuditLogs();

    const pdfLinkHtml = created.pdf_url
      ? `<a href="${created.pdf_url}" target="_blank" class="px-2 py-1 bg-blue-500 hover:bg-blue-400 text-white font-bold text-xs rounded-md transition">📄 PDF öffnen</a>`
      : '';

    showToast(
      `Cosmoterra-Rechnung ${created.invoice_number} gebucht!`,
      'success',
      true,
      pdfLinkHtml
    );

    if (shouldPrint && created.pdf_url) {
      triggerPdfPrintFromUrl(created.pdf_url);
    }
  } finally {
    ctBusy = false;
    if (saveBtn) saveBtn.disabled = false;
    if (printBtn) printBtn.disabled = false;
  }
}
