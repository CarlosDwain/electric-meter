/**
 * Electric Meter Tracker — Telegram Bot
 * Version 5.3 (Secure & Sanitized)
 */

// --- CONFIGURATION (REPLACE THESE) ---
const BOT_TOKEN       = "YOUR_BOT_TOKEN_HERE"; 
const SHEET_ID        = "YOUR_SHEET_ID_HERE";
const GEMINI_API_KEY  = "YOUR_GEMINI_API_KEY_HERE";
const ALLOWED_USER_ID = 123456789; // Your Numeric ID from @userinfobot
const SHEET_NAME      = "Readings";

// ─── States ──────────────────────────────────────────────────────────────────
const STATE_IDLE             = "IDLE";
const STATE_WAIT_OPTION      = "WAIT_OPTION";
const STATE_WAIT_NUMBER      = "WAIT_NUMBER";
const STATE_WAIT_PHOTO       = "WAIT_PHOTO";
const STATE_WAIT_OCR_CONFIRM = "WAIT_OCR_CONFIRM";
const STATE_WAIT_OCR_MANUAL  = "WAIT_OCR_MANUAL";
const STATE_CONFIRM_VALUE    = "CONFIRM_VALUE";
const STATE_CONFIRM_GAP      = "CONFIRM_GAP";

const STATE_TIMEOUT_MS    = 10 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 60 * 1000;
const SANITY_THRESHOLD    = 500;
const KWH_MIN             = 10000; 
const KWH_MAX             = 999999;

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
  const userId = message.from.id;

  // --- SECURITY CHECK: Whitelist ---
  if (userId !== ALLOWED_USER_ID) {
    sendMessage(chatId, "🚫 Access Denied. This is a private bot.");
    return;
  }

  const state  = getState(chatId);
  const text   = message.text ? message.text.trim() : "";

  console.log("Chat: " + chatId + " | State: " + state + " | Text: " + text);

  // --- State timeout ---
  if (state !== STATE_IDLE && isStateExpired(chatId)) {
    setState(chatId, STATE_IDLE);
    clearPending(chatId);
    sendMessage(chatId, "Your session timed out. Send /reading to start again.");
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

  // --- Global commands ---
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
      "Track your daily electricity usage by logging your meter reading twice a day.\n\n" +
      "Commands:\n" +
      "/reading — Log a new meter reading\n" +
      "/last — Show the last logged reading\n" +
      "/status — Show today's readings\n" +
      "/cancel — Cancel current input"
    );
    return;
  }

  if (text === "/reading") {
    const gapInfo = getGapInfo();
    if (gapInfo.hours > 24) {
      setPending(chatId, "gap_hours", gapInfo.hours.toFixed(1));
      setState(chatId, STATE_CONFIRM_GAP);
      sendMessage(chatId,
        "Last reading was " + gapInfo.hours.toFixed(1) + " hours ago.\nContinue?\nyes / no"
      );
    } else {
      setState(chatId, STATE_WAIT_OPTION);
      sendMessage(chatId, "How would you like to log?\n1 — Manual\n2 — Photo");
    }
    return;
  }

  // Handle Conversation States
  if (state === STATE_CONFIRM_GAP) {
    if (text.toLowerCase() === "yes") {
      setState(chatId, STATE_WAIT_OPTION);
      sendMessage(chatId, "How would you like to log?\n1 — Manual\n2 — Photo");
    } else {
      setState(chatId, STATE_IDLE);
      sendMessage(chatId, "Cancelled.");
    }
    return;
  }

  if (state === STATE_WAIT_OPTION) {
    if (text === "1") {
      setState(chatId, STATE_WAIT_NUMBER);
      sendMessage(chatId, "Type the kWh reading:");
    } else if (text === "2") {
      setState(chatId, STATE_WAIT_PHOTO);
      sendMessage(chatId, "Send a photo of the meter.");
    }
    return;
  }

  if (state === STATE_WAIT_NUMBER) {
    const kwh = parseFloat(cleanInput(text));
    if (isNaN(kwh)) {
      sendMessage(chatId, "Invalid number. Try again:");
      return;
    }
    checkAndLog(chatId, kwh, STATE_WAIT_NUMBER);
    return;
  }

  if (state === STATE_WAIT_OCR_CONFIRM) {
    const pendingKwh = getPending(chatId, "pending_kwh");
    if (text.toLowerCase() === "yes") {
      handleManualReading(chatId, pendingKwh);
    } else {
      setState(chatId, STATE_WAIT_OCR_MANUAL);
      sendMessage(chatId, "Please type the correct value:");
    }
    return;
  }

  if (state === STATE_WAIT_OCR_MANUAL) {
    const kwh = parseFloat(cleanInput(text));
    if (!isNaN(kwh)) handleManualReading(chatId, kwh);
    return;
  }

  if (state === STATE_CONFIRM_VALUE) {
    const pendingKwh = getPending(chatId, "pending_kwh");
    if (text.toLowerCase() === "yes") handleManualReading(chatId, pendingKwh);
    else setState(chatId, STATE_WAIT_NUMBER);
    return;
  }

  setState(chatId, STATE_IDLE);
  sendMessage(chatId, "Send /reading to start.");
}

// ─── Handlers ─────────────────────────────────────────────────────────

function handlePhotoReceived(chatId, message) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sendMessage(chatId, "Reading meter digits...");
    const fileId = message.photo[message.photo.length - 1].file_id;
    const imageBlob = fetchTelegramFile(fileId);
    
    if (!imageBlob) {
      setState(chatId, STATE_WAIT_OCR_MANUAL);
      sendMessage(chatId, "Download failed. Type value manually:");
      return;
    }

    const lastRecord = getLastRecord();
    const ocrValue = performOcrOnBlob(imageBlob, lastRecord ? lastRecord.kwh : null);

    if (ocrValue) {
      setPending(chatId, "pending_kwh", ocrValue);
      setPending(chatId, "pending_file_id", fileId);
      setState(chatId, STATE_WAIT_OCR_CONFIRM);
      sendMessage(chatId, "Detected: " + ocrValue + " kWh. Correct?\nyes / no");
    } else {
      setPending(chatId, "pending_file_id", fileId);
      setState(chatId, STATE_WAIT_OCR_MANUAL);
      sendMessage(chatId, "Could not read photo. Type value manually:");
    }
  } finally {
    lock.releaseLock();
  }
}

function handleManualReading(chatId, kwh) {
  const result = writeToSheet(kwh, getPendingString(chatId, "pending_file_id") || "manual");
  setState(chatId, STATE_IDLE);
  clearPending(chatId);
  sendMessage(chatId, "✅ Saved! Delta: " + result.delta + " kWh");
}

function checkAndLog(chatId, kwh, returnState) {
  const lastRecord = getLastRecord();
  if (lastRecord && Math.abs(kwh - lastRecord.kwh) > SANITY_THRESHOLD) {
    setPending(chatId, "pending_kwh", kwh);
    setState(chatId, STATE_CONFIRM_VALUE);
    sendMessage(chatId, "Unusual value (Δ" + Math.abs(kwh - lastRecord.kwh).toFixed(2) + "). Correct?\nyes / no");
    return;
  }
  handleManualReading(chatId, kwh);
}

// ─── OCR & Logic ──────────────────────────────────────────────────────

function performOcrOnBlob(imageBlob, lastKwh) {
  const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=";
  try {
    const payload = {
      contents: [{
        parts: [{ text: "Extract the main kWh reading from this meter. Reply with numeric value only." },
                { inline_data: { mime_type: "image/jpeg", data: Utilities.base64Encode(imageBlob.getBytes()) }}]
      }]
    };
    const response = UrlFetchApp.fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    const raw = JSON.parse(response.getContentText()).candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const val = parseFloat(raw.replace(/[^0-9.]/g, ""));
    return (!isNaN(val) && (lastKwh === null || val >= lastKwh)) ? val : null;
  } catch (e) { return null; }
}

function fetchTelegramFile(fileId) {
  const url = "https://api.telegram.org/bot" + BOT_TOKEN + "/getFile?file_id=" + fileId;
  const path = JSON.parse(UrlFetchApp.fetch(url).getContentText()).result.file_path;
  return UrlFetchApp.fetch("https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + path).getBlob().setContentType("image/jpeg");
}

function writeToSheet(rawKwh, source) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);
  const ts = new Date();
  sheet.appendRow([ts, rawKwh, source]);
  const row = sheet.getLastRow();
  const prev = getPreviousRecord(sheet, row, colMap.Raw_kwh);
  const res = calculateReadingLogic(ts, rawKwh, prev, sheet, row, colMap);
  updateSheetRow(sheet, row, colMap, res, rawKwh);
  return res;
}

// ─── State Helpers ────────────────────────────────────────────────────

function getState(chatId) { return PropertiesService.getScriptProperties().getProperty("state_" + chatId) || STATE_IDLE; }
function setState(chatId, state) { 
  PropertiesService.getScriptProperties().setProperty("state_" + chatId, state);
  PropertiesService.getScriptProperties().setProperty("state_time_" + chatId, String(new Date().getTime()));
}
function isStateExpired(chatId) {
  const t = parseInt(PropertiesService.getScriptProperties().getProperty("state_time_" + chatId) || "0");
  return (new Date().getTime() - t) > STATE_TIMEOUT_MS;
}
function setPending(chatId, k, v) { PropertiesService.getScriptProperties().setProperty("pending_" + k + "_" + chatId, String(v)); }
function getPending(chatId, k) { return parseFloat(PropertiesService.getScriptProperties().getProperty("pending_" + k + "_" + chatId)); }
function getPendingString(chatId, k) { return PropertiesService.getScriptProperties().getProperty("pending_" + k + "_" + chatId); }
function clearPending(chatId) {
  const p = PropertiesService.getScriptProperties();
  ["pending_kwh_", "pending_file_id_", "state_time_"].forEach(k => p.deleteProperty(k + chatId));
}
function sendMessage(chatId, text) {
  UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
    method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: chatId, text: text })
  });
}
function cleanInput(t) { return t.replace(/[Oo]/g, "0").replace(/l/g, "1").replace(/,/g, "."); }
function getGapInfo() {
  const last = getLastRecord();
  return last ? { hours: (new Date() - last.timestamp)/3600000 } : { hours: 0 };
}
function getLastRecord() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (!isNaN(parseFloat(data[i][1]))) return { kwh: data[i][1], timestamp: new Date(data[i][0]) };
  }
  return null;
}
