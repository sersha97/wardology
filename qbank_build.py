"""Build the Wardology QBank.

qbank/questions/<category>.yml  ->  functions/_lib/bank.json   (served only by the API, never public)
qbank/app/*                      ->  site/qbank/                (the test-taking app)
qbank/media/*                    ->  site/qbank/media/          (licensed or self-made images)

Called from build.py. Stand-alone check:  python3 qbank_build.py --check
"""
import html
import json
import re
import shutil
import sys
from pathlib import Path

import markdown
import yaml

import figures

ROOT = Path(__file__).parent
QDIR = ROOT / "qbank" / "questions"
APP = ROOT / "qbank" / "app"
MEDIA = ROOT / "qbank" / "media"
BANK_OUT = ROOT / "functions" / "_lib" / "bank.json"

# ABIM Internal Medicine blueprint (Jan 2026) content categories and target share.
CATEGORIES = [
    ("cardio", "Cardiovascular Disease", "❤️", 15),
    ("endo", "Endocrinology, Diabetes & Metabolism", "🍬", 10),
    ("gi", "Gastroenterology & Hepatology", "🍽️", 10),
    ("id", "Infectious Disease", "🦠", 10),
    ("rheum", "Rheumatology & Orthopedics", "🦴", 10),
    ("pulm", "Pulmonary Disease", "🫁", 8),
    ("nephro", "Nephrology & Urology", "🧂", 6),
    ("onc", "Medical Oncology", "🎗️", 6),
    ("heme", "Hematology", "🩸", 4),
    ("neuro", "Neurology", "🧠", 4),
    ("derm", "Dermatology", "🧴", 3),
    ("obgyn", "Obstetrics & Gynecology", "🤰", 3),
    ("psych", "Psychiatry", "🧘", 3),
    ("geri", "Geriatric Syndromes", "👵", 3),
    ("allergy", "Allergy & Immunology", "🤧", 2),
    ("misc", "Ethics, Safety & Epidemiology", "⚖️", 1),
    ("ophtho", "Ophthalmology", "👁️", 1),
    ("ent", "Otolaryngology & Dental Medicine", "👂", 1),
]
CAT_KEYS = [c[0] for c in CATEGORIES]
TASKS = ["Diagnosis/Testing", "Treatment/Care Decisions", "Risk Assessment/Prognosis/Epidemiology", "Pathophysiology/Basic Science"]
LETTERS = "ABCDEFGH"


LIST_RE = re.compile(r"^\s*(?:[-*] |\d+\. )")


def fix_lists(text):
    """Python-Markdown needs a blank line before a list that follows a paragraph line."""
    out = []
    for line in str(text).strip().split("\n"):
        if out and LIST_RE.match(line) and out[-1].strip() and not LIST_RE.match(out[-1]) and not out[-1].startswith((" ", "|")):
            out.append("")
        out.append(line)
    return "\n".join(out)


def md(text):
    return markdown.markdown(fix_lists(text), extensions=["tables", "sane_lists", "attr_list", "md_in_html"])


def inline(text):
    h = md(text)
    return h[3:-4] if h.startswith("<p>") and h.endswith("</p>") and h.count("<p>") == 1 else h


def ecg_plain(kind):
    """ECG strip from figures.py with the answer-revealing caption removed."""
    svg = figures.ecg(kind)
    svg = re.sub(r'<text[^>]*class="ecglab"[^>]*>.*?</text>', "", svg, flags=re.S)
    svg = re.sub(r'aria-label="[^"]*"', 'aria-label="Rhythm strip"', svg)
    return svg


def media_html(m, depth_prefix="/qbank/media/"):
    if not m:
        return ""
    out = []
    for item in (m if isinstance(m, list) else [m]):
        cap = html.escape(item.get("caption", ""))
        if "ecg" in item:
            out.append(f'<figure class="qmedia ecg">{ecg_plain(item["ecg"])}{f"<figcaption>{cap}</figcaption>" if cap else ""}</figure>')
        elif "svg" in item:
            svg = (MEDIA / item["svg"]).read_text(encoding="utf-8")
            out.append(f'<figure class="qmedia">{svg}{f"<figcaption>{cap}</figcaption>" if cap else ""}</figure>')
        elif "img" in item:
            credit = item.get("credit", "")
            out.append(f'<figure class="qmedia"><img src="{depth_prefix}{item["img"]}" alt="{html.escape(item.get("alt", cap))}" loading="lazy">'
                       f'<figcaption>{cap}{f" <span class=credit>{html.escape(credit)}</span>" if credit else ""}</figcaption></figure>')
    return "".join(out)


def labs_html(labs):
    if not labs:
        return ""
    rows = []
    for row in labs:
        if isinstance(row, str):  # section header
            rows.append(f'<tr class="lsec"><th colspan="3">{html.escape(row)}</th></tr>')
            continue
        name, val = row[0], row[1]
        ref = row[2] if len(row) > 2 else ""
        rows.append(f"<tr><td>{inline(name)}</td><td>{inline(val)}</td><td class='ref'>{inline(ref) if ref else ''}</td></tr>")
    return f'<table class="labs">{"".join(rows)}</table>'


def load_chapters():
    ch = {}
    for f in (ROOT / "content").glob("*/*.md"):
        raw = f.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
        if m and f.parent.name != "tools":
            fm = yaml.safe_load(m.group(1))
            ch[f"{f.parent.name}/{f.stem}"] = {"title": fm.get("title", f.stem), "emoji": fm.get("emoji", "📄")}
    return ch


def shuffle_choices(q):
    """Spread correct answers evenly over A–E and shuffle distractors.
    Deterministic per question id, so answer letters (and stored peer statistics) never move between builds.
    Set keep_order: true for numeric or logically ordered options."""
    import hashlib
    import random
    ch, ans = q.get("choices", {}), q.get("answer")
    if q.get("keep_order") or ans not in ch:
        return q
    keys = list(ch.keys())
    seed = int(hashlib.sha1(q["id"].encode()).hexdigest(), 16)
    target = seed % len(keys)
    others = [k for k in keys if k != ans]
    random.Random(seed).shuffle(others)
    order = others[:target] + [ans] + others[target:]
    new_keys = LETTERS[:len(keys)]
    remap = dict(zip(order, new_keys))
    q = dict(q)
    q["choices"] = {remap[k]: ch[k] for k in order}
    q["answer"] = remap[ans]
    q["why"] = {remap[k]: v for k, v in q.get("why", {}).items() if k in remap}
    return q


def build_question(q, chapters, problems):
    qid = q["id"]
    q = shuffle_choices(q)
    for k in ("topic", "task", "stem", "lead", "choices", "answer", "explain", "why", "objective", "refs", "chapters"):
        if k not in q:
            problems.append(f"{qid}: missing '{k}'")
    if q.get("task") not in TASKS:
        problems.append(f"{qid}: task must be one of {TASKS}")
    choices = q.get("choices", {})
    if list(choices.keys()) != list(LETTERS[:len(choices)]) or not 4 <= len(choices) <= 6:
        problems.append(f"{qid}: choices must be A, B, C, D(, E, F) in order")
    if q.get("answer") not in choices:
        problems.append(f"{qid}: answer {q.get('answer')} is not a choice")
    wrong = [k for k in choices if k != q.get("answer")]
    if sorted(q.get("why", {}).keys()) != sorted(wrong):
        problems.append(f"{qid}: 'why' must explain every wrong choice {wrong}")
    links = []
    for c in q.get("chapters", []):
        if c not in chapters:
            problems.append(f"{qid}: library chapter '{c}' does not exist (create content/{c}.md)")
        else:
            links.append(f'<a class="lib" href="/{c}" target="_blank" rel="noopener">{chapters[c]["emoji"]} {html.escape(chapters[c]["title"])} <span>→</span></a>')

    stem_html = md(q.get("stem", "")) + labs_html(q.get("labs")) + media_html(q.get("media"))
    ans = q.get("answer")
    exp = [f'<div class="xhead"><span class="xans">Correct answer: <b>{ans}</b></span> <span class="xtopic">{html.escape(q.get("topic", ""))}</span></div>']
    exp.append(f'<div class="xbody">{md(q.get("explain", ""))}</div>')
    if q.get("explain_media"):
        exp.append(media_html(q["explain_media"]))
    if q.get("table"):
        t = q["table"]
        rows = "".join(f"<tr><th>{inline(r[0])}</th><td>{inline(r[1])}</td></tr>" for r in t["rows"])
        exp.append(f'<div class="xtable"><table><caption>{html.escape(t.get("title", ""))}</caption>{rows}</table></div>')
    whys = "".join(f'<li><b>({k}) {inline(choices[k])}</b> — {inline(q["why"][k])}</li>' for k in choices if k in q.get("why", {}))
    exp.append(f'<div class="xwhy"><h4>Why not the others</h4><ul>{whys}</ul></div>')
    if q.get("mnemonic"):
        exp.append(f'<div class="xbox mnem"><b>🧠 Mnemonic</b>{md(q["mnemonic"])}</div>')
    if q.get("pearl"):
        exp.append(f'<div class="xbox pearl"><b>🎓 ABIM pearl</b>{md(q["pearl"])}</div>')
    exp.append(f'<div class="xobj"><b>🎯 Educational objective</b>{md(q.get("objective", ""))}</div>')
    if links:
        exp.append(f'<div class="xlib"><b>📚 Read more in Wardology</b>{"".join(links)}</div>')
    refs = "".join(f"<li>{inline(r)}</li>" for r in q.get("refs", []))
    exp.append(f'<div class="xrefs"><b>References</b><ol>{refs}</ol></div>')

    plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", md(q.get("stem", "")) + " " + q.get("lead", ""))))[:600]
    full_plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", stem_html + " ".join(exp)))).lower()
    return {
        "cat": q["_cat"], "topic": q.get("topic", ""), "task": q.get("task", ""),
        "stem_html": stem_html, "lead": inline(q.get("lead", "")),
        "choices": {k: inline(v) for k, v in choices.items()},
        "answer": ans, "explain_html": "".join(exp),
        "plain": plain, "search": full_plain + " " + q.get("topic", "").lower(),
    }


def collect(problems):
    chapters = load_chapters()
    qs, seen = {}, set()
    for f in sorted(QDIR.glob("*.yml")):
        cat = f.stem
        if cat not in CAT_KEYS:
            problems.append(f"{f.name}: file name must be one of {CAT_KEYS}")
            continue
        items = yaml.safe_load(f.read_text(encoding="utf-8")) or []
        for q in items:
            if q.get("id") in seen:
                problems.append(f"duplicate id {q.get('id')}")
            seen.add(q.get("id"))
            q["_cat"] = cat
            qs[q["id"]] = build_question(q, chapters, problems)
    return qs


def build(out_site=None):
    problems = []
    qs = collect(problems)
    if problems:
        raise SystemExit("QBank problems:\n  " + "\n  ".join(problems))
    counts = {k: 0 for k in CAT_KEYS}
    for q in qs.values():
        counts[q["cat"]] += 1
    cats = [{"key": k, "name": n, "emoji": e, "target": t, "count": counts[k]} for k, n, e, t in CATEGORIES]
    BANK_OUT.parent.mkdir(parents=True, exist_ok=True)
    BANK_OUT.write_text(json.dumps({"questions": qs, "categories": cats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if out_site:
        dest = Path(out_site) / "qbank"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(APP, dest)
        if MEDIA.exists():
            shutil.copytree(MEDIA, dest / "media")
    print(f"QBank: {len(qs)} questions in {sum(1 for c in counts.values() if c)} categories -> {BANK_OUT.relative_to(ROOT)}")
    return qs


if __name__ == "__main__":
    build(None if "--check" in sys.argv else ROOT / "site")
