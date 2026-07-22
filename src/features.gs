/**
 * Electric Meter Tracker — Extended Features
 * Features:
 *   - /bill command — estimated bill for current billing cycle
 *   - /compare command — this week vs last week usage
 *   - Daily summary — auto-sent at 9PM with the day's total
 *   - Weekly report — auto-sent every Sunday with 7-day breakdown
 *   - Anomaly alert — warns if today's usage is 50% above 7-day average
 *
 * SETUP:
 *   1. Update DEFAULT_KWH_RATE below, or set a rate with /setrate.
 *   2. Run setupTriggers() once manually to create all reminder and report triggers.
 */

const BILLING_CYCLE_DAY = 14;    // day of month your billing cycle starts
const DEFAULT_KWH_RATE  = 13.0;  // fallback rate if none has been set via /setrate

function getKwhRate() {
  const stored = PropertiesService.getScriptProperties().getProperty("kwh_rate");
  return stored ? parseFloat(stored) : DEFAULT_KWH_RATE;
}

function setKwhRate(rate) {
  PropertiesService.getScriptProperties().setProperty("kwh_rate", String(rate));
}

// ─── Trigger setup (run once manually) ───────────────────────────────────────

function addFeatureTriggers() {
  // Remove any existing feature triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    const name = t.getHandlerFunction();
    if (name === "sendDailySummary" || name === "sendWeeklyReport" || name === "checkAnomaly") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Daily summary — 9:00 PM
  ScriptApp.newTrigger("sendDailySummary")
    .timeBased()
    .atHour(21)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  // Weekly report — every Sunday at 8:00 AM
  ScriptApp.newTrigger("sendWeeklyReport")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(8)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  // Anomaly check — runs after each evening reading window (10:00 PM)
  ScriptApp.newTrigger("checkAnomaly")
    .timeBased()
    .atHour(22)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  console.log("Feature triggers created: daily summary (9PM), weekly report (Sun 8AM), anomaly check (10PM)");
}

// ─── /bill command ────────────────────────────────────────────────────────────

function getBillEstimate(chatId) {
  const ss     = SpreadsheetApp.openById(getSheetId());
  const sheet  = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);

  const today       = new Date();
  const cycleStart  = getBillingCycleStart(today);
  const cycleEnd    = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    sendMessage(chatId, "No readings logged yet.");
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // Sum all daily totals within the current billing cycle
  let totalKwh  = 0;
  let daysCounted = 0;
  const cycleRows = data.filter(row => {
    const ts = new Date(row[0]);
    return ts >= cycleStart && ts < cycleEnd &&
           row[colMap.Shift - 1] === "Morning" &&
           row[colMap.Daily_Total - 1] !== "" &&
           !isNaN(parseFloat(row[colMap.Daily_Total - 1]));
  });

  cycleRows.forEach(row => {
    totalKwh += parseFloat(row[colMap.Daily_Total - 1]);
    daysCounted++;
  });

  if (daysCounted === 0) {
    sendMessage(chatId, "No complete daily readings found for the current billing cycle yet.");
    return;
  }

  const estimatedBill = totalKwh * getKwhRate();
  const daysInCycle   = Math.round((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24));
  const daysElapsed   = Math.round((today - cycleStart) / (1000 * 60 * 60 * 24));
  const daysRemaining = daysInCycle - daysElapsed;
  const avgPerDay     = totalKwh / daysCounted;
  const projected     = avgPerDay * daysInCycle * getKwhRate();

  const cycleStartStr = Utilities.formatDate(cycleStart, CONFIG.TIMEZONE, "MMM dd");
  const cycleEndStr   = Utilities.formatDate(cycleEnd, CONFIG.TIMEZONE, "MMM dd");

  sendMessage(chatId,
    "Bill Estimate\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "Cycle: " + cycleStartStr + " – " + cycleEndStr + "\n" +
    "Days elapsed: " + daysElapsed + " of " + daysInCycle + "\n\n" +
    "Usage so far: " + totalKwh.toFixed(2) + " kWh\n" +
    "Rate: ₱" + getKwhRate().toFixed(2) + "/kWh\n" +
    "Est. bill so far: ₱" + estimatedBill.toFixed(2) + "\n\n" +
    "Avg daily usage: " + avgPerDay.toFixed(2) + " kWh\n" +
    "Projected full bill: ₱" + projected.toFixed(2) + "\n" +
    "Days remaining: " + daysRemaining
  );
}

function getBillingCycleStart(date) {
  const d = new Date(date);
  if (d.getDate() >= BILLING_CYCLE_DAY) {
    return new Date(d.getFullYear(), d.getMonth(), BILLING_CYCLE_DAY);
  } else {
    return new Date(d.getFullYear(), d.getMonth() - 1, BILLING_CYCLE_DAY);
  }
}

// ─── /compare command ─────────────────────────────────────────────────────────

function getWeeklyComparison(chatId) {
  const ss     = SpreadsheetApp.openById(getSheetId());
  const sheet  = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    sendMessage(chatId, "Not enough data to compare yet.");
    return;
  }

  const now       = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  thisMonday.setHours(0, 0, 0, 0);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  const thisWeekTotal = sumDailyTotals(data, colMap, thisMonday, now);
  const lastWeekEnd   = new Date(thisMonday);
  const lastWeekTotal = sumDailyTotals(data, colMap, lastMonday, lastWeekEnd);

  if (lastWeekTotal === 0 && thisWeekTotal === 0) {
    sendMessage(chatId, "Not enough data for a comparison yet. Keep logging readings daily.");
    return;
  }

  const diff    = thisWeekTotal - lastWeekTotal;
  const pct     = lastWeekTotal > 0 ? ((diff / lastWeekTotal) * 100).toFixed(1) : "N/A";
  const arrow   = diff > 0 ? "▲" : diff < 0 ? "▼" : "=";
  const costThis = (thisWeekTotal * getKwhRate()).toFixed(2);
  const costLast = (lastWeekTotal * getKwhRate()).toFixed(2);

  const thisStart = Utilities.formatDate(thisMonday, CONFIG.TIMEZONE, "MMM dd");
  const lastStart = Utilities.formatDate(lastMonday, CONFIG.TIMEZONE, "MMM dd");
  const lastEnd   = Utilities.formatDate(lastWeekEnd, CONFIG.TIMEZONE, "MMM dd");

  sendMessage(chatId,
    "⚡ Weekly Comparison\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "This week (" + thisStart + " →): " + thisWeekTotal.toFixed(2) + " kWh (₱" + costThis + ")\n" +
    "Last week (" + lastStart + "–" + lastEnd + "): " + lastWeekTotal.toFixed(2) + " kWh (₱" + costLast + ")\n\n" +
    arrow + " " + Math.abs(diff).toFixed(2) + " kWh " + (diff > 0 ? "more" : diff < 0 ? "less" : "same") +
    (pct !== "N/A" ? " (" + pct + "%)" : "")
  );
}

function sumDailyTotals(data, colMap, startDate, endDate) {
  return data
    .filter(row => {
      const ts = new Date(row[0]);
      return ts >= startDate && ts < endDate &&
             row[colMap.Shift - 1] === "Morning" &&
             row[colMap.Daily_Total - 1] !== "" &&
             !isNaN(parseFloat(row[colMap.Daily_Total - 1]));
    })
    .reduce((sum, row) => sum + parseFloat(row[colMap.Daily_Total - 1]), 0);
}

// ─── Daily summary (auto at 9PM) ──────────────────────────────────────────────

function sendDailySummary() {
  const ss     = SpreadsheetApp.openById(getSheetId());
  const sheet  = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const data  = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  const todayRows = data.filter(row =>
    Utilities.formatDate(new Date(row[0]), CONFIG.TIMEZONE, "yyyy-MM-dd") === today
  );

  if (todayRows.length === 0) {
    broadcastToAll(
      "No meter readings logged today.\n" +
      "Send /reading to log one before midnight."
    );
    return;
  }

  // Find daily total from morning reading
  const morningRow  = todayRows.find(r => r[colMap.Shift - 1] === "Morning");
  const dailyTotal  = morningRow ? parseFloat(morningRow[colMap.Daily_Total - 1]) : null;
  const readingCount = todayRows.length;
  const estCost     = dailyTotal ? (dailyTotal * getKwhRate()).toFixed(2) : null;

  let msg = "Daily Summary — " + today + "\n" +
            "━━━━━━━━━━━━━━━━━━━━\n" +
            "Readings logged: " + readingCount + "\n";

  if (dailyTotal !== null && !isNaN(dailyTotal)) {
    msg += "Total usage: " + dailyTotal.toFixed(2) + " kWh\n";
    msg += "Est. cost: ₱" + estCost;
  } else {
    msg += "Daily total: not available yet\n(need both morning readings to calculate)";
  }

  broadcastToAll(msg);
}

// ─── Weekly report (auto every Sunday 8AM) ───────────────────────────────────

function sendWeeklyReport() {
  const ss     = SpreadsheetApp.openById(getSheetId());
  const sheet  = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const now        = new Date();
  const weekStart  = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // Get daily totals for the past 7 days
  const dailyMap = {};
  data.forEach(row => {
    const ts = new Date(row[0]);
    if (ts >= weekStart && ts <= now &&
        row[colMap.Shift - 1] === "Morning" &&
        row[colMap.Daily_Total - 1] !== "" &&
        !isNaN(parseFloat(row[colMap.Daily_Total - 1]))) {
      const dateKey = Utilities.formatDate(ts, CONFIG.TIMEZONE, "MMM dd (EEE)");
      dailyMap[dateKey] = parseFloat(row[colMap.Daily_Total - 1]);
    }
  });

  const entries    = Object.entries(dailyMap);
  const totalKwh   = entries.reduce((s, [, v]) => s + v, 0);
  const avgKwh     = entries.length > 0 ? totalKwh / entries.length : 0;
  const totalCost  = (totalKwh * getKwhRate()).toFixed(2);
  const weekStartStr = Utilities.formatDate(weekStart, CONFIG.TIMEZONE, "MMM dd");
  const weekEndStr   = Utilities.formatDate(now, CONFIG.TIMEZONE, "MMM dd");

  if (entries.length === 0) {
    broadcastToAll("No complete daily readings found for this week.");
    return;
  }

  let msg = "Weekly Report\n" +
            "━━━━━━━━━━━━━━━━━━━━\n" +
            weekStartStr + " – " + weekEndStr + "\n\n";

  entries.forEach(([date, kwh]) => {
    msg += date + ": " + kwh.toFixed(2) + " kWh (₱" + (kwh * getKwhRate()).toFixed(2) + ")\n";
  });

  msg += "━━━━━━━━━━━━━━━━━━━━\n" +
         "Total: " + totalKwh.toFixed(2) + " kWh\n" +
         "Avg/day: " + avgKwh.toFixed(2) + " kWh\n" +
         "Est. cost: ₱" + totalCost;

  broadcastToAll(msg);
}

// ─── Anomaly alert (auto at 10PM) ─────────────────────────────────────────────

function checkAnomaly() {
  const ss     = SpreadsheetApp.openById(getSheetId());
  const sheet  = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const data  = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // Get today's daily total
  const todayRow = data.find(row =>
    Utilities.formatDate(new Date(row[0]), CONFIG.TIMEZONE, "yyyy-MM-dd") === today &&
    row[colMap.Shift - 1] === "Morning" &&
    row[colMap.Daily_Total - 1] !== "" &&
    !isNaN(parseFloat(row[colMap.Daily_Total - 1]))
  );

  if (!todayRow) return; // no morning reading today

  const todayTotal = parseFloat(todayRow[colMap.Daily_Total - 1]);

  // Get 7-day average (excluding today)
  const now       = new Date();
  const weekAgo   = new Date(now);
  weekAgo.setDate(now.getDate() - 7);

  const recentTotals = data
    .filter(row => {
      const ts      = new Date(row[0]);
      const dateKey = Utilities.formatDate(ts, CONFIG.TIMEZONE, "yyyy-MM-dd");
      return ts >= weekAgo && dateKey !== today &&
             row[colMap.Shift - 1] === "Morning" &&
             row[colMap.Daily_Total - 1] !== "" &&
             !isNaN(parseFloat(row[colMap.Daily_Total - 1]));
    })
    .map(row => parseFloat(row[colMap.Daily_Total - 1]));

  if (recentTotals.length < 3) return; // not enough history

  const avg   = recentTotals.reduce((s, v) => s + v, 0) / recentTotals.length;
  const ratio = todayTotal / avg;

  // Alert if today is 50% above the 7-day average
  if (ratio >= 1.5) {
    broadcastToAll(
      "High Usage Alert\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "Today's usage: " + todayTotal.toFixed(2) + " kWh\n" +
      "7-day average: " + avg.toFixed(2) + " kWh\n" +
      "That's " + ((ratio - 1) * 100).toFixed(0) + "% above your average.\n\n" +
      "Check if any appliances were left running."
    );
  }
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

function broadcastToAll(message) {
  const chatIds = getRegisteredChatIds();
  if (chatIds.length === 0) return;
  chatIds.forEach(chatId => sendMessage(chatId, message));
  console.log("Broadcast sent to " + chatIds.length + " user(s).");
}

// ─── Manual test helpers ─────────────────────────────────────────────────────

function testBillEstimate() {
  getBillEstimate("14");
}

function testWeeklyComparison() {
  getWeeklyComparison("14");
}

function testDailySummary() {
  sendDailySummary();
}

function testWeeklyReport() {
  sendWeeklyReport();
}

function testAnomalyCheck() {
  checkAnomaly();
}
