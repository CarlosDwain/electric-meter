# Electric Meter Tracker — Full Context v2

## Project Overview

A personal electric meter tracker that logs kWh readings into a Google Sheet twice a day (morning and evening). The system calculates delta kWh, daily totals, and shift labels automatically via Google Apps Script. The intake method is a Telegram bot.

---

## Current Architecture

```
User (Telegram)
    → Cloudflare Worker (meter-proxy.sorallocarlos17.workers.dev)
        → Apps Script Web App (doPost)
            → Google Sheet (Electric Meter Tracker > Readings tab)
```

---

## Google Sheet

**Sheet ID:** `YOUR_SHEET_ID_HERE`
**Tab name:** `Readings`

**Columns:**

| Col | Header | Description |
|-----|--------|-------------|
| A | Timestamp | DateTime of the reading |
| B | Raw_kwh | The kWh value |
| C | Meter Photo | "manual", "photo_placeholder:FILE_ID", or future OCR file ref |
| D | Shift | Morning / Evening / Manual / Gap (Multi-Day) / Gap (Missed) |
| E | Delta_kwh | Difference from previous reading |
| F | Daily_Total | Total kWh for the day (Morning readings only) |
| G | Notes | [Initial Reading], [OCR: Extracted], [GAP: ...], etc. |

---

## Apps Script Project

Two files in the same Apps Script project:

### tracker.gs — Core calculation logic

Functions:
- `getColumnMapping(sheet)` — maps headers to 1-based column numbers dynamically
- `updateSheetRow(sheet, row, colMap, result, rawKwh)` — writes computed values to row
- `calculateReadingLogic(timestamp, currentKwh, prevData, sheet, currentRow, colMap)` — determines shift, delta, daily total
- `getPreviousMorningReading(sheet, currentRow, colMap)` — finds last Morning row for daily total baseline
- `getPreviousRecord(sheet, currentRow, rawKwhCol)` — finds last valid kWh row for delta calculation

**Shift logic (Asia/Manila timezone):**
- Hour 6–10 → `"Morning"` (closes the overnight cycle)
- Hour 18–22 → `"Evening"` (closes the daytime cycle)
- Otherwise → `"Manual"`
- hoursElapsed > 14 → `"Gap (Missed)"`
- hoursElapsed > 28 → `"Gap (Multi-Day)"`

**Daily total:** Only calculated on Morning readings. Subtracts previous Morning kWh from current Morning kWh.

**Column mapping rules:**
- `delta_kwh` is checked before generic `kwh` catch-all to prevent misidentification
- `Meter_Photo` only matches `head.includes("photo")` with a `!map.Meter_Photo` guard
- `Raw_kwh` only matches if not already mapped

### telegram_bot.gs — Telegram bot + sheet writer

**Constants:**
```javascript
const BOT_TOKEN  = "YOUR_BOT_TOKEN";
const SHEET_ID   = "YOUR_SHEET_ID_HERE";
const SHEET_NAME = "Readings";
```

**Conversation states (stored in PropertiesService):**
- `IDLE` — waiting for /reading command
- `WAIT_OPTION` — waiting for user to pick 1 or 2
- `WAIT_NUMBER` — waiting for manual kWh number input
- `WAIT_PHOTO` — waiting for photo upload

**Commands:**
- `/start` — welcome message with description
- `/help` — usage instructions and best reading times
- `/reading` — starts the logging flow

**Conversation flow:**
1. User sends `/reading`
2. Bot asks: `1` (type manually) or `2` (upload photo)
3a. User picks `1` → bot asks for number → user types it → written to sheet
3b. User picks `2` → bot asks for photo → user sends it → placeholder logged (OCR not yet active)

**`writeToSheet(rawKwh, source)`** — appends a new row and calls tracker.gs logic
**`handleManualReading(chatId, kwh)`** — handles option 1
**`handlePhotoReceived(chatId, message)`** — handles option 2 (OCR placeholder)

---

## Cloudflare Worker

**URL:** `https://meter-proxy.sorallocarlos17.workers.dev`
**Purpose:** Proxies Telegram webhook POSTs to Apps Script, following Google's 302/307 redirects internally so Telegram gets a clean 200 OK back.

**Why it's needed:** Google Apps Script Web Apps redirect unauthenticated POST requests. Telegram doesn't follow redirects — it marks delivery as failed and retries forever (infinite loop). The Worker returns 200 to Telegram immediately, then follows the redirect internally.

**Worker code:**
```javascript
export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }
    const APPS_SCRIPT_URL = "YOUR_APPS_SCRIPT_DEPLOYMENT_URL";
    const body = await request.text();
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      redirect: "follow",
    });
    return new Response("OK", { status: 200 });
  }
};
```

**Important:** Every time a new Apps Script deployment is created, the Worker's `APPS_SCRIPT_URL` must be updated and redeployed.

---

## Telegram Bot Setup

**Bot username:** set via @BotFather
**Registered commands** (set via `setMyCommands`):
- `reading` — Log a new meter reading
- `help` — How to use this bot

**Webhook registration:**
```
https://api.telegram.org/botTOKEN/setWebhook?url=https://meter-proxy.sorallocarlos17.workers.dev&drop_pending_updates=true
```

**Useful Telegram API URLs:**
```
# Check webhook status
https://api.telegram.org/botTOKEN/getWebhookInfo

# Delete webhook + clear queue
https://api.telegram.org/botTOKEN/deleteWebhook?drop_pending_updates=true

# Get chat ID
https://api.telegram.org/botTOKEN/getUpdates

# Register command menu
https://api.telegram.org/botTOKEN/setMyCommands?commands=[{"command":"reading","description":"Log a new meter reading"},{"command":"help","description":"How to use this bot"}]
```

---

## Deployment Process (every code change)

1. Edit code in Apps Script
2. **Deploy → New deployment → Web app**
   - Execute as: Me
   - Who has access: Anyone
3. Copy the new deployment URL
4. Update `APPS_SCRIPT_URL` in the Cloudflare Worker
5. Click **Save and deploy** in Cloudflare
6. Re-register webhook (with `drop_pending_updates=true`) if needed

**Note:** Editing an existing deployment does NOT update the live URL — always create a **new deployment**.

---

## Issues Encountered and Resolved

### 302/307 redirect loop
Telegram retried forever because Apps Script redirected unauthenticated POSTs. Fixed with Cloudflare Worker proxy.

### Infinite reply loop
Bot kept sending the same message repeatedly. Cause: Apps Script took too long, Telegram retried. Fix: `ContentService.createTextOutput("OK")` must be created at the very top of `doPost` and always returned — never inside a try/catch that might throw before returning.

### Drive OCR MIME type corruption
`DriveApp.getFileById().getBlob()` returned `application/vnd.google-apps.document` even for JPEG files. Fix: `.setContentType("image/jpeg")` on the blob before passing to Drive OCR. (This is for future OCR implementation.)

### Column mapping conflicts
- `delta_kwh` header was being matched by the generic `kwh` catch-all, overwriting `Raw_kwh`. Fix: check `delta_kwh` explicitly before the catch-all.
- `Image_Url` column matched `head.includes("image")`, overwriting `Meter_Photo`. Fix: match only `head.includes("photo")` with a guard.

---

## Current Status

- Cloudflare Worker: deployed and verified
- Telegram bot: commands registered, conversation flow working
- Manual input (option 1): fully working — writes to sheet, calculates shift/delta/notes
- Photo input (option 2): placeholder working — logs file_id, OCR not yet active
- Sheet population: confirmed correct for all columns

## Next Step

Implement OCR in `handlePhotoReceived()` — download the image from Telegram servers using the file_id, run Drive OCR on the blob, extract the kWh number, and write the real value to the sheet instead of a blank.