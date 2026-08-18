# PhonePe Integrity Kiosk — Word of Honor

Touch-screen Integrity campaign game per **Game Rules - Digital Game.docx** and **Final Questions** Excel.

## Player flow
1. **Enter Name + Employee ID** (one page)
2. **Game Rules** — Word of Honor instructions
3. **Start Game**
4. **Question 1** — Answer the question
5. **Find the word**
6. Repeat for remaining questions (Question 2, etc.)

## Game flow (4 interactive rounds)
1. **MCQ 1** — Select the correct answer to unlock **Keyword Game 1** (+25 pts).
2. **Keyword Game 1** — Find the hidden integrity keyword on the touch screen (+25 pts).
3. **MCQ 2** — Choose the correct answer to unlock **Keyword Game 2** (+25 pts).
4. **Keyword Game 2** — Locate the final keyword to maximize your score (+25 pts).

### Progression rules
- Wrong **MCQ 1** → skip Keyword Game 1, move straight to Round 2 (MCQ 2).
- Wrong **MCQ 2** → game over.
- Wrong keyword or timeout → 0 pts for that section; game continues if allowed.

## Scoring (max 100 points)
| Total | End screen message |
|-------|-------------------|
| 0 | Oops! |
| 25 | Not bad! |
| 50 | Good Job! |
| 75 | Great job! |
| 100 | Flawless, perfect score! |

Each correct MCQ or keyword section awards **25 points**.

## Content source
- Rules: `Game Rules - Digital Game.docx`
- Questions: `Digital Game_2026_Qs and Keyword.xlsx`
- Columns used: Question, Option A, Option B, Correct Option, Keyword
- Re-import: `python scripts/import_questions.py`

## Run locally

```powershell
python -m http.server 5173
```

Open http://localhost:5173 — add `?kiosk=1` for kiosk hardening.

Admin kiosk (same game + Ctrl+Shift+L panel): http://localhost:5173/admin

Or run `.\start-kiosk.ps1` to launch Edge in kiosk mode.

## Deploy (Vercel · Spark Mindz)

Pushes to `master`/`main` auto-deploy via GitHub Actions to the Spark Mindz Vercel project.

```powershell
.\deploy.ps1
```

Live site: **https://phonepe-word-of-honor.vercel.app**
Admin kiosk: **https://phonepe-word-of-honor.vercel.app/admin** (Ctrl+Shift+L)
