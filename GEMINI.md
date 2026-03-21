# GEMINI.MD: AI Collaboration Guide (Telegram Edition)

## 1. Project Overview & Purpose
Automate tracking of electricity consumption (kWh) with a focus on **Day vs. Night** shifting using a **Telegram Bot** as the primary interface.

## 2. Core Technologies
*   **Interface:** Telegram Bot API.
*   **Backend:** Google Apps Script (v8 runtime) as a Web App.
*   **Database:** Google Sheets.
*   **OCR:** Google Drive API.
*   **Localization:** Timezone `Asia/Manila`, Currency `PHP`.

## 3. Architectural Patterns
*   **Event-Driven:** Triggered by Telegram Webhooks.
*   **Zero-Destructive:** Original readings are never modified.
*   **Stateless Processing:** Each webhook is processed independently, querying the Sheet for historical context.

## 4. Critical Rules (Mandates)
1.  **Zero-Cost:** Only free tiers and APIs.
2.  **Privacy:** Telegram Bot must use whitelisting (`ALLOWED_USER_ID`).
3.  **Accuracy:** Shift categorization must strictly follow the 8 AM/8 PM boundaries.
4.  **Resilience:** Handle network timeouts and Drive OCR failures gracefully with error notes.

## 5. Directory Structure
*   `/docs`: Architecture, Requirements, Backlog.
*   `src/`: Core logic (`Code.gs`).
*   `plans/`: Historical implementation plans.
