## Why We Moved Away from Google Forms
 
Google Forms photo uploads were unreliable for OCR:
- Files stored with wrong MIME types
- Drive OCR rejecting blobs typed as `application/vnd.google-apps.document`
- No clean way to get a raw image blob consistently
 
Decision: replace Forms intake with a **Telegram bot**.
 
---
 
## Telegram Bot Architecture
 
```
You (photo + caption)
    → Telegram servers
        → Cloudflare Worker (meter-proxy)
            → Apps Script Web App (doPost)
                → Drive OCR
                → Google Sheet row written
                → Bot replies with confirmation
```
 
### Why Cloudflare Worker is needed
 
Google Apps Script Web Apps redirect unauthenticated POST requests with a `302` or `307` before routing to `doPost`. Telegram does not follow redirects — it treats any non-200 response as a failed delivery and retries indefinitely, causing an infinite loop.
 
**The loop that happened:**
1. Telegram POSTs to Apps Script URL
2. Google returns 302 redirect
3. Telegram marks delivery failed, queues retry
4. Repeat forever — bot kept sending "Received: Hello" non-stop
 
**How the Cloudflare Worker fixes it:**
- Telegram POSTs to the Worker URL → Worker immediately returns `200 OK` to Telegram (no redirect, no loop possible)
- Worker internally follows Google's redirect using `redirect: "follow"` (server-to-server HTTP follows redirects fine)
- Apps Script `doPost` runs normally
 
---
 
## Cloudflare Worker
 
**URL:** `https://meter-proxy.sorallocarlos17.workers.dev`  
**Plan:** Free tier (100,000 requests/day — more than enough for 2 readings/day)
 
**Worker code:**
 
```javascript
export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }
 
    const APPS_SCRIPT_URL = "YOUR_APPS_SCRIPT_URL_HERE";
 
    const body = await request.text();
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      redirect: "follow",
    });
 
    return new Response("OK", { status: 200 });
  }
};
```
 
---
 
## Telegram Bot — Test Script (verified working)
 
Used a simple test spreadsheet to verify the full pipeline before integrating meter logic.
 
```javascript
const BOT_TOKEN = "YOUR_BOT_TOKEN";
const SHEET_ID  = "YOUR_SHEET_ID";
 
function doPost(e) {
  const output = ContentService.createTextOutput("OK");
  try {
    const update = JSON.parse(e.postData.contents);
    const message = update.message;
    if (!message || !message.text) return output;
 
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    sheet.appendRow([new Date(), message.text]);
    sendMessage(message.chat.id, "Received: " + message.text);
  } catch (err) {
    console.error(err.toString());
  }
  return output;
}
 
function sendMessage(chatId, text) {
  UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true
  });
}
```
 
**Critical lesson:** `ContentService.createTextOutput("OK")` must be created at the top of `doPost` and returned at the end — not inside the try/catch — so it always returns even if an exception occurs.
 
---
 
## Webhook Setup Commands
 
**Register webhook:**
```
https://api.telegram.org/botTOKEN/setWebhook?url=WORKER_URL&drop_pending_updates=true
```
 
**Check webhook status:**
```
https://api.telegram.org/botTOKEN/getWebhookInfo
```
 
**Delete webhook + clear queue:**
```
https://api.telegram.org/botTOKEN/deleteWebhook?drop_pending_updates=true
```
 
**Get chat ID:**
```
https://api.telegram.org/botTOKEN/getUpdates
```
 
---
 
## Current Status
 
- Cloudflare Worker deployed and verified working
- Test bot successfully receives messages and writes to spreadsheet
- Bot replies correctly with "Received: [message]"
- No redirect loop, `pending_update_count: 0` confirmed clean