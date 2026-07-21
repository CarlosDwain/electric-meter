# Repository Guidelines

## Project Structure & Module Organization

This is a Google Apps Script project for logging electricity-meter readings through a Telegram bot. Source files live in `src/`:

- `telegram_bot.gs` handles webhook updates, commands, image recognition, and Telegram API calls.
- `tracker.gs` contains shared sheet mapping and usage calculations.
- `reading_management.gs`, `reminders.gs`, and `features.gs` add commands and scheduled reports.
- `dashboard.gs` serves the Apps Script web app; `dashboard_html.html` is its client UI.

`docs/` contains supporting project documentation. There is no committed test or build directory.

## Development & Deployment

There is no local build, package script, or automated test command. Edit the `.gs` and `.html` files, then add them to the corresponding Google Apps Script project and deploy or update the Web App from Apps Script.

Use a local static check where available:

```powershell
npx tsc --project jsconfig.json --noEmit
```

`jsconfig.json` targets ES2015 and provides editor support for `.gs` files; this command may require compatible Google Apps Script type definitions. Verify behavior manually in a non-production spreadsheet and Telegram chat after deployment.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and `camelCase` for functions and local variables. Use `UPPER_SNAKE_CASE` for configuration and state constants, such as `SHEET_NAME` and `STATE_WAIT_PHOTO`. Keep Apps Script entry points (`doPost`, `doGet`) at top level. Prefer small, focused functions and preserve the existing section-comment style.

## Testing Guidelines

No automated test framework or coverage threshold is configured. For changes, exercise the affected command (for example, `/reading`, `/history 10`, or `/bill`), confirm the expected Google Sheet row updates, and check scheduled-trigger changes in Apps Script. Test meter-photo recognition with a valid image and manual fallback.

## Commit & Pull Request Guidelines

Follow the existing concise Conventional Commit-like history: `feat: add dashboard`, `fix: correct sheet logic`, or `chore: update ignore rules`. Keep commits scoped to one behavior. Pull requests should describe the user-visible change, identify Apps Script deployment or trigger steps, link related issues when applicable, and include dashboard screenshots for UI changes.

## Security & Configuration

Never commit live Telegram tokens, Gemini keys, spreadsheet IDs, or user IDs. Keep secrets in Apps Script properties where possible. Restore and retain the Telegram user whitelist before making a deployment publicly reachable.
