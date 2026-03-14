# Project Backlog: Electric Meter Tracker

## Phase 1: Foundation & Data Schema
- [x] Define Google Sheet columns (Raw vs. Calculated).
- [x] Create Google Form fields for kWh entry/photo upload.
- [x] Initialize `Code.gs` with basic `onFormSubmit` trigger.

## Phase 2: Core Logic (GAS)
- [x] Implement `calculateDelta` function.
- [x] Categorize shifts (Day: 8AM-8PM, Night: 8PM-8AM).
- [x] Implement timezone handling (`Asia/Manila`).
- [x] Add basic anomaly detection (e.g., negative delta or skipped readings).

## Phase 3: Advanced Features & OCR
- [ ] Integrate Google Drive OCR for kWh extraction.
- [ ] Implement skipped-reading detection (Gap Analysis).
- [ ] Implement daily budget alerting.

## Phase 4: Visualization
- [ ] Connect Google Sheet to Looker Studio.
- [ ] Design the dashboard (Daily vs. Nightly trends).
