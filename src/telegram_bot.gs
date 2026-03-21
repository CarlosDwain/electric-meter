/**
 * Electric Meter Tracker — Telegram Bot
 * Version 5.2 (All improvements applied)
 *
 * Improvements over v5.1:
 *  - Duplicate submission guard (60 second window)
 *  - State timeout (10 minutes)
 *  - Concurrent write lock (LockService)
 *  - /cancel command
 *  - /last command
 *  - /status command
 *  - Sanity check on manual input (warns if value is far from last reading)
 *  - Gap warning before logging if last reading was >24 hours ago
 *  - Input cleaning (common OCR-style typos like O→0, l→1)
 */

const BOT_TOKEN  = "YOUR_BOT_TOKEN_HERE";
const SHEET_ID   = "YOUR_SHEET_ID_HERE";
const SHEET_NAME = "Readings";

const STATE_IDLE           = "IDLE";
const STATE_WAIT_OPTION    = "WAIT_OPTION";
const STATE_WAIT_NUMBER    = "WAIT_NUMBER";
const STATE_WAIT_PHOTO     = "WAIT_PHOTO";
const STATE_CONFIRM_VALUE  = "CONFIRM_VALUE";  // sanity check confirmation
const STATE_CONFIRM_GAP    = "CONFIRM_GAP";    // gap warning confirmation

const STATE_TIMEOUT_MS     = 10 * 60 * 1000;  // 10 minutes
const DUPLICATE_WINDOW_MS  = 60 * 1000;        // 60 seconds
const SANITY_THRESHOLD     = 500;              // warn if delta > 500 kWh from last

// ─── Webhook entry point ──────────────────────────────────────────────────────

function doPost(e) {
  const output = ContentService.createTextOutput("OK");
  try {
    const update = JSON.parse(e.postData.contents);
    handleUpdate(update);
  } catch (err) {
    console.error("doPost error: " + err.toString());
  }
  return output;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

function handleUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = String(message.chat.id);
  const state  = getState(chatId);
  const text   = message.text ? message.text.trim() : "";

  console.log("Chat: " + chatId + " | State: " + state + " | Text: " + text);

  // --- Check state timeout ---
  if (state !== STATE_IDLE && isStateExpired(chatId)) {
    setState(chatId, STATE_IDLE);
    clearPending(chatId);
    sendMessage(chatId,
      "Your previous session timed out. Send /reading to start again."
    );
    return;
  }

  // --- Photo received ---
  if (message.photo) {
    if (state === STATE_WAIT_PHOTO) {
      handlePhotoReceived(chatId, message);
    } else {
      sendMessage(chatId, "Send /reading first to start logging a reading.");
    }
    return;
  }

  // --- Global commands (work from any state) ---
  if (text === "/cancel") {
    setState(chatId, STATE_IDLE);
    clearPending(chatId);
    sendMessage(chatId, "Cancelled. Send /reading to start a new reading.");
    return;
  }

  if (text === "/start") {
    setState(chatId, STATE_IDLE);
    clearPending(chatId);
    sendMessage(chatId,
      "⚡ Electric Meter Tracker\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "Track your daily electricity usage by logging your meter reading twice a day — morning and evening.\n\n" +
      "The bot automatically calculates:\n" +
      "• Delta kWh (usage since last reading)\n" +
      "• Daily total (full day usage)\n" +
      "• Shift (Morning / Evening / Manual)\n\n" +
      "Commands:\n" +
      "/reading — Log a new meter reading\n" +
      "/last — Show the last logged reading\n" +
      "/status — Show today's readings\n" +
      "/cancel — Cancel current input\n" +
      "/help — Show this message again"
    );
    return;
  }

  if (text === "/help") {
    sendMessage(chatId,
      "⚡ Electric Meter Tracker — Help\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "/reading — Log a new meter reading\n" +
      "/last — Show the last logged reading\n" +
      "/status — Show today's readings\n" +
      "/cancel — Cancel current input\n\n" +
      "When logging you can:\n" +
      "1 — Type the kWh number manually\n" +
      "2 — Upload a photo (OCR coming soon)\n\n" +
      "Best reading times:\n" +
      "• Morning: 6:00 AM – 10:00 AM\n" +
      "• Evening: 6:00 PM – 10:00 PM"
    );
    return;
  }

  if (text === "/last") {
    sendLastReading(chatId);
    return;
  }

  if (text === "/status") {
    sendTodayStatus(chatId);
    return;
  }

  // --- /reading command ---
  if (text === "/reading") {
    // Check for gap warning before starting
    const gapInfo = getGapInfo();
    if (gapInfo.hours > 24) {
      setPending(chatId, "gap_hours", gapInfo.hours.toFixed(1));
      setState(chatId, STATE_CONFIRM_GAP);
      sendMessage(chatId,
        "Last reading was " + gapInfo.hours.toFixed(1) + " hours ago (" + gapInfo.lastDate + ").\n\n" +
        "This will be flagged as a gap in the sheet.\n" +
        "Continue anyway?\n\n" +
        "yes — proceed\n" +
        "no — cancel"
      );
    } else {
      setState(chatId, STATE_WAIT_OPTION);
      sendMessage(chatId,
        "How would you like to enter the reading?\n\n" +
        "1 — Type the number manually\n" +
        "2 — Upload a photo of the meter"
      );
    }
    return;
  }

  // --- Conversation states ---
  if (state === STATE_CONFIRM_GAP) {
    if (text.toLowerCase() === "yes") {
      setState(chatId, STATE_WAIT_OPTION);
      sendMessage(chatId,
        "How would you like to enter the reading?\n\n" +
        "1 — Type the number manually\n" +
        "2 — Upload a photo of the meter"
      );
    } else {
      setState(chatId, STATE_IDLE);
      clearPending(chatId);
      sendMessage(chatId, "Cancelled. Send /reading when you're ready.");
    }
    return;
  }

  if (state === STATE_WAIT_OPTION) {
    if (text === "1") {
      setState(chatId, STATE_WAIT_NUMBER);
      sendMessage(chatId, "Type the kWh reading (numbers only, e.g. 28504):");
    } else if (text === "2") {
      setState(chatId, STATE_WAIT_PHOTO);
      sendMessage(chatId, "Send a photo of the meter.");
    } else {
      sendMessage(chatId, "Please reply with 1 or 2.");
    }
    return;
  }

  if (state === STATE_WAIT_NUMBER) {
    const cleaned = cleanInput(text);
    const kwh     = parseFloat(cleaned);
    if (isNaN(kwh)) {
      sendMessage(chatId,
        "That doesn't look like a number.\n" +
        "Please type the kWh reading (e.g. 28504):\n\n" +
        "Send /cancel to abort."
      );
      return;
    }

    // Sanity check
    const lastRecord = getLastRecord();
    if (lastRecord && Math.abs(kwh - lastRecord.kwh) > SANITY_THRESHOLD) {
      setPending(chatId, "pending_kwh", kwh);
      setState(chatId, STATE_CONFIRM_VALUE);
      sendMessage(chatId,
        "That value seems unusual.\n" +
        "Last reading: " + lastRecord.kwh + " kWh\n" +
        "You entered: " + kwh + " kWh\n" +
        "Difference: " + Math.abs(kwh - lastRecord.kwh).toFixed(2) + " kWh\n\n" +
        "Is this correct?\n" +
        "yes — log it anyway\n" +
        "no — re-enter the value"
      );
      return;
    }

    // Duplicate check
    if (isDuplicate()) {
      sendMessage(chatId,
        "A reading was just logged less than 60 seconds ago.\n" +
        "Are you sure you want to log another?\n\n" +
        "yes — log it anyway\n" +
        "no — cancel"
      );
      setPending(chatId, "pending_kwh", kwh);
      setState(chatId, STATE_CONFIRM_VALUE);
      return;
    }

    handleManualReading(chatId, kwh);
    return;
  }

  if (state === STATE_CONFIRM_VALUE) {
    const pendingKwh = getPending(chatId, "pending_kwh");
    if (text.toLowerCase() === "yes" && pendingKwh !== null) {
      handleManualReading(chatId, parseFloat(pendingKwh));
    } else {
      setState(chatId, STATE_WAIT_NUMBER);
      clearPending(chatId);
      sendMessage(chatId, "Please type the kWh reading again:");
    }
    return;
  }

  // --- Fallback ---
  setState(chatId, STATE_IDLE);
  sendMessage(chatId, "Send /reading to log a meter reading or /help for more info.");
}

// ─── Reading handlers ─────────────────────────────────────────────────────────

function handleManualReading(chatId, kwh) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const result = writeToSheet(kwh, "manual");
    setState(chatId, STATE_IDLE);
    clearPending(chatId);
    sendMessage(chatId,
      "Reading logged.\n" +
      "Value: " + kwh + " kWh\n" +
      "Shift: " + result.shift +
      (result.delta !== 0 ? "\nDelta: " + result.delta + " kWh" : "") +
      (result.dailyTotal !== null ? "\nDaily total: " + result.dailyTotal + " kWh" : "") +
      (result.notes ? "\nNotes: " + result.notes : "")
    );
  } finally {
    lock.releaseLock();
  }
}

function handlePhotoReceived(chatId, message) {
  const fileId = message.photo[message.photo.length - 1].file_id;
  console.log("Photo received, file_id: " + fileId + " — OCR not yet implemented.");

  writeToSheet(null, "photo_placeholder:" + fileId);
  setState(chatId, STATE_IDLE);
  clearPending(chatId);
  sendMessage(chatId,
    "Photo received and logged.\n" +
    "OCR is not active yet — reading recorded as blank.\n\n" +
    "Send /reading to log the value manually in the meantime."
  );
}

// ─── /last command ────────────────────────────────────────────────────────────

function sendLastReading(chatId) {
  const last = getLastRecord();
  if (!last) {
    sendMessage(chatId, "No readings logged yet.");
    return;
  }
  sendMessage(chatId,
    "Last reading:\n" +
    "Value: " + last.kwh + " kWh\n" +
    "Time: " + Utilities.formatDate(last.timestamp, CONFIG.TIMEZONE, "MMM dd, yyyy HH:mm") + "\n" +
    "Shift: " + last.shift
  );
}

// ─── /status command ──────────────────────────────────────────────────────────

function sendTodayStatus(chatId) {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const sheet   = ss.getSheetByName(SHEET_NAME);
  const colMap  = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    sendMessage(chatId, "No readings logged yet.");
    return;
  }

  const today    = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const data     = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const todayRows = data.filter(row => {
    const ts = new Date(row[0]);
    return Utilities.formatDate(ts, CONFIG.TIMEZONE, "yyyy-MM-dd") === today;
  });

  if (todayRows.length === 0) {
    sendMessage(chatId, "No readings logged today yet.\nSend /reading to log one.");
    return;
  }

  let msg = "Today's readings (" + today + "):\n━━━━━━━━━━━━━━━━━━━━\n";
  todayRows.forEach((row, i) => {
    const ts    = Utilities.formatDate(new Date(row[0]), CONFIG.TIMEZONE, "HH:mm");
    const kwh   = row[colMap.Raw_kwh - 1] || "—";
    const shift = row[colMap.Shift - 1]   || "—";
    const delta = row[colMap.Delta_kwh - 1];
    msg += (i + 1) + ". " + ts + " | " + kwh + " kWh | " + shift;
    if (delta !== "" && delta !== 0) msg += " | Δ" + delta;
    msg += "\n";
  });

  const dailyTotal = todayRows
    .map(r => r[colMap.Daily_Total - 1])
    .find(v => v !== "" && v !== null);
  if (dailyTotal) msg += "\nDaily total: " + dailyTotal + " kWh";

  sendMessage(chatId, msg);
}

// ─── Sheet writer ─────────────────────────────────────────────────────────────

function writeToSheet(rawKwh, source) {
  const ss        = SpreadsheetApp.openById(SHEET_ID);
  const sheet     = ss.getSheetByName(SHEET_NAME);
  const colMap    = getColumnMapping(sheet);
  const timestamp = new Date();

  const newRow = buildEmptyRow(sheet);
  newRow[colMap.Timestamp - 1]   = timestamp;
  newRow[colMap.Raw_kwh - 1]     = rawKwh !== null ? rawKwh : "";
  newRow[colMap.Meter_Photo - 1] = source;
  sheet.appendRow(newRow);

  const appendedRow = sheet.getLastRow();
  const prevData    = getPreviousRecord(sheet, appendedRow, colMap.Raw_kwh);
  const result      = calculateReadingLogic(timestamp, rawKwh, prevData, sheet, appendedRow, colMap);
  result.notes      = result.notes.trim();

  updateSheetRow(sheet, appendedRow, colMap, result, rawKwh);
  console.log("Row " + appendedRow + " written — " + rawKwh + " kWh / " + result.shift);
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLastRecord() {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const sheet   = ss.getSheetByName(SHEET_NAME);
  const colMap  = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    const kwh = parseFloat(data[i][colMap.Raw_kwh - 1]);
    if (!isNaN(kwh)) {
      return {
        kwh:       kwh,
        timestamp: new Date(data[i][0]),
        shift:     data[i][colMap.Shift - 1] || "—"
      };
    }
  }
  return null;
}

function getGapInfo() {
  const last = getLastRecord();
  if (!last) return { hours: 0, lastDate: "never" };
  const hours    = (new Date() - last.timestamp) / (1000 * 60 * 60);
  const lastDate = Utilities.formatDate(last.timestamp, CONFIG.TIMEZONE, "MMM dd HH:mm");
  return { hours, lastDate };
}

function isDuplicate() {
  const last = getLastRecord();
  if (!last) return false;
  return (new Date() - last.timestamp) < DUPLICATE_WINDOW_MS;
}

function cleanInput(text) {
  // Fix common OCR-style typos: letter O → 0, lowercase l → 1, comma → period
  return text.replace(/[Oo]/g, "0").replace(/l/g, "1").replace(/,/g, ".");
}

// ─── State management ─────────────────────────────────────────────────────────

function getState(chatId) {
  return PropertiesService.getScriptProperties()
    .getProperty("state_" + chatId) || STATE_IDLE;
}

function setState(chatId, state) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("state_" + chatId, state);
  props.setProperty("state_time_" + chatId, String(new Date().getTime()));
}

function isStateExpired(chatId) {
  const props    = PropertiesService.getScriptProperties();
  const stateTime = parseInt(props.getProperty("state_time_" + chatId) || "0");
  return (new Date().getTime() - stateTime) > STATE_TIMEOUT_MS;
}

function setPending(chatId, key, value) {
  PropertiesService.getScriptProperties()
    .setProperty("pending_" + key + "_" + chatId, String(value));
}

function getPending(chatId, key) {
  const val = PropertiesService.getScriptProperties()
    .getProperty("pending_" + key + "_" + chatId);
  return val !== null ? parseFloat(val) : null;
}

function clearPending(chatId) {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("pending_kwh_" + chatId);
  props.deleteProperty("pending_gap_hours_" + chatId);
  props.deleteProperty("state_time_" + chatId);
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

function sendMessage(chatId, text) {
  try {
    UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, text: text }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error("sendMessage error: " + err.toString());
  }
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────

function buildEmptyRow(sheet) {
  return new Array(Math.max(sheet.getLastColumn(), 7)).fill("");
}