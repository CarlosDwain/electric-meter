# GEMINI.MD: AI Collaboration Guide

This document provides essential context for AI models interacting with this project. Adhering to these guidelines will ensure consistency and maintain code quality.

## 1. Project Overview & Purpose

* **Primary Goal:** To automate the tracking and analysis of electricity consumption (kWh). The system differentiates between daytime (8 AM to 8 PM) and nighttime (8 PM to 8 AM) usage to provide insights into aircon/sleep vs. appliance/work energy costs.
* **Business Domain:** Personal Utility Monitoring / Home Energy Management.

## 2. Core Technologies & Stack

* **Languages:** JavaScript (Google Apps Script).
* **Frameworks & Runtimes:** Google Apps Script (GAS) runtime (v8 environment).
* **Databases:** Google Sheets (acting as a time-series database and storage layer).
* **Key Libraries/Dependencies:**
    * Google Apps Script Services (`SpreadsheetApp`, `DriveApp`).
    * Google Drive API (for OCR meter digit extraction).
    * Looker Studio (for data visualization).
* **Package Manager(s):** None (Uses Google Workspace managed environment; potentially `@google/clasp` for local development).

## 3. Architectural Patterns

* **Overall Architecture:** **Event-Driven Serverless Architecture.** The workflow follows a Trigger-Process-Store-Visualize pattern:
    1. **Trigger:** Form submission (via Google Forms/AppSheet).
    2. **Ingestion:** Data lands in a "Raw" Google Sheet.
    3. **Compute:** Google Apps Script calculates deltas and categorizes shifts.
    4. **Storage:** Results are written to "Calculated" columns/sheets.
    5. **Visualization:** Looker Studio UI refreshes based on the Sheet data.
* **Directory Structure Philosophy:** (Inferred)
    * `/docs`: Contains foundational documentation including architecture, PRD, rules, and tech stack.
    * (Root): Core project configuration and script entrypoints (e.g., `Code.gs` or `clasp` config).

## 4. Coding Conventions & Style Guide

* **Formatting:** (Inferred) Standard JavaScript conventions. Indentation: 2 spaces.
* **Naming Conventions:**
    * `variables`, `functions`: camelCase (e.g., `deltaConsumption`, `calculateShift`).
    * `Sheet Columns`: Snake_Case or PascalCase (e.g., `Raw_kwh`, `Day_Shift`, `Daily_Total`).
* **API Design:** Internal event-driven logic (Google Workspace triggers). No public REST API is currently planned.
* **Error Handling:** Must follow the **Zero Destructive Edits** rule. If a reading is missing or anomalous, the script must flag it rather than failing or overwriting previous valid data.

## 5. Key Files & Entrypoints

* **Main Entrypoint(s):** Google Apps Script functions, specifically the `onFormSubmit(e)` trigger or a custom trigger function.
* **Configuration:** 
    * `docs/rules.md`: Defines critical constraints like Zero-Cost and Localization.
    * Google Apps Script `PropertiesService`: For non-hardcoded configuration settings.
* **CI/CD Pipeline:** None detected. The project uses standard Google Workspace deployment.

## 6. Development & Testing Workflow

* **Local Development Environment:** (Inferred) Deployment via the online Apps Script Editor or locally using `@google/clasp`.
* **Testing:** Logic testing is performed by validating row calculations in Google Sheets. New code must be tested against the `Asia/Manila` timezone to ensure proper 8 AM/8 PM shift categorization.
* **CI/CD Process:** Manual updates to the Apps Script project or pushing changes via `clasp push`.

## 7. Specific Instructions for AI Collaboration

* **Zero-Cost Policy:** **CRITICAL.** Only use tools, APIs, and hosting that are 100% free. Avoid any service requiring a credit card for registration.
* **Data Integrity:** NEVER modify or delete original kWh readings. All calculated values (deltas, shift labels) must reside in separate columns.
* **Localization:** 
    * Timezone: `Asia/Manila` (UTC+8).
    * Currency: Philippine Peso (PHP).
* **Anomalies:** If an 8 PM reading is skipped, the next 8 AM calculation must detect the gap and flag it as an anomaly rather than calculating a misleading 24h delta as a single shift.
* **Security:** Do not hardcode API keys or sensitive identifiers. Use Google Apps Script's `PropertiesService` for environment-specific secrets.
* **Commit Messages:** (Inferred) Use descriptive prefixes for documentation updates or logic changes (e.g., `feat:`, `fix:`, `docs:`).
