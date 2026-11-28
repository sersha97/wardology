"""ABIM-style checks for QBank questions.

    python3 scripts/qbank_lint.py                 # warn on every file
    python3 scripts/qbank_lint.py --strict FILE…  # fail (exit 1) on any problem in these files

Checks: ABIM vital-sign wording, banned lead-ins (EXCEPT / all / none of the above / "true"),
no bold cues in stems, five options, answer-length cue, references are plain strings,
duplicate topics, duplicate stems.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
QDIR = ROOT / "qbank" / "questions"

STEM_RULES = [
    (r"\bpulse is \d", 'use "pulse rate is"'),
    (r"\bheart rate is \d", 'use "pulse rate is"'),
    (r"\brespirations? (?:are|is)\b", 'use "respiration rate is"'),
    (r"\brespiratory rate is\b", 'use "respiration rate is"'),
    (r"\bon room air\b|\bbreathing room air\b", 'use "breathing ambient air"'),
    (r"\*\*", "no bold text in the stem (it cues the answer)"),
    (r"\bclassic(?:al)?\b", 'avoid "classic" (cueing word)'),
]
LEAD_RULES = [
    (r"\bEXCEPT\b|\bexcept\b", "no EXCEPT items"),
    (r"all of the above|none of the above", "no all/none of the above"),
    (r"is (?:most likely )?true\b", 'avoid "which is true" lead-ins; ask a single focused question'),
]


def check(q, problems):
    qid = q.get("id", "?")
    stem = str(q.get("stem", ""))
    for pat, msg in STEM_RULES:
        if re.search(pat, stem):
            problems.append(f"{qid}: stem — {msg}")
    lead = str(q.get("lead", ""))
    for pat, msg in LEAD_RULES:
        if re.search(pat, lead):
            problems.append(f"{qid}: lead-in — {msg}")
    if not lead.rstrip().endswith("?"):
        problems.append(f"{qid}: lead-in should be a question ending in '?'")
    ch = q.get("choices", {})
    if len(ch) != 5:
        problems.append(f"{qid}: {len(ch)} options (ABIM single-best-answer items use 5)")
    ans = q.get("answer")
    if ans in ch and len(ch) > 1:
        others = [len(str(v)) for k, v in ch.items() if k != ans]
        mean = sum(others) / len(others)
        if len(str(ch[ans])) > 1.7 * mean and len(str(ch[ans])) - mean > 25:
            problems.append(f"{qid}: correct option is much longer than the others (length cue)")
    vals = [str(v).strip().lower() for v in ch.values()]
    if len(set(vals)) != len(vals):
        problems.append(f"{qid}: duplicate options")
    for r in q.get("refs", []):
        if not isinstance(r, str):
            problems.append(f"{qid}: reference parsed as a mapping — wrap it in quotes")
    if len(stem) < 120:
        problems.append(f"{qid}: stem looks too short for a clinical vignette")


def main(argv):
    strict = "--strict" in argv
    files = [Path(a) for a in argv if not a.startswith("--")] or sorted(QDIR.glob("*.yml"))
    all_files = sorted(QDIR.glob("*.yml"))
    topics, stems = defaultdict(list), defaultdict(list)
    for f in all_files:
        for q in yaml.safe_load(f.read_text(encoding="utf-8")) or []:
            topics[str(q.get("topic", "")).strip().lower()].append(q["id"])
            stems[re.sub(r"\W+", "", str(q.get("stem", "")).lower())[:160]].append(q["id"])
    problems = []
    chosen = {p.resolve() for p in files}
    ids_in_scope = set()
    for f in all_files:
        if f.resolve() not in chosen:
            continue
        for q in yaml.safe_load(f.read_text(encoding="utf-8")) or []:
            ids_in_scope.add(q["id"])
            check(q, problems)
    for t, ids in topics.items():
        if len(ids) > 1 and ids_in_scope & set(ids):
            problems.append(f"duplicate topic '{t}': {', '.join(ids)}")
    stop = {"the", "a", "of", "in", "and", "with", "for", "to", "on", "—", "-", "after", "before", "acute", "chronic"}
    def words(t):
        return {w for w in re.findall(r"[a-z0-9₁₂]+", t) if w not in stop}
    tl = list(topics.items())
    for i, (t1, ids1) in enumerate(tl):
        for t2, ids2 in tl[i + 1:]:
            w1, w2 = words(t1), words(t2)
            if w1 and w2 and len(w1 & w2) / len(w1 | w2) >= 0.6 and ids_in_scope & set(ids1 + ids2):
                problems.append(f"similar topics (check for the same concept): '{t1}' {ids1} ~ '{t2}' {ids2}")
    for s, ids in stems.items():
        if len(ids) > 1 and ids_in_scope & set(ids):
            problems.append(f"near-identical stems: {', '.join(ids)}")
    for p in problems:
        print(("ERROR " if strict else "warn  ") + p)
    print(f"{len(ids_in_scope)} questions checked, {len(problems)} problems")
    return 1 if strict and problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
