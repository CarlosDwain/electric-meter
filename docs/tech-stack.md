# Tech Stack Selection

| Component | Technology | Reasoning |
| :--- | :--- | :--- |
| **Interface** | **Telegram Bot** | Fastest input method. Snap a photo, send, done. |
| **Proxy** | **Cloudflare Worker**| Prevents Google Apps Script redirect loops. Highly reliable. |
| **Backend** | Google Apps Script (GAS) | Processes OCR and business logic. |
| **Database** | Google Sheets | Easy to audit, free, time-series storage. |
| **OCR Engine** | Google Drive API | Built-in high-accuracy OCR. |
| **Visualization**| Looker Studio | Dashboarding and trends analysis. |
