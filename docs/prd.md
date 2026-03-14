# Product Requirements Document (PRD)

## 1. Problem Statement
Manual tracking of electricity consumption (kwh) is tedious, prone to human error, and lacks real-time visualization. Monitoring specifically at 8 AM and 8 PM is required to differentiate between daytime (appliances/work) and nighttime (aircon/sleep) usage.

## 2. User Stories
* **As a User**, I want to take a photo of my meter and have the digits extracted automatically.
* **As a User**, I want to see how many kWh I used between 8 AM and 8 PM (Day Shift).
* **As a User**, I want to see my total 24-hour consumption (Daily).
* **As a User**, I want a visual dashboard to see if I am exceeding my daily budget.

## 3. Functional Requirements
* **Input:** Image upload or manual text entry via mobile-friendly interface.
* **Processing:** Calculate deltas based on the previous record's timestamp.
* **Output:** Summary of Day vs. Night consumption.
* **Notification:** (Optional) Alert if 24h consumption exceeds a defined threshold.