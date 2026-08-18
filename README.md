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

```powershell
python -m http.server 5173
```

- Player: http://localhost:5173
- Admin: http://localhost:5173/admin (Ctrl+Shift+L)

Or `.\start-kiosk.ps1` for Edge kiosk mode.

## Deploy

```powershell
.\deploy.ps1
```

Live: **https://phonepe-word-of-honor.vercel.app**  
Admin: **https://phonepe-word-of-honor.vercel.app/admin**
