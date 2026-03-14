# System Architecture

## Data Flow Diagram
1. **Trigger:** User submits kWh via Google Form (Mobile).
2. **Ingestion:** Data is appended to a "Raw" Google Sheet.
3. **Compute (GAS):**
   - Check timestamp (Is it ~8 AM or ~8 PM?).
   - Query the previous row's `Raw_kwh`.
   - Calculate `delta = current - previous`.
   - Categorize as `Day_Shift` or `Night_Shift`.
4. **Storage:** Update the "Calculated" sheet columns.
5. **Visualization:** Looker Studio fetches the updated Sheet and refreshes the UI.

## Logic Logic (Pseudo-code)
```javascript
if (Hour >= 07 && Hour <= 09) {
  Period = "AM";
  Daily_Total = Current - Yesterday_AM;
} else if (Hour >= 19 && Hour <= 21) {
  Period = "PM";
  Day_Consumption = Current - Today_AM;
}