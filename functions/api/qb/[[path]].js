// Wardology QBank API — Cloudflare Pages Function, D1 binding "DB".
// All routes live under /api/qb/...  Answers and explanations never leave the server
// until the question is graded (tutor: on submit; exam: when the test ends).
import BANK from "../../_lib/bank.json";

const Q = BANK.questions;          // id -> full question
const CATS = BANK.categories;      // [{key,name,emoji,target}]
const ALL_IDS = Object.keys(Q);
const SESSION_DAYS = 60;
const MAX_ITEMS = 60;              // ABIM: max 60 questions per session
const SEC_PER_Q = 120;             // ABIM pace: up to 2 h per 60-question session
const TERMS_VERSION = "2026-11-27"; // bump when /tools/terms or /tools/privacy change materially

// ---------- helpers ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const err = (msg, status = 400) => json({ error: msg }, status);
const now = () => Math.floor(Date.now() / 1000);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPw(pw, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return hex(bits);
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function cookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
// "Secure" on https (wardology.com); left off only for plain-http local testing, where Safari would refuse the cookie
let SECURE = "; Secure";
const sessionCookie = (token, maxAge) =>
  `qb_s=${token}; Path=/; HttpOnly${SECURE}; SameSite=Lax; Max-Age=${maxAge}`;

// ---------- feedback email (Cloudflare Email Sending REST API) ----------
// Pages project → Settings → Variables and Secrets:
//   CF_ACCOUNT_ID   your Cloudflare account ID                     (plain text)
//   CF_EMAIL_TOKEN  API token with "Email Sending: Edit"           (secret)
//   FEEDBACK_TO     where notes go, e.g. your Gmail (a verified Email Routing destination = free)
//   FEEDBACK_FROM   optional, default qbank@wardology.com (must be on wardology.com)
const FEEDBACK_KINDS = { correction: "✏️ Correction", suggestion: "💡 Suggestion", other: "💬 Other" };
const FEEDBACK_PER_HOUR = 20;
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function emailFeedback(env, f) {
  if (!env.CF_EMAIL_TOKEN || !env.CF_ACCOUNT_ID || !env.FEEDBACK_TO) return { ok: false, error: "email not configured" };
  const q = Q[f.qid] || {};
  const kind = FEEDBACK_KINDS[f.kind] || FEEDBACK_KINDS.other;
  const subject = `[Wardology QBank] ${kind.replace(/^\S+\s/, "")} · ${f.qid} · ${q.topic || ""}`.slice(0, 180);
  const lines = [
    `${kind} on question ${f.qid} (${q.cat || ""} · ${q.topic || ""})`, "",
    f.text, "",
    "—",
    `From: ${f.name || "(no name)"} <${f.email}>  (user #${f.uid})`,
    f.test_id ? `Test #${f.test_id} · ${f.mode || ""} mode · question ${f.idx || "?"} of the block` : "",
    `Feedback #${f.id} · ${new Date(f.at * 1000).toUTCString()}`,
    "Reply to this email to answer the user directly.",
  ].filter((x) => x !== "");
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f2a43">
    <p style="margin:0 0 6px"><b>${escH(kind)}</b> on question <b>${escH(f.qid)}</b><br><span style="color:#667">${escH(q.cat || "")} · ${escH(q.topic || "")}</span></p>
    <blockquote style="margin:12px 0;padding:10px 14px;border-left:4px solid #e4572e;background:#fff7f2;white-space:pre-wrap">${escH(f.text)}</blockquote>
    <p style="color:#667;font-size:13px;margin:0">From ${escH(f.name || "(no name)")} &lt;${escH(f.email)}&gt; · user #${f.uid}<br>
    ${f.test_id ? `Test #${escH(f.test_id)} · ${escH(f.mode || "")} mode · question ${escH(f.idx || "?")}<br>` : ""}Feedback #${f.id} · ${escH(new Date(f.at * 1000).toUTCString())}<br>Reply to this email to answer the user directly.</p></div>`;
  const url = env.EMAIL_API_URL || `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer " + env.CF_EMAIL_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({
        to: env.FEEDBACK_TO, from: { address: env.FEEDBACK_FROM || "qbank@wardology.com", name: "Wardology QBank" },
        reply_to: f.email, subject, text: lines.join("\n"), html,
      }),
    });
    if (r.ok) return { ok: true };
    return { ok: false, error: `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 300) };
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// what a student may see before grading
function publicQ(id) {
  const q = Q[id];
  if (!q) return null;
  return { id, cat: q.cat, stem_html: q.stem_html, lead: q.lead, choices: q.choices };
}
// full reveal
function revealQ(id) {
  const q = Q[id];
  return { id, cat: q.cat, topic: q.topic, task: q.task, answer: q.answer, explain_html: q.explain_html };
}
async function choiceStats(db, ids) {
  if (!ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rs = await db.prepare(`SELECT qid, choice, n FROM q_stats WHERE qid IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const r of rs.results) (out[r.qid] ||= {})[r.choice] = r.n;
  }
  const res = {};
  for (const id of ids) {
    const c = out[id] || {};
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    const pct = {};
    for (const k of Object.keys(Q[id].choices)) pct[k] = total ? Math.round((100 * (c[k] || 0)) / total) : null;
    res[id] = { total, pct };
  }
  return res;
}

async function getUser(req, db) {
  const t = cookie(req, "qb_s");
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return null;
  return db.prepare("SELECT u.id, u.email, u.name, u.terms_version FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?")
    .bind(t, now()).first();
}

// record one graded answer: user_q + first-attempt stats
async function recordGrade(db, uid, qid, choice) {
  const correct = choice ? (choice === Q[qid].answer ? 1 : 0) : null;
  const status = choice == null ? "omitted" : correct ? "correct" : "incorrect";
  const prev = await db.prepare("SELECT attempts FROM user_q WHERE user_id=? AND qid=?").bind(uid, qid).first();
  const stmts = [];
  if (!prev) {
    stmts.push(db.prepare("INSERT INTO user_q (user_id, qid, status, attempts, first_correct, updated_at) VALUES (?,?,?,?,?,?)")
      .bind(uid, qid, status, 1, correct, now()));
    if (choice) stmts.push(db.prepare("INSERT INTO q_stats (qid, choice, n) VALUES (?,?,1) ON CONFLICT(qid, choice) DO UPDATE SET n = n + 1").bind(qid, choice));
  } else {
    stmts.push(db.prepare("UPDATE user_q SET status=?, attempts=attempts+1, updated_at=? WHERE user_id=? AND qid=?").bind(status, now(), uid, qid));
  }
  await db.batch(stmts);
  return correct;
}

async function loadTest(db, uid, tid) {
  const t = await db.prepare("SELECT * FROM tests WHERE id=? AND user_id=?").bind(tid, uid).first();
  if (!t) return null;
  const items = (await db.prepare("SELECT * FROM test_items WHERE test_id=? ORDER BY idx").bind(tid).all()).results;
  return { t, items };
}

async function testPayload(db, t, items) {
  const revealedIds = items.filter((i) => i.revealed).map((i) => i.qid);
  const stats = await choiceStats(db, revealedIds);
  return {
    test: { id: t.id, mode: t.mode, timed: !!t.timed, time_limit: t.time_limit, elapsed: t.elapsed, status: t.status,
      current_idx: t.current_idx, created_at: t.created_at, finished_at: t.finished_at, categories: t.categories },
    items: items.map((i) => ({
      idx: i.idx, qid: i.qid, choice: i.choice, marked: !!i.marked, seconds: i.seconds, revealed: !!i.revealed,
      correct: i.revealed ? i.correct : null,
      q: publicQ(i.qid),
      reveal: i.revealed ? { ...revealQ(i.qid), stats: stats[i.qid] } : null,
    })),
  };
}

// ---------- routes ----------
export async function onRequest(ctx) {
  const { request: req, env, params } = ctx;
  const db = env.DB;
  if (!db) return err("Database not configured", 500);
  SECURE = new URL(req.url).protocol === "http:" ? "" : "; Secure";
  const path = (params.path || []).join("/");
  const method = req.method;
  let body = {};
  if (method === "POST") {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {
    // ----- auth -----
    if (path === "auth/signup" && method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim().slice(0, 80);
      const pw = String(body.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return err("Please enter a valid email.");
      if (pw.length < 8) return err("Password must be at least 8 characters.");
      if (body.agree !== true) return err("Please agree to the Terms of Use and Privacy Policy to create an account.");
      if (await db.prepare("SELECT id FROM users WHERE email=?").bind(email).first()) return err("An account with this email already exists. Log in instead.", 409);
      const salt = randHex(16);
      const h = await hashPw(pw, salt);
      const r = await db.prepare("INSERT INTO users (email, name, pw_hash, pw_salt, created_at, terms_version, terms_accepted_at) VALUES (?,?,?,?,?,?,?)").bind(email, name, h, salt, now(), TERMS_VERSION, now()).run();
      const uid = r.meta.last_row_id;
      const token = randHex(32);
      await db.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)").bind(token, uid, now() + SESSION_DAYS * 86400).run();
      return json({ ok: true, user: { id: uid, email, name } }, 200, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }
    if (path === "auth/login" && method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const u = await db.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
      if (!u || !safeEq(await hashPw(String(body.password || ""), u.pw_salt), u.pw_hash)) return err("Email or password is not correct.", 401);
      const token = randHex(32);
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id=? AND expires < ?").bind(u.id, now()),
        db.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)").bind(token, u.id, now() + SESSION_DAYS * 86400),
      ]);
      return json({ ok: true, user: { id: u.id, email: u.email, name: u.name } }, 200, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }
    if (path === "auth/logout" && method === "POST") {
      const t = cookie(req, "qb_s");
      if (t) await db.prepare("DELETE FROM sessions WHERE token=?").bind(t).run();
      return json({ ok: true }, 200, { "set-cookie": sessionCookie("x", 0) });
    }

    const user = await getUser(req, db);
    if (!user) return err("Please log in.", 401);
    const uid = user.id;

    if (path === "me" && method === "GET") {
      const { terms_version, ...u } = user;
      return json({ user: u, needs_terms: terms_version !== TERMS_VERSION, terms_version: TERMS_VERSION, bank: { total: ALL_IDS.length, categories: CATS } });
    }
    if (path === "terms/accept" && method === "POST") {
      await db.prepare("UPDATE users SET terms_version=?, terms_accepted_at=? WHERE id=?").bind(TERMS_VERSION, now(), uid).run();
      return json({ ok: true });
    }
    if (path === "account/delete" && method === "POST") {
      const u = await db.prepare("SELECT * FROM users WHERE id=?").bind(uid).first();
      if (!safeEq(await hashPw(String(body.password || ""), u.pw_salt), u.pw_hash)) return err("Password is not correct.", 401);
      await db.batch([
        db.prepare("DELETE FROM test_items WHERE test_id IN (SELECT id FROM tests WHERE user_id=?)").bind(uid),
        db.prepare("DELETE FROM tests WHERE user_id=?").bind(uid),
        db.prepare("DELETE FROM user_q WHERE user_id=?").bind(uid),
        db.prepare("DELETE FROM feedback WHERE user_id=?").bind(uid),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(uid),
        db.prepare("DELETE FROM users WHERE id=?").bind(uid),
      ]);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie("x", 0) });
    }

    // counts per category for the Create Test screen
    if (path === "pools" && method === "GET") {
      const rows = (await db.prepare("SELECT qid, status, marked FROM user_q WHERE user_id=?").bind(uid).all()).results;
      const uq = Object.fromEntries(rows.map((r) => [r.qid, r]));
      const pools = {};
      for (const c of CATS) pools[c.key] = { all: 0, unused: 0, incorrect: 0, marked: 0, omitted: 0, correct: 0 };
      for (const id of ALL_IDS) {
        const p = pools[Q[id].cat];
        if (!p) continue;
        p.all++;
        const r = uq[id];
        if (!r) p.unused++;
        else {
          p[r.status]++;
          if (r.marked) p.marked++;
        }
      }
      return json({ pools });
    }

    // create a test
    if (path === "tests" && method === "POST") {
      const mode = body.mode === "exam" ? "exam" : "tutor";
      const timed = mode === "exam" ? 1 : body.timed ? 1 : 0;
      const cats = Array.isArray(body.categories) && body.categories.length ? body.categories : CATS.map((c) => c.key);
      const pools = Array.isArray(body.pools) && body.pools.length ? body.pools : ["unused"];
      const n = Math.max(1, Math.min(MAX_ITEMS, parseInt(body.count) || 20));
      const rows = (await db.prepare("SELECT qid, status, marked FROM user_q WHERE user_id=?").bind(uid).all()).results;
      const uq = Object.fromEntries(rows.map((r) => [r.qid, r]));
      const pick = ALL_IDS.filter((id) => {
        if (!cats.includes(Q[id].cat)) return false;
        const r = uq[id];
        return pools.some((p) => (p === "all") || (p === "unused" && !r) || (r && p === "marked" && r.marked) ||
          (r && (p === "incorrect" || p === "omitted" || p === "correct") && r.status === p));
      });
      if (!pick.length) return err("No questions match these filters. Try other subjects or include used questions.");
      const chosen = shuffle(pick).slice(0, n);
      const limit = timed ? chosen.length * SEC_PER_Q : 0;
      const r = await db.prepare("INSERT INTO tests (user_id, mode, timed, time_limit, categories, created_at) VALUES (?,?,?,?,?,?)")
        .bind(uid, mode, timed, limit, cats.join(","), now()).run();
      const tid = r.meta.last_row_id;
      await db.batch(chosen.map((qid, i) => db.prepare("INSERT INTO test_items (test_id, idx, qid, marked) VALUES (?,?,?,?)")
        .bind(tid, i, qid, uq[qid] && uq[qid].marked ? 1 : 0)));
      return json({ id: tid });
    }

    // list tests
    if (path === "tests" && method === "GET") {
      const rs = (await db.prepare(`SELECT t.*, COUNT(i.idx) AS n, SUM(CASE WHEN i.correct=1 THEN 1 ELSE 0 END) AS nc,
        SUM(CASE WHEN i.revealed=1 THEN 1 ELSE 0 END) AS nr
        FROM tests t LEFT JOIN test_items i ON i.test_id=t.id WHERE t.user_id=? GROUP BY t.id ORDER BY t.id DESC LIMIT 500`).bind(uid).all()).results;
      return json({ tests: rs.map((t) => ({ id: t.id, mode: t.mode, timed: !!t.timed, status: t.status, n: t.n, correct: t.nc || 0,
        graded: t.nr || 0, created_at: t.created_at, finished_at: t.finished_at, categories: t.categories })) });
    }

    let m;
    if ((m = path.match(/^tests\/(\d+)(?:\/(\w+))?$/))) {
      const tid = parseInt(m[1]);
      const action = m[2] || "";
      const L = await loadTest(db, uid, tid);
      if (!L) return err("Test not found.", 404);
      const { t, items } = L;
      const item = (idx) => items.find((i) => i.idx === idx);

      if (!action && method === "GET") return json(await testPayload(db, t, items));

      if (action === "progress" && method === "POST") {
        // autosave: position, clock, time on current question, unsubmitted choice
        const stmts = [db.prepare("UPDATE tests SET current_idx=?, elapsed=?, status=CASE WHEN status='done' THEN 'done' ELSE 'active' END WHERE id=?")
          .bind(Math.max(0, parseInt(body.idx) || 0), Math.max(0, parseInt(body.elapsed) || 0), tid)];
        if (Array.isArray(body.seconds)) for (const s of body.seconds.slice(0, MAX_ITEMS))
          stmts.push(db.prepare("UPDATE test_items SET seconds=? WHERE test_id=? AND idx=?").bind(Math.max(0, parseInt(s[1]) || 0), tid, parseInt(s[0])));
        await db.batch(stmts);
        return json({ ok: true });
      }

      if (action === "mark" && method === "POST") {
        const it = item(parseInt(body.idx));
        if (!it) return err("No such question.");
        const mk = body.marked ? 1 : 0;
        await db.batch([
          db.prepare("UPDATE test_items SET marked=? WHERE test_id=? AND idx=?").bind(mk, tid, it.idx),
          db.prepare("UPDATE user_q SET marked=? WHERE user_id=? AND qid=?").bind(mk, uid, it.qid),
        ]);
        return json({ ok: true });
      }

      if (action === "answer" && method === "POST") {
        if (t.status === "done") return err("This test is finished.");
        const it = item(parseInt(body.idx));
        if (!it) return err("No such question.");
        const choice = String(body.choice || "");
        if (!(choice in Q[it.qid].choices)) return err("Pick an answer first.");
        if (t.mode === "tutor") {
          if (it.revealed) return err("Already answered.");
          const correct = await recordGrade(db, uid, it.qid, choice);
          await db.prepare("UPDATE test_items SET choice=?, first_choice=?, correct=?, revealed=1, seconds=? WHERE test_id=? AND idx=?")
            .bind(choice, choice, correct, Math.max(0, parseInt(body.seconds) || it.seconds), tid, it.idx).run();
          if (it.marked) await db.prepare("UPDATE user_q SET marked=1 WHERE user_id=? AND qid=?").bind(uid, it.qid).run();
          const stats = await choiceStats(db, [it.qid]);
          return json({ correct: !!correct, reveal: { ...revealQ(it.qid), stats: stats[it.qid] } });
        }
        // exam mode: save only, grade at the end
        await db.prepare("UPDATE test_items SET choice=?, first_choice=COALESCE(first_choice, ?), seconds=? WHERE test_id=? AND idx=?")
          .bind(choice, choice, Math.max(0, parseInt(body.seconds) || it.seconds), tid, it.idx).run();
        return json({ ok: true, saved: true });
      }

      if (action === "suspend" && method === "POST") {
        await db.prepare("UPDATE tests SET status='suspended', current_idx=?, elapsed=? WHERE id=? AND status!='done'")
          .bind(parseInt(body.idx) || 0, parseInt(body.elapsed) || 0, tid).run();
        return json({ ok: true });
      }

      if (action === "end" && method === "POST") {
        if (t.status !== "done") {
          for (const it of items) {
            if (it.revealed) continue;
            const correct = await recordGrade(db, uid, it.qid, it.choice || null);
            await db.prepare("UPDATE test_items SET correct=?, revealed=1 WHERE test_id=? AND idx=?").bind(correct, tid, it.idx).run();
            if (it.marked) await db.prepare("UPDATE user_q SET marked=1 WHERE user_id=? AND qid=?").bind(uid, it.qid).run();
          }
          await db.prepare("UPDATE tests SET status='done', finished_at=?, elapsed=MAX(elapsed, ?) WHERE id=?")
            .bind(now(), parseInt(body.elapsed) || 0, tid).run();
        }
        const L2 = await loadTest(db, uid, tid);
        return json(await testPayload(db, L2.t, L2.items));
      }
      return err("Unknown test action.", 404);
    }

    if (path === "feedback" && method === "POST") {
      const qid = String(body.qid || "");
      const text = String(body.text || "").trim().slice(0, 4000);
      if (!Q[qid]) return err("This question could not be found. Reload the page and try again.");
      if (!text) return err("Write your feedback first.");
      const kind = FEEDBACK_KINDS[body.kind] ? body.kind : "other";
      const recent = await db.prepare("SELECT COUNT(*) n FROM feedback WHERE user_id=? AND created_at > ?").bind(uid, now() - 3600).first();
      if (recent && recent.n >= FEEDBACK_PER_HOUR) return err("Thanks for all the notes! Please wait a little before sending more.", 429);
      const at = now();
      let r, tracked = true;
      try { r = await db.prepare("INSERT INTO feedback (user_id, qid, text, created_at, kind) VALUES (?,?,?,?,?)").bind(uid, qid, text, at, kind).run(); }
      catch (e) {  // database not migrated yet (qbank/migrations/0002) — still keep the note
        if (!/no (such )?column/i.test(String(e && e.message))) throw e;
        tracked = false;
        r = await db.prepare("INSERT INTO feedback (user_id, qid, text, created_at) VALUES (?,?,?,?)").bind(uid, qid, `[${kind}] ${text}`, at).run();
      }
      const f = { id: r.meta.last_row_id, uid, email: user.email, name: user.name, qid, text, kind, at,
        test_id: parseInt(body.test_id) || null, mode: body.mode === "exam" ? "exam" : body.mode === "tutor" ? "tutor" : "", idx: parseInt(body.idx) || null };
      // send after replying, so a slow or failing mail service never blocks or loses the note
      const send = emailFeedback(env, f).then((res) => {
        if (!res.ok) console.log("feedback email not sent:", f.id, res.error);
        return tracked && db.prepare("UPDATE feedback SET emailed=?, email_error=? WHERE id=?").bind(res.ok ? 1 : 0, res.ok ? null : res.error, f.id).run();
      }).catch(() => {});
      if (ctx.waitUntil) ctx.waitUntil(send); else await send;
      return json({ ok: true });
    }

    // performance: overall, by subject/task, per-test graph, answer changes, percentile
    if (path === "performance" && method === "GET") {
      const uq = (await db.prepare("SELECT qid, status, first_correct FROM user_q WHERE user_id=?").bind(uid).all()).results;
      const tally = (rows) => {
        const o = { used: rows.length, correct: 0, incorrect: 0, omitted: 0 };
        for (const r of rows) o[r.status]++;
        return o;
      };
      const overall = tally(uq);
      const by = (keyFn, keys) => {
        const g = Object.fromEntries(keys.map((k) => [k, []]));
        for (const r of uq) { const k = keyFn(Q[r.qid] || {}); if (g[k]) g[k].push(r); }
        return keys.map((k) => ({ key: k, total: ALL_IDS.filter((id) => keyFn(Q[id]) === k).length, ...tally(g[k]) }));
      };
      const subjects = by((q) => q.cat, CATS.map((c) => c.key));
      const tasks = by((q) => q.task, [...new Set(ALL_IDS.map((id) => Q[id].task))]);

      const changes = (await db.prepare(`SELECT i.qid, i.first_choice, i.choice FROM test_items i JOIN tests t ON t.id=i.test_id
        WHERE t.user_id=? AND t.mode='exam' AND i.revealed=1 AND i.first_choice IS NOT NULL AND i.first_choice != i.choice`).bind(uid).all()).results;
      const ch = { c2i: 0, i2c: 0, i2i: 0 };
      for (const r of changes) {
        const a = Q[r.qid] && Q[r.qid].answer;
        if (r.first_choice === a) ch.c2i++; else if (r.choice === a) ch.i2c++; else ch.i2i++;
      }
      const tests = (await db.prepare(`SELECT t.id, t.created_at, t.status, COUNT(i.idx) n, SUM(CASE WHEN i.correct=1 THEN 1 ELSE 0 END) nc,
        SUM(CASE WHEN i.revealed=1 THEN 1 ELSE 0 END) nr FROM tests t JOIN test_items i ON i.test_id=t.id WHERE t.user_id=? GROUP BY t.id ORDER BY t.id`).bind(uid).all()).results;
      const counts = await db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done, SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END) susp FROM tests WHERE user_id=?").bind(uid).first();

      // percentile rank among users with >= 10 graded questions (first attempts)
      const peers = (await db.prepare(`SELECT user_id, AVG(first_correct)*100.0 pct, COUNT(*) n FROM user_q
        WHERE first_correct IS NOT NULL GROUP BY user_id HAVING COUNT(*) >= 10`).all()).results;
      const mine = uq.filter((r) => r.first_correct != null);
      const myPct = mine.length ? (100 * mine.filter((r) => r.first_correct === 1).length) / mine.length : null;
      let rank = null, median = null;
      if (myPct != null && mine.length >= 10 && peers.length >= 5) {
        const below = peers.filter((p) => p.pct < myPct).length, eq = peers.filter((p) => p.pct === myPct).length;
        rank = Math.round((100 * (below + eq / 2)) / peers.length);
        const s = peers.map((p) => p.pct).sort((a, b) => a - b);
        median = Math.round(s[Math.floor(s.length / 2)]);
      }
      // average of OTHER users per test (same questions, first attempts; this user's own first attempt removed)
      const mineFirst = Object.fromEntries(uq.map((r) => [r.qid, r.first_correct]));
      const graph = [];
      for (const t of tests.filter((x) => x.nr > 0).slice(-40)) {
        const ids = (await db.prepare("SELECT qid FROM test_items WHERE test_id=? AND revealed=1").bind(t.id).all()).results.map((r) => r.qid);
        const st = await choiceStats(db, ids);
        let tot = 0, cor = 0;
        for (const id of ids) {
          const s = st[id]; if (!s.total) continue;
          let n = s.total, c = Math.round(((s.pct[Q[id].answer] || 0) * s.total) / 100);
          if (mineFirst[id] != null) { n -= 1; c -= mineFirst[id]; }
          if (n <= 0) continue;
          tot += n; cor += Math.max(0, c);
        }
        graph.push({ id: t.id, at: t.created_at, score: Math.round((100 * (t.nc || 0)) / Math.max(1, t.nr)), others: tot ? Math.round((100 * cor) / tot) : null });
      }
      return json({ overall, total: ALL_IDS.length, subjects, tasks, changes: ch, tests: { created: counts.n || 0, completed: counts.done || 0, suspended: counts.susp || 0 },
        percentile: { rank, median, mine: myPct == null ? null : Math.round(myPct), peers: peers.length }, graph, categories: CATS });
    }

    // search within questions this user has already seen
    if (path === "search" && method === "GET") {
      const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
      if (q.length < 2) return json({ results: [] });
      const used = (await db.prepare("SELECT qid, status FROM user_q WHERE user_id=?").bind(uid).all()).results;
      const res = [];
      for (const r of used) {
        const x = Q[r.qid];
        if (!x) continue;
        const hay = x.search;
        const i = hay.indexOf(q);
        if (i >= 0) res.push({ qid: r.qid, status: r.status, cat: x.cat, topic: x.topic, snippet: x.plain.slice(Math.max(0, i - 60), i + 140) });
        if (res.length >= 100) break;
      }
      return json({ results: res });
    }

    // review a single question the user has already answered
    if ((m = path.match(/^q\/([\w-]+)$/)) && method === "GET") {
      const qid = m[1];
      const r = await db.prepare("SELECT status, marked FROM user_q WHERE user_id=? AND qid=?").bind(uid, qid).first();
      if (!r || !Q[qid]) return err("You can review a question after you have answered it.", 403);
      const last = await db.prepare(`SELECT i.choice FROM test_items i JOIN tests t ON t.id=i.test_id WHERE t.user_id=? AND i.qid=? AND i.revealed=1 ORDER BY t.id DESC LIMIT 1`).bind(uid, qid).first();
      const stats = await choiceStats(db, [qid]);
      return json({ q: publicQ(qid), reveal: { ...revealQ(qid), stats: stats[qid] }, choice: last ? last.choice : null, status: r.status, marked: !!r.marked });
    }

    if (path === "reset" && method === "POST") {
      if (body.confirm !== "RESET") return err("Type RESET to confirm.");
      await db.batch([
        db.prepare("DELETE FROM test_items WHERE test_id IN (SELECT id FROM tests WHERE user_id=?)").bind(uid),
        db.prepare("DELETE FROM tests WHERE user_id=?").bind(uid),
        db.prepare("DELETE FROM user_q WHERE user_id=?").bind(uid),
      ]);
      return json({ ok: true });
    }

    if (path === "account/password" && method === "POST") {
      const u = await db.prepare("SELECT * FROM users WHERE id=?").bind(uid).first();
      if (!safeEq(await hashPw(String(body.old || ""), u.pw_salt), u.pw_hash)) return err("Current password is not correct.", 401);
      if (String(body.password || "").length < 8) return err("New password must be at least 8 characters.");
      const salt = randHex(16);
      await db.prepare("UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?").bind(await hashPw(String(body.password), salt), salt, uid).run();
      return json({ ok: true });
    }

    return err("Not found.", 404);
  } catch (e) {
    return err("Server error: " + (e && e.message ? e.message : String(e)), 500);
  }
}
