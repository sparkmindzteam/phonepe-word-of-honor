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

## Run locally (no Vercel)

Double-click **`start-local.bat`** and **leave that window open**.

It opens the player game and the admin page. Close the black window to stop the server.

- Player: http://127.0.0.1:5173
- Admin: http://127.0.0.1:5173/admin (Ctrl+Shift+L)

Each finished game is saved **once locally** and **once online**:

- Local: `data\scores.json` and `data\scores.csv`
- Online: https://phonepe-word-of-honor.vercel.app

Python 3 must be installed and on PATH.

Or `.\start-kiosk.ps1` for Edge kiosk mode.

## Deploy

```powershell
.\deploy.ps1
```

Live: **https://phonepe-word-of-honor.vercel.app**  
Admin: **https://phonepe-word-of-honor.vercel.app/admin**
