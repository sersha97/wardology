# Wardology

*The science of ward medicine.* Source for **[wardology.com](https://wardology.com)** (formerly shabalini.com/handbook). Library → subject → chapter, with a back arrow on every page.
Educational use only; not medical advice.

## Folder map

| Path | What it is |
|---|---|
| `subjects.yml` | The library: subjects, emoji, colors, sub-chapter groups, "coming next" list |
| `content/<subject>/<chapter>.md` | One chapter per file (Markdown + front matter) |
| `content/tools/*.md` | Formulas, quick cards, guideline watch, disclaimer |
| `figures.py` | Drawn ECG strips and diagrams |
| `assets/` | Style, navigation and search script |
| `build.py` | Turns everything into the static site |
| `site/` | Built website — open `site/index.html` in a browser |

## Build

```bash
pip install markdown pyyaml
python3 build.py        # writes ./site
```

## Add a chapter

1. Copy any chapter (for example `content/cardiology/flutter.md`) to `content/<subject>/<new-name>.md`.
2. Edit the front matter: `title`, `emoji`, `group` (must match a group in `subjects.yml`), `order`, `summary`, `tags`, `reviewed`, `sources`.
3. Write the sections as `## 🧠 Heading` — each `##` becomes a collapsible card and a jump chip.
4. Run `python3 build.py`. Remove the topic from `planned:` in `subjects.yml`.

## Special blocks

```text
:::bottom            ⚡ Bottom line box (also: pearl, warn, analogy, dose, board, new)
- text
:::

:::flow              Step-by-step decision chart
Q: Question?
Y: What to do if yes
N: What to do if no
:::

:::tabs              Tabbed panel
=== Tab one
content
=== Tab two
content
:::

{{ecg:af|Caption}}   ECG strip: sinus af flutter svt vt torsades longqt avb1 mobitz1 mobitz2 chb stemi pericarditis hyperk sinetach
{{fig:ef-spectrum}}  Diagram: ef-spectrum hemo-profiles acs-spectrum af-bouncer hfref-pillars sepsis-hour1 acid-base hypona-algo cirrhosis-map pe-risk stroke-time
```

## Emoji

Use any emoji in chapters, `subjects.yml` or figures. The build turns each one into a small
[Twemoji](https://github.com/jdecked/twemoji) SVG image (`assets/emoji/`), so it looks the same on
Mac, Windows, Android, iPhone and every browser — no more empty rectangles (□) on older devices.
A new emoji is downloaded automatically on the next build; commit the new file in `assets/emoji/`.
Inside an SVG figure, put an emoji in its own `<text class="emo">` element (not mixed with words).

## Deploy to wardology.com

Cloudflare Pages is connected to this repo. Every push to `main` rebuilds and publishes the site in about a minute.

| Pages setting | Value |
|---|---|
| Build command | `pip install -r requirements.txt && python3 build.py` |
| Build output directory | `site` |
| Environment variable | `PYTHON_VERSION` = `3.12` |

The GitHub Action in `.github/workflows/build.yml` only checks that the site builds (useful on pull requests).
Old links on `shabalini.com/handbook/...` are forwarded to `wardology.com/...` by a Cloudflare redirect rule on shabalini.com.

Brand: name, tagline, contact email and logo live at the top of `build.py`; logo files are in `assets/` (`logo.svg`, `favicon.svg`, `apple-touch-icon.png`, `og-image.png`).

## Quarterly review

Every Jan / Apr / Jul / Oct: check new guidelines, update the chapter, change `reviewed:`, and add a line to `content/tools/guideline-watch.md`.

## 🎓 QBank (wardology.com/qbank)

Free ABIM Internal Medicine question bank with accounts, tutor and exam modes, peer statistics and performance reports.

| Path | What it is |
|---|---|
| `qbank/questions/<category>.yml` | Questions, one file per ABIM blueprint category (`cardio`, `endo`, `gi`, `id`, `rheum`, `pulm`, `nephro`, `onc`, `heme`, `neuro`, `derm`, `obgyn`, `psych`, `geri`, `allergy`, `misc`, `ophtho`, `ent`) |
| `qbank/app/` | The test-taking app (copied to `site/qbank/`) |
| `qbank/media/` | Images for questions (only self-made or properly licensed; put the credit in the question) |
| `qbank_build.py` | Validates questions and writes `functions/_lib/bank.json` (the answer key — served only by the API, never public) |
| `functions/api/qb/[[path]].js` | API: accounts, tests, grading, statistics |
| `qbank/schema.sql` | Database tables (Cloudflare D1 `wardology-qbank`, binding `DB` in `wrangler.toml`) |

### Add a question

Copy any question in a `qbank/questions/*.yml` file and edit it. Required fields: `id` (unique, e.g. `CV-009`), `topic`, `task`
(one of `Diagnosis/Testing`, `Treatment/Care Decisions`, `Risk Assessment/Prognosis/Epidemiology`, `Pathophysiology/Basic Science`),
`chapters` (library links like `cardiology/af` — the chapter must exist), `stem`, `lead`, `choices` (A–E), `answer`, `explain`,
`why` (one line for every wrong choice), `objective`, `refs`. Optional: `labs`, `media` (`ecg: af` for a drawn strip from `figures.py`,
`svg:` or `img:` from `qbank/media/` with `credit:`), `table`, `mnemonic`, `pearl`, `keep_order: true` (numeric options).

Write choices in any order — the build spreads correct answers evenly over A–E (fixed per question id, so never re-letter a live question by hand).
Run `python3 qbank_build.py --check` to validate, then `python3 build.py`. `functions/_lib/bank.json` is rebuilt every time — commit it too.

### Blueprint targets (ABIM IM, Jan 2026) — goal 300 questions

Cardio 45 · Endo 30 · GI 30 · ID 30 · Rheum/Ortho 30 · Pulm 24 · Nephro/Uro 18 · Onc 18 · Heme 12 · Neuro 12 · Derm 9 · OB/GYN 9 · Psych 9 · Geri 9 · Allergy 6 · Misc 3 · Ophtho 3 · ENT 3.
At least 75% of items on high-importance topics; no more than 18% on low-frequency ("LF") topics.

### Local test

```bash
npm i -g wrangler
wrangler d1 execute wardology-qbank --local --file qbank/schema.sql
python3 build.py && wrangler pages dev site      # then open http://localhost:8788/qbank/
```
