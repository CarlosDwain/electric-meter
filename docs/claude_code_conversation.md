# Electric Meter Tracker — Full Context v4

## Project Overview

A personal electric meter tracker that logs kWh readings into a Google Sheet twice a day (morning and evening). The system calculates delta kWh, daily totals, and shift labels automatically via Google Apps Script. The intake method is a Telegram bot with Gemini Vision OCR and proactive reminders.

---

## Current Architecture

```
Apps Script Time Triggers (8AM / 8PM / every 15 min)
    → reminders.gs → Telegram (proactive messages)

User (Telegram)
    → Cloudflare Worker (meter-proxy.sorallocarlos17.workers.dev)
        → Apps Script Web App (doPost)
            → Gemini Vision API (OCR)
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
| C | Meter Photo | "manual", "tg:FILE_ID" for photos |
| D | Shift | Morning / Evening / Manual / Gap (Multi-Day) / Gap (Missed) |
| E | Delta_kwh | Difference from previous reading |
| F | Daily_Total | Total kWh for the day (Morning readings only) |
| G | Notes | [Initial Reading], [OCR: Extracted], [GAP: ...], etc. |

---

## Apps Script Project

Three files in the same Apps Script project.

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

### telegram_bot.gs — Telegram bot + Gemini OCR + sheet writer

**Constants:**
```javascript
const BOT_TOKEN      = "YOUR_BOT_TOKEN";
const SHEET_ID       = "YOUR_SHEET_ID_HERE";
const SHEET_NAME     = "Readings";
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";
const GEMINI_URL     = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=";
```

**OCR constants:**
```javascript
const KWH_MIN = 10000;   // realistic lower bound for this MERALCO meter
const KWH_MAX = 999999;  // realistic upper bound
```

**Conversation states (stored in PropertiesService):**
- `IDLE` — waiting for /reading command
- `WAIT_OPTION` — waiting for user to pick 1 or 2
- `WAIT_NUMBER` — waiting for manual kWh number input
- `WAIT_PHOTO` — waiting for photo upload
- `WAIT_OCR_CONFIRM` — OCR succeeded, waiting for user to confirm or reject
- `WAIT_OCR_MANUAL` — OCR failed or rejected, waiting for manual input
- `CONFIRM_VALUE` — sanity check triggered, waiting for confirmation
- `CONFIRM_GAP` — gap warning triggered, waiting for confirmation

**Commands:**
- `/start` — welcome message with full description
- `/help` — usage instructions and best reading times
- `/reading` — starts the logging flow
- `/last` — shows the last logged reading (value, time, shift)
- `/status` — shows all readings logged today with deltas
- `/cancel` — cancels current input from any state

**Conversation flow:**
```
/reading
    → gap warning if >24 hours since last reading (yes/no)
    → How to enter? 1 (manual) or 2 (photo)

Option 1 — Manual:
    → type number
    → sanity check if differs >500 kWh from last (yes/no)
    → duplicate check if reading within 60 seconds (yes/no)
    → logged to sheet

Option 2 — Photo:
    → send photo
    → Gemini OCR runs
    → OCR success: "Detected: XXXXX kWh — correct? yes/no"
        → yes: logged to sheet
        → no: ask to type correct value → logged to sheet
    → OCR fail: ask to type manually → logged to sheet
```

**Safety guards:**
- State timeout: 10 minutes — expired state resets to IDLE
- Duplicate guard: warns if reading logged within 60 seconds
- Write lock: `LockService.getScriptLock()` prevents concurrent writes
- Sanity check: warns if new value differs >500 kWh from last reading
- Gap warning: warns if >24 hours since last reading
- Input cleaning: fixes O→0, l→1, comma→period typos

**Chat ID registration:**
- Every user who interacts with the bot is auto-registered via `registerChatId(chatId)`
- Called at the top of `handleUpdate()` on every message
- Stored in PropertiesService under key `reminder_chat_ids` as a JSON array

### reminders.gs — Time-based reminder system

**Constants:**
```javascript
const REMINDER_CHAT_IDS_KEY = "reminder_chat_ids";
const REMINDER_SENT_KEY     = "reminder_sent_time";
const NUDGE_SENT_KEY        = "nudge_sent_time";
```

**Triggers (created by running `setupTriggers()` once):**
- `sendMorningReminder` — fires daily at 8:00 AM Asia/Manila
- `sendEveningReminder` — fires daily at 8:00 PM Asia/Manila
- `checkNudge` — fires every 15 minutes

**Reminder flow:**
1. `sendMorningReminder` or `sendEveningReminder` fires
2. Sends message to all registered chat IDs
3. Stores `reminder_sent_time` in PropertiesService
4. 15 minutes later, `checkNudge` fires
5. If no reading logged since reminder → sends nudge to all users
6. If reading was logged → clears flag silently, no nudge

**Key functions:**
- `setupTriggers()` — creates all three triggers, deletes existing ones first to prevent duplicates. **Run once manually.**
- `sendMorningReminder()` — broadcasts morning message
- `sendEveningReminder()` — broadcasts evening message
- `sendReminderToAll(message)` — sends to all registered users, sets reminder flag
- `checkNudge()` — checks if nudge needed, sends if 15–30 min window and no reading logged
- `registerChatId(chatId)` — adds chat ID to registry if not already present
- `getRegisteredChatIds()` — returns array of all registered chat IDs

**Test functions (temporary, remove after testing):**
```javascript
function testReminder()        // sends morning reminder immediately
function testNudge()           // simulates 16 min elapsed, fires nudge check
function testRegisteredUsers() // logs all registered chat IDs
```

---

## Gemini Vision OCR

**Model:** `gemini-2.5-flash`
**Method:** Image sent as base64 inline_data in the request body
**Prompt:** Asks Gemini to look at the main large number on the LCD display and return only the numeric kWh reading

**Smart extraction logic:**
- Gemini returns the number directly as plain text
- Response cleaned with `/[^0-9.]/g` to strip non-numeric characters
- Sanity check: discards if value < last recorded reading (meter never goes backward)

**Why Gemini instead of Drive OCR:**
- Drive API v2 `Files.insert` with OCR consistently failed due to MIME type corruption
- Blobs typed as `image/jpeg` were rejected with "OCR is not supported for files of type application/vnd.google-apps.document"
- Gemini accepts base64 image bytes directly — no Drive insert, no MIME type issues
- Gemini 2.5 Flash correctly identified `27826` from a real MERALCO meter photo on first try

**Model selection:**
- `gemini-2.0-flash` → 429 quota error (limit: 0 on free tier)
- `gemini-1.5-flash-latest` → 404 not found
- `gemini-2.5-flash` → works, confirmed via `ListModels`

**Free tier:** Google AI Studio — no credit card required

---

## Cloudflare Worker

**URL:** `https://meter-proxy.sorallocarlos17.workers.dev`
**Purpose:** Proxies Telegram webhook POSTs to Apps Script, following Google's 302/307 redirects internally so Telegram gets a clean 200 OK back.

**Why it's needed:** Google Apps Script Web Apps redirect unauthenticated POST requests. Telegram doesn't follow redirects — infinite retry loop results. The Worker returns 200 to Telegram immediately, then follows the redirect internally.

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
6. Re-register webhook with `drop_pending_updates=true` if needed

**Note:** Editing an existing deployment does NOT update the live URL — always create a **new deployment**. Time-based triggers (`setupTriggers`) do NOT need redeployment — they call functions directly, not via the Web App URL.

---

## Issues Encountered and Resolved

### 302/307 redirect loop
Telegram retried forever because Apps Script redirected unauthenticated POSTs. Fixed with Cloudflare Worker proxy.

### Infinite reply loop
Bot kept sending the same message repeatedly. Fix: `ContentService.createTextOutput("OK")` must be created at the very top of `doPost` and always returned.

### Drive OCR MIME type corruption (never resolved — switched to Gemini)
`DriveApp.getFileById().getBlob()` and `UrlFetchApp` blobs typed as `image/jpeg` were consistently rejected by `Drive.Files.insert`. Multiple fixes attempted — none worked. Switched to Gemini Vision API.

### Gemini model not found / quota errors
`gemini-2.0-flash` → 429, `gemini-1.5-flash-latest` → 404. Fixed by calling `ListModels` — `gemini-2.5-flash` confirmed working.

### OCR discarding correct reading
Gemini read `27826` correctly but it was discarded because test data in sheet had `27829`. Fixed by cleaning up test rows.

### Column mapping conflicts
- `delta_kwh` matched by generic `kwh` catch-all — fixed by checking `delta_kwh` first
- `Image_Url` matched `head.includes("image")` overwriting `Meter_Photo` — fixed by matching only `head.includes("photo")`

---

## Meter Details

**Type:** GE MERALCO electric meter (Made in Philippines by GEPMICI)
**Display:** LCD with amber/gold background, dark digits
**Main reading:** 5-digit number (e.g. 27826) — top row, largest digits
**Secondary reading:** 3-digit number below (e.g. 206) — ignored
**Serial:** 113BAG054804
**Realistic kWh range:** 10,000 – 999,999

---

## Current Status

- Cloudflare Worker: deployed and verified ✅
- Telegram bot: all commands working ✅
- Manual input (option 1): fully working ✅
- Photo input (option 2) with Gemini OCR: fully working ✅
- OCR confirmation + manual fallback: working ✅
- All safety guards: working ✅
- Sheet population: confirmed correct for all columns ✅
- Reminders at 8AM and 8PM: implemented ✅
- 15-minute nudge if no reading logged: implemented ✅
- Auto-registration of chat IDs for reminders: implemented ✅

## Next Steps (optional features)

- Monthly bill estimate (`/bill` command) — based on daily totals × rate per kWh
- Daily summary — auto-sent at 10PM with the day's total
- Weekly report — sent every Sunday with 7-day breakdown
- `/compare` command — this week vs last week
- Anomaly alert — warns if usage significantly above 7-day average
- Dashboard — Google Sheets dashboard tab with charts