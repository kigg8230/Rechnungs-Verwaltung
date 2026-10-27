# Konzept: Rechnungs- & Inkasso-Verwaltung (Rechnungs-LOG)

## 1. Ausgangslage & Zielsetzung
Als Vermittler übernehmen Sie die **Warenausgabe (Versand)** und das **Inkasso (Zahlungskontrolle)** im Namen einer Partnerfirma (Rechnungssteller). Dieses System dient als schlanke, selbst gehostete Web-Anwendung auf Ihrem **Oracle-VPS**, um Kundendaten, Dokumente (PDFs) und den Zahlungsstatus aller Rechnungen lückenlos und übersichtlich zu protokollieren.

---

## 2. Empfohlener Tech-Stack (Oracle-VPS Ready)
Da die Anwendung selbst auf einem Oracle-VPS (oft ARM64/Ampere oder x86) gehostet wird, empfiehlt sich ein ressourcenschonender und wartungsarmer Aufbau:

* **Deployment:** Docker & Docker Compose (einfaches Backup und Umzug möglich)
* **Backend & Datenbank:** 
  * **Option A (Kompakt & Schnell):** Node.js (Express/Fastify) oder Python (FastAPI) mit **SQLite** (Datenbank liegt als einzelne Datei vor, ideal für Backups inkl. PDF-Ordner).
  * **Option B (All-in-One Backend):** **PocketBase** (Go-basiert, extrem leichtgewichtig, bringt SQLite, Dateispeicher für PDFs, Authentifizierung und API direkt mit).
* **Frontend:** HTML5 / TailwindCSS + Vue.js oder React (bzw. leichtgewichtig mit Alpine.js/HTMX) für schnelle Filterung und direkte Status-Umschaltung ohne Seiten-Neuladen.
* **Sicherheit:** Reverse Proxy (z. B. Caddy oder Nginx Proxy Manager) für automatisches HTTPS (Let's Encrypt) + Login-Schutz.

---

## 3. Datenmodell (Datenbank-Struktur)

### 3.1 Kundenstammdaten (`customers`)
Speichert die Basisdaten für Versand und Kontakt:
| Feld | Typ | Beschreibung |
| :--- | :--- | :--- |
| `id` | UUID / Integer | Eindeutige Kunden-ID |
| `first_name` | Text | Vorname |
| `last_name` | Text | Nachname / Firmenname |
| `street` | Text | Straße und Hausnummer (für Warenversand) |
| `zip_code` | Text | Postleitzahl |
| `city` | Text | Ort |
| `phone` | Text | Telefonnummer (optional) |
| `email` | Text | E-Mail-Adresse (optional) |
| `notes` | Text | Freie Notizen zum Kunden |
| `created_at` | Timestamp | Erstellungsdatum |

### 3.2 Kunden-Dokumente / Chronik (`customer_documents`)
Zusätzlich oder als Teil der Historie können PDF-Dateien zu Dokumentationszwecken abgelegt werden (entweder direkt am Kunden oder an einem Rechnungseintrag):
| Feld | Typ | Beschreibung |
| :--- | :--- | :--- |
| `id` | UUID / Integer | Eindeutige Dokument-ID |
| `customer_id` | Foreign Key | Verknüpfung zum Kunden |
| `invoice_id` | Foreign Key | Optional: Verknüpfung direkt zu einer Rechnung |
| `file_name` | Text | Originaler Dateiname |
| `file_path` | Text | Speicherpfad auf dem Server |
| `description` | Text | Kurze Notiz zum PDF |
| `uploaded_at` | Timestamp | Upload-Zeitpunkt |

### 3.3 Rechnungseinträge (`invoices`)
Die chronologische Buchungs- und Inkasso-Liste:
| Feld | Typ | Beschreibung |
| :--- | :--- | :--- |
| `id` | UUID / Integer | Eindeutige ID |
| `customer_id` | Foreign Key | Zugeordneter Kunde |
| `invoice_date` | Date | Rechnungsdatum (Standardwert: **Heute**) |
| `invoice_number` | Text (Unique) | Generierte oder manuell angepasste Rechnungsnummer |
| `sequence_num` | Integer | Interne laufende Nummer (für saubere Sortierung) |
| `description` | Text | Freier Text (z. B. Warenpositionen, Versandhinweis) |
| `amount` | Decimal(10,2) | Rechnungsbetrag in EUR |
| `is_paid` | Boolean | Zahlungsstatus: `true` = Bezahlt (Grüner Haken), `false` = Offen (Rotes X) |
| `paid_at` | Timestamp | Optional: Zeitpunkt der Zahlungsmarkierung |
| `pdf_path` | Text | Optional: Direkt angehängtes Rechnungs-/Beleg-PDF |

### 3.4 Einstellungen (`settings`)
Steuerung des Rechnungsnummern-Schemas:
| Feld | Typ | Beispiel / Beschreibung |
| :--- | :--- | :--- |
| `prefix_schema` | Text | Präfix vor der Nummer, z. B. `{YYYY}-` oder `RE-{YY}-` |
| `suffix_schema` | Text | Suffix nach der Nummer, z. B. `/{YYYY}` oder leer |
| `number_digits` | Integer | Anzahl der Stellen für die laufende Nummer (z. B. `5` für `00001`) |
| `next_sequence` | Integer | Nächste zu vergebende laufende Nummer (z. B. `42`) |
| `yearly_reset` | Boolean | Ob der Zähler zum Jahreswechsel automatisch bei 1 startet |

### 3.5 Änderungsprotokoll für "Rückgängig"-Funktion (`audit_log`)
Ermöglicht das Zurücknehmen der letzten Aktionen (z. B. versehentliches Markieren als bezahlt oder Tippfehler):
| Feld | Typ | Beschreibung |
| :--- | :--- | :--- |
| `id` | Integer | Laufende Log-ID |
| `entity_type` | Text | Betroffene Tabelle (`invoices`, `customers`) |
| `entity_id` | Integer | ID des geänderten Datensatzes |
| `action` | Text | `CREATE`, `UPDATE`, `DELETE`, `STATUS_TOGGLE` |
| `previous_state` | JSON | Kompletter Zustand vor der Änderung |
| `new_state` | JSON | Zustand nach der Änderung |
| `timestamp` | Timestamp | Zeitpunkt der Änderung |

---

## 4. Kernfunktionen & Benutzeroberfläche (UI/UX)

### 4.1 Kundenansicht & Detailseite
* **Kopfbereich (Stammdaten):** Übersichtliche Karte mit Name, Vorname, Versandadresse (mit "Adresse kopieren"-Button für Paketscheine), Telefon, E-Mail und einem Textfeld für freie Notizen.
* **PDF-Dokumentenablage:** Drag & Drop-Bereich zum Hochladen von PDFs (Rechnungskopie, Lieferschein, Schriftverkehr) inkl. integrierter PDF-Vorschau im Browser.
* **Chronologische Rechnungsliste des Kunden:**
  * Ganz oben steht eine **Schnelleingabe-Zeile** für einen neuen Eintrag:
    1. **Datum:** Automatisch mit dem heutigen Tagesdatum vorbelegt (per Datepicker änderbar).
    2. **Rechnungsnummer:** Automatisch nach dem eingestellten Schema vorgeschlagen (z. B. `2026-00014`), bei Bedarf überschreibbar.
    3. **Freier Text:** Beschreibung der Leistung/Ware.
    4. **Betrag:** Eingabefeld für den Euro-Betrag.
    5. **PDF-Anhang (optional):** Direktes Anhängen eines PDFs an die Zeile.
    6. **Status / Action-Feld:** Klickbarer Button mit **Rotem X** ❌ (Unbezahlt – Standard bei Neuanlage) oder **Grünem Haken** ✅ (Bezahlt). Ein Klick schaltet den Status sofort um.

### 4.2 Konfigurierbares Rechnungsnummern-Schema (Einstellungen)
In den Einstellungen kann das Format über Platzhalter und Parameter frei definiert werden:
* **Präfix (Pre-Schema):** Freitext + Platzhalter wie `{YYYY}` (4-stelliges Jahr), `{YY}` (2-stelliges Jahr), `{MM}` (Monat).
* **Laufende Nummer:** Einstellung der Stellenanzahl (Padding), z. B. `5` Stellen numerisch (`00001`).
* **Suffix (Post-Schema):** Freitext + Platzhalter, z. B. `/{YYYY}`.
* **Live-Vorschau in den Einstellungen:**
  * *Beispiel 1:* Pre = `{YYYY}-`, Stellen = `5`, Post = *(leer)* ➔ **`2026-00001`**
  * *Beispiel 2:* Pre = *(leer)*, Stellen = `5`, Post = `/{YYYY}` ➔ **`00001/2026`**

### 4.3 Globale Gesamtliste & Auswertung (Kundenübergreifend)
Eine zentrale Übersichtsseite über **alle Kunden und Rechnungen**:
* **Zeitraum-Filter:** Auswahl `Von Datum` bis `Bis Datum` (plus Schnellauswahl: *Dieser Monat*, *Letzter Monat*, *Dieses Quartal*, *Dieses Jahr*).
* **Status-Filter:** 
  * *Alle anzeigen*
  * *Nur unbezahlte Rechnungen (Rotes X)* – für schnelles Mahnwesen/Inkasso-Kontrolle
  * *Nur bezahlte Rechnungen (Grüner Haken)*
* **Sortierung:** Standardmäßig oder per Klick **auf-/absteigend nach Rechnungsnummer** (sowie nach Datum oder Betrag) sortierbar.
* **Summenzeile:** Automatische Berechnung am Ende der Liste: *Gesamtbetrag im Zeitraum*, *Davon bezahlt (Grün)*, *Davon offen (Rot)* – wichtig für die Abrechnung mit der Partnerfirma.
* **Export:** Button für CSV/Excel- oder PDF-Export der aktuell gefilterten Liste zur Weitergabe an den Rechnungssteller.

### 4.4 "Rückgängig"-Funktion (Undo)
* Oben in der Navigationsleiste (oder als einblendbarer Toast nach jeder Aktion) befindet sich ein **"Rückgängig"-Button** (`↩ Rückgängig`) inkl. Historie der letzten 10–20 Änderungen.
* Wird z. B. versehentlich der Status von ❌ auf ✅ geklickt oder ein Betrag überschrieben, stellt ein Klick auf "Rückgängig" anhand des `audit_log` sofort den vorherigen Zustand wieder her.

---

## 5. Umsetzungsschritte (Roadmap)
1. **Schritt 1 (Basis & Datenbank):** Aufsetzen des Projekts (Backend + SQLite Datenbank + PDF-Upload-Ordner).
2. **Schritt 2 (Einstellungen & Nummern-Generator):** Logik für Pre-/Post-Schema und Stellenanzahl der Rechnungsnummern.
3. **Schritt 3 (Kundenverwaltung & Chronik):** Masken für Kundendaten, Notizen, PDF-Upload und die chronologische Rechnungsliste mit ✅/❌-Toggle.
4. **Schritt 4 (Globale Filter- & Berichts-Ansicht):** Zeitraum-Auswahl, Filter für unbezahlte Rechnungen, Sortierung nach Rechnungsnummer und Summenbildung.
5. **Schritt 5 (Undo-System & Deployment):** Einbau des Änderungs-Logs für die Rückgängig-Funktion und Bereitstellung eines `docker-compose.yml` für den Oracle-VPS.
