# Safety Observation PWA

A mobile-first safety observation app prototype for web, Android install, and iOS install through the browser.

## Run Locally

```powershell
node dev-server.js
```

Then open:

```text
http://127.0.0.1:4173/
```

## Current Features

- Installable PWA shell with offline cache.
- First-run role setup for Admin or Observer.
- Mobile observation form with local date/time, category picker, observation notes, corrective action, photo capture/upload, recipient email, and observer close-out option.
- Local dashboard with weekly/monthly/custom date filters.
- Category and status counts for open/pending, close-out submitted, and closed observations.
- Weekly day 1 to 7 graph with clickable category segments that filter to the matching observation summaries and statuses.
- Close-out workflow with close-out action notes, close-out photo evidence, and observer/admin confirmation.
- In-app notification banner after email handoff or report email preparation.
- Printable report, CSV export, and email report handoff.
- Admin settings for group name/default email.
- Admin invite link and QR code for regular observers.

## Notes

This version stores data in the browser on the device using `localStorage`. The next production step is adding a backend database and authentication so multiple users can share one live group dashboard.
