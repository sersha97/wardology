"""Wardology QBank — end-to-end pass/fail tests for highlighting and question feedback (+ email).

Runs the real site and Pages Function locally (wrangler pages dev + local D1) and drives it with
Playwright in Chromium (Chrome / Edge / Brave / Opera / Samsung Internet engine), Firefox (Gecko) and
WebKit (Safari engine — the one every iPhone/iPad browser uses), on desktop and on phone/tablet profiles.

    python3 tests/qbank_e2e.py --base http://localhost:8788 --mail http://127.0.0.1:9999 --db <path to local D1 sqlite>

The mail server is a stand-in for the Cloudflare Email Sending API (started by tests/run_e2e.sh).
"""
import argparse, json, sqlite3, sys, time, traceback, urllib.request, uuid
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:8788")
ap.add_argument("--mail", default="http://127.0.0.1:9999")
ap.add_argument("--db", required=True)
ap.add_argument("--only", default="")
A = ap.parse_args()
BASE = A.base

PLATFORMS = [
    # name, engine, device descriptor (None = desktop 1366x850)
    ("Windows/Mac · Chrome, Edge, Brave, Opera (Chromium)", "chromium", None),
    ("Windows/Mac/Linux · Firefox", "firefox", None),
    ("Mac · Safari (WebKit)", "webkit", None),
    ("iPhone · Safari/Chrome/Firefox (WebKit, touch)", "webkit", "iPhone 15"),
    ("iPad · Safari (WebKit, touch)", "webkit", "iPad Pro 11"),
    ("Android · Chrome/Samsung Internet (Chromium, touch)", "chromium", "Pixel 7"),
    ("Android · Firefox (Gecko, touch)", "firefox", "firefox-touch"),
]
if A.only:
    PLATFORMS = [p for p in PLATFORMS if A.only.lower() in p[0].lower()]

# ---------- helpers ----------
def mail_log():
    with urllib.request.urlopen(A.mail + "/log") as r:
        return json.loads(r.read())
def mail_mode(mode):
    urllib.request.urlopen(urllib.request.Request(A.mail + "/mode/" + mode, method="POST")).read()
def db(sql, *args):
    c = sqlite3.connect(A.db, timeout=10)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()

JS_SELECT = """([sel, start, len]) => {
  const root = document.querySelector(sel);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim().length > start + len ? 1 : 3 });
  const n = w.nextNode(); if (!n) return null;
  const r = document.createRange(); r.setStart(n, start); r.setEnd(n, start + len);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); return r.toString();
}"""
JS_SELECT_ACROSS = """(sel) => {
  // from the middle of the first text block to the middle of a later block (other paragraph or a lab-table cell)
  const root = document.querySelector(sel);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim().length > 12 ? 1 : 3 });
  const nodes = []; let n; while ((n = w.nextNode())) nodes.push(n);
  const blk = (x) => x.parentElement.closest('p,td,th,li,div');
  const a = nodes[0]; const b = nodes.find(x => blk(x) !== blk(a)); if (!a || !b) return null;
  const r = document.createRange(); r.setStart(a, 4); r.setEnd(b, 6);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); return r.toString();
}"""
STRUCT = """(sel) => { const r = document.querySelector(sel); return { p: r.querySelectorAll('p').length, tr: r.querySelectorAll('tr').length,
  td: r.querySelectorAll('td').length, text: r.textContent.replace(/\\s+/g,' ').trim(), badNest: r.querySelectorAll('mark p, mark tr, mark td, mark table, mark div').length } }"""
MARKS = "(sel) => [...document.querySelectorAll(sel + ' mark')].map(m => m.textContent).join('|')"

class Ctx:
    def __init__(self, pw, browser, device):
        self.touch = device is not None
        opts = {}
        if device == "firefox-touch":
            opts = dict(viewport={"width": 412, "height": 860}, has_touch=True, user_agent="Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0")
        elif device:
            opts = dict(pw.devices[device])
        else:
            opts = dict(viewport={"width": 1366, "height": 850})
        self.browser = browser
        self.ctx = self.browser.new_context(**opts, base_url=BASE)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.email = f"t{uuid.uuid4().hex[:10]}@example.com"
        r = self.page.request.post("/api/qb/auth/signup", data={"email": self.email, "password": "password123", "name": "Test Doc", "agree": True})
        assert r.ok, r.text()
        self.uid = r.json()["user"]["id"]
    def new_test(self, mode="tutor", n=5):
        r = self.page.request.post("/api/qb/tests", data={"mode": mode, "count": n, "pools": ["all"]})
        assert r.ok, r.text()
        tid = r.json()["id"]
        self.page.goto(f"/qbank/#/test/{tid}")
        self.page.wait_for_selector("#stem")
        return tid
    def click(self, sel):
        (self.page.tap if self.touch else self.page.click)(sel)
    def close(self):
        self.ctx.close()

# ---------- tests ----------
def t_toolbar_button(c):
    c.new_test()
    txt = c.page.evaluate(JS_SELECT, ["#stem", 0, 18]); assert txt
    c.click("#tHl")
    m = c.page.evaluate(MARKS, "#stem"); assert m == txt, f"expected mark {txt!r}, got {m!r}"

def t_popup_after_select(c):
    """Desktop: drag-select with the mouse -> floating 'Highlight' pill. Touch: long-press style selection
    (no mouse events at all) -> the same pill must still appear."""
    c.new_test()
    if c.touch:
        txt = c.page.evaluate(JS_SELECT, ["#stem", 2, 15])
    else:
        box = c.page.evaluate("""() => { const w = document.createTreeWalker(document.querySelector('#stem'), NodeFilter.SHOW_TEXT, {acceptNode:n=>n.nodeValue.trim().length>30?1:3});
          const n = w.nextNode(); const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 1); const a = r.getBoundingClientRect();
          r.setStart(n, 20); r.setEnd(n, 21); const b = r.getBoundingClientRect(); return [a.left + 1, a.top + a.height/2, b.left + 1, b.top + b.height/2]; }""")
        c.page.mouse.move(box[0], box[1]); c.page.mouse.down(); c.page.mouse.move(box[2], box[3], steps=6); c.page.mouse.up()
        txt = c.page.evaluate("() => getSelection().toString()")
    assert txt, "nothing selected"
    c.page.wait_for_selector(".hlpop", timeout=2500)
    c.click(".hlpop")
    m = c.page.evaluate(MARKS, "#stem"); assert m.strip() == txt.strip(), f"expected {txt!r} got {m!r}"
    assert c.page.locator(".hlpop").count() == 0, "pill should disappear after highlighting"

def t_selection_lost_before_tap(c):
    """iPhone/iPad/Android often clear the text selection the moment you tap a toolbar button.
    The highlight must still apply to what was selected."""
    c.new_test()
    txt = c.page.evaluate(JS_SELECT, ["#stem", 0, 12]); assert txt
    c.page.wait_for_timeout(120)
    c.page.evaluate("() => getSelection().removeAllRanges()")
    c.click("#tHl")
    m = c.page.evaluate(MARKS, "#stem"); assert m == txt, f"expected {txt!r} got {m!r}"

def t_keyboard_h(c):
    if c.touch: return "n/a (no keyboard)"
    c.new_test()
    txt = c.page.evaluate(JS_SELECT, ["#stem", 3, 10])
    c.page.keyboard.press("h")
    assert c.page.evaluate(MARKS, "#stem") == txt

def t_cross_block(c):
    """Selection spanning two paragraphs / into the lab table must not break the layout."""
    c.new_test(n=10)
    for _ in range(10):
        before = c.page.evaluate(STRUCT, "#stem")
        txt = c.page.evaluate(JS_SELECT_ACROSS, "#stem")
        if txt: break
        c.click("#fNext"); c.page.wait_for_timeout(150)
    assert txt, "no multi-block stem found"
    c.click("#tHl")
    after = c.page.evaluate(STRUCT, "#stem")
    for k in ("p", "tr", "td"):
        assert after[k] == before[k], f"{k} count changed {before[k]} -> {after[k]} (layout broken)"
    assert after["text"] == before["text"], "question text changed"
    assert after["badNest"] == 0, "paragraphs/table cells were moved inside a <mark>"
    got = c.page.evaluate("(s)=>[...document.querySelectorAll(s+' mark')].map(m=>m.textContent).join('')", "#stem").replace(" ", "").replace("\n", "")
    assert got == txt.replace(" ", "").replace("\n", "").replace("\t", ""), f"marked {got!r} != selected {txt!r}"

def t_persist(c):
    c.new_test()
    txt = c.page.evaluate(JS_SELECT, ["#stem", 0, 14]); c.click("#tHl")
    c.click("#fNext"); c.page.wait_for_timeout(200); c.click("#fPrev"); c.page.wait_for_timeout(200)
    assert c.page.evaluate(MARKS, "#stem") == txt, "lost after next/previous"
    c.page.reload(); c.page.wait_for_selector("#stem")
    assert c.page.evaluate(MARKS, "#stem") == txt, "lost after reload"

def t_remove(c):
    c.new_test()
    c.page.evaluate(JS_SELECT, ["#stem", 0, 14]); c.click("#tHl")
    c.click("#stem mark")
    assert c.page.locator("#stem mark").count() == 0, "tap/click on highlight did not remove it"
    c.page.reload(); c.page.wait_for_selector("#stem")
    assert c.page.locator("#stem mark").count() == 0, "removed highlight came back after reload"

def t_explanation(c):
    c.new_test()
    c.click("#choices .ch >> nth=0"); c.click("#submit")
    c.page.wait_for_selector("#xp")
    txt = c.page.evaluate(JS_SELECT, ["#xp", 0, 12]); assert txt
    c.click("#tHl")
    assert c.page.evaluate(MARKS, "#xp") == txt, "explanation text could not be highlighted"
    c.click("#fNext"); c.page.wait_for_timeout(150); c.click("#fPrev"); c.page.wait_for_selector("#xp")
    assert c.page.evaluate(MARKS, "#xp") == txt, "explanation highlight not kept"

def t_fail_no_selection(c):
    c.new_test()
    c.page.evaluate("() => getSelection().removeAllRanges()")
    c.page.wait_for_timeout(400)  # let any remembered selection expire
    c.click("#tHl")
    c.page.wait_for_selector("#toast:not([hidden])", timeout=2000)
    assert "Select text" in c.page.inner_text("#toast")
    assert c.page.locator("mark").count() == 0

def t_fail_outside(c):
    c.new_test()
    c.page.evaluate(JS_SELECT, [".lead", 0, 8])  # the lead-in question line is fine to select…
    c.page.evaluate(JS_SELECT, ["#choices", 0, 4])  # …but choices are not highlightable
    c.click("#tHl")
    assert c.page.locator("#choices mark").count() == 0, "answer choices got highlighted"
    assert c.page.locator("#tMark.on").count() == 0

# ---- feedback ----
def open_fb(c):
    c.click("#tFb"); c.page.wait_for_selector("#fbt")

def t_fb_empty(c):
    c.new_test(); open_fb(c)
    n0 = db("SELECT COUNT(*) FROM feedback")[0][0]
    c.click("#fbs"); c.page.wait_for_timeout(400)
    assert c.page.inner_text("#fbe").strip(), "no error shown for empty feedback"
    assert db("SELECT COUNT(*) FROM feedback")[0][0] == n0, "empty feedback was saved"

def t_fb_send_and_email(c):
    c.new_test(); open_fb(c)
    c.click('input[name="fbk"][value="correction"]')
    note = "The sodium cutoff in option C looks outdated <b>please check</b> " + uuid.uuid4().hex[:6]
    c.page.fill("#fbt", note)
    before = len(mail_log())
    c.click("#fbs")
    c.page.wait_for_selector("#toast:not([hidden])", timeout=4000)
    assert "Thanks" in c.page.inner_text("#toast")
    rows = db("SELECT qid, text FROM feedback WHERE user_id=? ORDER BY id DESC", c.uid)
    assert rows and note in rows[0][1], "feedback not saved"
    deadline = time.time() + 6
    while time.time() < deadline and len(mail_log()) <= before: time.sleep(0.2)
    log = mail_log()
    assert len(log) > before, "no email was sent to the Wardology inbox"
    msg = log[-1]["body"]
    assert msg["to"] and msg["from"], "email missing to/from"
    assert rows[0][0] in msg["subject"], "subject should name the question ID"
    assert "Correction" in msg["subject"], "subject should say Correction"
    assert c.email in json.dumps(msg.get("reply_to") or msg.get("replyTo") or ""), "reply-to should be the user's email"
    assert "please check" in msg["text"], "email text missing the note"
    assert "<b>please check</b>" not in msg["html"], "user HTML was not escaped in the email"
    assert log[-1]["auth"] == "Bearer test-token", "API token not sent"

def t_fb_double_click(c):
    c.new_test(); open_fb(c)
    c.page.fill("#fbt", "double click test " + uuid.uuid4().hex[:6])
    n0 = db("SELECT COUNT(*) FROM feedback WHERE user_id=?", c.uid)[0][0]
    c.page.evaluate("() => { const b = document.querySelector('#fbs'); b.click(); b.click(); b.click(); }")
    c.page.wait_for_timeout(1500)
    n1 = db("SELECT COUNT(*) FROM feedback WHERE user_id=?", c.uid)[0][0]
    assert n1 - n0 == 1, f"{n1 - n0} copies saved"

def t_fb_typing_no_shortcuts(c):
    if c.touch: return "n/a (no keyboard)"
    c.new_test(); open_fb(c)
    c.page.click("#fbt"); c.page.keyboard.type("Mark this as hard; A B C h")
    assert c.page.input_value("#fbt").endswith("A B C h")
    assert c.page.locator("#tMark.on").count() == 0, "typing 'M' marked the question"
    assert c.page.locator("#choices .ch.sel").count() == 0, "typing A/B/C picked an answer"

def t_fb_mobile_fit(c):
    c.new_test(); open_fb(c)
    box = c.page.locator("#fbs").bounding_box(); vp = c.page.viewport_size
    assert box and box["y"] + box["height"] <= vp["height"] and box["x"] >= 0 and box["x"] + box["width"] <= vp["width"], f"Send button off-screen {box} {vp}"
    ta = c.page.locator("#fbt").bounding_box(); assert ta["width"] > 200, "textarea too narrow"

def t_fb_mail_down(c):
    """If the email provider fails, the note must still be saved and the user still thanked."""
    mail_mode("fail")
    try:
        c.new_test(); open_fb(c)
        note = "provider down test " + uuid.uuid4().hex[:6]
        c.page.fill("#fbt", note); c.click("#fbs")
        c.page.wait_for_selector("#toast:not([hidden])", timeout=4000)
        assert "Thanks" in c.page.inner_text("#toast")
        assert db("SELECT COUNT(*) FROM feedback WHERE text=?", note)[0][0] == 1
    finally:
        mail_mode("ok")

def t_api_fail_cases(c):
    rq = c.page.request
    assert rq.post("/api/qb/feedback", data={"qid": "NOPE-1", "text": "x"}).status == 400, "bad question id accepted"
    assert rq.post("/api/qb/feedback", data={"qid": "CV-001", "text": "   "}).status == 400, "blank text accepted"
    anon = c.browser.new_context(base_url=BASE)
    try:
        assert anon.request.post("/api/qb/feedback", data={"qid": "CV-001", "text": "hi"}).status == 401, "logged-out user could send"
    finally:
        anon.close()
    long = "x" * 9000
    assert rq.post("/api/qb/feedback", data={"qid": "CV-001", "text": long}).ok
    assert db("SELECT LENGTH(text) FROM feedback WHERE user_id=? ORDER BY id DESC LIMIT 1", c.uid)[0][0] <= 4000, "text not capped"

def t_api_rate_limit(c):
    rq = c.page.request
    codes = [rq.post("/api/qb/feedback", data={"qid": "CV-001", "text": f"spam {i}"}).status for i in range(25)]
    assert 429 in codes, f"no rate limit after 25 notes in a row: {codes}"

TESTS = [
    ("Highlight · toolbar button", t_toolbar_button),
    ("Highlight · pop-up after selecting (mouse / touch)", t_popup_after_select),
    ("Highlight · selection cleared by tap (mobile behaviour)", t_selection_lost_before_tap),
    ("Highlight · H key", t_keyboard_h),
    ("Highlight · across paragraphs / lab table", t_cross_block),
    ("Highlight · kept after next/prev and reload", t_persist),
    ("Highlight · tap/click removes it", t_remove),
    ("Highlight · in the explanation", t_explanation),
    ("Highlight FAIL case · nothing selected → hint, no mark", t_fail_no_selection),
    ("Highlight FAIL case · answer choices not highlightable", t_fail_outside),
    ("Feedback FAIL case · empty note rejected", t_fb_empty),
    ("Feedback · saved + email to Wardology inbox", t_fb_send_and_email),
    ("Feedback · double-tap sends once", t_fb_double_click),
    ("Feedback · typing does not trigger shortcuts", t_fb_typing_no_shortcuts),
    ("Feedback · dialog fits the screen", t_fb_mobile_fit),
    ("Feedback · email provider down → still saved", t_fb_mail_down),
    ("Feedback FAIL cases · bad ID / blank / logged out / too long", t_api_fail_cases),
    ("Feedback FAIL case · spam rate limit", t_api_rate_limit),
]

def main():
    results = {}
    with sync_playwright() as pw:
        for pname, engine, device in PLATFORMS:
            browser = getattr(pw, engine).launch()
            for tname, fn in TESTS:
                c = None
                try:
                    c = Ctx(pw, browser, device)
                    note = fn(c)
                    res = ("SKIP", note) if isinstance(note, str) else ("PASS", "")
                    if c.errors: res = ("FAIL", "JS error: " + c.errors[0])
                except Exception as e:
                    msg = str(e).strip().splitlines()[0][:200] if str(e).strip() else type(e).__name__
                    res = ("FAIL", msg)
                finally:
                    if c: c.close()
                results[(pname, tname)] = res
                if res[0] == "FAIL" and "Target" in res[1]:
                    browser = getattr(pw, engine).launch()
                print(f"{res[0]:4} | {pname[:38]:38} | {tname} {('— ' + res[1]) if res[1] else ''}", flush=True)
    fails = sum(1 for r in results.values() if r[0] == "FAIL")
    passes = sum(1 for r in results.values() if r[0] == "PASS")
    print(f"\n{passes} passed, {fails} failed, {len(results) - passes - fails} not applicable")
    json.dump({f"{k[0]} || {k[1]}": v for k, v in results.items()}, open("/tmp/qb_results.json", "w"), indent=1)
    sys.exit(1 if fails else 0)

main()
