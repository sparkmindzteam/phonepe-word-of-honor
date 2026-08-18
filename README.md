# Word of Honor

PhonePe integrity kiosk game.

## Player flow
1. Enter name and Email ID
2. Game rules
3. Two rounds: quiz (30s) then word search (20s)

## Scoring (max 100)
Each correct quiz or keyword section awards **25 points**.

| Total | Message |
|-------|---------|
| 0 | Oops! |
| 25 | Not bad! |
| 50 | Good Job! |
| 75 | Great job! |
| 100 | Flawless, perfect score! |

Wrong Q1 skips that word search. Wrong Q2 ends the game.

## Run locally

Double-click **`start-local.bat`**. One locked kiosk:

- **Ctrl+Shift+L** — open or close the admin panel (keyboard, timers, records)
- **Esc** — close admin, or exit kiosk if admin is already closed

Scores save to `data\scores.json` / `data\scores.csv` and online.

## Deploy

```powershell
.\deploy.ps1
```

Live: **https://phonepe-word-of-honor.vercel.app**  
Ctrl+Shift+L opens admin on that page too.
