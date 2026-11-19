const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');
const { generateCosmoterraPdf, parseNumeric, formatGermanDecimal } = require('./cosmoterra-pdf');
const cosmoterraCatalog = require('./public/cosmoterra-catalog');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data & upload directories exist
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PARTNER_UPLOADS_DIR = path.join(UPLOADS_DIR, 'settings');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PARTNER_UPLOADS_DIR, { recursive: true });

// Initialize SQLite database
const dbPath = path.join(DATA_DIR, 'rechnungs-log.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode & foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const hashBuffer = crypto.scryptSync(String(password), salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  if (hashBuffer.length !== keyBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, keyBuffer);
}

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL DEFAULT 'admin',
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    prefix_schema TEXT NOT NULL DEFAULT '{YYYY}-',
    suffix_schema TEXT NOT NULL DEFAULT '',
    number_digits INTEGER NOT NULL DEFAULT 5,
    next_sequence INTEGER NOT NULL DEFAULT 1,
    yearly_reset INTEGER NOT NULL DEFAULT 1,
    last_reset_year INTEGER NOT NULL DEFAULT 2026,
    default_sort_order TEXT NOT NULL DEFAULT 'date_desc',
    cosmoterra_enabled INTEGER NOT NULL DEFAULT 0,
    cosmoterra_partner_mode TEXT NOT NULL DEFAULT 'text',
    cosmoterra_partner_name TEXT NOT NULL DEFAULT '',
    cosmoterra_partner_address TEXT NOT NULL DEFAULT '',
    cosmoterra_partner_gp_nr TEXT NOT NULL DEFAULT '',
    cosmoterra_partner_image TEXT NOT NULL DEFAULT '',
    cosmoterra_gift_text TEXT NOT NULL DEFAULT 'Geschenk von Herzen von deinem Berater {NAME}'
  );

  INSERT OR IGNORE INTO settings (id, prefix_schema, suffix_schema, number_digits, next_sequence, yearly_reset, last_reset_year)
  VALUES (1, '{YYYY}-', '', 5, 1, 1, CAST(strftime('%Y', 'now') AS INTEGER));

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL,
    street TEXT NOT NULL DEFAULT '',
    zip_code TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    invoice_date TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    sequence_num INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    is_paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    pdf_filename TEXT,
    pdf_original_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS customer_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    previous_state TEXT,
    new_state TEXT,
    undone INTEGER NOT NULL DEFAULT 0,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

// Safe migration for existing databases: add new settings columns if missing
const safeSettingsAlterStatements = [
  "ALTER TABLE settings ADD COLUMN default_sort_order TEXT NOT NULL DEFAULT 'date_desc';",
  "ALTER TABLE settings ADD COLUMN cosmoterra_enabled INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE settings ADD COLUMN cosmoterra_partner_mode TEXT NOT NULL DEFAULT 'text';",
  "ALTER TABLE settings ADD COLUMN cosmoterra_partner_name TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE settings ADD COLUMN cosmoterra_partner_address TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE settings ADD COLUMN cosmoterra_partner_gp_nr TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE settings ADD COLUMN cosmoterra_partner_image TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE settings ADD COLUMN cosmoterra_gift_text TEXT NOT NULL DEFAULT 'Geschenk von Herzen von deinem Berater {NAME}';"
];
for (const sql of safeSettingsAlterStatements) {
  try {
    db.exec(sql);
  } catch (e) {
    // Column already exists
  }
}

// Migration: invoice_payments table
db.exec(`
  CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );
`);

// Ensure default user exists (admin / rechnungen2026 or via env vars)
const existingUser = db.prepare('SELECT * FROM users WHERE id = 1').get();
if (!existingUser) {
  const initUser = process.env.ADMIN_USER || 'admin';
  const initPass = process.env.ADMIN_PASSWORD || 'rechnungen2026';
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)').run(initUser, hashPassword(initPass));
}

// Helper: Parse cookies
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function getValidSession(req) {
  const cookies = parseCookies(req);
  const token = cookies['rl_session'];
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (Date.now() > session.expires_at) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return session;
}

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth Endpoints (unprotected)
app.get('/api/auth/status', (req, res) => {
  const session = getValidSession(req);
  if (!session) return res.status(401).json({ authenticated: false });
  const user = db.prepare('SELECT username FROM users WHERE id = 1').get();
  res.json({ authenticated: true, username: user ? user.username : session.username });
});

app.post('/api/auth/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get();

  if (!user || username.trim().toLowerCase() !== user.username.toLowerCase() || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Benutzername oder Passwort ist falsch!' });
  }

  // Clean expired sessions
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
  db.prepare('INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)').run(token, user.username, expiresAt);

  res.setHeader('Set-Cookie', `rl_session=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
  res.json({ success: true, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies['rl_session']) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(cookies['rl_session']);
  }
  res.setHeader('Set-Cookie', 'rl_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ success: true });
});

// Protect all /api/* and /uploads/* routes below
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
    const session = getValidSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Nicht angemeldet. Bitte zuerst einloggen.' });
    }
  }
  next();
});

app.put('/api/auth/credentials', (req, res) => {
  const { current_password = '', new_username = '', new_password = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get();

  if (!verifyPassword(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Das aktuelle Passwort ist nicht korrekt.' });
  }
  const cleanUser = new_username.trim() || user.username;
  if (new_password && new_password.length < 4) {
    return res.status(400).json({ error: 'Das neue Passwort muss mindestens 4 Zeichen lang sein.' });
  }

  const newHash = new_password ? hashPassword(new_password) : user.password_hash;
  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = 1').run(cleanUser, newHash);
  res.json({ success: true, username: cleanUser });
});

app.use('/uploads', express.static(UPLOADS_DIR));

// Multer setup for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safeOrig = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeOrig}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Nur PDF-Dateien sind erlaubt!'));
    }
  },
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// Multer setup for Cosmoterra partner header graphic (PNG / JPEG)
const partnerImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(PARTNER_UPLOADS_DIR, { recursive: true });
    cb(null, PARTNER_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = file.mimetype === 'image/jpeg' || /\.(jpe?g)$/i.test(file.originalname) ? '.jpg' : '.png';
    cb(null, `cosmoterra-partner-${Date.now()}${ext}`);
  }
});
const uploadPartnerImage = multer({
  storage: partnerImageStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg' || /\.(png|jpe?g)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Nur PNG- oder JPG-Grafiken sind erlaubt!'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

function removeUploadFileIfExists(relPath) {
  if (!relPath) return;
  const resolved = path.resolve(UPLOADS_DIR, relPath);
  const root = path.resolve(UPLOADS_DIR);
  if (resolved.startsWith(root) && fs.existsSync(resolved)) {
    try {
      fs.unlinkSync(resolved);
    } catch (err) {
      console.error('Warnung beim Entfernen einer alten Upload-Datei:', err.message);
    }
  }
}

function sanitizeFilenameSegment(str) {
  return String(str || '')
    .replace(/[\/\\:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
}

function resolveInvoiceNumberAndSequence(settings, invoiceDate, requestedInvoiceNumber) {
  let nextSeq = settings.next_sequence;
  const invYear = new Date(invoiceDate).getFullYear();
  if (settings.yearly_reset && invYear > settings.last_reset_year) {
    nextSeq = 1;
  }

  let invoiceNumber = String(requestedInvoiceNumber || '').trim();
  let usedGeneratedSeq = false;
  if (!invoiceNumber) {
    invoiceNumber = formatInvoiceNumber(settings, invoiceDate, nextSeq);
    usedGeneratedSeq = true;
  } else {
    const expectedAuto = formatInvoiceNumber(settings, invoiceDate, nextSeq);
    if (invoiceNumber === expectedAuto) {
      usedGeneratedSeq = true;
    }
  }

  const sequenceNum = usedGeneratedSeq ? nextSeq : (parseInt(invoiceNumber.replace(/\D/g, ''), 10) || 0);
  return { nextSeq, invYear, invoiceNumber, usedGeneratedSeq, sequenceNum };
}

function computeCosmoterraSummary(payload = {}) {
  const catalogByKey = new Map();
  for (const p of [...cosmoterraCatalog.LEFT_PRODUCTS, ...cosmoterraCatalog.RIGHT_PRODUCTS]) {
    catalogByKey.set(`${p.side}:${p.rowIndex}`, p);
  }

  let grandTotal = 0;
  let itemCount = 0;
  const descParts = [];

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const side = item.side === 'right' ? 'right' : 'left';
    const rowIndex = Number(item.rowIndex);
    const catItem = catalogByKey.get(`${side}:${rowIndex}`);
    if (!catItem) continue;

    const qty = Math.max(0, Number(item.qty) || 0);
    if (qty <= 0) continue;

    itemCount++;
    const unitPrice =
      item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== ''
        ? Math.max(0, Number(item.unitPrice) || 0)
        : catItem.price;
    const isAction = Boolean(item.isAction) || Math.abs(unitPrice - catItem.price) > 0.001;
    const isGift = Boolean(item.isGift);

    if (!isGift) {
      grandTotal += Math.round(qty * unitPrice * 100) / 100;
    }

    let label = `${qty}x ${catItem.name}`;
    if (isAction) label += ' (A)';
    if (isGift) label += ' (Geschenk)';
    descParts.push(label);
  }

  const manualRows = Array.isArray(payload.manualRows) ? payload.manualRows : [];
  for (let i = 0; i < cosmoterraCatalog.MANUAL_ROW_INDICES.length; i++) {
    const row = manualRows[i];
    if (!row) continue;

    const nr = (row.nr || '').trim();
    const name = (row.name || '').trim();
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

    if (!nr && !name && qty <= 0 && !hasUnitPrice && !hasManualTotal && !isGift) continue;
    itemCount++;

    let rowTotal = null;
    if (!isGift) {
      if (hasManualTotal) {
        rowTotal = Math.round(manualTotalVal * 100) / 100;
      } else if (qty > 0 && hasUnitPrice) {
        rowTotal = Math.round(qty * unitPrice * 100) / 100;
      }
      if (rowTotal !== null) {
        grandTotal += rowTotal;
      }
    }

    const baseName = name || (nr ? `Art. ${nr}` : 'Freie Position');
    let label;
    if (baseName.toLowerCase() === 'wertmarken' && qty > 0 && !hasUnitPrice && !hasManualTotal) {
      label = `Wertmarken: ${qty}`;
    } else if (rowTotal !== null && rowTotal < 0) {
      label = `${baseName} (-${formatGermanDecimal(Math.abs(rowTotal))} €)`;
    } else {
      label = qty > 0 ? `${qty}x ${baseName}` : baseName;
    }
    if (isAction) label += ' (A)';
    if (isGift) label += ' (Geschenk)';
    descParts.push(label);
  }

  return {
    grandTotal: Math.round(grandTotal * 100) / 100,
    itemCount,
    autoDescription: descParts.join(', ')
  };
}

// Helper: Recompute invoice paid status based on payments
function updateInvoicePaidStatusFromPayments(invoiceId) {
  const inv = db.prepare('SELECT amount, is_paid, paid_at FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) return null;
  const paySumRow = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total_paid FROM invoice_payments WHERE invoice_id = ?').get(invoiceId);
  const totalPaid = Math.round((paySumRow.total_paid || 0) * 100) / 100;
  const invAmount = Math.round((inv.amount || 0) * 100) / 100;

  let newIsPaid = inv.is_paid;
  let newPaidAt = inv.paid_at;

  if (totalPaid >= invAmount && invAmount > 0) {
    newIsPaid = 1;
    if (!newPaidAt) newPaidAt = new Date().toISOString();
  } else if (inv.is_paid === 1 && totalPaid < invAmount) {
    // If payments exist but do not cover total amount, it's partially paid (unpaid status)
    newIsPaid = 0;
    newPaidAt = null;
  }

  if (newIsPaid !== inv.is_paid || newPaidAt !== inv.paid_at) {
    db.prepare('UPDATE invoices SET is_paid = ?, paid_at = ? WHERE id = ?').run(newIsPaid, newPaidAt, invoiceId);
  }

  return { ...inv, is_paid: newIsPaid, paid_at: newPaidAt, total_paid: totalPaid, remaining: Math.max(0, Math.round((invAmount - totalPaid) * 100) / 100) };
}
function formatInvoiceNumber(settings, dateStr, sequenceNum) {
  const dateObj = dateStr ? new Date(dateStr) : new Date();
  const yyyy = String(dateObj.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');

  const replaceTokens = (str) =>
    (str || '')
      .replace(/\{YYYY\}/gi, yyyy)
      .replace(/\{YY\}/gi, yy)
      .replace(/\{MM\}/gi, mm)
      .replace(/\{DD\}/gi, dd);

  const prefix = replaceTokens(settings.prefix_schema);
  const suffix = replaceTokens(settings.suffix_schema);
  const digits = Math.max(1, Math.min(12, Number(settings.number_digits) || 5));
  const paddedSeq = String(sequenceNum).padStart(digits, '0');

  return `${prefix}${paddedSeq}${suffix}`;
}

// Helper: Record audit log entry
function logAction(entityType, entityId, action, summary, previousState, newState) {
  const stmt = db.prepare(`
    INSERT INTO audit_log (entity_type, entity_id, action, summary, previous_state, new_state, undone)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `);
  stmt.run(
    entityType,
    entityId,
    action,
    summary,
    previousState ? JSON.stringify(previousState) : null,
    newState ? JSON.stringify(newState) : null
  );
}

// ==================== SETTINGS API ====================

app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);

  let nextSeq = settings.next_sequence;
  const reqYear = new Date(dateStr).getFullYear();
  if (settings.yearly_reset && reqYear > settings.last_reset_year) {
    nextSeq = 1;
  }

  const preview = formatInvoiceNumber(settings, dateStr, nextSeq);
  res.json({ ...settings, preview_next: preview, effective_next_sequence: nextSeq });
});

app.put('/api/settings', (req, res) => {
  const prev = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const body = req.body || {};

  const prefix_schema = body.prefix_schema !== undefined ? String(body.prefix_schema) : prev.prefix_schema;
  const suffix_schema = body.suffix_schema !== undefined ? String(body.suffix_schema) : prev.suffix_schema;
  const number_digits = body.number_digits !== undefined ? (Number(body.number_digits) || 5) : prev.number_digits;
  const next_sequence = body.next_sequence !== undefined ? Math.max(1, Number(body.next_sequence) || 1) : prev.next_sequence;
  const yearly_reset = body.yearly_reset !== undefined ? (body.yearly_reset ? 1 : 0) : prev.yearly_reset;
  const rawSort = body.default_sort_order !== undefined ? body.default_sort_order : prev.default_sort_order;
  const validSort = rawSort === 'date_asc' ? 'date_asc' : 'date_desc';

  const cosmoterra_enabled = body.cosmoterra_enabled !== undefined ? (body.cosmoterra_enabled ? 1 : 0) : (prev.cosmoterra_enabled ? 1 : 0);
  const rawMode = body.cosmoterra_partner_mode !== undefined ? body.cosmoterra_partner_mode : prev.cosmoterra_partner_mode;
  const cosmoterra_partner_mode = rawMode === 'image' ? 'image' : 'text';
  const cosmoterra_partner_name = body.cosmoterra_partner_name !== undefined ? String(body.cosmoterra_partner_name).trim() : (prev.cosmoterra_partner_name || '');
  const cosmoterra_partner_address = body.cosmoterra_partner_address !== undefined ? String(body.cosmoterra_partner_address).trim() : (prev.cosmoterra_partner_address || '');
  const cosmoterra_partner_gp_nr = body.cosmoterra_partner_gp_nr !== undefined ? String(body.cosmoterra_partner_gp_nr).trim() : (prev.cosmoterra_partner_gp_nr || '');
  const defaultGiftText = 'Geschenk von Herzen von deinem Berater {NAME}';
  const rawGiftText = body.cosmoterra_gift_text !== undefined
    ? String(body.cosmoterra_gift_text).trim()
    : (prev.cosmoterra_gift_text !== undefined ? String(prev.cosmoterra_gift_text).trim() : defaultGiftText);
  const cosmoterra_gift_text = rawGiftText || defaultGiftText;

  const currentYear = new Date().getFullYear();
  db.prepare(`
    UPDATE settings
    SET prefix_schema = ?, suffix_schema = ?, number_digits = ?, next_sequence = ?, yearly_reset = ?, last_reset_year = ?, default_sort_order = ?,
        cosmoterra_enabled = ?, cosmoterra_partner_mode = ?, cosmoterra_partner_name = ?, cosmoterra_partner_address = ?, cosmoterra_partner_gp_nr = ?,
        cosmoterra_gift_text = ?
    WHERE id = 1
  `).run(
    prefix_schema,
    suffix_schema,
    number_digits,
    next_sequence,
    yearly_reset,
    currentYear,
    validSort,
    cosmoterra_enabled,
    cosmoterra_partner_mode,
    cosmoterra_partner_name,
    cosmoterra_partner_address,
    cosmoterra_partner_gp_nr,
    cosmoterra_gift_text
  );

  const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  logAction('settings', 1, 'UPDATE', 'Einstellungen geändert', prev, updated);

  const preview = formatInvoiceNumber(updated, new Date().toISOString().slice(0, 10), updated.next_sequence);
  res.json({ ...updated, preview_next: preview });
});

app.post('/api/settings/cosmoterra-image', (req, res) => {
  uploadPartnerImage.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Fehler beim Hochladen der Grafik.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Grafikdatei ausgewählt.' });
    }

    const prev = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (prev && prev.cosmoterra_partner_image) {
      removeUploadFileIfExists(prev.cosmoterra_partner_image);
    }

    const relPath = `settings/${req.file.filename}`;
    db.prepare('UPDATE settings SET cosmoterra_partner_image = ?, cosmoterra_partner_mode = ? WHERE id = 1')
      .run(relPath, 'image');

    const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    logAction('settings', 1, 'UPDATE', 'Cosmoterra Partner-Grafik hochgeladen', prev, updated);

    const preview = formatInvoiceNumber(updated, new Date().toISOString().slice(0, 10), updated.next_sequence);
    res.json({ ...updated, preview_next: preview, image_url: `/uploads/${relPath}` });
  });
});

app.delete('/api/settings/cosmoterra-image', (req, res) => {
  const prev = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (prev && prev.cosmoterra_partner_image) {
    removeUploadFileIfExists(prev.cosmoterra_partner_image);
  }

  db.prepare('UPDATE settings SET cosmoterra_partner_image = ?, cosmoterra_partner_mode = ? WHERE id = 1')
    .run('', 'text');

  const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  logAction('settings', 1, 'UPDATE', 'Cosmoterra Partner-Grafik entfernt', prev, updated);

  const preview = formatInvoiceNumber(updated, new Date().toISOString().slice(0, 10), updated.next_sequence);
  res.json({ ...updated, preview_next: preview });
});

// ==================== CUSTOMERS API ====================

app.get('/api/customers', (req, res) => {
  const customers = db.prepare(`
    SELECT c.*,
      COUNT(i.id) AS invoice_count,
      SUM(CASE WHEN i.is_paid = 0 THEN 1 ELSE 0 END) AS unpaid_count,
      COALESCE(SUM(CASE WHEN i.is_paid = 0 THEN (i.amount - COALESCE(p.paid_sum, 0)) ELSE 0 END), 0) AS unpaid_amount,
      COALESCE(SUM(i.amount), 0) AS total_amount
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid_sum
      FROM invoice_payments
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    GROUP BY c.id
    ORDER BY c.last_name COLLATE NOCASE ASC, c.first_name COLLATE NOCASE ASC
  `).all();
  res.json(customers);
});

app.get('/api/customers/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });

  const documents = db.prepare('SELECT * FROM customer_documents WHERE customer_id = ? ORDER BY uploaded_at DESC').all(customer.id);
  const invoices = db.prepare(`
    SELECT i.*,
      COALESCE(p.paid_sum, 0) AS paid_amount,
      ROUND(MAX(0, i.amount - COALESCE(p.paid_sum, 0)), 2) AS remaining_amount,
      COALESCE(p.payment_count, 0) AS payment_count
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid_sum, COUNT(id) AS payment_count
      FROM invoice_payments
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    WHERE i.customer_id = ?
    ORDER BY i.invoice_date DESC, i.id DESC
  `).all(customer.id);

  // Attach payments array to each invoice
  const payments = db.prepare(`
    SELECT ip.* FROM invoice_payments ip
    JOIN invoices i ON i.id = ip.invoice_id
    WHERE i.customer_id = ?
    ORDER BY ip.payment_date ASC, ip.id ASC
  `).all(customer.id);

  const paymentsByInvoice = {};
  for (const pm of payments) {
    if (!paymentsByInvoice[pm.invoice_id]) paymentsByInvoice[pm.invoice_id] = [];
    paymentsByInvoice[pm.invoice_id].push(pm);
  }

  for (const inv of invoices) {
    inv.payments = paymentsByInvoice[inv.id] || [];
  }

  res.json({ ...customer, documents, invoices });
});

app.post('/api/customers', (req, res) => {
  const { first_name = '', last_name = '', street = '', zip_code = '', city = '', phone = '', email = '', notes = '' } = req.body;
  if (!last_name.trim()) {
    return res.status(400).json({ error: 'Name / Nachname ist ein Pflichtfeld.' });
  }

  const info = db.prepare(`
    INSERT INTO customers (first_name, last_name, street, zip_code, city, phone, email, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(first_name.trim(), last_name.trim(), street.trim(), zip_code.trim(), city.trim(), phone.trim(), email.trim(), notes);

  const created = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(info.lastInsertRowid));
  logAction('customers', created.id, 'CREATE', `Kunde "${created.last_name}, ${created.first_name}" angelegt`, null, created);
  res.status(201).json(created);
});

app.put('/api/customers/:id', (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!prev) return res.status(404).json({ error: 'Kunde nicht gefunden' });

  const {
    first_name = prev.first_name,
    last_name = prev.last_name,
    street = prev.street,
    zip_code = prev.zip_code,
    city = prev.city,
    phone = prev.phone,
    email = prev.email,
    notes = prev.notes
  } = req.body;

  if (!String(last_name).trim()) {
    return res.status(400).json({ error: 'Name / Nachname darf nicht leer sein.' });
  }

  db.prepare(`
    UPDATE customers
    SET first_name = ?, last_name = ?, street = ?, zip_code = ?, city = ?, phone = ?, email = ?, notes = ?
    WHERE id = ?
  `).run(first_name.trim(), last_name.trim(), street.trim(), zip_code.trim(), city.trim(), phone.trim(), email.trim(), notes, id);

  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  logAction('customers', id, 'UPDATE', `Kundendaten von "${updated.last_name}, ${updated.first_name}" aktualisiert`, prev, updated);
  res.json(updated);
});

app.delete('/api/customers/:id', (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!prev) return res.status(404).json({ error: 'Kunde nicht gefunden' });

  const invoices = db.prepare('SELECT * FROM invoices WHERE customer_id = ?').all(id);
  const documents = db.prepare('SELECT * FROM customer_documents WHERE customer_id = ?').all(id);

  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  logAction('customers', id, 'DELETE', `Kunde "${prev.last_name}, ${prev.first_name}" gelöscht`, { customer: prev, invoices, documents }, null);
  res.json({ success: true });
});

// ==================== CUSTOMER DOCUMENTS (PDFs) API ====================

app.post('/api/customers/:id/documents', upload.single('pdf'), (req, res) => {
  const customerId = Number(req.params.id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  if (!req.file) return res.status(400).json({ error: 'Keine PDF-Datei ausgewählt' });

  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const description = (req.body.description || '').trim();

  const info = db.prepare(`
    INSERT INTO customer_documents (customer_id, file_name, original_name, description)
    VALUES (?, ?, ?, ?)
  `).run(customerId, req.file.filename, originalName, description);

  const doc = db.prepare('SELECT * FROM customer_documents WHERE id = ?').get(Number(info.lastInsertRowid));
  logAction('customer_documents', doc.id, 'CREATE', `PDF "${originalName}" bei ${customer.last_name} hochgeladen`, null, doc);
  res.status(201).json(doc);
});

app.delete('/api/documents/:id', (req, res) => {
  const id = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM customer_documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

  db.prepare('DELETE FROM customer_documents WHERE id = ?').run(id);
  logAction('customer_documents', id, 'DELETE', `PDF "${doc.original_name}" gelöscht`, doc, null);
  res.json({ success: true });
});

// ==================== INVOICES API ====================

app.get('/api/invoices', (req, res) => {
  const { customer_id, status, from, to, search, sort = 'date_desc' } = req.query;

  let whereClauses = [];
  let params = [];

  if (customer_id) {
    whereClauses.push('i.customer_id = ?');
    params.push(Number(customer_id));
  }
  if (status === 'unpaid') {
    whereClauses.push('i.is_paid = 0');
  } else if (status === 'paid') {
    whereClauses.push('i.is_paid = 1');
  }
  if (from) {
    whereClauses.push('i.invoice_date >= ?');
    params.push(from);
  }
  if (to) {
    whereClauses.push('i.invoice_date <= ?');
    params.push(to);
  }
  if (search && search.trim()) {
    const raw = search.trim();
    const q = `%${raw}%`;
    // Normalize German amount input (e.g. "1.234,50 €" -> "1234.50", "45,80" -> "45.80")
    const normalizedAmountStr = raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
    const qDot = `%${normalizedAmountStr}%`;
    const qComma = `%${raw.replace(/[€\s]/g, '')}%`;
    const parsedNum = Number(normalizedAmountStr);

    if (!isNaN(parsedNum) && normalizedAmountStr !== '') {
      whereClauses.push(`(
        i.invoice_number LIKE ? OR
        i.description LIKE ? OR
        c.last_name LIKE ? OR
        c.first_name LIKE ? OR
        c.city LIKE ? OR
        printf('%.2f', i.amount) LIKE ? OR
        replace(printf('%.2f', i.amount), '.', ',') LIKE ? OR
        CAST(i.amount AS TEXT) LIKE ? OR
        ABS(i.amount - ?) < 0.005
      )`);
      params.push(q, q, q, q, q, qDot, qComma, qDot, parsedNum);
    } else {
      whereClauses.push(`(
        i.invoice_number LIKE ? OR
        i.description LIKE ? OR
        c.last_name LIKE ? OR
        c.first_name LIKE ? OR
        c.city LIKE ? OR
        printf('%.2f', i.amount) LIKE ? OR
        replace(printf('%.2f', i.amount), '.', ',') LIKE ?
      )`);
      params.push(q, q, q, q, q, qDot, qComma);
    }
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  let orderSql = 'ORDER BY i.invoice_date DESC, i.id DESC';
  if (sort === 'date_asc') orderSql = 'ORDER BY i.invoice_date ASC, i.id ASC';
  else if (sort === 'number_asc') orderSql = 'ORDER BY i.invoice_number COLLATE NOCASE ASC, i.sequence_num ASC, i.invoice_date ASC';
  else if (sort === 'number_desc') orderSql = 'ORDER BY i.invoice_number COLLATE NOCASE DESC, i.sequence_num DESC, i.invoice_date DESC';
  else if (sort === 'amount_desc') orderSql = 'ORDER BY i.amount DESC';
  else if (sort === 'amount_asc') orderSql = 'ORDER BY i.amount ASC';

  const invoices = db.prepare(`
    SELECT i.*,
      c.first_name, c.last_name, c.city, c.street, c.zip_code,
      COALESCE(p.paid_sum, 0) AS paid_amount,
      ROUND(MAX(0, i.amount - COALESCE(p.paid_sum, 0)), 2) AS remaining_amount,
      COALESCE(p.payment_count, 0) AS payment_count
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid_sum, COUNT(id) AS payment_count
      FROM invoice_payments
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    ${whereSql}
    ${orderSql}
  `).all(...params);

  // If fetching for all invoices, also attach payments
  if (invoices.length > 0) {
    const invIds = invoices.map(x => x.id);
    const placeholders = invIds.map(() => '?').join(',');
    const allPayments = db.prepare(`
      SELECT * FROM invoice_payments
      WHERE invoice_id IN (${placeholders})
      ORDER BY payment_date ASC, id ASC
    `).all(...invIds);

    const payMap = {};
    for (const p of allPayments) {
      if (!payMap[p.invoice_id]) payMap[p.invoice_id] = [];
      payMap[p.invoice_id].push(p);
    }
    for (const inv of invoices) {
      inv.payments = payMap[inv.id] || [];
    }
  }

  res.json(invoices);
});

app.post('/api/invoices', upload.single('pdf'), (req, res) => {
  const customerId = Number(req.body.customer_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const invoiceDate = req.body.invoice_date || new Date().toISOString().slice(0, 10);

  const { nextSeq, invYear, invoiceNumber, usedGeneratedSeq, sequenceNum } =
    resolveInvoiceNumberAndSequence(settings, invoiceDate, req.body.invoice_number);

  const description = (req.body.description || '').trim();
  const rawAmount = String(req.body.amount || '0').replace(',', '.');
  const amount = parseFloat(rawAmount) || 0;
  const isPaid = req.body.is_paid === 'true' || req.body.is_paid === true || req.body.is_paid === 1 || req.body.is_paid === '1' ? 1 : 0;
  const paidAt = isPaid ? new Date().toISOString() : null;

  let pdfFilename = null;
  let pdfOriginalName = null;
  if (req.file) {
    pdfFilename = req.file.filename;
    pdfOriginalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  }

  const info = db.prepare(`
    INSERT INTO invoices (customer_id, invoice_date, invoice_number, sequence_num, description, amount, is_paid, paid_at, pdf_filename, pdf_original_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customerId, invoiceDate, invoiceNumber, sequenceNum, description, amount, isPaid, paidAt, pdfFilename, pdfOriginalName);

  // Advance sequence counter if we used the generated sequence
  const prevSettings = { ...settings };
  if (usedGeneratedSeq) {
    db.prepare('UPDATE settings SET next_sequence = ?, last_reset_year = ? WHERE id = 1').run(nextSeq + 1, invYear);
  }

  const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(info.lastInsertRowid));
  logAction(
    'invoices',
    created.id,
    'CREATE',
    `Rechnung ${created.invoice_number} (${created.amount.toFixed(2)} €) bei ${customer.last_name} erstellt`,
    { prevSettings: usedGeneratedSeq ? prevSettings : null },
    created
  );

  res.status(201).json(created);
});

// ==================== COSMOTERRA DIGITAL INVOICE API ====================

app.post('/api/cosmoterra/preview', async (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const pdfBytes = await generateCosmoterraPdf(req.body || {}, settings, UPLOADS_DIR);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Cosmoterra-Vorschau.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Cosmoterra Preview Fehler:', err);
    res.status(500).json({ error: 'PDF-Vorschau fehlgeschlagen: ' + err.message });
  }
});

app.post('/api/cosmoterra/invoices', async (req, res) => {
  try {
    const body = req.body || {};
    const customerId = Number(body.customer_id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });

    const summary = computeCosmoterraSummary(body);
    if (summary.itemCount === 0) {
      return res.status(400).json({ error: 'Bitte mindestens eine Artikelmenge, freie Zeile oder ein Geschenk erfassen.' });
    }

    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const invoiceDate = (body.invoice_date || new Date().toISOString().slice(0, 10)).trim();
    const { nextSeq, invYear, invoiceNumber, usedGeneratedSeq, sequenceNum } =
      resolveInvoiceNumberAndSequence(settings, invoiceDate, body.invoice_number);

    const customerDisplayName =
      (body.customer_name || '').trim() ||
      `${customer.last_name}${customer.first_name ? ' ' + customer.first_name : ''}`;

    const pdfBytes = await generateCosmoterraPdf(
      { ...body, invoice_date: invoiceDate, invoice_number: invoiceNumber },
      settings,
      UPLOADS_DIR
    );

    // Create monthly YYYYMM directory (e.g. "202611")
    const ymMatch = invoiceDate.match(/^(\d{4})-(\d{2})/);
    const now = new Date();
    const ymFolder = ymMatch
      ? `${ymMatch[1]}${ymMatch[2]}`
      : `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetDir = path.join(UPLOADS_DIR, ymFolder);
    fs.mkdirSync(targetDir, { recursive: true });

    const safeInv = sanitizeFilenameSegment(invoiceNumber) || 'Rechnung';
    const safeCust = sanitizeFilenameSegment(customerDisplayName) || `Kunde_${customer.id}`;
    const baseName = `${safeInv}_${safeCust}`;

    let finalFileName = `${baseName}.pdf`;
    let counter = 2;
    while (fs.existsSync(path.join(targetDir, finalFileName))) {
      finalFileName = `${baseName}_${counter}.pdf`;
      counter++;
    }

    fs.writeFileSync(path.join(targetDir, finalFileName), Buffer.from(pdfBytes));

    const pdfFilename = `${ymFolder}/${finalFileName}`;
    const pdfOriginalName = finalFileName;
    const description = (body.description || '').trim() || summary.autoDescription;
    const amount = summary.grandTotal;
    const isPaid = body.is_paid === true || body.is_paid === 'true' || body.is_paid === 1 || body.is_paid === '1' ? 1 : 0;
    const paidAt = isPaid ? new Date().toISOString() : null;

    const info = db.prepare(`
      INSERT INTO invoices (customer_id, invoice_date, invoice_number, sequence_num, description, amount, is_paid, paid_at, pdf_filename, pdf_original_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(customerId, invoiceDate, invoiceNumber, sequenceNum, description, amount, isPaid, paidAt, pdfFilename, pdfOriginalName);

    const prevSettings = { ...settings };
    if (usedGeneratedSeq) {
      db.prepare('UPDATE settings SET next_sequence = ?, last_reset_year = ? WHERE id = 1').run(nextSeq + 1, invYear);
    }

    const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(info.lastInsertRowid));
    logAction(
      'invoices',
      created.id,
      'CREATE',
      `Cosmoterra-Rechnung ${created.invoice_number} (${created.amount.toFixed(2)} €) bei ${customer.last_name} erstellt`,
      { prevSettings: usedGeneratedSeq ? prevSettings : null },
      created
    );

    res.status(201).json({
      ...created,
      pdf_url: `/uploads/${ymFolder}/${encodeURIComponent(finalFileName)}`
    });
  } catch (err) {
    console.error('Cosmoterra Invoice Fehler:', err);
    res.status(500).json({ error: 'Fehler beim Erstellen der Cosmoterra-Rechnung: ' + err.message });
  }
});

app.put('/api/invoices/:id', upload.single('pdf'), (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!prev) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

  const invoiceDate = req.body.invoice_date !== undefined ? req.body.invoice_date : prev.invoice_date;
  const invoiceNumber = req.body.invoice_number !== undefined ? req.body.invoice_number.trim() : prev.invoice_number;
  const description = req.body.description !== undefined ? req.body.description.trim() : prev.description;
  const amount = req.body.amount !== undefined ? (parseFloat(String(req.body.amount).replace(',', '.')) || 0) : prev.amount;

  let isPaid = prev.is_paid;
  let paidAt = prev.paid_at;
  if (req.body.is_paid !== undefined) {
    isPaid = (req.body.is_paid === true || req.body.is_paid === 'true' || req.body.is_paid === 1 || req.body.is_paid === '1') ? 1 : 0;
    paidAt = isPaid ? (prev.paid_at || new Date().toISOString()) : null;
  }

  let pdfFilename = prev.pdf_filename;
  let pdfOriginalName = prev.pdf_original_name;
  if (req.file) {
    pdfFilename = req.file.filename;
    pdfOriginalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  }

  db.prepare(`
    UPDATE invoices
    SET invoice_date = ?, invoice_number = ?, description = ?, amount = ?, is_paid = ?, paid_at = ?, pdf_filename = ?, pdf_original_name = ?
    WHERE id = ?
  `).run(invoiceDate, invoiceNumber, description, amount, isPaid, paidAt, pdfFilename, pdfOriginalName, id);

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);

  // Determine summary text
  let summary = `Rechnung ${updated.invoice_number} bearbeitet`;
  if (prev.is_paid !== updated.is_paid && prev.amount === updated.amount && prev.description === updated.description) {
    summary = `Rechnung ${updated.invoice_number} als ${updated.is_paid ? 'BEZAHLT ✅' : 'UNBEZAHLT ❌'} markiert`;
  }

  logAction('invoices', id, 'UPDATE', summary, prev, updated);
  res.json(updated);
});

app.patch('/api/invoices/:id/toggle-paid', (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!prev) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

  const newPaid = prev.is_paid ? 0 : 1;
  const paidAt = newPaid ? new Date().toISOString() : null;

  db.prepare('UPDATE invoices SET is_paid = ?, paid_at = ? WHERE id = ?').run(newPaid, paidAt, id);
  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);

  logAction(
    'invoices',
    id,
    'STATUS_TOGGLE',
    `Rechnung ${updated.invoice_number} als ${newPaid ? 'BEZAHLT ✅' : 'OFFEN ❌'} markiert`,
    prev,
    updated
  );
  res.json(updated);
});

app.delete('/api/invoices/:id', (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!prev) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

  const payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ?').all(id);

  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  logAction('invoices', id, 'DELETE', `Rechnung ${prev.invoice_number} (${prev.amount.toFixed(2)} €) gelöscht`, { ...prev, payments }, null);
  res.json({ success: true });
});

// ==================== INVOICE PAYMENTS (PARTIAL PAYMENTS) API ====================

app.get('/api/invoices/:id/payments', (req, res) => {
  const invoiceId = Number(req.params.id);
  const payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date ASC, id ASC').all(invoiceId);
  res.json(payments);
});

app.post('/api/invoices/:id/payments', (req, res) => {
  const invoiceId = Number(req.params.id);
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

  const paymentDate = (req.body.payment_date || new Date().toISOString().slice(0, 10)).trim();
  const rawAmount = String(req.body.amount || '0').replace(',', '.');
  const amount = parseFloat(rawAmount) || 0;
  const note = (req.body.note || '').trim();

  if (amount <= 0) {
    return res.status(400).json({ error: 'Der Zahlungsbetrag muss größer als 0 sein.' });
  }

  const prevInvoiceState = { ...invoice };
  const prevPayments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ?').all(invoiceId);

  const info = db.prepare(`
    INSERT INTO invoice_payments (invoice_id, payment_date, amount, note)
    VALUES (?, ?, ?, ?)
  `).run(invoiceId, paymentDate, amount, note);

  const payment = db.prepare('SELECT * FROM invoice_payments WHERE id = ?').get(Number(info.lastInsertRowid));

  // Recalculate invoice paid status
  const updatedInv = updateInvoicePaidStatusFromPayments(invoiceId);

  logAction(
    'invoice_payments',
    payment.id,
    'CREATE',
    `Teilzahlung von ${payment.amount.toFixed(2)} € für Rechnung ${invoice.invoice_number} erfasst`,
    { invoice: prevInvoiceState, payments: prevPayments },
    { payment, updatedInvoice: updatedInv }
  );

  res.status(201).json({ payment, invoice: updatedInv });
});

app.delete('/api/payments/:id', (req, res) => {
  const id = Number(req.params.id);
  const payment = db.prepare('SELECT * FROM invoice_payments WHERE id = ?').get(id);
  if (!payment) return res.status(404).json({ error: 'Zahlungseintrag nicht gefunden' });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id);
  const prevInvoiceState = invoice ? { ...invoice } : null;

  db.prepare('DELETE FROM invoice_payments WHERE id = ?').run(id);

  let updatedInv = null;
  if (invoice) {
    updatedInv = updateInvoicePaidStatusFromPayments(invoice.id);
  }

  logAction(
    'invoice_payments',
    id,
    'DELETE',
    `Teilzahlung von ${payment.amount.toFixed(2)} € gelöscht`,
    { payment, invoice: prevInvoiceState },
    { updatedInvoice: updatedInv }
  );

  res.json({ success: true, updatedInvoice: updatedInv });
});

// ==================== AUDIT LOG & UNDO API ====================

app.get('/api/audit-log', (req, res) => {
  const logs = db.prepare('SELECT * FROM audit_log WHERE undone = 0 ORDER BY id DESC LIMIT 20').all();
  res.json(logs);
});

app.post('/api/undo', (req, res) => {
  const targetId = req.body && req.body.log_id ? Number(req.body.log_id) : null;
  const lastLog = targetId
    ? db.prepare('SELECT * FROM audit_log WHERE id = ? AND undone = 0').get(targetId)
    : db.prepare('SELECT * FROM audit_log WHERE undone = 0 ORDER BY id DESC LIMIT 1').get();

  if (!lastLog) {
    return res.status(400).json({ error: 'Keine Aktion zum Rückgängigmachen vorhanden.' });
  }

  const prev = lastLog.previous_state ? JSON.parse(lastLog.previous_state) : null;
  const next = lastLog.new_state ? JSON.parse(lastLog.new_state) : null;

  try {
    if (lastLog.entity_type === 'invoices') {
      if (lastLog.action === 'CREATE') {
        db.prepare('DELETE FROM invoices WHERE id = ?').run(lastLog.entity_id);
        if (prev && prev.prevSettings) {
          db.prepare('UPDATE settings SET next_sequence = ?, last_reset_year = ? WHERE id = 1')
            .run(prev.prevSettings.next_sequence, prev.prevSettings.last_reset_year);
        }
      } else if (lastLog.action === 'UPDATE' || lastLog.action === 'STATUS_TOGGLE') {
        db.prepare(`
          UPDATE invoices
          SET customer_id = ?, invoice_date = ?, invoice_number = ?, sequence_num = ?, description = ?, amount = ?, is_paid = ?, paid_at = ?, pdf_filename = ?, pdf_original_name = ?
          WHERE id = ?
        `).run(
          prev.customer_id, prev.invoice_date, prev.invoice_number, prev.sequence_num,
          prev.description, prev.amount, prev.is_paid, prev.paid_at,
          prev.pdf_filename, prev.pdf_original_name, prev.id
        );
      } else if (lastLog.action === 'DELETE') {
        db.prepare(`
          INSERT INTO invoices (id, customer_id, invoice_date, invoice_number, sequence_num, description, amount, is_paid, paid_at, pdf_filename, pdf_original_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          prev.id, prev.customer_id, prev.invoice_date, prev.invoice_number, prev.sequence_num,
          prev.description, prev.amount, prev.is_paid, prev.paid_at,
          prev.pdf_filename, prev.pdf_original_name, prev.created_at
        );
      }
    } else if (lastLog.entity_type === 'customers') {
      if (lastLog.action === 'CREATE') {
        db.prepare('DELETE FROM customers WHERE id = ?').run(lastLog.entity_id);
      } else if (lastLog.action === 'UPDATE') {
        db.prepare(`
          UPDATE customers
          SET first_name = ?, last_name = ?, street = ?, zip_code = ?, city = ?, phone = ?, email = ?, notes = ?
          WHERE id = ?
        `).run(
          prev.first_name, prev.last_name, prev.street, prev.zip_code, prev.city,
          prev.phone, prev.email, prev.notes, prev.id
        );
      } else if (lastLog.action === 'DELETE') {
        const c = prev.customer;
        db.prepare(`
          INSERT INTO customers (id, first_name, last_name, street, zip_code, city, phone, email, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(c.id, c.first_name, c.last_name, c.street, c.zip_code, c.city, c.phone, c.email, c.notes, c.created_at);

        for (const inv of (prev.invoices || [])) {
          db.prepare(`
            INSERT INTO invoices (id, customer_id, invoice_date, invoice_number, sequence_num, description, amount, is_paid, paid_at, pdf_filename, pdf_original_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(inv.id, inv.customer_id, inv.invoice_date, inv.invoice_number, inv.sequence_num, inv.description, inv.amount, inv.is_paid, inv.paid_at, inv.pdf_filename, inv.pdf_original_name, inv.created_at);
        }
        for (const doc of (prev.documents || [])) {
          db.prepare(`
            INSERT INTO customer_documents (id, customer_id, file_name, original_name, description, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(doc.id, doc.customer_id, doc.file_name, doc.original_name, doc.description, doc.uploaded_at);
        }
      }
    } else if (lastLog.entity_type === 'invoice_payments') {
      if (lastLog.action === 'CREATE') {
        const pm = db.prepare('SELECT invoice_id FROM invoice_payments WHERE id = ?').get(lastLog.entity_id);
        db.prepare('DELETE FROM invoice_payments WHERE id = ?').run(lastLog.entity_id);
        if (pm) updateInvoicePaidStatusFromPayments(pm.invoice_id);
      } else if (lastLog.action === 'DELETE') {
        const p = prev.payment;
        db.prepare(`
          INSERT INTO invoice_payments (id, invoice_id, payment_date, amount, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(p.id, p.invoice_id, p.payment_date, p.amount, p.note, p.created_at);
        updateInvoicePaidStatusFromPayments(p.invoice_id);
      }
    } else if (lastLog.entity_type === 'customer_documents') {
      if (lastLog.action === 'CREATE') {
        db.prepare('DELETE FROM customer_documents WHERE id = ?').run(lastLog.entity_id);
      } else if (lastLog.action === 'DELETE') {
        db.prepare(`
          INSERT INTO customer_documents (id, customer_id, file_name, original_name, description, uploaded_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(prev.id, prev.customer_id, prev.file_name, prev.original_name, prev.description, prev.uploaded_at);
      }
    } else if (lastLog.entity_type === 'settings') {
      db.prepare(`
        UPDATE settings
        SET prefix_schema = ?, suffix_schema = ?, number_digits = ?, next_sequence = ?, yearly_reset = ?, last_reset_year = ?, default_sort_order = ?,
            cosmoterra_enabled = ?, cosmoterra_partner_mode = ?, cosmoterra_partner_name = ?, cosmoterra_partner_address = ?, cosmoterra_partner_gp_nr = ?, cosmoterra_partner_image = ?,
            cosmoterra_gift_text = ?
        WHERE id = 1
      `).run(
        prev.prefix_schema,
        prev.suffix_schema,
        prev.number_digits,
        prev.next_sequence,
        prev.yearly_reset,
        prev.last_reset_year,
        prev.default_sort_order || 'date_desc',
        prev.cosmoterra_enabled ? 1 : 0,
        prev.cosmoterra_partner_mode || 'text',
        prev.cosmoterra_partner_name || '',
        prev.cosmoterra_partner_address || '',
        prev.cosmoterra_partner_gp_nr || '',
        prev.cosmoterra_partner_image || '',
        prev.cosmoterra_gift_text || 'Geschenk von Herzen von deinem Berater {NAME}'
      );
    }

    db.prepare('UPDATE audit_log SET undone = 1 WHERE id = ?').run(lastLog.id);
    res.json({ success: true, undone_log: lastLog });
  } catch (err) {
    console.error('Undo error:', err);
    res.status(500).json({ error: 'Fehler beim Rückgängigmachen: ' + err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Rechnungs-LOG Server läuft auf http://localhost:${PORT}`);
});
