/**
 * Electric Meter Tracker — Telegram Bot
 * Version 5.3 (OCR with manual fallback)
 *
 * OCR flow:
 *   User sends photo
 *   → Drive OCR runs
 *   → If OCR succeeds: bot shows result and asks "Is this correct? yes / no"
 *       → yes: logged to sheet
 *       → no: bot asks user to type the correct value
 *   → If OCR fails: bot immediately asks user to type the value manually
 *
 * Smart number extraction from OCR text:
 *   - Filters to numbers in realistic kWh range (10000–999999)
 *   - Picks the largest match (main reading dominates the display)
 *   - Cross-checks against last recorded reading (must be >= last)
 */

const BOT_TOKEN  = "YOUR_BOT_TOKEN_HERE";
const SHEET_ID   = "YOUR_SHEET_ID_HERE";
const ALLOWED_USER_ID = 123456789; // Your Numeric ID from @userinfobot
const SHEET_NAME = "Readings";
const MONTHLY_SHEET_NAME = "Monthly_History";

const STATE_IDLE             = "IDLE";
const STATE_WAIT_OPTION      = "WAIT_OPTION";
const STATE_WAIT_NUMBER      = "WAIT_NUMBER";
const STATE_WAIT_PHOTO       = "WAIT_PHOTO";
const STATE_WAIT_OCR_CONFIRM = "WAIT_OCR_CONFIRM";  // user confirms OCR result
const STATE_WAIT_OCR_MANUAL  = "WAIT_OCR_MANUAL";   // user types correct value after OCR rejection
const STATE_CONFIRM_VALUE    = "CONFIRM_VALUE";
const STATE_CONFIRM_GAP      = "CONFIRM_GAP";

const STATE_TIMEOUT_MS    = 10 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 60 * 1000;
const SANITY_THRESHOLD    = 500;
const KWH_MIN             = 10000;   // realistic lower bound for this meter
const KWH_MAX             = 999999;  // realistic upper bound

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
    return;
  }

  const state  = getState(chatId);
  const text   = message.text ? message.text.trim() : "";

  console.log("Chat: " + chatId + " | State: " + state + " | Text: " + text);

  // Auto-register this chat ID for reminders
  registerChatId(chatId);

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
      "Track your daily electricity usage by logging your meter reading twice a day — morning and evening.\n\n" +
      "The bot automatically calculates:\n" +
      "• Delta kWh (usage since last reading)\n" +
      "• Daily total (full day usage)\n" +
      "• Shift (Morning / Evening / Manual)\n\n" +
      "Commands:\n" +
      "/reading — Log a new meter reading\n" +
      "/last — Show the last logged reading\n" +
      "/status — Show today's readings\n" +
      "/bill — Estimated bill for this billing cycle\n" +
      "/compare — This week vs last week usage\n" +
      "/setrate [amount] — Update kWh rate (e.g. /setrate 11.50)\n" +
      "/getrate — Show current kWh rate\n" +
      "/cancel — Cancel current input\n" +
      "/help — Show this message again"
    );
    return;
  }

  if (text === "/help") {
    sendMessage(chatId,
      "⚡ Electric Meter Tracker — Help\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "Logging:\n" +
      "/reading — Log a new meter reading\n" +
      "/cancel — Cancel current input\n\n" +
      "View data:\n" +
      "/last — Show the last logged reading\n" +
      "/status — Show today's readings\n" +
      "/bill — Estimated bill for this billing cycle\n" +
      "/compare — This week vs last week usage\n\n" +
      "Settings:\n" +
      "/setrate [amount] — Update kWh rate (e.g. /setrate 11.50)\n" +
      "/getrate — Show current kWh rate\n\n" +
      "Other:\n" +
      "/start — Welcome message\n" +
      "/help — Show this message\n\n" +
      "When logging you can:\n" +
      "1 — Type the kWh number manually\n" +
      "2 — Upload a photo (OCR auto-reads the meter)\n\n" +
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

  if (text === "/bill") {
    getBillEstimate(chatId);
    return;
  }

  if (text === "/compare") {
    getWeeklyComparison(chatId);
    return;
  }

  if (text.startsWith("/setrate")) {
    const parts   = text.split(" ");
    const rate    = parseFloat(parts[1]);
    if (isNaN(rate) || rate <= 0) {
      sendMessage(chatId, "Invalid rate. Usage: /setrate 11.50");
    } else {
      const oldRate = getKwhRate();
      setKwhRate(rate);
      sendMessage(chatId,
        "Rate updated.\n" +
        "Previous: ₱" + oldRate.toFixed(2) + "/kWh\n" +
        "New: ₱" + rate.toFixed(2) + "/kWh"
      );
    }
    return;
  }

  if (text === "/getrate") {
    const rate = getKwhRate();
    sendMessage(chatId, "Current rate: ₱" + rate.toFixed(2) + "/kWh\n\nTo update: /setrate 11.50");
    return;
  }

  // --- /reading command ---
  if (text === "/reading") {
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
    checkAndLog(chatId, kwh, STATE_WAIT_NUMBER);
    return;
  }

  // --- OCR confirmation state ---
  if (state === STATE_WAIT_OCR_CONFIRM) {
    const pendingKwh = getPending(chatId, "pending_kwh");
    if (text.toLowerCase() === "yes") {
      // User confirmed OCR result
      handleManualReading(chatId, pendingKwh);
    } else if (text.toLowerCase() === "no") {
      // User rejected — ask them to type the correct value
      setState(chatId, STATE_WAIT_OCR_MANUAL);
      sendMessage(chatId,
        "Please type the correct kWh reading:"
      );
    } else {
      // Maybe they typed the correct number directly
      const cleaned = cleanInput(text);
      const kwh     = parseFloat(cleaned);
      if (!isNaN(kwh)) {
        handleManualReading(chatId, kwh);
      } else {
        sendMessage(chatId,
          "Please reply with:\n" +
          "yes — to confirm " + pendingKwh + " kWh\n" +
          "no — to type the correct value"
        );
      }
    }
    return;
  }

  // --- OCR manual fallback state ---
  if (state === STATE_WAIT_OCR_MANUAL) {
    const cleaned = cleanInput(text);
    const kwh     = parseFloat(cleaned);
    if (isNaN(kwh)) {
      sendMessage(chatId,
        "That doesn't look like a number. Please type the kWh reading (e.g. 28504):"
      );
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

// ─── Photo handler with OCR ───────────────────────────────────────────────────

function handlePhotoReceived(chatId, message) {
  sendMessage(chatId, "Reading the meter...");

  const fileId    = message.photo[message.photo.length - 1].file_id;
  const imageBlob = fetchTelegramFile(fileId);

  if (!imageBlob) {
    // Download failed — go straight to manual
    setState(chatId, STATE_WAIT_OCR_MANUAL);
    sendMessage(chatId,
      "Could not download the photo. Please type the kWh reading manually:"
    );
    return;
  }

  const lastRecord = getLastRecord();
  const ocrValue   = performOcrOnBlob(imageBlob, lastRecord ? lastRecord.kwh : null);
  console.log("OCR result: " + ocrValue);

  if (ocrValue !== null) {
    // OCR succeeded — store result and ask user to confirm
    setPending(chatId, "pending_kwh", ocrValue);
    setPending(chatId, "pending_file_id", fileId);
    setState(chatId, STATE_WAIT_OCR_CONFIRM);
    sendMessage(chatId,
      "Meter reading detected: " + ocrValue + " kWh\n\n" +
      "Is this correct?\n" +
      "yes — log it\n" +
      "no — type the correct value"
    );
  } else {
    // OCR failed — ask user to type manually
    setPending(chatId, "pending_file_id", fileId);
    setState(chatId, STATE_WAIT_OCR_MANUAL);
    sendMessage(chatId,
      "Could not read the meter from the photo.\n\n" +
      "Please type the kWh reading manually:"
    );
  }
}

// ─── Reading handlers ─────────────────────────────────────────────────────────

function checkAndLog(chatId, kwh, returnState) {
  const lastRecord = getLastRecord();

  // Sanity check
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
    setPending(chatId, "pending_kwh", kwh);
    setState(chatId, STATE_CONFIRM_VALUE);
    sendMessage(chatId,
      "A reading was just logged less than 60 seconds ago.\n" +
      "Are you sure you want to log another?\n\n" +
      "yes — log it anyway\n" +
      "no — cancel"
    );
    return;
  }

  handleManualReading(chatId, kwh);
}

function handleManualReading(chatId, kwh) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Check if this came from a photo — store the file reference
    const fileId = getPendingString(chatId, "pending_file_id");
    const source = fileId ? "tg:" + fileId : "manual";

    const result = writeToSheet(kwh, source);
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

// ─── OCR ─────────────────────────────────────────────────────────────────────

function fetchTelegramFile(fileId) {
  try {
    const metaUrl = "https://api.telegram.org/bot" + BOT_TOKEN + "/getFile?file_id=" + fileId;
    const meta    = JSON.parse(UrlFetchApp.fetch(metaUrl).getContentText());
    if (!meta.ok) throw new Error("getFile failed: " + JSON.stringify(meta));

    const fileUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + meta.result.file_path;
    return UrlFetchApp.fetch(fileUrl).getBlob().setContentType("image/jpeg");
  } catch (err) {
    console.error("fetchTelegramFile error: " + err.toString());
    return null;
  }
}

const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
const GEMINI_URL     = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=";

/**
 * Sends the image to Gemini Vision and asks it to extract the kWh reading.
 * Falls back gracefully if the API call fails or returns an unreadable value.
 */
function performOcrOnBlob(imageBlob, lastKwh) {
  try {
    // Convert blob to base64
    const base64Image = Utilities.base64Encode(imageBlob.getBytes());
    const mimeType    = "image/jpeg";

    const payload = {
      contents: [{
        parts: [
          {
            text: "This is a photo of an electric meter display. " +
                  "Look at the main large number on the LCD/display screen — this is the kWh reading. " +
                  "Ignore any small numbers, labels, serial numbers, or barcodes. " +
                  "Reply with ONLY the numeric kWh reading, nothing else. " +
                  "Example reply: 27826"
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }]
    };

    const response = UrlFetchApp.fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const json   = JSON.parse(response.getContentText());
    const raw    = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    console.log("Gemini raw response: " + raw);

    if (!raw) return null;

    // Clean the response and extract the number
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const value   = parseFloat(cleaned);

    if (isNaN(value)) return null;

    // Sanity check against last reading
    if (lastKwh !== null && value < lastKwh) {
      console.log("Gemini returned " + value + " which is less than last reading " + lastKwh + " — discarding");
      return null;
    }

    return value;

  } catch (err) {
    console.error("performOcrOnBlob error: " + err.toString());
    return null;
  }
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

  const today     = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const data      = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
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
  const props     = PropertiesService.getScriptProperties();
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

function getPendingString(chatId, key) {
  return PropertiesService.getScriptProperties()
    .getProperty("pending_" + key + "_" + chatId) || null;
}

function clearPending(chatId) {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("pending_kwh_" + chatId);
  props.deleteProperty("pending_file_id_" + chatId);
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