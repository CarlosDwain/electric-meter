/**
 * @OnlyCurrentDoc
 * 
 * Electric Meter Tracker - Version 2.4 (Smart Gap Analysis)
 */

const CONFIG = {
  TIMEZONE: "Asia/Manila",
  ANOMALY_THRESHOLD: 100, 
};

function onFormSubmit(e) {
  const sheet = e.range.getSheet();
  const range = e.range;
  const row = range.getRow();
  const values = range.getValues()[0];

  const timestamp = new Date(values[0]);
  const rawKwh = parseFloat(values[1]);

  // 1. Find the REAL previous record (timestamp + kwh)
  const prevData = getPreviousRecord(sheet, row);
  
  // 2. Run Gap & Shift Logic
  const result = calculateReadingLogic(timestamp, rawKwh, prevData, sheet, row);

  // 3. Write results back (Columns D, E, F, G)
  sheet.getRange(row, 4, 1, 4).setValues([[
    result.shift,
    result.delta,
    result.dailyTotal || "",
    result.notes
  ]]);
}

/**
 * Enhanced Logic Engine with Gap Detection
 */
function calculateReadingLogic(timestamp, currentKwh, prevData, sheet, currentRow) {
  const hour = parseInt(Utilities.formatDate(timestamp, CONFIG.TIMEZONE, "H"));
  
  let shift = "Manual";
  let delta = 0;
  let dailyTotal = null;
  let notes = "";

  // A. Determine Base Shift (6-10 AM/PM)
  if (hour >= 6 && hour <= 10) shift = "Night";
  else if (hour >= 18 && hour <= 22) shift = "Day";

  // B. Delta & Gap Analysis
  if (prevData && !isNaN(prevData.kwh)) {
    delta = (currentKwh - prevData.kwh).toFixed(2);
    
    // Calculate hours since last reading
    const hoursElapsed = (timestamp - prevData.timestamp) / (1000 * 60 * 60);

    // Gap Detection
    if (hoursElapsed > 28) {
      shift = "Gap (Multi-Day)";
      const days = (hoursElapsed / 24).toFixed(1);
      notes += `[GAP: ${days} days elapsed] `;
    } else if (hoursElapsed > 14) {
      shift = "Gap (Missed)";
      notes += "[GAP: Missed 1 Shift] ";
    }

    // Anomaly Checks
    if (delta < 0) notes += "[ERROR: Negative Delta] ";
    else if (delta > CONFIG.ANOMALY_THRESHOLD && hoursElapsed < 14) {
      notes += "[WARN: High Consumption] ";
    }
  } else {
    notes += "[Initial Reading] ";
  }

  // C. Daily Total Calculation (only if not a multi-day gap)
  if (shift === "Night") {
    const yesterdayAmRecord = getReadingFromYesterdayAM(sheet, currentRow);
    if (yesterdayAmRecord) {
      dailyTotal = (currentKwh - yesterdayAmRecord.kwh).toFixed(2);
    }
  }

  return { shift, delta, dailyTotal, notes: notes.trim() };
}

/**
 * Find the previous AM reading row
 */
function getReadingFromYesterdayAM(sheet, currentRow) {
  if (currentRow <= 2) return null;
  const data = sheet.getRange(1, 1, currentRow - 1, 4).getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][3] === "Night") {
      return { kwh: parseFloat(data[i][1]) };
    }
  }
  return null;
}

/**
 * Enhanced: Returns BOTH kwh and timestamp of the last valid reading
 */
function getPreviousRecord(sheet, currentRow) {
  if (currentRow <= 2) return null;
  const data = sheet.getRange(1, 1, currentRow - 1, 2).getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const kwh = parseFloat(data[i][1]);
    const ts = new Date(data[i][0]);
    if (!isNaN(kwh)) return { kwh: kwh, timestamp: ts };
  }
  return null;
}
