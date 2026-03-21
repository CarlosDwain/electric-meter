# Project Backlog: Electric Meter Tracker (v2)

## Phase 1: State Machine & Bot Flow (Completed)
- [x] Implement `/start`, `/help`, and `/reading` commands.
- [x] Implement `PropertiesService` state tracking (IDLE, WAIT_NUMBER, etc.).
- [x] Implement Cloudflare-safe `doPost` with early `ContentService` return.
- [x] Implement refined `Morning`/`Evening` shift logic.

## Phase 2: OCR Implementation (Next Step)
- [ ] Implement `handlePhotoReceived()` with Drive OCR.
- [ ] Replace `photo_placeholder` with actual extracted value.
- [ ] Implement image blob MIME type fix (`.setContentType("image/jpeg")`).

## Phase 3: Visualization
- [ ] Connect Google Sheet to Looker Studio.
- [ ] Design "Day vs. Night" trend charts.
