const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const catalog = require('./public/cosmoterra-catalog.js');

const TEMPLATE_PATH = path.join(__dirname, 'assets', 'cosmoterra-vorlage.pdf');

// A4 standard width = 595.28pt, template MediaBox width = 637.795pt, content bounds [87.874 .. 623.226].
// Shifting by -58.0 centers the form on A4 with ~10.5mm left and right margins.
const X_OFFSET = 58.0;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const HEART_SVG_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

const COLS = {
  left: {
    nameRight: 214.2,
    qtyCenter: 246.85,
    priceBoxX: 269.5,
    priceRight: 301.0,
    eqLeft: 306.3,
    totalRight: 350.5,
    totalCenter: 333.5
  },
  right: {
    nameRight: 485.2,
    qtyCenter: 517.85,
    priceBoxX: 540.5,
    priceRight: 572.0,
    eqLeft: 577.0,
    totalRight: 621.5,
    totalCenter: 604.5
  }
};

const CHAR_TRANSLIT = {
  'č': 'c', 'Č': 'C',
  'ć': 'c', 'Ć': 'C',
  'š': 's', 'Š': 'S',
  'ž': 'z', 'Ž': 'Z',
  'đ': 'd', 'Đ': 'D',
  'ł': 'l', 'Ł': 'L',
  'ń': 'n', 'Ń': 'N',
  'ś': 's', 'Ś': 'S',
  'ź': 'z', 'Ź': 'Z',
  'ż': 'z', 'Ż': 'Z',
  'ř': 'r', 'Ř': 'R',
  'ě': 'e', 'Ě': 'E',
  'ů': 'u', 'Ů': 'U',
  'ő': 'ö', 'Ő': 'Ö',
  'ű': 'ü', 'Ű': 'Ü',
  'ă': 'a', 'Ă': 'A',
  'ș': 's', 'Ș': 'S',
  'ț': 't', 'Ț': 'T',
  'ğ': 'g', 'Ğ': 'G',
  'ş': 's', 'Ş': 'S',
  'ı': 'i', 'İ': 'I'
};

function sanitizeWinAnsi(str, font) {
  let out = String(str ?? '').replace(/[\r\n]+/g, ' ');
  out = out.replace(/./g, (ch) => CHAR_TRANSLIT[ch] || ch);
  if (!font) return out;
  let safe = '';
  for (const ch of out) {
    try {
      font.encodeText(ch);
      safe += ch;
    } catch {
      // Drop glyphs unsupported by WinAnsi (e.g. emojis) so PDF generation never throws
    }
  }
  return safe.trim();
}

function ox(x) {
  return x - X_OFFSET;
}

function parseNumeric(val) {
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

function formatGermanDecimal(absNum) {
  const fixed = absNum.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withThousands},${decPart}`;
}

function formatEur(val) {
  const num = Math.round((Number(val) || 0) * 100) / 100;
  if (num < 0) {
    return `- € ${formatGermanDecimal(Math.abs(num))}`;
  }
  return `€ ${formatGermanDecimal(num)}`;
}

function formatDateDE(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(isoDate).trim();
}

function drawFittedText(page, text, {
  x,
  y,
  maxWidth = 200,
  font,
  baseSize = 9,
  minSize = 5.5,
  color = rgb(0, 0, 0),
  align = 'left'
}) {
  let safe = sanitizeWinAnsi(text, font);
  if (!safe) return;

  let size = baseSize;
  while (size > minSize && font.widthOfTextAtSize(safe, size) > maxWidth) {
    size = Math.round((size - 0.3) * 10) / 10;
  }

  if (font.widthOfTextAtSize(safe, size) > maxWidth) {
    while (safe.length > 1 && font.widthOfTextAtSize(`${safe}...`, size) > maxWidth) {
      safe = safe.slice(0, -1);
    }
    safe = `${safe}...`;
  }

  const width = font.widthOfTextAtSize(safe, size);
  let drawX = x;
  if (align === 'right') drawX = x - width;
  else if (align === 'center') drawX = x - width / 2;

  page.drawText(safe, { x: drawX, y, size, font, color });
}

function drawHeart(page, cx, bottomY, scale = 0.36) {
  const w = 24 * scale;
  const rowCenterY = bottomY + 6.5;
  page.drawSvgPath(HEART_SVG_PATH, {
    x: cx - w / 2,
    y: rowCenterY + 12.2 * scale,
    scale,
    color: rgb(0.84, 0.12, 0.18)
  });
}

function drawGiftCell(page, totalCenterOx, bottomY, textY, fontBold) {
  const minusX = totalCenterOx - 8.5;
  page.drawText('-', {
    x: minusX,
    y: textY,
    size: 8.5,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.15)
  });
  drawHeart(page, totalCenterOx + 4.5, bottomY, 0.36);
}

function detectImageType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  return null;
}

async function generateCosmoterraPdf(payload, settings = {}, uploadsDir = '') {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error('Cosmoterra PDF-Vorlage nicht gefunden: ' + TEMPLATE_PATH);
  }

  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const srcDoc = await PDFDocument.load(templateBytes);
  const outDoc = await PDFDocument.create();

  const page = outDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const [embeddedTemplate] = await outDoc.embedPdf(srcDoc, [0]);
  page.drawPage(embeddedTemplate, { x: -X_OFFSET, y: 0 });

  const fontRegular = await outDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);

  const effective = catalog.getEffectiveCatalog(settings);

  // Replace top-left "Stand 01/2027" when active price stand differs from printed PDF template
  if (effective.priceStand !== catalog.TEMPLATE_PRICE_STAND) {
    page.drawRectangle({
      x: ox(90.5),
      y: 817.5,
      width: 52,
      height: 9.5,
      color: rgb(1, 1, 1)
    });
    drawFittedText(page, `Stand ${effective.priceStand}`, {
      x: ox(92.126),
      y: 819.8,
      maxWidth: 48,
      font: fontRegular,
      baseSize: 6.0,
      minSize: 5.0
    });
  }

  const invoiceNumber = payload.invoice_number || '';
  const customerName = payload.customer_name || '';
  const customerAddress = payload.customer_address || '';
  const invoiceDateDE = formatDateDE(payload.invoice_date || new Date().toISOString().slice(0, 10));

  // Header Top Left (Rechnung Nr., Kunde Name, Anschrift, Datum)
  drawFittedText(page, invoiceNumber, {
    x: ox(160),
    y: 799.2,
    maxWidth: 188,
    font: fontBold,
    baseSize: 10.5,
    minSize: 7.5
  });
  drawFittedText(page, customerName, {
    x: ox(138),
    y: 770.8,
    maxWidth: 210,
    font: fontBold,
    baseSize: 9.5,
    minSize: 6.5
  });
  drawFittedText(page, customerAddress, {
    x: ox(138),
    y: 752.8,
    maxWidth: 210,
    font: fontRegular,
    baseSize: 9.0,
    minSize: 6.0
  });
  drawFittedText(page, invoiceDateDE, {
    x: ox(138),
    y: 734.0,
    maxWidth: 210,
    font: fontRegular,
    baseSize: 9.5,
    minSize: 7.0
  });

  // Header Top Right (Cosmoterra GeschäftspartnerIn)
  const partnerMode = settings.cosmoterra_partner_mode || 'text';
  const partnerName = (settings.cosmoterra_partner_name || '').trim();
  const partnerAddress = (settings.cosmoterra_partner_address || '').trim();
  const partnerGpNr = (settings.cosmoterra_partner_gp_nr || '').trim();
  const partnerImageRel = (settings.cosmoterra_partner_image || '').trim();

  let drewImage = false;
  if (partnerMode === 'image' && partnerImageRel && uploadsDir) {
    const absImagePath = path.resolve(uploadsDir, partnerImageRel);
    const uploadsRoot = path.resolve(uploadsDir);
    if (absImagePath.startsWith(uploadsRoot) && fs.existsSync(absImagePath)) {
      try {
        const imgBytes = fs.readFileSync(absImagePath);
        const imgType = detectImageType(imgBytes);
        let embeddedImg = null;
        if (imgType === 'png') embeddedImg = await outDoc.embedPng(imgBytes);
        else if (imgType === 'jpg') embeddedImg = await outDoc.embedJpg(imgBytes);

        if (embeddedImg) {
          // Erase preprinted "Name: ___" and "Anschrift: ___" lines cleanly above "GP-Nr.:"
          page.drawRectangle({
            x: ox(364),
            y: 746.0,
            width: 259.5,
            height: 30.5,
            color: rgb(1, 1, 1)
          });

          const imgW = embeddedImg.width || 1;
          const imgH = embeddedImg.height || 1;
          const wideBox = { x: ox(365), y: 746.5, w: 256, h: 29.5 };
          const leftBox = { x: ox(365), y: 746.5, w: 132, h: 42.5 };

          const wideScale = Math.min(wideBox.w / imgW, wideBox.h / imgH);
          const leftScale = Math.min(leftBox.w / imgW, leftBox.h / imgH);
          const chosenBox = leftScale > wideScale ? leftBox : wideBox;
          const chosenScale = Math.max(wideScale, leftScale);

          const drawW = imgW * chosenScale;
          const drawH = imgH * chosenScale;
          const drawX = chosenBox.x;
          const drawY = chosenBox.y + (chosenBox.h - drawH) / 2;

          page.drawImage(embeddedImg, { x: drawX, y: drawY, width: drawW, height: drawH });
          drewImage = true;
        }
      } catch (err) {
        console.error('Warnung: Partner-Grafik konnte nicht ins PDF eingebettet werden:', err.message);
      }
    }
  }

  if (!drewImage) {
    drawFittedText(page, partnerName, {
      x: ox(410),
      y: 769.8,
      maxWidth: 210,
      font: fontBold,
      baseSize: 9.5,
      minSize: 6.5
    });
    drawFittedText(page, partnerAddress.replace(/\r?\n+/g, ', '), {
      x: ox(410),
      y: 751.8,
      maxWidth: 210,
      font: fontRegular,
      baseSize: 9.0,
      minSize: 6.0
    });
  }

  // Always print GP-Nr. in the bottom right header line
  drawFittedText(page, partnerGpNr, {
    x: ox(410),
    y: 733.8,
    maxWidth: 210,
    font: fontBold,
    baseSize: 9.5,
    minSize: 7.0
  });

  // Lookup submitted items by "side:rowIndex"
  const submittedByKey = new Map();
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const side = item.side === 'right' ? 'right' : 'left';
    const rowIndex = Number(item.rowIndex);
    submittedByKey.set(`${side}:${rowIndex}`, item);
  }

  let anyGift = false;
  let grandTotal = 0;

  // Iterate over ALL 90 preprinted product rows so active catalog prices (e.g. Stand 11/2026) replace printed 01/2027 template prices even when qty = 0
  for (const catItem of [...effective.leftProducts, ...effective.rightProducts]) {
    const side = catItem.side;
    const rowIndex = catItem.rowIndex;
    const yArr = side === 'left' ? catalog.LEFT_Y : catalog.RIGHT_Y;
    const bottomY = yArr[rowIndex];
    if (bottomY === undefined) continue;

    const col = COLS[side];
    const textY = bottomY + 3.6;

    const submitted = submittedByKey.get(`${side}:${rowIndex}`);
    const qty = submitted ? Math.max(0, Number(submitted.qty) || 0) : 0;
    const activeCatalogPrice = catItem.price;
    const templatePrice = catItem.templatePrice !== undefined ? catItem.templatePrice : catItem.price;

    const effectiveUnitPrice =
      submitted && submitted.unitPrice !== undefined && submitted.unitPrice !== null && submitted.unitPrice !== ''
        ? Math.max(0, Number(submitted.unitPrice) || 0)
        : activeCatalogPrice;

    const isAction = submitted
      ? Boolean(submitted.isAction) || Math.abs(effectiveUnitPrice - activeCatalogPrice) > 0.001
      : false;
    const isGift = submitted ? Boolean(submitted.isGift) && qty > 0 : false;
    const differsFromTemplate = Math.abs(effectiveUnitPrice - templatePrice) > 0.001;

    if (isAction) {
      // Narrow white badge behind 'A' so it stays crisp without clipping long product names
      page.drawRectangle({
        x: ox(col.nameRight - 6.0),
        y: bottomY + 1.2,
        width: 6.4,
        height: 10.6,
        color: rgb(1, 1, 1)
      });
      drawFittedText(page, 'A', {
        x: ox(col.nameRight),
        y: textY,
        maxWidth: 10,
        font: fontBold,
        baseSize: 7.4,
        minSize: 6.5,
        color: rgb(0.85, 0.08, 0.08),
        align: 'right'
      });
    }

    if (differsFromTemplate) {
      page.drawRectangle({
        x: ox(col.priceBoxX),
        y: bottomY + 0.8,
        width: 32.4,
        height: 11.4,
        color: rgb(1, 1, 1)
      });
      drawFittedText(page, formatEur(effectiveUnitPrice), {
        x: ox(col.priceRight),
        y: textY,
        maxWidth: 31,
        font: fontRegular,
        baseSize: 7.3,
        minSize: 5.8,
        align: 'right'
      });
    }

    if (qty > 0) {
      const qtyStr = Number.isInteger(qty) ? String(qty) : qty.toLocaleString('de-DE');
      drawFittedText(page, qtyStr, {
        x: ox(col.qtyCenter),
        y: textY,
        maxWidth: 19,
        font: fontBold,
        baseSize: 7.8,
        minSize: 5.8,
        align: 'center'
      });

      if (catItem.missingEq) {
        drawFittedText(page, '=', {
          x: ox(col.eqLeft),
          y: textY,
          maxWidth: 10,
          font: fontRegular,
          baseSize: 7.5,
          minSize: 6.5,
          align: 'left'
        });
      }

      if (isGift) {
        anyGift = true;
        drawGiftCell(page, ox(col.totalCenter), bottomY, textY, fontBold);
      } else {
        const lineTotal = Math.round(qty * effectiveUnitPrice * 100) / 100;
        grandTotal += lineTotal;
        drawFittedText(page, formatEur(lineTotal), {
          x: ox(col.totalRight),
          y: textY,
          maxWidth: 35,
          font: fontBold,
          baseSize: 7.3,
          minSize: 5.5,
          align: 'right'
        });
      }
    }
  }

  // Render up to 7 manual rows on right side (indices 41..47)
  const manualRows = Array.isArray(payload.manualRows) ? payload.manualRows : [];
  for (let i = 0; i < catalog.MANUAL_ROW_INDICES.length; i++) {
    const row = manualRows[i];
    if (!row) continue;

    const nr = (row.nr || '').trim();
    const name = (row.name || '').trim();
    const ust = (row.ust || '').trim();
    const parsedQty = parseNumeric(row.qty);
    const qty = Number.isFinite(parsedQty) ? Math.max(0, parsedQty) : 0;

    const rawUnitPriceStr = row.unitPrice !== undefined && row.unitPrice !== null ? String(row.unitPrice).trim() : '';
    const parsedUnitPrice = rawUnitPriceStr !== '' ? parseNumeric(rawUnitPriceStr) : NaN;
    const hasUnitPrice = Number.isFinite(parsedUnitPrice);
    const unitPrice = hasUnitPrice ? parsedUnitPrice : null;

    const rawTotalStr = row.total !== undefined && row.total !== null ? String(row.total).trim() : '';
    const parsedTotal = rawTotalStr !== '' ? parseNumeric(rawTotalStr) : NaN;
    const hasManualTotal = Number.isFinite(parsedTotal);
    const manualTotalVal = hasManualTotal ? parsedTotal : null;

    const isAction = Boolean(row.isAction);
    const isGift = Boolean(row.isGift);

    const hasContent = Boolean(nr || name || qty > 0 || hasUnitPrice || hasManualTotal || isGift);
    if (!hasContent) continue;

    const rowIndex = catalog.MANUAL_ROW_INDICES[i];
    const bottomY = catalog.RIGHT_Y[rowIndex];
    const textY = bottomY + 3.6;

    if (nr) {
      drawFittedText(page, nr, {
        x: ox(363.9),
        y: textY + 0.3,
        maxWidth: 23,
        font: fontRegular,
        baseSize: 5.8,
        minSize: 4.8
      });
    }

    if (name) {
      const nameX = nr ? ox(389.0) : ox(363.9);
      const nameMaxW = nr ? (isAction ? 86 : 94) : (isAction ? 111 : 119);
      drawFittedText(page, name, {
        x: nameX,
        y: textY,
        maxWidth: nameMaxW,
        font: fontRegular,
        baseSize: 7.3,
        minSize: 5.5
      });
    }

    if (isAction) {
      drawFittedText(page, 'A', {
        x: ox(COLS.right.nameRight),
        y: textY,
        maxWidth: 12,
        font: fontBold,
        baseSize: 8.2,
        minSize: 7.0,
        color: rgb(0.85, 0.08, 0.08),
        align: 'right'
      });
    }

    if (ust) {
      drawFittedText(page, ust, {
        x: ox(489.7),
        y: textY + 0.3,
        maxWidth: 17,
        font: fontRegular,
        baseSize: 5.8,
        minSize: 4.8
      });
    }

    if (qty > 0) {
      const qtyStr = Number.isInteger(qty) ? String(qty) : qty.toLocaleString('de-DE');
      drawFittedText(page, qtyStr, {
        x: ox(COLS.right.qtyCenter),
        y: textY,
        maxWidth: 19,
        font: fontBold,
        baseSize: 7.8,
        minSize: 5.8,
        align: 'center'
      });
    }

    if (hasUnitPrice) {
      drawFittedText(page, 'x', {
        x: ox(532.0),
        y: textY,
        maxWidth: 8,
        font: fontRegular,
        baseSize: 7.3,
        minSize: 6.5
      });
      drawFittedText(page, formatEur(unitPrice), {
        x: ox(COLS.right.priceRight),
        y: textY,
        maxWidth: 31,
        font: fontRegular,
        baseSize: 7.3,
        minSize: 5.8,
        align: 'right'
      });
      drawFittedText(page, '=', {
        x: ox(COLS.right.eqLeft),
        y: textY,
        maxWidth: 10,
        font: fontRegular,
        baseSize: 7.5,
        minSize: 6.5,
        align: 'left'
      });
    }

    if (isGift) {
      anyGift = true;
      drawGiftCell(page, ox(COLS.right.totalCenter), bottomY, textY, fontBold);
    } else {
      let rowTotal = null;
      if (hasManualTotal) {
        rowTotal = Math.round(manualTotalVal * 100) / 100;
      } else if (qty > 0 && hasUnitPrice) {
        rowTotal = Math.round(qty * unitPrice * 100) / 100;
      }

      if (rowTotal !== null) {
        grandTotal += rowTotal;
        drawFittedText(page, formatEur(rowTotal), {
          x: ox(COLS.right.totalRight),
          y: textY,
          maxWidth: 35.5,
          font: fontBold,
          baseSize: 7.3,
          minSize: 5.5,
          align: 'right'
        });
      }
    }
  }

  // Row 49: Gift Footer directly above RECHNUNGSBETRAG
  if (anyGift) {
    const giftBottomY = catalog.RIGHT_Y[catalog.GIFT_FOOTER_ROW_INDEX];
    drawHeart(page, ox(367.5), giftBottomY, 0.38);
    const giftTemplate = (settings.cosmoterra_gift_text || '').trim() || 'Geschenk von Herzen von deinem Berater {NAME}';
    const giftText = giftTemplate.replace(/\{NAME\}/gi, partnerName).replace(/\s+/g, ' ').trim();
    drawFittedText(page, giftText, {
      x: ox(374.5),
      y: giftBottomY + 3.6,
      maxWidth: 209,
      font: fontBold,
      baseSize: 6.7,
      minSize: 4.8,
      color: rgb(0.15, 0.15, 0.15)
    });
  }

  // Row 50: Grand Total in RECHNUNGSBETRAG box
  const roundedTotal = Math.round(grandTotal * 100) / 100;
  const totalBottomY = catalog.RIGHT_Y[catalog.TOTAL_ROW_INDEX];
  drawFittedText(page, formatEur(roundedTotal), {
    x: ox(COLS.right.totalRight),
    y: totalBottomY + 3.8,
    maxWidth: 35.5,
    font: fontBold,
    baseSize: 7.8,
    minSize: 5.6,
    align: 'right'
  });

  return await outDoc.save();
}

module.exports = {
  generateCosmoterraPdf,
  parseNumeric,
  formatGermanDecimal
};
