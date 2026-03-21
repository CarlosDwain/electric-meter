# System Architecture (Cloudflare Proxy Edition)

## Data Flow Diagram
1.  **User Action:** User sends Photo/Text to Telegram Bot.
2.  **Proxy (Cloudflare Worker):**
    *   Receives the Telegram Webhook.
    *   Immediately returns `200 OK` to Telegram to prevent retry loops.
    *   Forwards the data to the Google Apps Script Web App URL, following the `302` redirect.
3.  **Backend (GAS):** Processes OCR and calculates logic.
4.  **Storage:** Writes to Google Sheets.
5.  **Feedback:** Bot replies via Telegram API.

## Why the Proxy?
Google Apps Script redirects unauthenticated `POST` requests. Telegram does not follow these redirects and treats them as failures, causing infinite loops. The Cloudflare Worker acts as a server-side client that follows the redirect and handles the communication gracefully.
