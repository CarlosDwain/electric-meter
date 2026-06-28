/**
 * Electric Meter Tracker — Edit, Delete, History Commands
 * Version 1.0
 *
 * New commands:
 *   /edit [value]  — Edit the last logged reading and recalculate
 *   /delete        — Delete the last logged reading and recalculate
 *   /history [n]   — Show last n readings (max 20)
 */

// ─── /history command ─────────────────────────────────────────────────────────

function sendHistory(chatId, text) {
  const parts = text.trim().split(" ");
  let count = parseInt(parts[1]);

  if (isNaN(count) || count <= 0) {
    sendMessage(chatId, "Usage: /history [number]\nExample: /history 10");
    return;
  }

  // Cap at 20 to avoid Telegram message length limits
  if (count > 20) {
    count = 20;
    sendMessage(chatId, "Showing last 20 entries (maximum allowed).");
  }

  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const sheet   = ss.getSheetByName(SHEET_NAME);
  const colMap  = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    sendMessage(chatId, "No readings logged yet.");
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // Get last n rows that have a valid kWh reading
  const validRows = [];
  for (let i = data.length - 1; i >= 0 && validRows.length < count; i--) {
    const kwh = parseFloat(data[i][colMap.Raw_kwh - 1]);
    if (!isNaN(kwh)) {
      validRows.unshift({
        timestamp: new Date(data[i][0]),
        kwh:       kwh,
        shift:     data[i][colMap.Shift - 1]     || "—",
        delta:     data[i][colMap.Delta_kwh - 1]
      });
    }
  }

  if (validRows.length === 0) {
    sendMessage(chatId, "No readings found.");
    return;
  }

  let msg = "Last " + validRows.length + " readings:\n━━━━━━━━━━━━━━━━━━━━\n";
  validRows.forEach((row, i) => {
    const ts    = Utilities.formatDate(row.timestamp, CONFIG.TIMEZONE, "MMM dd HH:mm");
    const delta = (row.delta !== "" && row.delta !== 0)
      ? " | Δ" + row.delta
      : "";
    msg += (i + 1) + ". " + ts + "\n" +
           "   " + row.kwh + " kWh | " + row.shift + delta + "\n";
  });

  sendMessage(chatId, msg);
}

// ─── /edit command ────────────────────────────────────────────────────────────

function handleEditCommand(chatId, text) {
  const parts = text.trim().split(" ");
  const newKwh = parseFloat(parts[1]);

  if (isNaN(newKwh) || newKwh <= 0) {
    sendMessage(chatId, "Usage: /edit [value]\nExample: /edit 28504");
    return;
  }

  const last = getLastRecord();
  if (!last) {
    sendMessage(chatId, "No readings logged yet.");
    return;
  }

  // Store pending edit value and ask for confirmation
  setPending(chatId, "edit_kwh", newKwh);
  setState(chatId, STATE_CONFIRM_EDIT);

  const ts = Utilities.formatDate(last.timestamp, CONFIG.TIMEZONE, "MMM dd HH:mm");
  sendMessage(chatId,
    "Edit last reading?\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "Current: " + last.kwh + " kWh (" + ts + ")\n" +
    "New value: " + newKwh + " kWh\n\n" +
    "yes — confirm edit\n" +
    "no — cancel"
  );
}

function confirmEdit(chatId) {
  const newKwh = getPending(chatId, "edit_kwh");
  if (newKwh === null) {
    setState(chatId, STATE_IDLE);
    sendMessage(chatId, "Something went wrong. Please try /edit again.");
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss      = SpreadsheetApp.openById(SHEET_ID);
    const sheet   = ss.getSheetByName(SHEET_NAME);
    const colMap  = getColumnMapping(sheet);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      sendMessage(chatId, "No readings to edit.");
      setState(chatId, STATE_IDLE);
      clearPending(chatId);
      return;
    }

    // Find the last row with a valid kWh reading
    const data      = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    let   targetIdx = -1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (!isNaN(parseFloat(data[i][colMap.Raw_kwh - 1]))) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx === -1) {
      sendMessage(chatId, "No readings to edit.");
      setState(chatId, STATE_IDLE);
      clearPending(chatId);
      return;
    }

    const sheetRow  = targetIdx + 2; // +2 for header row and 0-index
    const timestamp = new Date(data[targetIdx][0]);

    // Update raw kWh
    sheet.getRange(sheetRow, colMap.Raw_kwh).setValue(newKwh);

    // Recalculate this row
    const prevData = getPreviousRecord(sheet, sheetRow, colMap.Raw_kwh);
    const result   = calculateReadingLogic(timestamp, newKwh, prevData, sheet, sheetRow, colMap);
    updateSheetRow(sheet, sheetRow, colMap, result, newKwh);

    // Recalculate the next row if it exists — its Delta reference changed
    recalculateNextRow(sheet, sheetRow, colMap, data, targetIdx);

    setState(chatId, STATE_IDLE);
    clearPending(chatId);

    sendMessage(chatId,
      "Reading updated.\n" +
      "New value: " + newKwh + " kWh\n" +
      "Shift: " + result.shift +
      (result.delta !== 0 ? "\nDelta: " + result.delta + " kWh" : "") +
      (result.dailyTotal !== null ? "\nDaily total: " + result.dailyTotal + " kWh" : "")
    );

  } finally {
    lock.releaseLock();
  }
}

// ─── /delete command ──────────────────────────────────────────────────────────

function handleDeleteCommand(chatId) {
  const last = getLastRecord();
  if (!last) {
    sendMessage(chatId, "No readings logged yet.");
    return;
  }

  setState(chatId, STATE_CONFIRM_DELETE);

  const ts = Utilities.formatDate(last.timestamp, CONFIG.TIMEZONE, "MMM dd HH:mm");
  sendMessage(chatId,
    "Delete last reading?\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    last.kwh + " kWh | " + last.shift + "\n" +
    ts + "\n\n" +
    "This cannot be undone.\n\n" +
    "yes — confirm delete\n" +
    "no — cancel"
  );
}

function confirmDelete(chatId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss      = SpreadsheetApp.openById(SHEET_ID);
    const sheet   = ss.getSheetByName(SHEET_NAME);
    const colMap  = getColumnMapping(sheet);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      sendMessage(chatId, "No readings to delete.");
      setState(chatId, STATE_IDLE);
      return;
    }

    // Find the last row with a valid kWh reading
    const data      = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    let   targetIdx = -1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (!isNaN(parseFloat(data[i][colMap.Raw_kwh - 1]))) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx === -1) {
      sendMessage(chatId, "No readings to delete.");
      setState(chatId, STATE_IDLE);
      return;
    }

    const sheetRow   = targetIdx + 2;
    const deletedKwh = parseFloat(data[targetIdx][colMap.Raw_kwh - 1]);
    const deletedTs  = Utilities.formatDate(
      new Date(data[targetIdx][0]), CONFIG.TIMEZONE, "MMM dd HH:mm"
    );

    // Delete the row
    sheet.deleteRow(sheetRow);

    // Recalculate the row that is now at sheetRow (was previously sheetRow + 1)
    // Need to re-fetch data after deletion
    const newLastRow = sheet.getLastRow();
    if (sheetRow <= newLastRow) {
      const freshData = sheet.getRange(2, 1, newLastRow - 1, sheet.getLastColumn()).getValues();
      const nextIdx   = sheetRow - 2; // convert back to 0-index in freshData
      if (nextIdx >= 0 && nextIdx < freshData.length) {
        const nextKwh = parseFloat(freshData[nextIdx][colMap.Raw_kwh - 1]);
        if (!isNaN(nextKwh)) {
          const nextTs   = new Date(freshData[nextIdx][0]);
          const prevData = getPreviousRecord(sheet, sheetRow, colMap.Raw_kwh);
          const result   = calculateReadingLogic(nextTs, nextKwh, prevData, sheet, sheetRow, colMap);
          updateSheetRow(sheet, sheetRow, colMap, result, nextKwh);
        }
      }
    }

    setState(chatId, STATE_IDLE);
    clearPending(chatId);

    sendMessage(chatId,
      "Reading deleted.\n" +
      "Removed: " + deletedKwh + " kWh (" + deletedTs + ")\n" +
      "Adjacent rows recalculated."
    );

  } finally {
    lock.releaseLock();
  }
}

// ─── Shared recalculation helper ──────────────────────────────────────────────

/**
 * After editing or deleting a row, recalculates the next row
 * so its Delta reflects the new previous reading.
 */
function recalculateNextRow(sheet, editedSheetRow, colMap, data, editedIdx) {
  const nextIdx = editedIdx + 1;
  if (nextIdx >= data.length) return; // no next row

  const nextSheetRow = editedSheetRow + 1;
  const nextKwh      = parseFloat(data[nextIdx][colMap.Raw_kwh - 1]);
  if (isNaN(nextKwh)) return; // next row has no valid reading

  const nextTs   = new Date(data[nextIdx][0]);
  const prevData = getPreviousRecord(sheet, nextSheetRow, colMap.Raw_kwh);
  const result   = calculateReadingLogic(nextTs, nextKwh, prevData, sheet, nextSheetRow, colMap);
  updateSheetRow(sheet, nextSheetRow, colMap, result, nextKwh);
}