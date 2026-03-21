/**
 * Electric Meter Tracker — Telegram Bot
 * Version 5.1 (Secure & Sanitized)
 */

// --- CONFIGURATION (REPLACE THESE) ---
const BOT_TOKEN      = "PASTE_YOUR_BOT_TOKEN_HERE"; 
const SHEET_ID       = "PASTE_YOUR_SHEET_ID_HERE";
const ALLOWED_USER_ID = 123456789; // Your Numeric ID from @userinfobot
const SHEET_NAME     = "Readings";

// ─── States ──────────────────────────────────────────────────────────────────
const STATE_IDLE         = "IDLE";
const STATE_WAIT_OPTION  = "WAIT_OPTION";
const STATE_WAIT_NUMBER  = "WAIT_NUMBER";
const STATE_WAIT_PHOTO   = "WAIT_PHOTO";

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
  console.log("Chat: " + chatId + " | State: " + state);

  // --- User sent a photo ---
  if (message.photo) {
    if (state === STATE_WAIT_PHOTO) {
      handlePhotoReceived(chatId, message);
    } else {
      sendMessage(chatId, "Please use the menu first. Send /reading to start.");
    }
    return;
  }

  // --- User sent text ---
  const text = message.text ? message.text.trim() : "";

  if (text === "/start") {
    setState(chatId, STATE_IDLE);
    sendMessage(chatId,
      "Welcome to the Electric Meter Tracker.\n" +
      "Send /reading to log a new meter reading."
    );
    return;
  }

  if (text === "/reading") {
    setState(chatId, STATE_WAIT_OPTION);
    sendMessage(chatId,
      "How would you like to enter the reading?\n\n" +
      "1 — Type the number manually\n" +
      "2 — Upload a photo of the meter"
    );
    return;
  }

  // Handle State Machine
  if (state === STATE_WAIT_OPTION) {
    if (text === "1") {
      setState(chatId, STATE_WAIT_NUMBER);
      sendMessage(chatId, "Please type the kWh reading (numbers only, e.g. 28504):");
    } else if (text === "2") {
      setState(chatId, STATE_WAIT_PHOTO);
      sendMessage(chatId, "Please send a photo of the meter.");
    } else {
      sendMessage(chatId, "Please reply with 1 or 2.");
    }
    return;
  }

  if (state === STATE_WAIT_NUMBER) {
    const kwh = parseFloat(text);
    if (isNaN(kwh)) {
      sendMessage(chatId, "That doesn't look like a number. Please type the kWh reading (e.g. 28504):");
      return;
    }
    handleManualReading(chatId, kwh);
    return;
  }

  // Fallback
  if (state !== STATE_IDLE) {
    setState(chatId, STATE_IDLE);
    sendMessage(chatId, "Cancelled. Send /reading to start over.");
  }
}

// ─── Reading handlers ─────────────────────────────────────────────────────────

function handleManualReading(chatId, kwh) {
  const result = writeToSheet(kwh, "manual");
  setState(chatId, STATE_IDLE);
  sendMessage(chatId,
    "✅ Reading logged.\n\n" +
    "Value: " + kwh + " kWh\n" +
    "Shift: " + result.shift +
    (result.delta !== 0 ? "\nDelta: " + result.delta + " kWh" : "") +
    (result.dailyTotal !== null ? "\nDaily total: " + result.dailyTotal + " kWh" : "") +
    (result.notes ? "\nNotes: " + result.notes : "")
  );
}

function handlePhotoReceived(chatId, message) {
  const fileId = message.photo[message.photo.length - 1].file_id;
  
  // PLACEHOLDER: Implementation of OCR goes here
  writeToSheet(null, "photo_placeholder:" + fileId);
  setState(chatId, STATE_IDLE);
  sendMessage(chatId,
    "📸 Photo received.\n" +
    "Note: OCR is not active yet. The reading was logged as blank.\n" +
    "Type the value manually if needed."
  );
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

  const prevData = getPreviousRecord(sheet, appendedRow, colMap.Raw_kwh);
  const result   = calculateReadingLogic(timestamp, rawKwh, prevData, sheet, appendedRow, colMap);
  
  updateSheetRow(sheet, appendedRow, colMap, result, rawKwh);
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getState(chatId) {
  return PropertiesService.getScriptProperties().getProperty("state_" + chatId) || STATE_IDLE;
}

function setState(chatId, state) {
  PropertiesService.getScriptProperties().setProperty("state_" + chatId, state);
}

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

function buildEmptyRow(sheet) {
  const width = Math.max(sheet.getLastColumn(), 7);
  return new Array(width).fill("");
}
