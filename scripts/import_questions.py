"""Import Final Questions Excel into questions.json for the Integrity kiosk game."""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

XLSX = Path(__file__).resolve().parents[1] / "Digital Game_2026_Qs and Keyword.xlsx"
OUT = Path(__file__).resolve().parents[1] / "questions.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def col_row(ref: str):
    m = re.match(r"([A-Z]+)(\d+)", ref)
    col = 0
    for ch in m.group(1):
        col = col * 26 + (ord(ch) - 64)
    return col, int(m.group(2))


def clean(s: str) -> str:
    s = (s or "").replace("\u00a0", " ")
    for a, b in (
        ("\u2019", "'"),
        ("\u2018", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
        ("\u2013", "-"),
        ("\u2014", "-"),
        ("\ufffd", ""),
    ):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def load_sheet():
    with zipfile.ZipFile(XLSX) as z:
        ss = []
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            texts = [t.text or "" for t in si.iter(f"{NS}t")]
            ss.append("".join(texts))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))

    rows = {}
    for c in sheet.findall(f".//{NS}c"):
        ref = c.get("r")
        if not ref:
            continue
        col, row = col_row(ref)
        t = c.get("t")
        v = c.find(f"{NS}v")
        is_elem = c.find(f"{NS}is")
        val = ""
        if t == "inlineStr" and is_elem is not None:
            texts = [x.text or "" for x in is_elem.iter(f"{NS}t")]
            val = "".join(texts)
        elif v is not None:
            val = v.text or ""
            if t == "s" and val.isdigit():
                val = ss[int(val)]
        rows.setdefault(row, {})[col] = val.strip() if isinstance(val, str) else str(val)
    return rows


def main():
    rows = load_sheet()
    questions = []
    keyword_labels = set()

    for r in sorted(rows):
        if r == 1:
            continue
        d = rows[r]
        if not d.get(1):
            continue
        kw = clean(d.get(7, ""))
        clue = clean(d.get(3, ""))
        if not kw or not clue:
            continue
        opt_a = clean(d.get(4, ""))
        opt_b = clean(d.get(5, ""))
        if not opt_a or not opt_b:
            continue
        kw_label = re.sub(r"[^A-Za-z0-9 ]", "", kw).upper().strip()
        kw_label = re.sub(r"\s+", " ", kw_label)
        correct = clean(d.get(6, "")).upper()
        questions.append(
            {
                "allegation": clean(d.get(2, "")),
                "clue": clue,
                "options": [opt_a, opt_b],
                "correctIndex": 0 if correct == "A" else 1,
                "categoryWord": kw_label,
            }
        )
        keyword_labels.add(kw_label)

    decoys = sorted({re.sub(r"[^A-Z0-9]", "", k) for k in keyword_labels})
    longest = max(len(d) for d in decoys)

    cfg = {
        "orientation": "landscape",
        "kioskResolution": "1920x1080",
        "roundsPerGame": 2,
        "wordFindSeconds": 20,
        "idleResetSeconds": 7,
        "sectionPoints": 25,
        "quizPoints": 25,
        "wordPoints": 25,
        "scoreFeedback": {
            "0": "Oops!",
            "25": "Not bad!",
            "50": "Good Job!",
            "75": "Great job!",
            "100": "Flawless, perfect score!",
        },
        "puzzleVariants": 10,
        "decoyWords": decoys,
        "grid": {"minSize": 12, "maxSize": max(20, longest + 2)},
        "questions": questions,
    }
    OUT.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(questions)} questions, {len(decoys)} decoys, maxSize={cfg['grid']['maxSize']}")
    print("sample options:", questions[0]["options"])


if __name__ == "__main__":
    main()
