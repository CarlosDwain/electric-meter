# System Architecture (v2 State-Managed)

## Data Flow Diagram
1.  **User Action:** User interacts with the Bot via commands (`/reading`) or messages.
2.  **Proxy:** Cloudflare Worker forwards the request to GAS and immediately returns `200 OK`.
3.  **State Management:**
    *   `PropertiesService` tracks the user's conversation state (e.g., `WAIT_NUMBER`).
    *   This allows the bot to ask "How would you like to log?" and remember the answer.
4.  **Processing (GAS):**
    *   **Manual:** Numbers are parsed and saved.
    *   **Photo:** Currently saves a placeholder `file_id` (OCR implementation is the next step).
5.  **Storage:** Appends to the **"Readings"** Google Sheet.
6.  **Feedback:** Bot provides a formatted summary of the saved reading.

## State Definitions
- `IDLE`: Default state.
- `WAIT_OPTION`: User just sent `/reading`, bot is waiting for "1" or "2".
- `WAIT_NUMBER`: User chose manual entry, bot is waiting for digits.
- `WAIT_PHOTO`: User chose photo, bot is waiting for upload.
