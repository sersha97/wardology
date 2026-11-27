#!/usr/bin/env python3
"""Build the Wardology static site (wardology.com).

content/<subject>/<slug>.md  ->  site/<subject>/<slug>.html
subjects.yml                 ->  library (home) + one page per subject
content/tools/*.md           ->  site/tools/<slug>.html

Run:  python3 build.py        (output in ./site, open site/index.html)
"""
import html
import json
import re
import shutil
from datetime import date
from pathlib import Path

import markdown
import yaml

import emojify
import figures

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
OUT = ROOT / "site"
SITE_TITLE = "Wardology"
TAGLINE = "The science of ward medicine"
SITE_URL = "https://wardology.com"
DESCRIPTION = "Wardology — the science of ward medicine. A practical, evidence-based hospital medicine handbook for the wards and the boards."
CONTACT = "hello@wardology.com"
LOGO = '<svg class="wlogo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="url(#wg)"/><defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4572e"/><stop offset=".45" stop-color="#b5324b"/><stop offset="1" stop-color="#0f2a43"/></linearGradient></defs><path d="M7 19H13L22 47L32 25L42 47L51 19" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="56.5" cy="19" r="3.4" fill="#f2b134"/></svg>'
PAGES = []  # site-relative URLs for sitemap.xml
KEYWORDS = "hospital medicine, hospitalist handbook, internal medicine, clinical reference, medical residents, ABIM board review, inpatient medicine, medical education"
AUTHOR = {"@type": "Person", "name": "Serhii Shabalin, MD", "jobTitle": "Physician, Internal Medicine", "url": "https://www.shabalini.com"}
PUBLISHER = {"@type": "Organization", "name": SITE_TITLE, "url": SITE_URL, "logo": SITE_URL + "/assets/apple-touch-icon.png", "email": CONTACT}
SPECIALTY = {"cardiology": "Cardiovascular", "pulmonary": "Pulmonary", "renal": "Renal", "id": "Infectious", "heme": "Hematologic",
             "gi": "Gastroenterologic", "endo": "Endocrine", "neuro": "Neurologic", "geri": "Geriatric", "nightcalls": "Emergency",
             "rheum": "Rheumatologic", "derm": "Dermatologic", "womens": "Obstetric", "psych": "Psychiatric", "eye-ent": "Otolaryngologic"}


def medical_ld(name, desc, url, extra=None):
    """schema.org MedicalWebPage JSON-LD so crawlers and URL classifiers see clinician-facing medical reference content."""
    d = {"@context": "https://schema.org", "@type": "MedicalWebPage", "name": name, "description": desc,
         "url": f"{SITE_URL}/{url.removesuffix('.html')}", "inLanguage": "en",
         "audience": {"@type": "MedicalAudience", "audienceType": "Clinician"},
         "author": AUTHOR, "publisher": PUBLISHER,
         "isPartOf": {"@type": "WebSite", "name": SITE_TITLE, "url": SITE_URL}}
    d.update(extra or {})
    return d

CALLOUTS = {
    "bottom": ("⚡", "Bottom line — first hour"),
    "pearl": ("💡", "Pearl"),
    "warn": ("⚠️", "Watch out"),
    "analogy": ("🧩", "Think of it like this"),
    "dose": ("💊", "Dose check"),
    "board": ("🎓", "Board corner"),
    "new": ("🆕", "What's new"),
    "mnemonic": ("🧠", "Mnemonic"),
}


# ---------- Markdown helpers ----------

def _asset_version():
    import hashlib
    h = hashlib.sha1()
    files = [f for f in sorted((ROOT / "assets").iterdir()) if f.is_file()]
    for f in files + sorted((ROOT / "content").rglob("*.md")) + [ROOT / "figures.py", ROOT / "emojify.py"]:
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


ASSET_V = _asset_version()  # cache-buster so Cloudflare/browsers never serve an old stylesheet

def md(text):
    return markdown.markdown(text, extensions=["tables", "sane_lists", "attr_list", "md_in_html"])


def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[^\w\s-]", "", s, flags=re.U).strip().lower()
    return re.sub(r"[\s_]+", "-", s)[:40] or "sec"


def parse_front(path):
    raw = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
    if not m:
        raise SystemExit(f"No front matter in {path}")
    return yaml.safe_load(m.group(1)), m.group(2)


def render_flow(body):
    """Lines:  Q: question   Y: yes-branch   N: no-branch (optional)"""
    steps, cur = [], None
    for line in body.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        k, _, v = line.partition(":")
        k = k.strip().upper()
        if k == "Q":
            cur = {"q": v.strip(), "y": None, "n": None}
            steps.append(cur)
        elif k in ("Y", "N") and cur:
            cur[k.lower()] = v.strip()
    out = ['<div class="flow">']
    for i, s in enumerate(steps, 1):
        inl = lambda t: md(t)[3:-4] if t else ""
        out.append(f'<div class="fstep"><div class="fq"><span class="fnum">{i}</span>{inl(s["q"])}</div>')
        if s["y"]:
            out.append(f'<div class="fy"><b>Yes →</b> {inl(s["y"])}</div>')
        if s["n"]:
            out.append(f'<div class="fn"><b>No ↓</b> {inl(s["n"])}</div>')
        out.append("</div>")
        if i < len(steps):
            out.append('<div class="farrow">▼</div>')
    out.append("</div>")
    return "\n".join(out)


def preprocess(text):
    """Turn custom blocks into HTML placeholders that Markdown leaves alone."""
    stash = {}

    def keep(h):
        k = f"HBSTASH{len(stash)}X"
        stash[k] = h
        return f"\n\n{k}\n\n"

    def block(m):
        kind, title, body = m.group(1), (m.group(2) or "").strip(), m.group(3)
        if kind == "flow":
            return keep(render_flow(body))
        if kind == "tabs":
            # sub-blocks: === Tab name
            parts = re.split(r"^=== (.+)$", body, flags=re.M)
            names, panes = parts[1::2], parts[2::2]
            tid = f"t{len(stash)}"
            btns = "".join(
                f'<button role="tab" class="tab{" on" if i == 0 else ""}" data-t="{tid}-{i}">{html.escape(n.strip())}</button>'
                for i, n in enumerate(names))
            pn = "".join(
                f'<div class="pane{" on" if i == 0 else ""}" id="{tid}-{i}">{md(sub(p))}</div>' for i, p in enumerate(panes))
            return keep(f'<div class="tabs"><div class="tabbar" role="tablist">{btns}</div>{pn}</div>')
        emo, default = CALLOUTS.get(kind, ("📌", kind.title()))
        return keep(f'<div class="callout {kind}"><div class="ctitle">{emo} {html.escape(title or default)}</div>{md(sub(body))}</div>')

    def sub(t):
        t = re.sub(r"\{\{ecg:([a-z0-9]+)(?:\|([^}]*))?\}\}", lambda m: keep(figures.render_ecg(m.group(1), m.group(2))), t)
        t = re.sub(r"\{\{fig:([a-z0-9-]+)\}\}", lambda m: keep(figures.render_fig(m.group(1))), t)
        return t

    # nested-safe enough: blocks do not nest except tabs content (no ::: inside tabs)
    text = re.sub(r"^- \[ \] ", "- ☐ ", text, flags=re.M)
    text = re.sub(r"^:::[ \t]*(\w+)[ \t]*(.*?)\n(.*?)^:::[ \t]*$", block, text, flags=re.M | re.S)
    text = sub(text)
    return text, stash


def restore(h, stash):
    for _ in range(3):
        for k, v in stash.items():
            h = h.replace(f"<p>{k}</p>", v).replace(k, v)
    return h


def sectionize(h):
    """Wrap each <h2> section into a collapsible card. Returns (html, [(id, title)])."""
    parts = re.split(r"(<h2[^>]*>.*?</h2>)", h, flags=re.S)
    head, out, toc = parts[0], [], []
    for i in range(1, len(parts), 2):
        title_html = re.sub(r"</?h2[^>]*>", "", parts[i])
        sid = slugify(title_html)
        toc.append((sid, html.unescape(re.sub(r"<[^>]+>", "", title_html)).strip()))
        out.append(f'<details class="sec" id="{sid}" open><summary><h2>{title_html}</h2><span class="chev">⌄</span></summary>'
                   f'<div class="secbody">{parts[i + 1]}</div></details>')
    return head + "".join(out), toc


def tables_wrap(h):
    return re.sub(r"(<table>.*?</table>)", r'<div class="tblwrap">\1</div>', h, flags=re.S)


# ---------- Templates ----------
def shell(title, body, depth, page_class="", topbar="", url="", desc="", ld=None):
    p = "../" * depth
    desc = desc or DESCRIPTION
    ld_html = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in (ld or []))
    PAGES.append(url)
    canon = f"{SITE_URL}/{url.removesuffix('.html')}"
    return emojify.page(f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="keywords" content="{KEYWORDS}">
<meta name="author" content="Serhii Shabalin, MD">
<meta name="rating" content="general">
<meta name="robots" content="index, follow">
<link rel="canonical" href="{canon}">
<meta name="theme-color" content="#0f2a43">
<meta property="og:site_name" content="{SITE_TITLE}"><meta property="og:type" content="website">
<meta property="og:title" content="{html.escape(title)}"><meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{canon}"><meta property="og:image" content="{SITE_URL}/assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{p}assets/favicon.svg" type="image/svg+xml"><link rel="icon" href="{p}assets/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="{p}assets/apple-touch-icon.png">
{ld_html}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{p}assets/style.css?v={ASSET_V}">
</head>
<body class="{page_class}" data-root="{p}">
{topbar}
<main id="main">{body}</main>
<footer class="foot"><p><b>{SITE_TITLE}</b> — {TAGLINE.lower()} · by <a href="https://www.shabalini.com">Serhii Shabalin, MD</a> · educational use only — <a href="{p}tools/disclaimer.html">not medical advice</a>. · <a href="{p}tools/about.html">About Wardology</a> Check doses and local protocols. · <a href="mailto:{CONTACT}">{CONTACT}</a></p><p class="credit">Emoji: <a href="https://github.com/jdecked/twemoji">Twemoji</a>, CC-BY 4.0</p></footer>
<div id="search" class="search" hidden><div class="sbox"><div class="shead"><span>🔍</span><input id="q" type="search" placeholder="Search: AF, hyponatremia, Light's…" autocomplete="off"><button class="sclose" aria-label="Close">✕</button></div><ul id="sres"></ul></div></div>
<button id="totop" class="totop" aria-label="Back to top" hidden>↑</button>
<script src="{p}assets/search-index.js?v={ASSET_V}"></script><script src="{p}assets/app.js?v={ASSET_V}"></script>
</body></html>""", p)


def topbar(back_href, back_label, title, depth, show_toc=False, color="#0f2a43"):
    toc_btn = '<button class="tbtn" id="tocbtn" aria-label="Sections">☰</button>' if show_toc else ""
    return f"""<header class="topbar" style="--sc:{color}">
<a class="back" href="{back_href}" aria-label="Back to {html.escape(back_label)}"><span class="arrow">←</span><span class="blab">{html.escape(back_label)}</span></a>
<div class="ttitle">{html.escape(title)}</div>
<div class="tact">{toc_btn}<button class="tbtn" id="sbtn" aria-label="Search">🔍</button><a class="tbtn" href="{'../' * depth}index.html" aria-label="Library">📚</a></div>
</header>"""


# ---------- Build ----------
def main():
    subjects = yaml.safe_load((ROOT / "subjects.yml").read_text(encoding="utf-8"))
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    for f in (ROOT / "assets").iterdir():
        if f.is_file():
            shutil.copy(f, OUT / "assets" / f.name)

    index = []
    all_topics = []
    for s in subjects:
        sdir = CONTENT / s["id"]
        topics = []
        for f in sorted(sdir.glob("*.md")):
            fm, body = parse_front(f)
            fm["slug"] = f.stem
            fm["body"] = body
            fm["subject"] = s
            topics.append(fm)
        group_names = [g["name"] for g in s["groups"]]
        topics.sort(key=lambda t: (group_names.index(t["group"]) if t["group"] in group_names else 99, t.get("order", 50)))
        s["topics"] = topics
        all_topics += topics

    # topic pages
    for s in subjects:
        tlist = s["topics"]
        (OUT / s["id"]).mkdir(exist_ok=True)
        for i, t in enumerate(tlist):
            text, stash = preprocess(t["body"])
            h = restore(md(text), stash)
            h = tables_wrap(h)
            h, toc = sectionize(h)
            prev_t = tlist[i - 1] if i > 0 else None
            next_t = tlist[i + 1] if i < len(tlist) - 1 else None
            chips = "".join(f'<a class="chip" href="#{sid}">{html.escape(tt)}</a>' for sid, tt in toc)
            tags = "".join(f'<span class="tag">{html.escape(str(x))}</span>' for x in t.get("tags", []))
            words = len(re.sub(r"<[^>]+>", " ", h).split())
            nav = '<nav class="pn">'
            nav += (f'<a class="pnb prev" href="{prev_t["slug"]}.html"><small>← Previous</small><b>{prev_t["emoji"]} {html.escape(prev_t["title"])}</b></a>' if prev_t else '<span></span>')
            nav += (f'<a class="pnb next" href="{next_t["slug"]}.html"><small>Next →</small><b>{next_t["emoji"]} {html.escape(next_t["title"])}</b></a>' if next_t else '<span></span>')
            nav += "</nav>"
            body = f"""
<section class="thero" style="--sc:{s['color']}">
<div class="crumbs"><a href="../index.html">📚 Library</a> › <a href="index.html">{s['emoji']} {html.escape(s['name'])}</a> › <span>{html.escape(t['group'])}</span></div>
<div class="tbig">{t['emoji']}</div>
<h1>{html.escape(t['title'])}</h1>
<p class="tsum">{html.escape(t.get('summary', ''))}</p>
<div class="tags">{tags}</div>
<div class="meta">🗓️ Reviewed {t.get('reviewed', '')} · ⏱️ {max(1, round(words / 200))} min read · 📖 {html.escape(t.get('sources', ''))}</div>
</section>
<div class="chips" id="chips"><button class="chip all" id="toggleall">⇕ Collapse all</button>{chips}</div>
<article class="topic">{h}</article>
<a class="backbig" href="index.html">↩︎ Back to {s['emoji']} {html.escape(s['name'])}</a>
{nav}
<div id="tocsheet" class="sheet" hidden><div class="sheetin"><div class="sheethead"><b>On this page</b><button class="sclose" aria-label="Close">✕</button></div>
{''.join(f'<a href="#{sid}">{html.escape(tt)}</a>' for sid, tt in toc)}</div></div>"""
            page = shell(f"{t['title']} · {SITE_TITLE}", body, 1, "tpage",
                         topbar("index.html", s["name"], t["title"], 1, True, s["color"]), f"{s['id']}/{t['slug']}.html",
                         desc=f"{t['title']} — {t.get('summary', '')} Hospital medicine reference for physicians and residents.",
                         ld=[medical_ld(t["title"], t.get("summary", ""), f"{s['id']}/{t['slug']}.html", {
                             "about": {"@type": "MedicalCondition", "name": t["title"]},
                             "medicalAudience": {"@type": "MedicalAudience", "audienceType": "Clinician"},
                             **({"specialty": f"https://schema.org/{SPECIALTY[s['id']]}"} if s["id"] in SPECIALTY else {}),
                             **({"lastReviewed": str(t["reviewed"])} if t.get("reviewed") else {})})])
            (OUT / s["id"] / f"{t['slug']}.html").write_text(page, encoding="utf-8")
            plain = html.unescape(re.sub(r"<[^>]+>", " ", h)).replace("⌄", " ")
            index.append({"t": t["title"], "e": t["emoji"], "s": s["name"], "u": f"{s['id']}/{t['slug']}.html",
                          "k": " ".join(map(str, t.get("tags", []))) + " " + t.get("summary", ""),
                          "h": " ".join(tt for _, tt in toc), "x": re.sub(r"\s+", " ", plain)[:4000]})

        # subject page
        groups_html = []
        for gr in s["groups"]:
            items = [t for t in tlist if t["group"] == gr["name"]]
            if not items:
                continue
            rows = "".join(
                f'<a class="trow" href="{t["slug"]}.html"><span class="temo">{t["emoji"]}</span><span class="ttext"><b>{html.escape(t["title"])}</b>'
                f'<small>{html.escape(t.get("summary", ""))}</small><span class="mini">{"".join(f"<i>{html.escape(str(x))}</i>" for x in t.get("tags", [])[:4])}</span></span><span class="go">›</span></a>'
                for t in items)
            groups_html.append(f'<section class="group"><h2>{gr["emoji"]} {html.escape(gr["name"])} <span class="cnt">{len(items)}</span></h2>{rows}</section>')
        planned = "".join(f"<li>🔒 {html.escape(p)}</li>" for p in s.get("planned", []))
        body = f"""
<section class="shero" style="--sc:{s['color']}">
<div class="crumbs"><a href="../index.html">📚 Library</a> › <span>{s['emoji']} {html.escape(s['name'])}</span></div>
<div class="sbig">{s['emoji']}</div><h1>{html.escape(s['name'])}</h1><p>{html.escape(s['blurb'])}</p>
<div class="sstat">📄 {len(tlist)} chapters · 🗂️ {len([g for g in s['groups'] if any(t['group'] == g['name'] for t in tlist)])} sections</div>
</section>
<div class="gwrap" style="--sc:{s['color']}">{''.join(groups_html)}
{f'<section class="group planned"><h2>🛠️ Coming next</h2><ul>{planned}</ul></section>' if planned else ''}</div>"""
        page = shell(f"{s['name']} · {SITE_TITLE}", body, 1, "spage", topbar("../index.html", "Library", s["name"], 1, False, s["color"]), f"{s['id']}/",
                     desc=f"{s['name']} — {s['blurb']} Hospital medicine reference for physicians and residents.",
                     ld=[medical_ld(s["name"], s["blurb"], f"{s['id']}/",
                                    {"specialty": f"https://schema.org/{SPECIALTY[s['id']]}"} if s["id"] in SPECIALTY else None)])
        (OUT / s["id"] / "index.html").write_text(page, encoding="utf-8")

    # tools pages
    (OUT / "tools").mkdir(exist_ok=True)
    tools = []
    for f in sorted((CONTENT / "tools").glob("*.md")):
        fm, body = parse_front(f)
        text, stash = preprocess(body)
        h = tables_wrap(restore(md(text), stash))
        h, toc = sectionize(h)
        chips = "".join(f'<a class="chip" href="#{sid}">{html.escape(tt)}</a>' for sid, tt in toc)
        b = f"""<section class="thero" style="--sc:#0f2a43"><div class="crumbs"><a href="../index.html">📚 Library</a> › <span>🧰 Tools</span></div>
<div class="tbig">{fm['emoji']}</div><h1>{html.escape(fm['title'])}</h1><p class="tsum">{html.escape(fm.get('summary', ''))}</p></section>
{f'<div class="chips" id="chips"><button class="chip all" id="toggleall">⇕ Collapse all</button>{chips}</div>' if toc else ''}<article class="topic">{h}</article>
<a class="backbig" href="../index.html">↩︎ Back to 📚 Library</a>"""
        (OUT / "tools" / f"{f.stem}.html").write_text(
            shell(f"{fm['title']} · {SITE_TITLE}", b, 1, "tpage", topbar("../index.html", "Library", fm["title"], 1, False), f"tools/{f.stem}.html",
                  desc=f"{fm['title']} — {fm.get('summary', '')} {SITE_TITLE}, a hospital medicine reference for physicians and residents.",
                  ld=[medical_ld(fm["title"], fm.get("summary", ""), f"tools/{f.stem}.html")]), encoding="utf-8")
        if fm.get("show", True):
            tools.append((f.stem, fm))
        index.append({"t": fm["title"], "e": fm["emoji"], "s": "Tools", "u": f"tools/{f.stem}.html", "k": fm.get("summary", ""),
                      "h": " ".join(tt for _, tt in toc), "x": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))[:4000]})

    # home
    tiles = "".join(
        f'<a class="tile" href="{s["id"]}/index.html" style="--sc:{s["color"]}"><span class="temoji">{s["emoji"]}</span><b>{html.escape(s["name"])}</b>'
        f'<small>{len(s["topics"])} chapters</small><span class="tpeek">{" · ".join(html.escape(t["title"].split(" (")[0]) for t in s["topics"][:3])}…</span></a>'
        for s in subjects)
    tool_tiles = "".join(f'<a class="tool" href="tools/{slug}.html"><span>{fm["emoji"]}</span><b>{html.escape(fm["title"])}</b><small>{html.escape(fm.get("summary", ""))}</small></a>' for slug, fm in tools)
    total = len(all_topics)
    feat = [t for t in all_topics if t.get("featured")][:8]
    feat_html = "".join(f'<a class="feat" href="{t["subject"]["id"]}/{t["slug"]}.html" style="--sc:{t["subject"]["color"]}"><span>{t["emoji"]}</span><b>{html.escape(t["title"])}</b><small>{t["subject"]["emoji"]} {html.escape(t["subject"]["name"])}</small></a>' for t in feat)
    body = f"""
<section class="hero">
<div class="hdeco" aria-hidden="true">❤️🫁🧠🦠🩸🧂</div>
<div class="hlogo">{LOGO}</div>
<h1>Ward<span>ology</span></h1>
<p class="tagline">{TAGLINE}</p>
<p>Fast, practical, evidence-based. Pathophysiology in 60 seconds, criteria you can trust, and what to do at 3 AM — plus a board corner on every page.</p>
<button class="bigsearch" id="sbtn2">🔍 <span>Search {total} chapters…</span></button>
<div class="hstats"><span>📚 {len(subjects)} subjects</span><span>📄 {total} chapters</span><span>🗓️ Updated {date.today().isoformat()}</span></div>
</section>
<a class="qbankcta" href="qbank/"><span class="qe">🎓</span><span><b>QBank — ABIM Internal Medicine</b><small>Free board-style questions mapped to the ABIM blueprint, with tutor and timed exam modes.</small></span><span class="go">›</span></a>
<section class="lib"><h2 class="lh">📚 Library</h2><div class="tiles">{tiles}</div></section>
<section class="lib"><h2 class="lh">⭐ Start here</h2><div class="feats">{feat_html}</div></section>
<section class="lib"><h2 class="lh">🧰 Tools</h2><div class="tools">{tool_tiles}</div></section>
<section class="about"><b>👋 About</b><p>Written by <a href="https://www.shabalini.com">Serhii Shabalin, MD</a> — Internal Medicine resident at a community teaching hospital in New Jersey, trained in Kyiv, first-generation physician. Built for real-life clinical wards and the ABIM boards. Every page lists its sources and review date. Educational use only. Questions or corrections: <a href="mailto:{CONTACT}">{CONTACT}</a>. <a href="tools/about.html">More about Wardology →</a></p></section>"""
    hdr = f"""<header class="topbar home"><a class="back brand" href="index.html"><span class="arrow">{LOGO}</span><span class="blab">{SITE_TITLE}</span></a><div class="ttitle"></div>
<div class="tact"><a class="tbtn" href="qbank/" aria-label="QBank" title="QBank">🎓</a><button class="tbtn" id="sbtn" aria-label="Search">🔍</button></div></header>"""
    home_ld = [{"@context": "https://schema.org", "@type": "WebSite", "name": SITE_TITLE, "url": SITE_URL, "description": DESCRIPTION,
                "inLanguage": "en", "publisher": PUBLISHER, "author": AUTHOR,
                "audience": {"@type": "MedicalAudience", "audienceType": "Clinician"}},
               medical_ld(f"{SITE_TITLE} — {TAGLINE}", DESCRIPTION, "")]
    (OUT / "index.html").write_text(shell(f"{SITE_TITLE} — {TAGLINE}", body, 0, "home", hdr, "", ld=home_ld), encoding="utf-8")
    import qbank_build
    qbank_build.build(OUT)
    write_static()

    # emoji used by the search box (results are drawn in the browser)
    js_text = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    for d in index:
        for txt in (d["e"], d["x"][:4000]):
            for _, _, e in emojify._matches(txt):
                emojify.ensure(e)
    for _, _, e in emojify._matches(js_text):
        emojify.ensure(e)
    (OUT / "assets" / "emoji").mkdir()
    for code in sorted(set(emojify.USED.values())):
        shutil.copy(emojify.EMOJI_DIR / f"{code}.svg", OUT / "assets" / "emoji" / f"{code}.svg")
    (OUT / "assets" / "search-index.js").write_text(
        "window.HB_INDEX=" + json.dumps(index, ensure_ascii=False) + ";\n"
        "window.HB_EMOJI=" + json.dumps(emojify.USED, ensure_ascii=False) + ";", encoding="utf-8")
    emojify.report()
    print(f"Built {total} chapters in {len(subjects)} subjects, {len(tools)} tools -> {OUT}")


def write_static():
    """sitemap.xml, robots.txt, 404 page and Cloudflare Pages headers."""
    # files that must sit at the site root as-is (e.g. Google Search Console verification)
    for f in (ROOT / "root").glob("*"):
        shutil.copy(f, OUT / f.name)
    today = date.today().isoformat()
    urls = "".join(f"<url><loc>{SITE_URL}/{u.removesuffix('.html')}</loc><lastmod>{today}</lastmod></url>" for u in sorted(set(PAGES)))
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n', encoding="utf-8")
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")
    body = f"""<section class="hero"><div class="hlogo">{LOGO}</div><h1>Lost on the <span>ward?</span></h1>
<p>This page does not exist (or it moved). Try the search, or go back to the library.</p>
<a class="bigsearch" href="/">📚 <span>Back to the library</span></a></section>"""
    hdr = f"""<header class="topbar home"><a class="back brand" href="/"><span class="arrow">{LOGO}</span><span class="blab">{SITE_TITLE}</span></a><div class="ttitle"></div><div class="tact"></div></header>"""
    page = shell(f"Not found · {SITE_TITLE}", body, 0, "home", hdr, "404.html").replace('href="assets/', 'href="/assets/').replace('src="assets/', 'src="/assets/').replace('data-root=""', 'data-root="/"').replace('href="tools/', 'href="/tools/')
    PAGES.remove("404.html")
    (OUT / "404.html").write_text(page, encoding="utf-8")
    (OUT / "_headers").write_text("/assets/*\n  Cache-Control: public, max-age=604800\n"
        "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n", encoding="utf-8")


if __name__ == "__main__":
    main()
