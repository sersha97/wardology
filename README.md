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
