/**
 * Electric Meter Tracker — Core Logic
 * Shared calculation and sheet-writing logic.
 *
 * Called by telegram_bot.gs when a reading is logged, whether entered
 * manually or extracted from a meter photo.
 *
 * Sheet columns (Readings tab):
 *   A: Timestamp
 *   B: Raw_kwh
 *   C: Meter Photo
 *   D: Shift
 *   E: Delta_kwh
 *   F: Daily_Total
 *   G: Notes
 */

const CONFIG = {
  TIMEZONE: "Asia/Manila",
};

/**
 * Maps sheet headers to 1-based column numbers.
 * Called once per doPost execution.
 */
function getColumnMapping(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const head = h.toString().toLowerCase().trim();
    if (head === "delta_kwh")                                     map.Delta_kwh   = i + 1;
    else if (head === "shift")                                    map.Shift        = i + 1;
    else if (head === "daily_total")                              map.Daily_Total  = i + 1;
    else if (head === "notes")                                    map.Notes        = i + 1;
    else if (head.includes("photo") && !map.Meter_Photo)         map.Meter_Photo  = i + 1;
    else if (head === "timestamp")                                map.Timestamp    = i + 1;
    else if ((head.includes("kwh") || head.includes("reading"))
             && !map.Raw_kwh)                                     map.Raw_kwh      = i + 1;
  });
  return map;
}

/**
 * Writes all computed values back to the appended row.
 */
function updateSheetRow(sheet, row, colMap, result, rawKwh) {
  const valueToWrite = (rawKwh !== null && !isNaN(rawKwh)) ? rawKwh : "";
  if (colMap.Raw_kwh)    sheet.getRange(row, colMap.Raw_kwh).setValue(valueToWrite);
  if (colMap.Shift)      sheet.getRange(row, colMap.Shift).setValue(result.shift);
  if (colMap.Delta_kwh)  sheet.getRange(row, colMap.Delta_kwh).setValue(result.delta);
  if (colMap.Daily_Total) sheet.getRange(row, colMap.Daily_Total).setValue(
    result.dailyTotal !== null ? result.dailyTotal : ""
  );
  if (colMap.Notes)      sheet.getRange(row, colMap.Notes).setValue(result.notes);
}

/**
 * Determines shift, delta kWh, daily total, and notes
 * based on the timestamp and previous records.
 */
function calculateReadingLogic(timestamp, currentKwh, prevData, sheet, currentRow, colMap) {
  const hour = parseInt(Utilities.formatDate(timestamp, CONFIG.TIMEZONE, "H"));
  let shift      = "Manual";
  let delta      = 0;
  let dailyTotal = null;
  let notes      = "";

  // Shift windows (Asia/Manila):
  //   Morning 06:00–10:00 — closes the overnight cycle
  //   Evening 18:00–22:00 — closes the daytime cycle
  if (hour >= 6 && hour <= 10)       shift = "Morning";
  else if (hour >= 18 && hour <= 22) shift = "Evening";

  if (prevData && !isNaN(prevData.kwh)) {
    delta = parseFloat((currentKwh - prevData.kwh).toFixed(2));
    const hoursElapsed = (timestamp - prevData.timestamp) / (1000 * 60 * 60);

    if (hoursElapsed > 28) {
      notes += `[GAP: ${(hoursElapsed / 24).toFixed(1)} days] `;
    } else if (hoursElapsed > 14) {
      notes += "[GAP: Missed 1 Shift] ";
    }
  } else {
    notes += "[Initial Reading] ";
  }

  // Daily total: Morning reading minus the previous Morning reading.
  // Gap detection stays in Notes so missed-shift morning readings still count.
  if (shift === "Morning") {
    const prevMorning = getPreviousMorningReading(sheet, currentRow, colMap);
    if (prevMorning) {
      dailyTotal = parseFloat((currentKwh - prevMorning.kwh).toFixed(2));
    }
  }

  return { shift, delta, dailyTotal, notes: notes.trim() };
}

/**
 * Walks backwards through the sheet to find the most recent
 * Morning row — used as the daily total baseline.
 */
function getPreviousMorningReading(sheet, currentRow, colMap) {
  if (currentRow <= 2 || !colMap.Shift) return null;
  const data = sheet.getRange(1, 1, currentRow - 1, sheet.getLastColumn()).getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][colMap.Shift - 1] === "Morning") {
      return { kwh: parseFloat(data[i][colMap.Raw_kwh - 1]) };
    }
  }
  return null;
}

/**
 * Walks backwards to find the most recent row with a valid kWh reading.
 * Used to calculate delta.
 */
function getPreviousRecord(sheet, currentRow, rawKwhCol) {
  if (currentRow <= 2 || !rawKwhCol) return null;
  const data = sheet.getRange(1, 1, currentRow - 1, rawKwhCol).getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const kwh = parseFloat(data[i][rawKwhCol - 1]);
    if (!isNaN(kwh)) return { kwh: kwh, timestamp: new Date(data[i][0]) };
  }
  return null;
}
