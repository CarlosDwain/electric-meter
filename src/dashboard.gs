/**
 * Electric Meter Tracker — Dashboard Web App
 * Serves a mobile-first read-only dashboard for family members.
 *
 * SETUP:
 *   1. Add this file to your Apps Script project
 *   2. Add dashboard_html.html (the HTML file)
 *   3. Deploy → New Deployment → Web App
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   4. Copy the deployment URL and share with family
 *
 * IMPORTANT:
 *   If you redeploy after changes, use "Manage Deployments" → edit existing
 *   deployment to keep the same URL. Creating a new deployment gives a new URL.
 */

// ─── Web app entry point ──────────────────────────────────────────────────────

function doGet(e) {
  // If a JSON data request, return data
  if (e && e.parameter && e.parameter.action === "data") {
    return ContentService
      .createTextOutput(JSON.stringify(getDashboardData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Otherwise serve the HTML page
  return HtmlService.createHtmlOutputFromFile("dashboard_html")
    .setTitle("⚡ Electric Meter Dashboard")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── Data aggregation ─────────────────────────────────────────────────────────

function getDashboardData() {
  const ss     = SpreadsheetApp.openById(getSheetId());
  const sheet  = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();
  const rate   = getKwhRate();

  if (lastRow < 2) {
    return {
      ok: false,
      message: "No readings logged yet.",
      rate: rate
    };
  }

  const allData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  return {
    ok: true,
    rate: rate,
    lastUpdated: new Date().toISOString(),
    today: getTodayData(allData, colMap, rate),
    billingCycle: getBillingCycleData(allData, colMap, rate),
    last7Days: getLast7DaysData(allData, colMap, rate),
    last30Days: getLast30DaysData(allData, colMap, rate),
    weeklyComparison: getWeeklyComparisonData(allData, colMap, rate),
    lastReading: getLastReadingData(allData, colMap),
    monthlyData: getMonthlyData(allData, colMap)
  };
}

function getTodayData(data, colMap, rate) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const todayRows = data.filter(row =>
    Utilities.formatDate(new Date(row[0]), CONFIG.TIMEZONE, "yyyy-MM-dd") === today
  );

  const morningRow = todayRows.find(r => r[colMap.Shift - 1] === "Morning");
  const dailyTotal = morningRow && morningRow[colMap.Daily_Total - 1] !== ""
    ? parseFloat(morningRow[colMap.Daily_Total - 1])
    : null;

  return {
    date: today,
    readingCount: todayRows.length,
    dailyTotal: dailyTotal,
    estCost: dailyTotal !== null ? dailyTotal * rate : null,
    lastReadingTime: todayRows.length > 0
      ? Utilities.formatDate(new Date(todayRows[todayRows.length - 1][0]), CONFIG.TIMEZONE, "HH:mm")
      : null
  };
}

function getBillingCycleData(data, colMap, rate) {
  const today = new Date();
  const cycleStart = getBillingCycleStart(today);
  const cycleEnd   = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);

  const cycleRows = data.filter(row => {
    const ts = new Date(row[0]);
    return ts >= cycleStart && ts < cycleEnd &&
           row[colMap.Shift - 1] === "Morning" &&
           row[colMap.Daily_Total - 1] !== "" &&
           !isNaN(parseFloat(row[colMap.Daily_Total - 1]));
  });

  let totalKwh = 0;
  cycleRows.forEach(row => {
    totalKwh += parseFloat(row[colMap.Daily_Total - 1]);
  });

  const daysInCycle   = Math.round((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24));
  const daysElapsed   = Math.round((today - cycleStart) / (1000 * 60 * 60 * 24));
  const daysRemaining = daysInCycle - daysElapsed;
  const daysCounted   = cycleRows.length;
  const avgPerDay     = daysCounted > 0 ? totalKwh / daysCounted : 0;
  const projected     = avgPerDay * daysInCycle;

  return {
    cycleStart: Utilities.formatDate(cycleStart, CONFIG.TIMEZONE, "MMM dd"),
    cycleEnd:   Utilities.formatDate(cycleEnd, CONFIG.TIMEZONE, "MMM dd"),
    daysElapsed: daysElapsed,
    daysInCycle: daysInCycle,
    daysRemaining: daysRemaining,
    totalKwh: totalKwh,
    estCost: totalKwh * rate,
    avgPerDay: avgPerDay,
    projectedKwh: projected,
    projectedCost: projected * rate,
    progressPct: Math.min((daysElapsed / daysInCycle) * 100, 100)
  };
}

function getLast7DaysData(data, colMap, rate) {
  return getDaysData(data, colMap, rate, 7);
}

function getLast30DaysData(data, colMap, rate) {
  return getDaysData(data, colMap, rate, 30);
}

function getDaysData(data, colMap, rate, numDays) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const start = new Date(today);
  start.setDate(today.getDate() - numDays);
  start.setHours(0, 0, 0, 0);

  const dailyMap = {};
  data.forEach(row => {
    const ts = new Date(row[0]);
    if (ts >= start && ts <= today &&
        row[colMap.Shift - 1] === "Morning" &&
        row[colMap.Daily_Total - 1] !== "" &&
        !isNaN(parseFloat(row[colMap.Daily_Total - 1]))) {
      const dateKey = Utilities.formatDate(ts, CONFIG.TIMEZONE, "yyyy-MM-dd");
      dailyMap[dateKey] = parseFloat(row[colMap.Daily_Total - 1]);
    }
  });

  // Build ordered array
  const result = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateKey = Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd");
    const label   = Utilities.formatDate(d, CONFIG.TIMEZONE, numDays <= 7 ? "EEE dd" : "MMM dd");
    const kwh     = dailyMap[dateKey] || 0;
    result.push({
      date: dateKey,
      label: label,
      kwh: kwh,
      cost: kwh * rate
    });
  }

  return result;
}

function getWeeklyComparisonData(data, colMap, rate) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  thisMonday.setHours(0, 0, 0, 0);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const thisWeekTotal = sumDailyTotalsForRange(data, colMap, thisMonday, now);
  const lastWeekTotal = sumDailyTotalsForRange(data, colMap, lastMonday, thisMonday);

  const diff = thisWeekTotal - lastWeekTotal;
  const pct  = lastWeekTotal > 0 ? (diff / lastWeekTotal) * 100 : null;

  return {
    thisWeekKwh: thisWeekTotal,
    lastWeekKwh: lastWeekTotal,
    thisWeekCost: thisWeekTotal * rate,
    lastWeekCost: lastWeekTotal * rate,
    diffKwh: diff,
    diffPct: pct
  };
}

function sumDailyTotalsForRange(data, colMap, startDate, endDate) {
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

function getLastReadingData(data, colMap) {
  for (let i = data.length - 1; i >= 0; i--) {
    const kwh = parseFloat(data[i][colMap.Raw_kwh - 1]);
    if (!isNaN(kwh)) {
      return {
        kwh: kwh,
        timestamp: Utilities.formatDate(new Date(data[i][0]), CONFIG.TIMEZONE, "MMM dd, yyyy HH:mm"),
        shift: data[i][colMap.Shift - 1] || "—"
      };
    }
  }
  return null;
}

function getMonthlyData(data, colMap) {
  const ss = SpreadsheetApp.openById(getSheetId());
  const monthlySheet = ss.getSheetByName(MONTHLY_SHEET_NAME);
  const lastRow = monthlySheet.getLastRow();

  // Read Monthly_History data
  const historical = {};
  if (lastRow >= 2) {
    const rows = monthlySheet.getRange(2, 1, lastRow - 1, 2).getValues();
    rows.forEach(row => {
      const label = row[0].toString().trim();
      const val = parseFloat(row[1].toString().replace(/,/g, ""));
      if (label && !isNaN(val)) {
        historical[label] = val;
      }
    });
  }

  // Calculate completed billing-cycle totals from the Readings sheet.
  const now = new Date();
  let cycleStart = new Date(2026, 3, 14);
  const autoCalculated = {};

  while (cycleStart <= now) {
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1); // 13th of each month
    cycleEnd.setDate(13);
    cycleEnd.setHours(23, 59, 59, 999);

    if (cycleEnd <= now) {
      const monthLabel = Utilities.formatDate(cycleStart, CONFIG.TIMEZONE, "MMM-yy");

      const total = data
        .filter(row => {
          const ts = new Date(row[0]);
          return ts >= cycleStart && ts <= cycleEnd &&
                 row[colMap.Shift - 1] === "Morning" &&
                 row[colMap.Daily_Total - 1] !== "" &&
                 !isNaN(parseFloat(row[colMap.Daily_Total - 1]));
        })
        .reduce((sum, row) => sum + parseFloat(row[colMap.Daily_Total - 1]), 0);

        if (total > 0) {
          autoCalculated[monthLabel] = parseFloat(total.toFixed(2));
        }
    }

    cycleStart = new Date(cycleEnd);
    cycleStart.setDate(14);
  }

  const merged = { ...historical, ...autoCalculated };

  const years = {};
  Object.entries(merged).forEach(([label, kwh]) => {
    const parts = label.split("-");
    if (parts.length !== 2) return;
    const year = parts[1].length === 2 ? "20" + parts[1] : parts[1];
    if (!years[year]) years[year] = [];
    years[year].push({ label: parts[0] + "-" + parts[1], month: parts[0], kwh });
  });

  return {
    years: Object.keys(years).sort(),
    data: years  
  };
}


// ─── Export data ──────────────────────────────────────────────────────────────

function getExportData(startYear, endYear, exportAll) {
  const ss = SpreadsheetApp.openById(getSheetId());
  const sheet = ss.getSheetByName(SHEET_NAME);
  const colMap = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();

  const allReadings = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues()
    : [];

    const monthly = getMonthlyData(allReadings, colMap);

    const monthlySummary = [];
    monthly.years.forEach(year => {
      if (!exportAll && (parseInt(year) < startYear || parseInt(year) > endYear)) return;
      monthly.data[year].forEach(entry => {
        monthlySummary.push({
          month: entry.label,
          kwh: entry.kwh
        });
      });
    });

    const dailyReadings = allReadings
      .filter(row => {
        if (!row[0]) return false;
        const ts = new Date(row[0]);
        const year = ts.getFullYear();
        if (!exportAll && (year < startYear || year > endYear)) return false;
        const dailyTotal = row[colMap.Daily_Total - 1];
        return dailyTotal !== "" && !isNaN(parseFloat(dailyTotal));
      })
      .map(row => ({
        date: Utilities.formatDate(new Date(row[0]), CONFIG.TIMEZONE, "yyyy-MM-dd"),
        kwh: parseFloat(row[colMap.Raw_kwh - 1]) || 0,
        dailyTotal: parseFloat(row[colMap.Daily_Total - 1]) || 0
      }));

  return {
    monthlySummary,
    dailyReadings,
    availableYears: monthly.years
  };
}
