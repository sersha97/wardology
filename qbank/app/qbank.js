/* Wardology QBank — single-page app. Talks to /api/qb/* (Cloudflare Pages Functions + D1). */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const app = $("#app");
  let _lg = 0;
  const logo = () => { const id = "qwg" + (++_lg); return LOGO_T.replace(/qwg/g, id); };
  const LOGO_T = '<svg class="wl" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="qwg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4572e"/><stop offset=".45" stop-color="#b5324b"/><stop offset="1" stop-color="#0f2a43"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#qwg)"/><path d="M7 19H13L22 47L32 25L42 47L51 19" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="56.5" cy="19" r="3.4" fill="#f2b134"/></svg>';
  const S = { user: null, bank: null, cats: {} };
  const TASK_SHORT = { "Diagnosis/Testing": "Diagnosis & testing", "Treatment/Care Decisions": "Treatment & care", "Risk Assessment/Prognosis/Epidemiology": "Risk & prognosis", "Pathophysiology/Basic Science": "Pathophysiology" };

  async function api(path, body, method) {
    const opt = { method: method || (body ? "POST" : "GET"), headers: {}, credentials: "same-origin" };
    if (body) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    const r = await fetch("/api/qb/" + path, opt);
    let d = {};
    try { d = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(d.error || "Something went wrong (" + r.status + ")"); e.status = r.status; throw e; }
    return d;
  }
  function toast(msg, ms = 2600) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  function modal(html, onReady) {
    const m = $("#modal"); m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false;
    const close = () => { m.hidden = true; m.innerHTML = ""; };
    m.onclick = (e) => { if (e.target === m) close(); };
    $$("[data-close]", m).forEach((b) => (b.onclick = close));
    onReady && onReady(m, close);
    return close;
  }
  const confirmBox = (title, text, okLabel = "OK", danger = false) => new Promise((res) => {
    modal(`<h3>${title}</h3><p class="muted">${text}</p><div class="acts"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? "accent" : ""}" id="ok">${okLabel}</button></div>`,
      (m, close) => { $("#ok", m).onclick = () => { close(); res(true); }; $$("[data-close]", m).forEach((b) => b.addEventListener("click", () => res(false))); });
  });
  const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const fmtDate = (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const catName = (k) => (S.cats[k] ? S.cats[k].emoji + " " + S.cats[k].name : k);

  // ---------- theme & font ----------
  function cycleTheme() {
    const cur = document.documentElement.dataset.theme || "auto";
    const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
    if (next === "auto") { delete document.documentElement.dataset.theme; localStorage.removeItem("qb_theme"); }
    else { document.documentElement.dataset.theme = next; localStorage.setItem("qb_theme", next); }
    toast("Theme: " + (next === "auto" ? "follows your device" : next === "light" ? "day" : "night"));
  }
  function cycleFont() {
    const sizes = [15, 17, 19, 21];
    const cur = parseInt(localStorage.getItem("qb_font") || "17");
    const next = sizes[(sizes.indexOf(cur) + 1) % sizes.length];
    localStorage.setItem("qb_font", next);
    document.documentElement.style.setProperty("--qfs", next + "px");
  }

  // ---------- boot & routing ----------
  async function boot() {
    try { const me = await api("me"); S.user = me.user; setBank(me.bank); }
    catch (e) { if (e.status !== 401) { app.innerHTML = `<div class="auth"><div class="authcard"><h1>QBank is offline</h1><p class="sub">${esc(e.message)}</p><a class="btn" href="/">Back to Wardology</a></div></div>`; return; } }
    window.addEventListener("hashchange", route);
    route();
  }
  function setBank(b) { S.bank = b; S.cats = Object.fromEntries(b.categories.map((c) => [c.key, c])); }
  function route() {
    stopRunner();
    const h = (location.hash.slice(1) || "/home").split("/").filter(Boolean);
    if (!S.user) return renderAuth();
    const [v, a, b] = h;
    if (v === "test" && a) return openRunner(parseInt(a), b != null ? parseInt(b) : null);
    const views = { home: viewHome, create: viewCreate, tests: viewTests, results: () => viewResults(parseInt(a)), overall: viewOverall,
      reports: viewReports, graphs: viewGraphs, search: viewSearch, q: () => viewQuestion(a), account: viewAccount };
    (views[v] || viewHome)();
  }

  // ---------- auth ----------
  function renderAuth(tab = "signup") {
    app.innerHTML = `<div class="auth"><div class="authcard">
      ${logo()}<h1>Wardology <span>QBank</span></h1>
      <p class="sub">Free ABIM Internal Medicine board prep, built on the ABIM Certification Examination blueprint.</p>
      <div class="authtabs"><button data-t="signup" class="${tab === "signup" ? "on" : ""}">Create account</button><button data-t="login" class="${tab === "login" ? "on" : ""}">Log in</button></div>
      <form id="af">
        ${tab === "signup" ? '<label class="f" for="nm">Name</label><input id="nm" type="text" autocomplete="name" placeholder="Dr. Jane Doe">' : ""}
        <label class="f" for="em">Email</label><input id="em" type="email" autocomplete="email" required>
        <label class="f" for="pw">Password</label><input id="pw" type="password" autocomplete="${tab === "signup" ? "new-password" : "current-password"}" minlength="8" required>
        <button class="btn accent" type="submit">${tab === "signup" ? "Create free account" : "Log in"}</button>
        <div class="err" id="aerr"></div>
      </form>
      <ul class="feat"><li>📝 Tutor and ABIM-style timed exam blocks</li><li>📊 Your score, percentile and weak spots by subject</li><li>📚 Every explanation links to the Wardology library</li></ul>
      <p class="kbd" style="margin-top:14px"><a href="/">← Back to the Wardology library</a></p>
    </div></div>`;
    $$(".authtabs button").forEach((b) => (b.onclick = () => renderAuth(b.dataset.t)));
    $("#af").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#af .btn"); btn.disabled = true; $("#aerr").textContent = "";
      try {
        const d = await api("auth/" + tab, { email: $("#em").value, password: $("#pw").value, name: tab === "signup" ? $("#nm").value : undefined });
        S.user = d.user; const me = await api("me"); setBank(me.bank);
        if (!location.hash) location.hash = "#/home"; route();
      } catch (er) { $("#aerr").textContent = er.message; btn.disabled = false; }
    };
  }

  // ---------- shell ----------
  const NAV = [
    ["home", "🏠", "Welcome"], ["create", "📝", "Create test"], ["tests", "🗂️", "Previous tests"],
    ["overall", "📈", "Performance", [["overall", "Overall"], ["reports", "Reports"], ["graphs", "Graphs"]]],
    ["search", "🔍", "Search"], ["account", "👤", "My account"],
  ];
  function shell(active, title, body, right = "") {
    const isOn = (k) => k === active || (k === "overall" && ["overall", "reports", "graphs"].includes(active));
    const nav = NAV.map(([k, ico, lab, sub]) => `<a href="#/${k}" class="${isOn(k) && !sub ? "on" : ""}"><span class="ico">${ico}</span>${lab}</a>` +
      (sub ? `<div class="sub">${sub.map(([sk, sl]) => `<a href="#/${sk}" class="${active === sk ? "on" : ""}">${sl}</a>`).join("")}</div>` : "")).join("");
    app.innerHTML = `<div class="shell">
      <aside class="side"><a class="brandq" href="#/home">${logo()}<span><b>QBank</b><small>Wardology · ABIM IM</small></span></a>
        <nav class="nav">${nav}</nav><div class="spacer"></div>
        <div class="who">Signed in as <b>${esc(S.user.name || S.user.email)}</b><br><a href="/">📚 Wardology library</a> · <a href="#" id="lo">Log out</a></div></aside>
      <main class="content"><div class="mobtop">${logo()}<b>QBank</b><span class="muted" style="margin-left:auto;font-size:13px"><a href="/">Library</a></span></div>
        <div class="ptitle"><h1>${title}</h1><div class="right">${right}</div></div>${body}</main>
      <nav class="mobbar">${[["home", "🏠", "Home"], ["create", "📝", "New test"], ["tests", "🗂️", "Tests"], ["overall", "📈", "Stats"], ["search", "🔍", "Search"], ["account", "👤", "Me"]]
        .map(([k, i, l]) => `<a href="#/${k}" class="${isOn(k) ? "on" : ""}"><span>${i}</span>${l}</a>`).join("")}</nav></div>`;
    $("#lo").onclick = async (e) => { e.preventDefault(); await api("auth/logout", {}); S.user = null; location.hash = ""; renderAuth("login"); };
    window.scrollTo(0, 0);
  }
  const loading = (active, title) => shell(active, title, '<div class="card"><div class="spin" style="margin:30px auto"></div></div>');

  // ---------- welcome ----------
  async function viewHome() {
    loading("home", "Welcome");
    const [perf, tl] = await Promise.all([api("performance"), api("tests")]);
    const o = perf.overall;
    const open = tl.tests.find((t) => t.status !== "done");
    const first = (S.user.name || "").split(" ")[0];
    const cats = S.bank.categories.map((c) => `<div class="bp"><span class="e">${c.emoji}</span><span class="n">${esc(c.name)}</span><span class="c">${c.count} Qs · ${c.target}%</span></div>`).join("");
    shell("home", "Welcome", `
      <section class="hero"><h1>Hi${first ? " " + esc(first) : ""} — ready for a <span>block</span>?</h1>
        <p>${S.bank.total} original questions mapped to the ABIM Internal Medicine Certification blueprint. Tutor mode teaches as you go; exam mode runs like the real thing: up to 60 questions, 2 minutes each.</p>
        <div class="row"><a class="btn accent" href="#/create">📝 Create a test</a>${open ? `<a class="btn" href="#/test/${open.id}">▶️ Resume test #${open.id}</a>` : ""}</div></section>
      <div class="kpis">
        <div class="kpi"><small>Answered</small><b>${o.used}</b> <span class="muted">/ ${perf.total}</span></div>
        <div class="kpi"><small>Correct</small><b>${pct(o.correct, o.used)}%</b></div>
        <div class="kpi"><small>Percentile</small><b>${perf.percentile.rank != null ? perf.percentile.rank + "th" : "—"}</b></div>
        <div class="kpi"><small>Tests</small><b>${perf.tests.completed}</b> <span class="muted">done</span></div>
      </div>
      <div class="card"><h2>🧭 Blueprint coverage</h2><p class="muted" style="margin-top:-6px;font-size:14px">Question share follows the ABIM Internal Medicine Certification Examination blueprint — common problems first, plus the rarer conditions and specialist-level decisions the certification exam expects you to know.</p><div class="bpgrid">${cats}</div></div>
      <div class="card"><h2>⌨️ Shortcuts in a test</h2><p class="kbd">A–F choose · Enter submit · ← → previous / next · M mark · H highlight selected text · Right-click a choice to cross it out</p></div>`);
  }

  // ---------- create test ----------
  async function viewCreate() {
    loading("create", "Create test");
    const { pools } = await api("pools");
    const st = JSON.parse(localStorage.getItem("qb_create") || "{}");
    let mode = st.mode || "tutor", timed = !!st.timed, poolSel = st.pools || ["unused"], cats = st.cats || S.bank.categories.map((c) => c.key), count = st.count || 20;
    const POOLS = [["unused", "Unused"], ["incorrect", "Incorrect"], ["marked", "Marked"], ["omitted", "Omitted"], ["correct", "Correct"]];
    const avail = (k) => { const p = pools[k] || {}; return poolSel.reduce((a, s) => a + (s === "marked" ? 0 : p[s] || 0), 0) + (poolSel.includes("marked") ? Math.max(0, (p.marked || 0)) : 0); };
    const draw = () => {
      const total = cats.reduce((a, k) => a + avail(k), 0);
      shell("create", "Create test", `
        <div class="card"><h2>Mode</h2>
          <div class="seg" id="mode"><button data-m="tutor" class="${mode === "tutor" ? "on" : ""}">🧑‍🏫 Tutor</button><button data-m="exam" class="${mode === "exam" ? "on" : ""}">⏱️ Exam (ABIM-style)</button></div>
          ${mode === "tutor" ? `<label class="chk" style="display:inline-flex;margin-left:10px"><input type="checkbox" id="timed" ${timed ? "checked" : ""}> Timed (2 min / question)</label>` : ""}
          <p class="modehelp">${mode === "tutor" ? "See the answer, peer statistics and the full explanation right after each question." :
            "Like the real ABIM session: up to 60 questions, 2 minutes per question, change answers freely, explanations appear when you end the block. A block cannot be reopened once it ends."}</p></div>
        <div class="card"><h2>Question pool</h2><div class="pools">${POOLS.map(([k, l]) => {
          const n = Object.values(pools).reduce((a, p) => a + (p[k] || 0), 0);
          return `<label class="chk ${n ? "" : "dis"}"><input type="checkbox" data-p="${k}" ${poolSel.includes(k) ? "checked" : ""}> ${l}<span class="cnt">${n}</span></label>`; }).join("")}</div></div>
        <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">Subjects</h2><label class="chk" style="margin-left:auto"><input type="checkbox" id="allc" ${cats.length === S.bank.categories.length ? "checked" : ""}> All subjects</label></div>
          <div class="subjgrid">${S.bank.categories.map((c) => { const n = avail(c.key);
            return `<label class="chk ${n ? "" : "dis"}"><input type="checkbox" data-c="${c.key}" ${cats.includes(c.key) ? "checked" : ""}> ${c.emoji} ${esc(c.name)}<span class="cnt">${n}</span></label>`; }).join("")}</div></div>
        <div class="card"><h2>Number of questions</h2><div class="row"><input class="numin" type="number" id="cnt" min="1" max="60" value="${Math.min(count, 60)}">
          <span class="muted">Max 60 per block · ${total} available</span><button class="btn accent" id="go" style="margin-left:auto" ${total ? "" : "disabled"}>Generate test →</button></div><div class="err" id="cerr"></div></div>`);
      $$("#mode button").forEach((b) => (b.onclick = () => { mode = b.dataset.m; save(); draw(); }));
      $("#timed") && ($("#timed").onchange = (e) => { timed = e.target.checked; save(); });
      $$("[data-p]").forEach((i) => (i.onchange = () => { poolSel = $$("[data-p]").filter((x) => x.checked).map((x) => x.dataset.p); save(); draw(); }));
      $$("[data-c]").forEach((i) => (i.onchange = () => { cats = $$("[data-c]").filter((x) => x.checked).map((x) => x.dataset.c); save(); draw(); }));
      $("#allc").onchange = (e) => { cats = e.target.checked ? S.bank.categories.map((c) => c.key) : []; save(); draw(); };
      $("#cnt").onchange = (e) => { count = Math.max(1, Math.min(60, parseInt(e.target.value) || 20)); save(); };
      $("#go").onclick = async () => {
        count = Math.max(1, Math.min(60, parseInt($("#cnt").value) || 20)); save();
        if (!poolSel.length) return ($("#cerr").textContent = "Pick at least one question pool.");
        if (!cats.length) return ($("#cerr").textContent = "Pick at least one subject.");
        $("#go").disabled = true;
        try { const d = await api("tests", { mode, timed, pools: poolSel, categories: cats, count }); location.hash = "#/test/" + d.id; }
        catch (e) { $("#cerr").textContent = e.message; $("#go").disabled = false; }
      };
    };
    const save = () => localStorage.setItem("qb_create", JSON.stringify({ mode, timed, pools: poolSel, cats, count }));
    draw();
  }

  // ---------- previous tests ----------
  async function viewTests() {
    loading("tests", "Previous tests");
    const { tests } = await api("tests");
    if (!tests.length) return shell("tests", "Previous tests", `<div class="card empty">No tests yet.<br><br><a class="btn accent" href="#/create">📝 Create your first test</a></div>`);
    const rows = tests.map((t) => {
      const st = t.status === "done" ? '<span class="pill done">Done</span>' : t.status === "suspended" ? '<span class="pill susp">Suspended</span>' : '<span class="pill act">In progress</span>';
      const sc = t.graded ? pct(t.correct, t.n) + "%" : "—";
      const subj = t.categories.split(",").length >= S.bank.categories.length ? "All subjects" : t.categories.split(",").map((k) => (S.cats[k] ? S.cats[k].emoji : "")).join(" ");
      const act = t.status === "done" ? `<a class="btn small ghost" href="#/results/${t.id}">Results</a> <a class="btn small" href="#/test/${t.id}">Review</a>` : `<a class="btn small accent" href="#/test/${t.id}">Resume</a>`;
      return `<tr><td><b>#${t.id}</b></td><td>${fmtDate(t.created_at)}</td><td>${t.mode === "exam" ? "⏱️ Exam" : "🧑‍🏫 Tutor" + (t.timed ? " · timed" : "")}</td><td>${subj}</td><td>${t.n}</td><td><b>${sc}</b></td><td>${st}</td><td style="white-space:nowrap">${act}</td></tr>`;
    }).join("");
    shell("tests", "Previous tests", `<div class="card tblwrap"><table class="tbl"><thead><tr><th>Test</th><th>Date</th><th>Mode</th><th>Subjects</th><th>Qs</th><th>Score</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`,
      `<a class="btn accent small" href="#/create">📝 New test</a>`);
  }

  // ---------- results ----------
  async function viewResults(id) {
    loading("tests", "Test results");
    const d = await api("tests/" + id);
    const items = d.items, n = items.length;
    const c = items.filter((i) => i.correct === 1).length, om = items.filter((i) => i.revealed && !i.choice).length;
    const rows = items.map((i) => {
      const s = i.reveal && i.reveal.stats;
      const others = s && s.total ? (s.pct[i.reveal.answer] ?? 0) + "%" : "—";
      const mk = !i.revealed ? "•" : !i.choice ? '<span class="muted">—</span>' : i.correct ? '<span class="ok">✓</span>' : '<span class="no">✗</span>';
      return `<tr><td style="font-size:18px;font-weight:800">${mk}</td><td><a href="#/test/${id}/${i.idx}">Q${i.idx + 1}</a> ${i.marked ? "🚩" : ""}</td><td>${catName(i.q.cat)}</td><td>${esc(i.reveal ? i.reveal.topic : "")}</td><td>${others}</td><td>${fmtTime(i.seconds)}</td></tr>`;
    }).join("");
    shell("tests", `Test #${id} results`, `
      <div class="card score">${ring(pct(c, n), "correct", "var(--good)")}
        <div class="statlist" style="max-width:360px"><div>Correct <b>${c}</b></div><div>Incorrect <b>${n - c - om}</b></div><div>Omitted <b>${om}</b></div>
        <div>Mode <b>${d.test.mode === "exam" ? "Exam" : "Tutor"}</b></div><div>Time used <b>${fmtTime(d.test.elapsed)}</b></div></div></div>
      <div class="card tblwrap reslist"><table class="tbl"><thead><tr><th></th><th>Question</th><th>Subject</th><th>Topic</th><th>% others correct</th><th>Your time</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      `<a class="btn small" href="#/test/${id}">Review answers</a>`);
  }

  // ---------- performance ----------
  function ring(p, label, color = "var(--teal)") {
    const r = 52, C = 2 * Math.PI * r, L = (C * Math.max(0, Math.min(100, p))) / 100;
    return `<svg class="ring" viewBox="0 0 130 130" role="img" aria-label="${p}% ${label}"><circle cx="65" cy="65" r="${r}" fill="none" stroke="var(--soft)" stroke-width="12"/>
      <circle cx="65" cy="65" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${L} ${C}" transform="rotate(-90 65 65)"/>
      <text class="t" x="65" y="66" text-anchor="middle">${p}%</text><text class="s" x="65" y="86" text-anchor="middle">${label}</text></svg>`;
  }
  function bell(rank, median) {
    const W = 520, H = 150, pts = [];
    for (let i = 0; i <= 100; i++) { const z = (i - 50) / 17; pts.push([20 + (i / 100) * (W - 40), H - 26 - Math.exp(-z * z / 2) * (H - 50)]); }
    const x = (p) => 20 + (p / 100) * (W - 40);
    return `<svg class="bell" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your percentile rank ${rank}">
      <path d="M${pts.map((p) => p.join(",")).join(" L")}" fill="none" stroke="var(--mute)" stroke-width="2"/>
      <line x1="20" y1="${H - 26}" x2="${W - 20}" y2="${H - 26}" stroke="var(--line)"/>
      ${[0, 25, 50, 75, 100].map((p) => `<text x="${x(p)}" y="${H - 8}" text-anchor="middle" style="font:11px var(--sans);fill:var(--mute)">${p}</text>`).join("")}
      <line x1="${x(rank)}" y1="14" x2="${x(rank)}" y2="${H - 26}" stroke="var(--teal)" stroke-width="3"/>
      <text x="${x(rank)}" y="11" text-anchor="middle" style="font:700 12px var(--sans);fill:var(--teal)">You · ${rank}th</text></svg>
      <div class="legend"><span><i style="background:var(--teal)"></i>Your percentile rank</span><span>Median score of users: ${median}%</span></div>`;
  }
  async function viewOverall() {
    loading("overall", "Overall performance");
    const p = await api("performance"), o = p.overall;
    const tasks = p.tasks.map((t) => `<tr><td>${esc(TASK_SHORT[t.key] || t.key)}</td><td>${t.used}/${t.total}</td><td>${pct(t.correct, t.used)}%</td><td style="width:40%">${bar(t)}</td></tr>`).join("");
    shell("overall", "Overall performance", `<div class="perfgrid">
      <div class="card"><h2>Your score</h2><div class="ringrow">${ring(pct(o.correct, o.used), "correct", "var(--good)")}<div class="statlist">
        <div>Total correct <b>${o.correct}</b></div><div>Total incorrect <b>${o.incorrect}</b></div><div>Total omitted <b>${o.omitted}</b></div></div></div></div>
      <div class="card"><h2>QBank usage</h2><div class="ringrow">${ring(pct(o.used, p.total), "used", "var(--selb)")}<div class="statlist">
        <div>Used questions <b>${o.used}</b></div><div>Unused questions <b>${p.total - o.used}</b></div><div>Total questions <b>${p.total}</b></div></div></div></div>
      <div class="card"><h2>Answer changes <span class="muted" style="font:500 13px var(--sans)">(exam mode)</span></h2><div class="statlist">
        <div>Correct → incorrect <b>${p.changes.c2i}</b></div><div>Incorrect → correct <b>${p.changes.i2c}</b></div><div>Incorrect → incorrect <b>${p.changes.i2i}</b></div></div></div>
      <div class="card"><h2>Test count</h2><div class="statlist"><div>Tests created <b>${p.tests.created}</b></div><div>Tests completed <b>${p.tests.completed}</b></div><div>Suspended tests <b>${p.tests.suspended}</b></div></div></div>
    </div>
    <div class="card"><h2>Percentile rank</h2>${p.percentile.rank != null ? bell(p.percentile.rank, p.percentile.median) :
      `<p class="muted">Your rank appears after you answer at least 10 questions and at least 5 users have done the same (${p.percentile.peers} so far). It compares first attempts only.</p>`}</div>
    <div class="card tblwrap"><h2>By physician task</h2><table class="tbl"><thead><tr><th>Task</th><th>Usage</th><th>Correct</th><th></th></tr></thead><tbody>${tasks}</tbody></table></div>`);
  }
  const bar = (t) => `<div class="bar" title="${t.correct} correct · ${t.incorrect} incorrect · ${t.omitted} omitted">${t.used ? `<i class="g" style="width:${pct(t.correct, t.used)}%"></i><i class="b" style="width:${pct(t.incorrect, t.used)}%"></i><i class="o" style="width:${pct(t.omitted, t.used)}%"></i>` : ""}</div>`;
  async function viewReports() {
    loading("reports", "Reports");
    const p = await api("performance");
    let tab = "subjects", q = "";
    const draw = () => {
      const list = (tab === "subjects" ? p.subjects : p.tasks).filter((s) => !q || (tab === "subjects" ? catName(s.key) : s.key).toLowerCase().includes(q));
      const rows = list.map((s) => `<tr><td><b>${tab === "subjects" ? catName(s.key) : esc(TASK_SHORT[s.key] || s.key)}</b>${bar(s)}</td><td>${s.used}/${s.total}</td>
        <td>${s.correct} (${pct(s.correct, s.used)}%)</td><td>${s.incorrect} (${pct(s.incorrect, s.used)}%)</td><td>${s.omitted} (${pct(s.omitted, s.used)}%)</td></tr>`).join("");
      shell("reports", "Reports", `<div class="card"><div class="row" style="margin-bottom:12px"><div class="seg"><button data-t="subjects" class="${tab === "subjects" ? "on" : ""}">Subjects</button><button data-t="tasks" class="${tab === "tasks" ? "on" : ""}">Physician tasks</button></div>
        <input type="search" id="rq" placeholder="Search…" value="${esc(q)}" style="max-width:260px;margin-left:auto"></div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>Usage</th><th>Correct</th><th>Incorrect</th><th>Omitted</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="legend"><span><i style="background:var(--good)"></i>Correct</span><span><i style="background:var(--bad)"></i>Incorrect</span><span><i style="background:var(--mute)"></i>Omitted</span></p></div>`,
        `<button class="btn small ghost" onclick="window.print()">🖨️ Print</button>`);
      $$(".seg button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
      $("#rq").oninput = (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const i = $("#rq"); i.focus(); i.setSelectionRange(pos, pos); };
    };
    draw();
  }
  async function viewGraphs() {
    loading("graphs", "Graphs");
    const p = await api("performance");
    const g = p.graph;
    if (!g.length) return shell("graphs", "Graphs", `<div class="card empty">Finish a test (or answer a few tutor questions) to see your graph.</div>`);
    const W = 760, H = 300, L = 44, R = 20, T = 20, B = 40;
    const x = (i) => L + (g.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (g.length - 1));
    const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
    const grid = [0, 20, 40, 60, 80, 100].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");
    const xl = g.map((d, i) => (g.length <= 12 || i % Math.ceil(g.length / 12) === 0) ? `<text class="axis" x="${x(i)}" y="${H - B + 18}" text-anchor="middle">#${d.id}</text>` : "").join("");
    const oth = g.map((d, i) => (d.others != null ? [x(i), y(d.others)] : null)).filter(Boolean);
    const cum = []; let s = 0; g.forEach((d, i) => { s += d.score; cum.push([x(i), y(s / (i + 1))]); });
    const dots = g.map((d, i) => `<circle class="me" r="6" cx="${x(i)}" cy="${y(d.score)}" data-tip="Test #${d.id} · ${fmtDate(d.at)}<br>You: ${d.score}%${d.others != null ? " · Others: " + d.others + "%" : ""}"/>
      <circle r="14" cx="${x(i)}" cy="${y(d.score)}" fill="transparent" data-tip="Test #${d.id} · ${fmtDate(d.at)}<br>You: ${d.score}%${d.others != null ? " · Others: " + d.others + "%" : ""}"/>`).join("");
    shell("graphs", "Graphs", `<div class="card"><h2>Performance by test</h2>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score by test">${grid}${xl}
        <text class="axis" x="12" y="${T + (H - T - B) / 2}" transform="rotate(-90 12 ${T + (H - T - B) / 2})" text-anchor="middle">Score %</text>
        ${cum.length > 1 ? `<path class="meline" d="M${cum.map((p) => p.join(",")).join(" L")}"/>` : ""}
        ${oth.length > 1 ? `<path class="oth" d="M${oth.map((p) => p.join(",")).join(" L")}"/>` : oth.map((p) => `<circle r="4" cx="${p[0]}" cy="${p[1]}" fill="var(--accent)"/>`).join("")}
        ${dots}</svg>
      <div class="legend"><span><i style="background:var(--teal)"></i>Your score</span><span><i style="background:var(--teal);opacity:.35"></i>Your cumulative average</span><span><i style="background:var(--accent)"></i>Others' average on the same questions</span></div></div>
      <div class="card tblwrap"><h2>Table view</h2><table class="tbl"><thead><tr><th>Test</th><th>Date</th><th>Your score</th><th>Others' average</th></tr></thead><tbody>
      ${g.map((d) => `<tr><td>#${d.id}</td><td>${fmtDate(d.at)}</td><td>${d.score}%</td><td>${d.others != null ? d.others + "%" : "—"}</td></tr>`).join("")}</tbody></table></div>`);
    tips();
  }
  function tips() {
    let tip;
    $$("[data-tip]").forEach((el) => {
      el.addEventListener("mouseenter", () => { tip = document.createElement("div"); tip.className = "tip"; tip.innerHTML = el.dataset.tip; document.body.appendChild(tip); });
      el.addEventListener("mousemove", (e) => { if (tip) { tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY + 12 + "px"; } });
      el.addEventListener("mouseleave", () => { tip && tip.remove(); tip = null; });
    });
  }

  // ---------- search & single-question review ----------
  async function viewSearch() {
    shell("search", "Search", `<div class="card"><input type="search" id="sq" placeholder="Search questions you have answered: sarcoidosis, hyperkalemia, DOAC…" autofocus>
      <p class="kbd" style="margin:8px 0 0">Search covers questions you have already used, so unused questions stay fresh.</p></div><div id="sr"></div>`);
    let t;
    $("#sq").oninput = (e) => { clearTimeout(t); t = setTimeout(async () => {
      const q = e.target.value.trim();
      if (q.length < 2) return ($("#sr").innerHTML = "");
      const { results } = await api("search?q=" + encodeURIComponent(q));
      $("#sr").innerHTML = results.length ? results.map((r) => `<a class="sres" href="#/q/${r.qid}"><small>${catName(r.cat)} · ${esc(r.topic)} · <span class="${r.status === "correct" ? "ok" : r.status === "incorrect" ? "no" : ""}">${r.status}</span></small><div>…${esc(r.snippet)}…</div></a>`).join("")
        : '<div class="card empty">No matches in your used questions.</div>';
    }, 250); };
  }
  async function viewQuestion(qid) {
    loading("search", "Question review");
    const d = await api("q/" + encodeURIComponent(qid));
    const it = { q: d.q, reveal: d.reveal, choice: d.choice, revealed: true, correct: d.choice ? (d.choice === d.reveal.answer ? 1 : 0) : null, marked: d.marked };
    shell("search", "Question review", `<div class="card"><div class="qwrap" style="padding:4px">${questionHTML(it, true)}</div></div>`, `<a class="btn small ghost" href="#/search">← Back to search</a>`);
    bindLinksNewTab();
  }

  // ---------- account ----------
  function viewAccount() {
    shell("account", "My account", `
      <div class="card"><h2>Profile</h2><div class="statlist" style="max-width:520px"><div>Name <span>${esc(S.user.name || "—")}</span></div><div>Email <span>${esc(S.user.email)}</span></div></div></div>
      <div class="card"><h2>Display</h2><div class="row"><button class="btn ghost" id="th">🌗 Day / night</button><button class="btn ghost" id="fs">🔠 Text size</button></div></div>
      <div class="card"><h2>Change password</h2><form id="pf" style="max-width:420px"><label class="f">Current password</label><input type="password" id="op" autocomplete="current-password">
        <label class="f">New password (8+ characters)</label><input type="password" id="np" autocomplete="new-password"><button class="btn" style="margin-top:12px">Update password</button><div class="err" id="perr"></div></form></div>
      <div class="card"><h2>Reset QBank</h2><p class="muted">Deletes all your tests, answers and marks so every question becomes unused again. Your account stays. This cannot be undone.</p><button class="btn accent" id="rs">Reset my progress</button></div>`);
    $("#th").onclick = cycleTheme; $("#fs").onclick = () => { cycleFont(); toast("Text size " + localStorage.getItem("qb_font") + " px"); };
    $("#pf").onsubmit = async (e) => { e.preventDefault(); $("#perr").textContent = "";
      try { await api("account/password", { old: $("#op").value, password: $("#np").value }); toast("Password updated"); $("#pf").reset(); } catch (er) { $("#perr").textContent = er.message; } };
    $("#rs").onclick = () => modal(`<h3>Reset QBank?</h3><p class="muted">Type <b>RESET</b> to delete all your tests and answers.</p><input type="text" id="rc" autocomplete="off"><div class="err" id="rerr"></div>
      <div class="acts"><button class="btn ghost" data-close>Cancel</button><button class="btn accent" id="rgo">Reset</button></div>`, (m, close) => {
      $("#rgo", m).onclick = async () => { try { await api("reset", { confirm: $("#rc", m).value.trim() }); close(); toast("Your QBank was reset"); location.hash = "#/home"; } catch (er) { $("#rerr", m).textContent = er.message; } };
    });
  }

  // ---------- question rendering (shared by runner & review) ----------
  function questionHTML(it, revealed) {
    const q = it.q, rv = it.reveal;
    const strikes = R && R.strike[it.idx] || {};
    const sel = it.choice || (R && R.pending[it.idx]) || null;
    const choices = Object.entries(q.choices).map(([k, txt]) => {
      let cls = "ch", mk = "", pc = "";
      if (revealed && rv) {
        if (k === rv.answer) { cls += " right"; mk = '<span class="mk ok">✓</span>'; }
        else if (k === it.choice) { cls += " wrong"; mk = '<span class="mk no">✗</span>'; }
        const p = rv.stats && rv.stats.pct[k];
        pc = `<span class="pct">${p == null ? "" : "(" + p + "%)"}</span>`;
      } else {
        pc = `<button class="strikebtn" data-strike="${k}" title="Cross out (or right-click the choice)" aria-label="Cross out ${k}">✕</button>`;
      }
      if (sel === k) cls += " sel";
      if (strikes[k] && !revealed) cls += " strike";
      return `<div class="${cls}" data-ch="${k}" role="radio" aria-checked="${sel === k}" tabindex="0"><span class="mk">${mk}</span><span class="rad"></span><span class="tx"><span class="lt">${k}.</span> ${txt}</span>${pc}</div>`;
    }).join("");
    let verdict = "";
    if (revealed && rv) {
      const s = rv.stats || { total: 0, pct: {} };
      const v = !it.choice ? '<span class="v om">Omitted</span>' : it.correct ? '<span class="v ok">✓ Correct</span>' : '<span class="v no">✗ Incorrect</span>';
      verdict = `<div class="verdict">${v}<span>📊 ${s.total ? (s.pct[rv.answer] ?? 0) + "% answered correctly" : "First answer on record"}</span><span>⏱️ ${fmtTime(it.seconds || 0)}</span><span>🗂️ ${catName(q.cat)}</span></div>`;
    }
    return `<div class="qcol"><div class="stem" id="stem">${q.stem_html}</div><p class="lead">${q.lead}</p><div class="choices" id="choices">${choices}</div>
      ${revealed ? verdict : ""}<div id="subrow" class="subrow"></div></div>${revealed && rv ? `<div class="xp" id="xp">${rv.explain_html}</div>` : ""}`;
  }
  function bindLinksNewTab() { $$(".xp a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; }); }

  // ---------- test runner ----------
  let R = null;
  function stopRunner() {
    if (!R) return;
    clearInterval(R.tick); clearInterval(R.autosave);
    document.removeEventListener("keydown", R.onKey); document.removeEventListener("mouseup", R.onUp);
    if (!R.done && !R.leaving) saveProgress(true);
    $$(".panel,.hlpop").forEach((p) => p.remove());
    R = null;
  }
  async function openRunner(id, startIdx) {
    app.innerHTML = '<div class="boot"><div class="spin"></div></div>';
    let d;
    try { d = await api("tests/" + id); } catch (e) { toast(e.message); location.hash = "#/tests"; return; }
    R = { id, test: d.test, items: d.items, idx: startIdx != null ? startIdx : d.test.current_idx || 0, elapsed: d.test.elapsed || 0,
      done: d.test.status === "done", pending: {}, strike: JSON.parse(localStorage.getItem("qb_strike_" + id) || "{}"), secs: {}, hlMode: false };
    R.idx = Math.max(0, Math.min(R.items.length - 1, R.idx));
    R.items.forEach((i) => (R.secs[i.idx] = i.seconds || 0));
    drawRunner();
    if (!R.done) {
      R.tick = setInterval(tick, 1000);
      R.autosave = setInterval(() => saveProgress(false), 20000);
    }
    R.onKey = onKey; document.addEventListener("keydown", R.onKey);
    R.onUp = onMouseUp; document.addEventListener("mouseup", R.onUp);
  }
  function tick() {
    if (!R || R.done || document.hidden) return;
    R.elapsed++;
    const it = R.items[R.idx];
    if (!it.revealed) R.secs[it.idx] = (R.secs[it.idx] || 0) + 1;
    drawTimer();
    if (R.test.timed && R.test.time_limit && R.elapsed >= R.test.time_limit) { toast("Time is up — ending the block"); endTest(true); }
  }
  function drawTimer() {
    const t = $("#timer"); if (!t) return;
    if (R.done) { t.textContent = "Review"; return; }
    if (R.test.timed && R.test.time_limit) {
      const left = R.test.time_limit - R.elapsed;
      t.textContent = "⏱️ " + fmtTime(left) + " left"; t.classList.toggle("low", left < 300);
    } else t.textContent = "⏱️ " + fmtTime(R.elapsed);
  }
  async function saveProgress(beacon) {
    if (!R || R.done) return;
    const body = { idx: R.idx, elapsed: R.elapsed, seconds: Object.entries(R.secs).map(([k, v]) => [parseInt(k), v]) };
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/qb/tests/" + R.id + "/progress", new Blob([JSON.stringify(body)], { type: "application/json" }));
    else try { await api("tests/" + R.id + "/progress", body); } catch {}
  }
  function drawRunner() {
    const n = R.items.length;
    app.innerHTML = `<div class="runner">
      <header class="rhead">
        <button class="tb navtoggle" id="navt" aria-label="Question list">☰</button>
        <div><div class="qn">Question ${R.idx + 1} of ${n}</div><div class="tid">Test #${R.id}</div></div>
        <span class="mode">${R.done ? "Review" : R.test.mode === "exam" ? "Exam" : "Tutor"}</span>
        <div class="grow"></div>
        <div class="tools">
          <button class="tb" id="tMark" title="Mark for review (M)">🚩<span class="lbl">Mark</span></button>
          <button class="tb" id="tHl" title="Highlight selected text (H)">🖍️<span class="lbl">Highlight</span></button>
          <button class="tb" id="tLab" title="Lab values">🧪<span class="lbl">Lab values</span></button>
          <button class="tb" id="tCalc" title="Calculator">🧮<span class="lbl">Calculator</span></button>
          <button class="tb" id="tFont" title="Text size">🔠</button>
          <button class="tb" id="tTheme" title="Day / night">🌗</button>
          <button class="tb" id="tFb" title="Send feedback on this question">💬<span class="lbl">Feedback</span></button>
        </div>
        <span class="timer" id="timer"></span>
      </header>
      <div class="rbody"><nav class="qnav" id="qnav"></nav><div class="qscroll" id="qscroll"><div class="qwrap" id="qwrap"></div></div></div>
      <footer class="rfoot">
        ${R.done ? `<button class="tb" id="fExit">↩︎ <span class="flbl">Exit review</span></button>` : `<button class="tb" id="fEnd">⏹ <span class="flbl">End</span></button><button class="tb" id="fSus">⏸ <span class="flbl">Suspend</span></button>`}
        <div class="grow"></div>
        <button class="tb" id="fPrev">← <span class="lbl">Previous</span></button>
        <button class="tb navtoggle" id="fNav">☰</button>
        <button class="tb" id="fNext"><span class="lbl">Next</span> →</button>
      </footer></div>`;
    $("#tMark").onclick = toggleMark; $("#tHl").onclick = () => doHighlight(true);
    $("#tLab").onclick = () => togglePanel("labs"); $("#tCalc").onclick = () => togglePanel("calc");
    $("#tFont").onclick = cycleFont; $("#tTheme").onclick = cycleTheme; $("#tFb").onclick = feedback;
    $("#fPrev").onclick = () => go(R.idx - 1); $("#fNext").onclick = () => go(R.idx + 1);
    $("#navt").onclick = $("#fNav").onclick = () => $("#qnav").classList.toggle("open");
    if (R.done) $("#fExit").onclick = () => { R.leaving = true; location.hash = "#/results/" + R.id; };
    else { $("#fEnd").onclick = () => endTest(false); $("#fSus").onclick = suspend; }
    drawNav(); drawQ(); drawTimer();
  }
  function drawNav() {
    $("#qnav").innerHTML = R.items.map((i) => {
      let st = "";
      if (i.revealed) st = !i.choice ? '<span class="muted">–</span>' : i.correct ? '<span class="ok">✓</span>' : '<span class="no">✗</span>';
      const ans = !i.revealed && (i.choice || R.pending[i.idx]) ? " ans" : "";
      return `<button class="${i.idx === R.idx ? "cur" : ""}${ans}" data-go="${i.idx}">${i.marked ? '<span class="flag">🚩</span>' : ""}${i.idx + 1} ${st}</button>`;
    }).join("");
    $$("#qnav [data-go]").forEach((b) => (b.onclick = () => { go(parseInt(b.dataset.go)); $("#qnav").classList.remove("open"); }));
    const cur = $("#qnav .cur"); cur && cur.scrollIntoView({ block: "nearest" });
  }
  function drawQ() {
    const it = R.items[R.idx];
    const revealed = it.revealed;
    $(".qn").textContent = `Question ${R.idx + 1} of ${R.items.length}`;
    $("#tMark").classList.toggle("on", !!it.marked);
    const wrap = $("#qwrap");
    wrap.classList.toggle("split", revealed && window.innerWidth > 1180);
    wrap.innerHTML = questionHTML(it, revealed);
    // restore highlights
    const saved = localStorage.getItem("qb_hl_" + it.q.id);
    if (saved) { try { const o = JSON.parse(saved); if (o.len === it.q.stem_html.length) $("#stem").innerHTML = o.html; } catch {} }
    $("#stem").onclick = (e) => { if (e.target.tagName === "MARK") { const m = e.target; m.replaceWith(...m.childNodes); saveHl(); } };
    if (!revealed) {
      $$("#choices .ch").forEach((c) => {
        c.onclick = (e) => { if (e.target.closest("[data-strike]")) return; choose(c.dataset.ch); };
        c.oncontextmenu = (e) => { e.preventDefault(); strike(c.dataset.ch); };
        c.onkeydown = (e) => { if (e.key === " ") { e.preventDefault(); choose(c.dataset.ch); } };
      });
      $$("[data-strike]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); strike(b.dataset.strike); }));
      const sub = $("#subrow");
      if (R.test.mode === "tutor") {
        const sel = R.pending[it.idx];
        sub.innerHTML = `<button class="btn accent" id="submit" ${sel ? "" : "disabled"}>Submit</button><span class="hint">Enter to submit · right-click a choice to cross it out</span>`;
        $("#submit").onclick = submit;
      } else {
        sub.innerHTML = `<span class="hint">${it.choice ? "✓ Answer saved — you can change it until you end the block." : "Your choice saves automatically."}</span>`;
      }
    }
    bindLinksNewTab();
    $("#qscroll").scrollTop = 0;
    $("#fPrev").disabled = R.idx === 0; $("#fNext").disabled = R.idx === R.items.length - 1;
  }
  function go(i) {
    if (!R || i < 0 || i >= R.items.length) return;
    R.idx = i; drawQ(); drawNav();
    if (!R.done) saveProgress(false);
  }
  async function choose(k) {
    const it = R.items[R.idx];
    if (it.revealed) return;
    if (R.test.mode === "tutor") {
      R.pending[it.idx] = k; $$("#choices .ch").forEach((c) => { c.classList.toggle("sel", c.dataset.ch === k); c.setAttribute("aria-checked", c.dataset.ch === k); });
      $("#submit").disabled = false; drawNav();
    } else {
      it.choice = k; $$("#choices .ch").forEach((c) => { c.classList.toggle("sel", c.dataset.ch === k); c.setAttribute("aria-checked", c.dataset.ch === k); });
      $("#subrow").innerHTML = '<span class="hint">✓ Answer saved — you can change it until you end the block.</span>'; drawNav();
      try { await api(`tests/${R.id}/answer`, { idx: it.idx, choice: k, seconds: R.secs[it.idx] || 0 }); } catch (e) { toast(e.message); }
    }
  }
  async function submit() {
    const it = R.items[R.idx];
    const k = R.pending[it.idx];
    if (!k || it.revealed) return;
    $("#submit").disabled = true;
    try {
      const d = await api(`tests/${R.id}/answer`, { idx: it.idx, choice: k, seconds: R.secs[it.idx] || 0 });
      Object.assign(it, { choice: k, revealed: true, correct: d.correct ? 1 : 0, reveal: d.reveal, seconds: R.secs[it.idx] || 0 });
      delete R.pending[it.idx];
      drawQ(); drawNav();
      if (R.items.every((x) => x.revealed)) toast("Last question answered — press End block to see your results", 4000);
    } catch (e) { toast(e.message); $("#submit").disabled = false; }
  }
  function strike(k) {
    const it = R.items[R.idx];
    const s = (R.strike[it.idx] ||= {}); s[k] = !s[k];
    localStorage.setItem("qb_strike_" + R.id, JSON.stringify(R.strike));
    const el = $(`#choices [data-ch="${k}"]`); el && el.classList.toggle("strike", !!s[k]);
  }
  async function toggleMark() {
    const it = R.items[R.idx];
    it.marked = !it.marked; $("#tMark").classList.toggle("on", it.marked); drawNav();
    try { await api(`tests/${R.id}/mark`, { idx: it.idx, marked: it.marked }); } catch (e) { toast(e.message); }
  }
  // highlighting
  function selectionInStem() {
    const s = window.getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return null;
    const r = s.getRangeAt(0), stem = $("#stem");
    return stem && stem.contains(r.commonAncestorContainer) ? r : null;
  }
  function doHighlight(fromButton) {
    $$(".hlpop").forEach((p) => p.remove());
    const r = selectionInStem();
    if (!r) { if (fromButton) toast("Select text in the question first, then press Highlight"); return; }
    const m = document.createElement("mark");
    try { m.appendChild(r.extractContents()); r.insertNode(m); } catch { return; }
    window.getSelection().removeAllRanges(); saveHl();
  }
  function saveHl() { const it = R.items[R.idx]; localStorage.setItem("qb_hl_" + it.q.id, JSON.stringify({ len: it.q.stem_html.length, html: $("#stem").innerHTML })); }
  function onMouseUp(e) {
    if (!R || e.target.closest(".hlpop")) return;
    setTimeout(() => {
      $$(".hlpop").forEach((p) => p.remove());
      const r = selectionInStem(); if (!r) return;
      const b = r.getBoundingClientRect();
      const btn = document.createElement("button"); btn.className = "hlpop"; btn.textContent = "🖍️ Highlight";
      btn.style.left = Math.max(8, b.left + b.width / 2 - 50) + "px"; btn.style.top = Math.max(60, b.top - 40) + "px";
      btn.onmousedown = (ev) => { ev.preventDefault(); doHighlight(true); };
      document.body.appendChild(btn);
    }, 10);
  }
  function onKey(e) {
    if (!R || $("#modal:not([hidden])") || ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const k = e.key.toUpperCase();
    if (e.key === "ArrowRight") go(R.idx + 1);
    else if (e.key === "ArrowLeft") go(R.idx - 1);
    else if (k === "M") toggleMark();
    else if (k === "H") doHighlight(true);
    else if (e.key === "Enter" && R.test.mode === "tutor" && !R.done) submit();
    else if (/^[A-F]$/.test(k) && !e.metaKey && !e.ctrlKey && R.items[R.idx].q.choices[k] && !R.done) choose(k);
  }
  async function suspend() {
    try { await api(`tests/${R.id}/suspend`, { idx: R.idx, elapsed: R.elapsed }); } catch {}
    R.leaving = true; toast("Test suspended — resume it from Previous tests"); location.hash = "#/tests";
  }
  async function endTest(auto) {
    if (!auto) {
      const left = R.items.filter((i) => !i.revealed && !i.choice).length;
      const ok = await confirmBox("End this block?", (left ? `${left} question${left > 1 ? "s are" : " is"} unanswered and will count as omitted. ` : "") +
        (R.test.mode === "exam" ? "Your answers will be graded and you cannot change them afterwards." : "You will see your results."), "End block", true);
      if (!ok) return;
    }
    clearInterval(R.tick);
    try { await api(`tests/${R.id}/end`, { elapsed: R.elapsed }); } catch (e) { toast(e.message); return; }
    R.done = true; R.leaving = true; location.hash = "#/results/" + R.id;
  }
  function feedback() {
    const it = R.items[R.idx];
    modal(`<h3>💬 Feedback on this question</h3><p class="muted" style="font-size:14px">Spotted an error, an outdated guideline or something unclear? Tell us — every note is read.</p>
      <textarea id="fbt" placeholder="What should we fix?"></textarea><div class="err" id="fbe"></div>
      <div class="acts"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="fbs">Send</button></div>`, (m, close) => {
      $("#fbs", m).onclick = async () => { try { await api("feedback", { qid: it.q.id, text: $("#fbt", m).value }); close(); toast("Thanks — feedback sent"); } catch (e) { $("#fbe", m).textContent = e.message; } };
      $("#fbt", m).focus();
    });
  }
  // floating panels
  function togglePanel(kind) {
    const ex = $(".panel." + kind); if (ex) return ex.remove();
    const p = document.createElement("div"); p.className = "panel " + kind;
    if (kind === "labs") {
      p.innerHTML = `<div class="ph"><b>🧪 Lab values</b><button class="x" aria-label="Close">✕</button></div><div class="pb"><input type="search" id="lq" placeholder="Search labs…" style="margin-bottom:8px"><div class="labtabs"></div><table class="labtbl"></table></div>`;
      let tab = 0;
      const draw = () => {
        const q = ($("#lq", p).value || "").toLowerCase();
        $(".labtabs", p).innerHTML = QB_LABS.map((t, i) => `<button data-i="${i}" class="${i === tab && !q ? "on" : ""}">${t.tab}</button>`).join("");
        $$(".labtabs button", p).forEach((b) => (b.onclick = () => { tab = parseInt(b.dataset.i); $("#lq", p).value = ""; draw(); }));
        const rows = q ? QB_LABS.flatMap((t) => t.rows).filter((r) => r.length > 1 && r[0].toLowerCase().includes(q)) : QB_LABS[tab].rows;
        $(".labtbl", p).innerHTML = rows.map((r) => r[0].startsWith("#") ? `<tr class="h"><td colspan="2">${esc(r[0].slice(2))}</td></tr>` : `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join("");
      };
      document.body.appendChild(p); draw(); $("#lq", p).oninput = draw;
    } else {
      p.innerHTML = `<div class="ph"><b>🧮 Calculator</b><button class="x" aria-label="Close">✕</button></div><div class="pb"><div class="expr"></div><div class="disp">0</div><div class="keys">
        ${["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "="].map((k) => `<button class="${"÷×−+".includes(k) ? "op" : k === "=" ? "eq" : ""}">${k}</button>`).join("")}</div></div>`;
      p.style.width = "300px";
      document.body.appendChild(p);
      let ex = "";
      const disp = $(".disp", p), exl = $(".expr", p);
      const calc = (s) => { const js = s.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-"); if (!/^[-+*/().\d\s]*$/.test(js)) throw 0; const v = Function("return (" + js + ")")(); if (!isFinite(v)) throw 0; return +v.toFixed(10); };
      $$(".keys button", p).forEach((b) => (b.onclick = () => {
        const k = b.textContent;
        if (k === "C") ex = ""; else if (k === "=") { try { exl.textContent = ex + " ="; ex = String(calc(ex)); } catch { ex = ""; disp.textContent = "Error"; return; } }
        else if (k === "±") ex = ex.startsWith("-") ? ex.slice(1) : "-" + ex; else ex += k;
        disp.textContent = ex || "0";
      }));
    }
    $(".x", p).onclick = () => p.remove();
    drag(p);
  }
  function drag(p) {
    const h = $(".ph", p); let sx, sy, ox, oy;
    h.onpointerdown = (e) => { if (e.target.closest("button")) return; sx = e.clientX; sy = e.clientY; const r = p.getBoundingClientRect(); ox = r.left; oy = r.top; h.setPointerCapture(e.pointerId); };
    h.onpointermove = (e) => { if (sx == null) return; p.style.left = Math.max(0, ox + e.clientX - sx) + "px"; p.style.top = Math.max(0, oy + e.clientY - sy) + "px"; p.style.right = "auto"; };
    h.onpointerup = () => (sx = null);
  }
  window.addEventListener("resize", () => { if (R && R.items[R.idx].revealed) $("#qwrap").classList.toggle("split", window.innerWidth > 1180); });

  boot();
})();
