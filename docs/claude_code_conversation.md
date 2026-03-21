# Electric Meter Tracker — Full Context v5

## Project Overview

A personal electric meter tracker that logs kWh readings into a Google Sheet twice a day (morning and evening). The system calculates delta kWh, daily totals, and shift labels automatically via Google Apps Script. The intake method is a Telegram bot with Gemini Vision OCR, proactive reminders, and reporting features.

---

## Current Architecture

```
Apps Script Time Triggers (8AM / 8PM / 9PM / 10PM / every 15 min / Sunday 8AM)
    → reminders.gs + features.gs → Telegram (proactive messages)

User (Telegram)
    → Cloudflare Worker (meter-proxy.sorallocarlos17.workers.dev)
        → Apps Script Web App (doPost)
            → Gemini Vision API (OCR)
            → Google Sheet (Electric Meter Tracker > Readings tab)
```

---

## Google Sheet

**Sheet ID:** `1gv9MYmf0p-dw2X5j0J0wViug8VOrujZFyM2HldfISN0`
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

Four files in the same Apps Script project.

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
const SHEET_ID       = "1gv9MYmf0p-dw2X5j0J0wViug8VOrujZFyM2HldfISN0";
const SHEET_NAME     = "Readings";
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";
const GEMINI_URL     = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=";
const KWH_MIN        = 10000;
const KWH_MAX        = 999999;
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
- `/bill` — estimated bill for current billing cycle
- `/compare` — this week vs last week usage comparison
- `/setrate [amount]` — update kWh rate (e.g. `/setrate 11.50`)
- `/getrate` — show current kWh rate
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
- State timeout: 10 minutes
- Duplicate guard: warns if reading within 60 seconds
- Write lock: `LockService.getScriptLock()`
- Sanity check: warns if new value differs >500 kWh from last
- Gap warning: warns if >24 hours since last reading
- Input cleaning: fixes O→0, l→1, comma→period

**Chat ID registration:**
- `registerChatId(chatId)` called at top of `handleUpdate()` on every message
- Stored in PropertiesService under `reminder_chat_ids` as JSON array

### reminders.gs — Time-based reminder system

**Triggers (created by `setupTriggers()`):**
- `sendMorningReminder` — daily at 8:00 AM Asia/Manila
- `sendEveningReminder` — daily at 8:00 PM Asia/Manila
- `checkNudge` — every 15 minutes

**Flow:**
1. Reminder fires → sends to all registered chat IDs → stores `reminder_sent_time`
2. 15 min later `checkNudge` fires → if no reading logged since reminder → sends nudge
3. If reading was logged → clears flag silently

**Key functions:**
- `setupTriggers()` — creates all triggers, deletes existing first. **Run once manually.**
- `sendMorningReminder()` / `sendEveningReminder()` — broadcast reminder messages
- `sendReminderToAll(message)` — sends to all users, sets reminder flag
- `checkNudge()` — 15–30 min window check, sends nudge if no reading logged
- `registerChatId(chatId)` — adds to registry if not present
- `getRegisteredChatIds()` — returns array of all chat IDs
- `broadcastToAll(message)` — sends message to all registered users

### features.gs — Reporting and analytics

**Constants:**
```javascript
const BILLING_CYCLE_DAY = 14;   // day of month billing cycle starts
const DEFAULT_KWH_RATE  = 11.0; // fallback if no rate set via /setrate
```

**Rate management (stored in PropertiesService):**
- `getKwhRate()` — returns stored rate or DEFAULT_KWH_RATE
- `setKwhRate(rate)` — stores rate in PropertiesService
- Updated via `/setrate` command — no code changes needed when rate changes

**Triggers (created by `addFeatureTriggers()`):**
- `sendDailySummary` — daily at 9:00 PM Asia/Manila
- `sendWeeklyReport` — every Sunday at 8:00 AM Asia/Manila
- `checkAnomaly` — daily at 10:00 PM Asia/Manila

**Features:**

`/bill` — Estimated bill for current billing cycle:
- Finds billing cycle start based on `BILLING_CYCLE_DAY`
- Sums all `Daily_Total` values from Morning rows within the cycle
- Shows: usage so far, rate, est. bill so far, avg daily, projected full bill, days remaining

`/compare` — Weekly comparison:
- Compares this week (Mon→today) vs last full week
- Shows kWh and ₱ cost for each, difference and percentage

Daily summary (9PM auto):
- Shows today's reading count and daily total
- If no readings logged, sends a reminder to log before midnight

Weekly report (Sunday 8AM auto):
- Lists each day's usage and cost for the past 7 days
- Shows total, average per day, estimated cost

Anomaly alert (10PM auto):
- Compares today's daily total against 7-day average
- Alerts if today is ≥50% above the average
- Requires at least 3 days of history to fire

**Trigger setup:** Run `addFeatureTriggers()` once manually. Run `setupTriggers()` separately for reminders — they are independent functions.

**Test functions:**
```javascript
function testBillEstimate()      // sends /bill result to Telegram immediately
function testWeeklyComparison()  // sends /compare result immediately
function testDailySummary()      // sends daily summary immediately
function testWeeklyReport()      // sends weekly report immediately
function testAnomalyCheck()      // runs anomaly check immediately
```

---

## Gemini Vision OCR

**Model:** `gemini-2.5-flash`
**Method:** Image sent as base64 `inline_data` in request body
**Prompt:** Ask Gemini for the main large number on the LCD display, return only the numeric kWh reading

**Extraction:**
- Response cleaned with `/[^0-9.]/g`
- Discarded if value < last recorded reading

**Why Gemini:** Drive API v2 OCR consistently failed with MIME type corruption. Gemini accepts base64 directly — confirmed reading `27826` from real MERALCO meter photo on first try.

**Model selection history:**
- `gemini-2.0-flash` → 429 quota error
- `gemini-1.5-flash-latest` → 404 not found
- `gemini-2.5-flash` → confirmed working via `ListModels`

---

## Cloudflare Worker

**URL:** `https://meter-proxy.sorallocarlos17.workers.dev`

**Why needed:** Apps Script redirects unauthenticated POST requests (302/307). Telegram doesn't follow redirects → infinite retry loop. Worker returns 200 to Telegram immediately, follows redirect internally.

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

---

## Telegram Bot Commands

**Registered via `setMyCommands`:**
```
reading   — Log a new meter reading
last      — Show last reading
status    — Today's readings
bill      — Estimated bill this cycle
compare   — This week vs last week
help      — How to use this bot
```

**Note:** `/setrate` and `/getrate` work as commands but are not in the menu since they're used infrequently.

**Webhook:**
```
https://api.telegram.org/botTOKEN/setWebhook?url=https://meter-proxy.sorallocarlos17.workers.dev&drop_pending_updates=true
```

---

## Deployment Process

1. Edit code in Apps Script
2. **Deploy → New deployment → Web app** (Execute as: Me, Who has access: Anyone)
3. Copy new URL → update Cloudflare Worker `APPS_SCRIPT_URL` → Save and deploy
4. Re-register webhook if needed

**Time-based triggers do NOT need redeployment** — they call functions directly.

---

## All Issues Encountered and Resolved

| Issue | Resolution |
|-------|-----------|
| 302/307 redirect loop | Cloudflare Worker proxy |
| Infinite Telegram retry loop | `ContentService.createTextOutput("OK")` at top of `doPost` |
| Drive OCR MIME type corruption | Switched to Gemini Vision API |
| Gemini model 404/429 errors | Used `ListModels` — confirmed `gemini-2.5-flash` |
| OCR discarding correct reading | Cleaned up test rows with values above real meter |
| Column mapping conflicts | Explicit checks before generic catch-alls |
| `/bill` returning no data | Expected — needs Morning rows with Daily_Total in billing cycle |

---

## Meter Details

**Type:** GE MERALCO (GEPMICI, Made in Philippines)
**Display:** LCD, amber/gold background, dark digits
**Main reading:** 5-digit number, top row (e.g. 27826)
**Secondary:** 3-digit number below (e.g. 206) — ignored
**kWh range:** 10,000 – 999,999
**Billing cycle:** starts on the 14th of each month

---

## Current Status

| Feature | Status |
|---------|--------|
| Cloudflare Worker | ✅ deployed |
| Telegram bot commands | ✅ all working |
| Manual input | ✅ working |
| Photo + Gemini OCR | ✅ working |
| OCR confirm + manual fallback | ✅ working |
| Safety guards | ✅ working |
| 8AM/8PM reminders | ✅ implemented |
| 15-min nudge | ✅ implemented |
| /bill command | ✅ implemented (needs real data) |
| /compare command | ✅ implemented |
| /setrate + /getrate | ✅ implemented |
| Daily summary (9PM) | ✅ implemented |
| Weekly report (Sunday) | ✅ implemented |
| Anomaly alert (10PM) | ✅ implemented |

## Possible Future Features

- Dashboard — Google Sheets tab with charts
- `/history [days]` — show last N days of readings
- Cost projection graph
- Export to PDF monthly report