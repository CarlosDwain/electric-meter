/**
 * Electric Meter Tracker — Reminders
 * Version 1.0
 *
 * HOW IT WORKS:
 *   1. setupTriggers() creates three time-based triggers (run once manually):
 *        - sendMorningReminder: fires daily at 8:00 AM Asia/Manila
 *        - sendEveningReminder: fires daily at 8:00 PM Asia/Manila
 *        - checkNudge: fires every 15 minutes
 *
 *   2. When a reminder fires, it sends a message to all registered chat IDs
 *      and stores the reminder time in PropertiesService.
 *
 *   3. checkNudge runs every 15 minutes. If a reminder was sent but no reading
 *      has been logged since then, it sends a follow-up nudge.
 *
 * SETUP:
 *   Run setupTriggers() once manually from the Apps Script editor.
 *   You only need to do this once — triggers persist until deleted.
 */

const REMINDER_CHAT_IDS_KEY = "reminder_chat_ids";
const REMINDER_SENT_KEY     = "reminder_sent_time";
const NUDGE_SENT_KEY        = "nudge_sent_time";

// ─── Trigger setup (run once manually) ───────────────────────────────────────

function setupTriggers() {
  // Delete existing triggers first to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Morning reminder — 8:00 AM
  ScriptApp.newTrigger("sendMorningReminder")
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  // Evening reminder — 8:00 PM
  ScriptApp.newTrigger("sendEveningReminder")
    .timeBased()
    .atHour(20)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  // Nudge checker — every 15 minutes
  ScriptApp.newTrigger("checkNudge")
    .timeBased()
    .everyMinutes(15)
    .create();
  
  // Daily summary — 9 PM
  ScriptApp.newTrigger("sendDailySummary")
    .timeBased().atHour(21).everyDays(1)
    .inTimezone(CONFIG.TIMEZONE).create();
  
  // Weekly report — every Sunday 8 AM
  ScriptApp.newTrigger("sendWeeklyReport")
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(8).inTimezone(CONFIG.TIMEZONE).create();
  
  // Anomaly check — 10 PM
  ScriptApp.newTrigger("checkAnomaly")
    .timeBased().atHour(22).everyDays(1)
    .inTimezone(CONFIG.TIMEZONE).create();

  console.log("All 6 triggers created successfully.");
}

// ─── Reminder functions ───────────────────────────────────────────────────────

function sendMorningReminder() {
  sendReminderToAll(
    "Good morning! Time to take your meter reading.\n\n" +
    "Send /reading to log the morning reading now."
  );
}

function sendEveningReminder() {
  sendReminderToAll(
    "Good evening! Time to take your meter reading.\n\n" +
    "Send /reading to log the evening reading now."
  );
}

function sendReminderToAll(message) {
  const chatIds = getRegisteredChatIds();
  if (chatIds.length === 0) {
    console.log("No registered chat IDs — no reminders sent.");
    return;
  }

  chatIds.forEach(chatId => sendMessage(chatId, message));

  // Store the reminder sent time for nudge checking
  const props = PropertiesService.getScriptProperties();
  props.setProperty(REMINDER_SENT_KEY, String(new Date().getTime()));
  props.deleteProperty(NUDGE_SENT_KEY); // reset nudge flag

  console.log("Reminder sent to " + chatIds.length + " user(s): " + chatIds.join(", "));
}

// ─── Nudge checker ────────────────────────────────────────────────────────────

function checkNudge() {
  const props        = PropertiesService.getScriptProperties();
  const reminderTime = parseInt(props.getProperty(REMINDER_SENT_KEY) || "0");
  const nudgeSent    = props.getProperty(NUDGE_SENT_KEY);

  // No reminder was sent recently
  if (!reminderTime) return;

  const minutesSinceReminder = (new Date().getTime() - reminderTime) / (1000 * 60);

  // Only nudge between 15 and 30 minutes after reminder
  if (minutesSinceReminder < 15 || minutesSinceReminder > 30) return;

  // Already sent a nudge for this reminder
  if (nudgeSent) return;

  // Check if a reading was logged since the reminder was sent
  const lastRecord = getLastRecord();
  if (lastRecord && lastRecord.timestamp.getTime() > reminderTime) {
    // Reading was logged — clear the reminder flag
    props.deleteProperty(REMINDER_SENT_KEY);
    console.log("Reading logged after reminder — no nudge needed.");
    return;
  }

  // No reading logged — send nudge to all registered users
  const chatIds = getRegisteredChatIds();
  chatIds.forEach(chatId => {
    sendMessage(chatId,
      "Reminder: you haven't logged your meter reading yet.\n\n" +
      "Send /reading when you're ready."
    );
  });

  props.setProperty(NUDGE_SENT_KEY, String(new Date().getTime()));
  props.deleteProperty(REMINDER_SENT_KEY); // clear so it doesn't nudge again
  console.log("Nudge sent to " + chatIds.length + " user(s).");
}

// ─── Chat ID registry ─────────────────────────────────────────────────────────

/**
 * Registers a chat ID so they receive reminders.
 * Called automatically from handleUpdate() whenever anyone interacts with the bot.
 */
function registerChatId(chatId) {
  const props   = PropertiesService.getScriptProperties();
  const current = props.getProperty(REMINDER_CHAT_IDS_KEY);
  const ids     = current ? JSON.parse(current) : [];

  if (!ids.includes(String(chatId))) {
    ids.push(String(chatId));
    props.setProperty(REMINDER_CHAT_IDS_KEY, JSON.stringify(ids));
    console.log("Registered new chat ID: " + chatId);
  }
}

function getRegisteredChatIds() {
  const props   = PropertiesService.getScriptProperties();
  const current = props.getProperty(REMINDER_CHAT_IDS_KEY);
  return current ? JSON.parse(current) : [];
}

function testReminder() {
  // Test the morning reminder message
  sendMorningReminder();
}

function testNudge() {
  // Simulate a reminder being sent 16 minutes ago with no reading logged
  const props = PropertiesService.getScriptProperties();
  props.setProperty(REMINDER_SENT_KEY, String(new Date().getTime() - (16 * 60 * 1000)));
  props.deleteProperty(NUDGE_SENT_KEY);
  checkNudge();
}

function testRegisteredUsers() {
  // See who is registered for reminders
  const ids = getRegisteredChatIds();
  console.log("Registered chat IDs: " + JSON.stringify(ids));
}