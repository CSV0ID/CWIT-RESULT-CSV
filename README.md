# CWIT S26 Result System — vmedulife API & Extractor

## vmedulife API

**Endpoint:** `POST https://portal.vmedulife.com/api/assessment/publicLink.php`  
**Content-Type:** `application/x-www-form-urlencoded`

### Payload

Two form fields:

| Field | Value |
|---|---|
| `getStudentResult` | `true` |
| `data` | base64(`{"institute_url":"cwit-pune","result_id":<ID>,"admission_number":"<PRN>","search_type":"university_number"}`) |

### Required Headers

```
Origin: https://portal.vmedulife.com
Referer: https://portal.vmedulife.com/public/assessment/
User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36
Accept: application/json
Content-Type: application/x-www-form-urlencoded
```

### Response

```json
{
  "studentName": "PRANAV MAHESHAN",
  "isValidAdmissionNumber": "true",
  "resultStatus": "Published",
  "data": {
    "157117": {
      "subjectName": "THEORY OF STRUCTURES",
      "courseCode": "R23CE2804",
      "courseCredits": "2",
      "totalExamMarks": "100.00",
      "col_5130": "70",
      "col_2244": "30",
      "col_5599": "100",
      "col_7708": "27",
      ...
    },
    "SGPA": "8.5"
  }
}
```

The `data` dict contains subject entries keyed by numeric instance IDs, plus a `"SGPA"` key at the same level. Each subject has metadata (`subjectName`, `courseCode`, `courseCredits`, `totalExamMarks`) plus variable `col_*` numeric keys that hold the actual marks.

---

### Result IDs by Department

#### Backlog (single ID per department)

| Department | ID |
|---|---|
| Civil Engineering | 8744 |
| Electrical Engineering | 8745 |
| Mechanical (Aided) | 8763 |
| Mechanical (Un-Aided) | 8764 |
| E&TC (Aided) | 8765 |
| E&TC (Un-Aided) | 8766 |
| Computer Engineering | 8767 |
| Computer Engineering & IoT | 8768 |

#### Regular (one ID per semester)

| Department | Sem II | Sem IV | Sem VI |
|---|---|---|---|
| Civil Engineering | 8660 | 8661 | 8662 |
| Electrical Engineering | 8663 | 8664 | 8665 |
| Mechanical (Aided) | 8676 | 8677 | 8678 |
| Mechanical (Un-Aided) | 8680 | 8681 | 8682 |
| E&TC (Aided) | 8692 | 8693 | 8694 |
| E&TC (Un-Aided) | 8696 | 8697 | 8698 |
| Computer Engineering | 8701 | 8702 | 8703 |
| Computer Engineering & IoT | 8705 | 8706 | 8707 |

### Roll → Semester

First two digits of PRN determine the regular exam semester:

| Prefix | Semester |
|---|---|
| `25` | II |
| `24` | IV |
| `23` | VI |

---

## The `col_*` Problem

Each department + exam combination uses **different numeric `col_*` keys** for the same semantic fields. For example, the theory maximum marks column might be `col_3836` for Computer Engineering Sem IV but `col_5130` for Civil Engineering Sem IV. This means hardcoding column keys per-exam is fragile.

### Solution: Position-Based Parser

Instead of mapping specific col_* keys, the parser (`parse_raw.py`, `parseRawSubjects` in JS) sorts all `col_*` values by their numeric suffix and reads fixed **positions** in the sorted array:

| Positions | Meaning |
|---|---|
| 0–5 | Theory: SA max, FA max, TH max, SA obt, FA obt, TH obt |
| 6+ (repeating groups of 3) | Practicals: max, internal, obtained (FA-PR, SA-PR, SLA) |
| Trailer (from end) | Credits (≤10), then Pass/Fail status(es) |
| Core (remaining) | Total max (≥100), total obt (just before it) |

This works universally across all departments and exams without knowing the specific `col_*` keys.

---

## Extraction Scripts

### `check_s26.py` — Backlog Extraction
Batch-fetches backlog results for all students. Uses hardcoded `col_*` keys (known from earlier analysis). Output: `cwit_s26_backlog_results.csv`.

### `fetch_s26_regular_all.py` — Initial Regular Bulk
Fetches all students for all departments using hardcoded column keys. Output: `cwit_s26_regular_all.csv` (3032 students, published + unpublished).

### `re_extract_regular.py` — Column Discovery
Re-fetches only published students, groups by (dept, sem), **discovers column mappings** by probing one student per group and pattern-matching values (70, 30, 100 for theory; 25 for practicals; Pass/Fail for status). Output: `cwit_s26_regular_published.csv`.

### `re_extract_with_raw.py` — Raw JSON Preservation (Recommended)
Same grouping but saves the **entire raw `data` JSON** from the API response into a `_raw_json` column. This lets the position-based parser reconstruct marks at display time without re-fetching. Output: `cwit_s26_regular_published_with_raw.csv` (832 students).

---

## CSV Structure

### `cwit_s26_regular_published_with_raw.csv` (primary regular source)

| Column | Content |
|---|---|
| `RollNumber` | PRN |
| `StudentName` | Student name |
| `Department` | Full department name |
| `Semester` | 2, 4, or 6 |
| `resultStatus` | Published / Not Published |
| `isValidAdmissionNumber` | true / false |
| `SGPA` | SGPA value |
| `_raw_json` | **Full `data` dict from API response as JSON string** |
| `S1_Name`…`S8_cols` | Individual subject columns (redundant with `_raw_json`) |

### `cwit_s26_backlog_results.csv` (backlog source)

| Column | Content |
|---|---|
| `RollNumber`, `StudentName`, `Department` | Basic info |
| `S1_Name`…`S9_CR` | Subject columns (TH, Total, Pct, Status, CR, Practicals) |

---

## Servers & APIs

### `server.py` — Combined Live API + CSV (Python, port 8888)
- `/api/result` — Live proxy to vmedulife, position-based parser for response, Telegram notify
- `/api/csvresult` — CSV lookup from `cwit_s26_regular_published.csv` (OLD format, individual columns)
- `/csv` — CSV lookup frontend page

### `csv_server.py` — Dedicated CSV Lookup Server (Python, port 8888)
- Reads `cwit_s26_regular_published_with_raw.csv`
- Uses `parse_raw.py` position-based parser on `_raw_json`
- Telegram notification on every search

### Vercel `/api/result.js` — Live API Proxy (Node.js)
- Same logic as Python `server.py` but for Vercel serverless
- Uses `parseSubjectColumns()` — JS position-based parser

### Vercel `/api/csvresult.js` — CSV Lookup API (Node.js)
- Backlog: simple CSV line-by-line parse with simple split (backlog CSV has no complex quoting)
- Regular: reads `regular.json` (pre-built JSON lookup), does O(1) dict lookup by roll number, passes `_raw_json` to `parseRawSubjects()`

---

## `regular.json` — JSON Lookup File

Pre-built from `cwit_s26_regular_published_with_raw.csv` using Python's `csv.DictReader`. Each entry:

```json
{
  "244038": {
    "n": "RAJESHWARI KANGUDE",
    "d": "Computer Engineering",
    "s": "4",
    "st": "Published",
    "g": "",
    "r": "{\"157643\": {\"subjectName\": \"COMPUTER NETWORKS\", ...}}"
  }
}
```

Keys: `n`=name, `d`=department, `s`=semester, `st`=status, `g`=SGPA, `r`=raw JSON. This avoids CSV parsing entirely on Vercel — just `JSON.parse` + dict lookup.

---

## Telegram Notifications

Every result lookup (live API or CSV) sends a Telegram message with:
- Department, roll number, student name
- SGPA (if available)
- Per-subject marks: FA-TH/SA-TH/TH · PR FA-PR/SA-PR · SLA · Total % Status
- Device fingerprint (for fraud tracking)
- Client IP
- Optional contact email

Bot token and chat ID are set via environment variables `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
