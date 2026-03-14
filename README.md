# Electric Meter Tracker

An automated, zero-cost system for tracking and analyzing electricity consumption (kWh) using Google Workspace.

## Overview
This project differentiates between **Daytime (8 AM – 8 PM)** and **Nighttime (8 PM – 8 AM)** energy usage to provide insights into household energy costs (e.g., aircon vs. appliance usage).

## Features
- **Automated Calculations:** Calculates consumption (delta) and categorizes shifts automatically on form submission.
- **Smart Gap Analysis:** Detects missed readings (e.g., during travel) and flags them as gaps rather than single shifts.
- **OCR Integration (In Progress):** Extract kWh digits directly from photos of your meter.
- **Visual Dashboard:** Real-time visualization using Looker Studio.

## Tech Stack
- **Frontend:** Google Forms / AppSheet
- **Backend:** Google Apps Script (GAS)
- **Database:** Google Sheets
- **OCR:** Google Drive API
- **Visualization:** Looker Studio

## Setup Instructions
1. **Google Sheet:** Create a sheet with headers: `Timestamp`, `Raw_kwh`, `Shift`, `Delta_kwh`, `Daily_Total`, `Notes`.
2. **Google Form:** Link a form to the sheet with a "Reading (kWh)" number field.
3. **Apps Script:** 
   - Open **Extensions > Apps Script**.
   - Copy the contents of `src/Code.gs` into the editor.
   - Set up an **On Form Submit** trigger for the `onFormSubmit` function.
4. **Timezone:** Ensure your script and sheet are set to `Asia/Manila`.

## Rules & Constraints
- **Zero-Cost:** 100% free tools and APIs only.
- **Data Integrity:** Original readings are never modified; calculations happen in separate columns.
- **Localization:** Fixed to Philippine Peso (PHP) and `Asia/Manila` timezone.
