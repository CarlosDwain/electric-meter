# Development Rules & Constraints

### 1. Zero-Cost Policy
* All tools, APIs, and hosting must be 100% free. 
* Avoid any service requiring a credit card for "free tiers" that might auto-charge.

### 2. Data Integrity
* No "destructive" edits. Original kWh readings must be preserved; calculated deltas must be stored in separate columns.
* Handle missing readings gracefully (e.g., if 8 PM is skipped, the next 8 AM calculation should flag an anomaly).

### 3. Localization
* Timezone: Fixed to `Asia/Manila` (UTC+8).
* Currency: Philippine Peso (PHP).

