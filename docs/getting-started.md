# Getting Started: Minimal Connection Test

Use this guide to verify the connection between **Telegram**, **Cloudflare**, and **Google Sheets** using a completely blank spreadsheet. This is a "Proof of Concept" to ensure the communication pipeline is open.

---

## 1. Google Sheet & Test Script
1.  Create a **new, blank Google Sheet**. (Do not add any headers).
2.  Go to **Extensions > Apps Script**.
3.  Paste this minimal test code (replace `YOUR_BOT_TOKEN`):
    ```javascript
    const BOT_TOKEN = "YOUR_BOT_TOKEN_HERE"; // From @BotFather
    
    function doPost(e) {
      const output = ContentService.createTextOutput("OK");
      try {
        const update = JSON.parse(e.postData.contents);
        const message = update.message;
        if (!message || !message.text) return output;
        
        // Appends to the first available tab in the blank sheet
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
        sheet.appendRow([new Date(), "Message: " + message.text]);
        
        sendMessage(message.chat.id, "✅ Connection successful! Saved: " + message.text);
      } catch (err) {
        console.error(err.toString());
      }
      return output;
    }
    
    function sendMessage(chatId, text) {
      const url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
      UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ chat_id: chatId, text: text })
      });
    }
    ```
4.  **Deploy > New Deployment > Web App**.
    *   Execute as: **Me**.
    *   Access: **Anyone**.
5.  **Copy the Web App URL** (the one ending in `/exec`).

---

## 2. Cloudflare Worker Proxy
1.  Create a new **Worker** in Cloudflare.
2.  Paste this proxy code (replace `GOOGLE_URL`):
    ```javascript
    export default {
      async fetch(request) {
        if (request.method !== "POST") return new Response("OK", { status: 200 });
        
        const GOOGLE_URL = "PASTE_YOUR_GOOGLE_WEB_APP_URL_HERE";
        
        const body = await request.text();
        await fetch(GOOGLE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          redirect: "follow", // Essential to follow Google's 302 redirect
        });
        
        return new Response("OK", { status: 200 });
      }
    };
    ```
3.  **Save and Deploy**. Copy your **Worker URL**.

---

## 3. Register the Webhook
1.  Open your browser and visit:
    `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>&drop_pending_updates=true`
2.  Confirm you see `{"ok":true,"result":true,"description":"Webhook was set"}`.

---

## 4. The Test
1.  Open your bot on Telegram.
2.  Send the message: **"Hello World"**.
3.  **Check your Sheet:** Row 1 should automatically appear with the date and "Message: Hello World".
4.  **Check your Chat:** The bot should reply with "✅ Connection successful!".

**Once this works, the pipeline is verified and you are ready to implement the full Electric Meter Tracker logic.**
