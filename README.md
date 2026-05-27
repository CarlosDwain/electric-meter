# Electric Meter Tracker (Telegram Edition)

An automated, zero-cost system for tracking and analyzing electricity consumption (kWh) using a **Telegram Bot** and Google Workspace.

## Overview
This project differentiates between **Daytime (8 AM – 8 PM)** and **Nighttime (8 PM – 8 AM)** energy usage. Simply snap a photo of your meter and send it to your private Telegram Bot; the system does the rest.

## Features
- **Telegram Interface:** No forms or apps needed. Just chat with your bot.
- **Automated OCR:** Automatically extracts digits from your meter photos using Google Drive OCR.
- **Smart Gap Analysis:** Detects missed readings (e.g., during travel) and flags them automatically.
- **Security:** Whitelisted to only respond to your specific Telegram User ID.
- **Visual Dashboard:** Real-time trends and budget tracking via Looker Studio.

## Tech Stack
- **Interface:** Telegram Bot API
- **Backend:** Google Apps Script (Web App / Webhook)
- **Database:** Google Sheets
- **OCR Engine:** Google Drive API
- **Visualization:** Looker Studio

## Setup Instructions
1. **Create Bot:** Message `@BotFather` on Telegram to get your **API Token**.
2. **Get ID:** Message `@userinfobot` to get your **Numeric User ID**.
3. **Google Sheet:** Create a sheet named `Readings` with headers: `Timestamp`, `Raw_kwh`, `Image_Url`, `Shift`, `Delta_kwh`, `Daily_Total`, `Notes`.
4. **Apps Script:**
   - Paste `src/Code.gs` into the editor.
   - Replace `YOUR_BOT_TOKEN_HERE` and `ALLOWED_USER_ID`.
   - **Deploy > New Deployment > Web App** (Access: "Anyone").
   - Copy the Web App URL and paste it into the `setWebhook()` function.
   - Run `setWebhook()` once.

---
*Created with the help of Gemini CLI.*
