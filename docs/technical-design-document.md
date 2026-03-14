# Technical Design: Data Schema & GAS Foundation

## 1. Google Sheets Schema Design
The sheet will serve as the "Time-Series Database".

### Sheet: `Readings`
| Col | Name | Type | Description |
| :--- | :--- | :--- | :--- |
| **A** | `Timestamp` | `Date` | Form submission (Auto-generated). |
| **B** | `Raw_kwh` | `Number` | User entry or extracted OCR digits. |
| **C** | `Image_Url` | `URL` | Link to the meter photo (if applicable). |
| **D** | `Shift` | `Enum` | `Day` (8AM-8PM), `Night` (8PM-8AM), `Manual`. |
| **E** | `Delta_kwh` | `Number` | Consumption since previous record. |
| **F** | `Daily_Total`| `Number` | 24h consumption (only calculated on AM shifts). |
| **G** | `Notes` | `String` | Anomaly flags or manual corrections. |

---

## 2. Google Apps Script (GAS) Logic
The script will run as a trigger on **Form Submission**.

### Core Function: `onFormSubmit(e)`
1.  **Event Data:** Extract the `Raw_kwh` and `Timestamp` from the event object.
2.  **Context Fetching:**
    - Identify the current row and the row immediately preceding it.
3.  **Calculations:**
    - `delta = current_kwh - previous_kwh`.
    - `shift = (current_hour >= 7 && current_hour <= 9) ? "Night" : (current_hour >= 19 && current_hour <= 21) ? "Day" : "Anomaly"`.
    - *Note: AM reading closes the "Night" shift (8PM-8AM).*
4.  **Anomaly Detection:**
    - If `delta < 0` (meter reset or manual error).
    - If `delta > 100` (unlikely high consumption).
5.  **Persistence:** Write the results back to the spreadsheet.

---

## 3. Localization & Constants
- **Timezone:** `Asia/Manila` (UTC+8).
- **Currency:** `PHP`.
- **Target Shifts:**
    - **8 AM:** Marks the end of the `Night` shift (Sleep/Aircon).
    - **8 PM:** Marks the end of the `Day` shift (Work/Appliances).
