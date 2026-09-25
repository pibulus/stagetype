// deno-lint-ignore-file no-window
// Most of this file runs inside the page (window.*), so it stays plain JavaScript.
// End-to-end browser suite: drives every page in headless Chromium against an in-process relay and a
// mock Deepgram. Run with `deno task e2e`. Screenshots land in e2e/screenshots (gitignored).
//
// Chromium: set CHROMIUM_PATH, or install Playwright's build once with
//   deno run -A npm:playwright@1.56.1 install chromium
import { chromium } from "playwright-core";
import { mockDeepgram } from "./mock_deepgram.ts";

const upstream = mockDeepgram(0);
Deno.env.set("DEEPGRAM_API_KEY", "test-key");
Deno.env.set("DEEPGRAM_URL", `ws://localhost:${upstream.addr.port}/listen`);
const { handler } = await import("../server.ts");
const relay = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, handler);
const base = `http://localhost:${relay.addr.port}`;
const SHOTS = new URL("./screenshots", import.meta.url).pathname;
await Deno.mkdir(SHOTS, { recursive: true });
let failed = 0;
const browser = await chromium.launch({
  executablePath: Deno.env.get("CHROMIUM_PATH") || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const errors = [];
const track = (page, name) => {
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  // A 404 on a room's stream is expected and designed for (ended rooms, wrong join codes, demo ids before a scan).
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
};
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) failed++; };

// Presenter
const p = await ctx.newPage(); track(p, "presenter");
// Headless Chromium has no working SpeechRecognition; stand in a fake so the local-mic path runs.
await p.addInitScript(() => {
  window.__recs = [];
  window.SpeechRecognition = class {
    constructor() { this.started = false; window.__recs.push(this); }
    start() { this.started = true; }
    stop() { this.started = false; this.onend?.(); }
    emit(text, isFinal) {
      this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
    }
  };
  window.__rec = () => window.__recs.at(-1);
});
await p.goto(base + "/");
ok(await p.evaluate(() => typeof qrcode === "function"), "vendored qrcode.js loads");
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
const url = await p.textContent("#urlDisplay");
ok(/\/live\/[a-z0-9]{8}$/.test(url), "room opened, audience URL shown: " + url);
ok((await p.$$eval("#qrGraphic svg", (n) => n.length)) === 1, "QR svg rendered");
ok(!(await p.$eval("#pauseBtn", (b) => b.hidden)), "pause button visible while live");
ok(!(await p.isVisible("#startBtn")) && await p.isVisible("#stopBtn"), "start button really hidden while live, end talk shown");
const roomId = url.split("/").pop();
// token is only in the mic tab URL; grab it from the page state via the mic QR text
await p.click("#tabMic"); const micUrl = await p.textContent("#urlDisplay"); await p.click("#tabAudience");
const token = micUrl.split("#")[1];
ok(token && token.length === 32, "mic pairing URL carries 32-char token");
await p.click("#tabMic");
ok((await p.textContent("#fsNote")).includes("write key"), "fullscreen note warns about projecting the mic QR");
await p.click("#tabAudience");
ok((await p.textContent("#fsNote")).includes("Project"), "fullscreen note back to audience copy");
await p.click("#fsQrBtn"); ok(await p.$eval("#fsModal", (m) => m.classList.contains("open")), "fullscreen modal opens");
await p.keyboard.press("Escape"); ok(await p.$eval("#fsModal", (m) => !m.classList.contains("open")), "escape closes modal");
ok(await p.evaluate(() => window.__rec()?.started === true), "local recogniser started");

// Audience
const a = await ctx.newPage(); track(a, "audience");
await a.goto(`${base}/live/${roomId}`);
await a.waitForFunction(() => document.querySelector("#state").textContent === "Live");
ok(true, "audience connected, state Live");

// Mic page (token in hash; over http on localhost so no https warning)
const m = await ctx.newPage(); track(m, "mic");
await m.goto(`${base}/mic/${roomId}#${token}`);
ok(!(await m.textContent("#err")).includes("https"), "mic page: no https warning on localhost, err=" + JSON.stringify(await m.textContent("#err")));

// Push lines via API as the phone mic would
const push = (body) => fetch(`${base}/api/room/${roomId}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then(r => r.json());
await push({ text: "typing away", final: false });
await push({ text: "First sentence.", final: true });
await push({ text: "First sentence.", final: true }); // genuine repeat must not be swallowed
await push({ text: "Second sentence.", final: true });
await a.waitForFunction(() => document.querySelectorAll("#feed p:not(#interim)").length === 3);
ok(true, "audience received 3 finals (repeat kept)");
// local mic final goes through the relay exactly once
await p.evaluate(() => { window.__rec().emit("mid sentence", false); window.__rec().emit("Local line.", true); });
await a.waitForFunction(() => document.querySelectorAll("#feed p:not(#interim)").length === 4);
await p.waitForFunction(() => document.querySelector("#ticker").textContent.includes("Local line."));
await new Promise((r) => setTimeout(r, 300));
ok((await p.textContent("#ticker")).split("Local line.").length === 2, "local final shows once on ticker (relay echo, no local dup)");
await p.waitForFunction(() => document.querySelectorAll("#ticker span.fresh-lead").length === 1);
const tick = await p.textContent("#ticker");
ok(!tick.includes("First sentence.") && tick.includes("Second sentence.") && tick.includes("Local line."), "presenter ticker shows last two finals only: " + JSON.stringify(tick.trim()));
const count = await push({ text: "", final: false });
ok(count.listeners === 2, "server sees 2 listeners (presenter + audience): " + count.listeners);
await p.evaluate(() => push({ ping: true }));
await p.waitForFunction(() => document.querySelector("#countBadge").textContent === "1 reading");
ok(true, "presenter badge excludes itself: 1 reading");

// Space pauses (not ends)
await p.click("body", { position: { x: 5, y: 5 } });
await p.keyboard.press("Space");
await p.waitForFunction(() => document.querySelector("#pauseBtn").textContent === "Resume mic");
ok(await p.$eval("#stopBtn", (b) => !b.hidden), "space paused mic, room still open");
ok(await p.evaluate(() => window.__rec().started === false), "recogniser stopped while paused");
ok((await p.textContent("#liveText")).includes("paused"), "liveText shows paused");
await p.keyboard.press("Space");
await p.waitForFunction(() => document.querySelector("#pauseBtn").textContent === "Pause mic");
ok(await p.evaluate(() => window.__rec().started === true), "space resumed: fresh recogniser running");

// Audience reconnect with offset: simulate by reloading, should not duplicate
await a.reload();
await a.waitForFunction(() => document.querySelectorAll("#feed p:not(#interim)").length === 4);
ok(true, "audience reload replays backlog exactly once");

// Take screenshots
await p.screenshot({ path: `${SHOTS}/presenter.png` });
await a.setViewportSize({ width: 430, height: 880 });
await a.screenshot({ path: `${SHOTS}/audience.png` });
await m.setViewportSize({ width: 430, height: 880 });
await m.evaluate(() => { document.body.classList.add("live"); document.querySelector("#go").classList.add("live"); document.querySelector("#pulseAura").classList.add("active"); document.querySelector("#stateText").textContent = "Live on stage"; document.querySelector("#state").classList.add("on"); finals.push("Second sentence.", "Local line."); words = 4; listeners = 2; stats(); render("and this is what"); });
await m.screenshot({ path: `${SHOTS}/mic.png` });

// End talk
await p.click("#stopBtn");
await a.waitForFunction(() => !document.querySelector("#endCard").hidden);
ok(true, "audience got end card");
await new Promise((r) => setTimeout(r, 700));
await a.setViewportSize({ width: 430, height: 880 });
await a.screenshot({ path: `${SHOTS}/audience-end.png` });
ok((await p.textContent("#liveText")) === "Talk ended", "presenter shows Talk ended");
ok(await p.$eval("#pauseBtn", (b) => b.hidden), "pause hidden after end");

// Second talk: ticker must be clean
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
ok((await p.textContent("#ticker")).trim() === "", "second talk starts with empty ticker");
await p.click("#stopBtn");

// Audience opens a dead room. This browser read that room earlier, so the saved copy comes back;
// a browser that never saw it gets a plain "Room closed" with no card.
const d = await ctx.newPage(); track(d, "dead");
await d.goto(`${base}/live/${roomId}`);
await d.waitForFunction(() => document.querySelector("#state").textContent === "Saved on this phone");
ok(!(await d.$eval("#endCard", (c) => c.hidden)) && (await d.$$eval("#feed p:not(#interim)", (n) => n.length)) === 4, "dead room on a phone that was there: saved copy and export card");
const fresh = await browser.newContext(); const d2 = await fresh.newPage(); track(d2, "dead-fresh");
await d2.goto(`${base}/live/${roomId}`);
await d2.waitForFunction(() => document.querySelector("#state").textContent === "Room closed");
ok(await d2.$eval("#endCard", (c) => c.hidden), "dead room on a phone that was never there: no card");
await fresh.close();

// ---- Title + ticker/reader preferences
await p.fill("#title", "COMP1010 Week 3");
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
ok((await p.textContent("#qrTalk")) === "COMP1010 Week 3" && !(await p.$eval("#qrTalk", (e) => e.hidden)), "title shown on QR card");
ok(await p.$eval("#title", (i) => i.disabled), "title locked while live");
const url2 = await p.textContent("#urlDisplay"); const room2 = url2.split("/").pop();
await p.click("#tabMic"); const tok2 = (await p.textContent("#urlDisplay")).split("#")[1]; await p.click("#tabAudience");
// ticker prefs (the finer ones sit under a disclosure)
await p.evaluate(() => { document.querySelector("#moreTicker").open = true; });
await p.selectOption("#face", "fraunces");
await p.click('[data-pref="weight"] [data-v="400"]');
await p.click('[data-pref="depth"] [data-v="3"]');
await p.click('[data-pref="flow"] [data-v="settled"]');
await p.click('[data-pref="ring"] [data-v="none"]');
const tk = await p.$eval("#ticker", (t) => ({ face: t.dataset.face, flow: t.dataset.flow, ring: t.dataset.ring, ff: getComputedStyle(t).fontFamily, fw: getComputedStyle(t).fontWeight, depth: t.style.getPropertyValue("--ticker-depth") }));
ok(tk.face === "fraunces" && tk.ff.includes("Fraunces") && tk.fw === "400" && tk.depth === "3" && tk.flow === "settled" && tk.ring === "none", "ticker prefs applied: " + JSON.stringify(tk));
ok((await p.evaluate(() => localStorage.getItem("st-face"))) === "fraunces", "ticker prefs persisted");
const fontsLoaded = await p.evaluate(async () => { await document.fonts.load("700 20px Fraunces"); return document.fonts.check("700 20px Fraunces"); });
ok(fontsLoaded, "Fraunces webfont actually loads from /vendor/fonts");
const a2 = await ctx.newPage(); track(a2, "audience-title");
await a2.goto(`${base}/live/${room2}`);
await a2.waitForFunction(() => document.querySelector("#state").textContent === "Live");
ok((await a2.textContent("#talkTitle")) === "COMP1010 Week 3", "audience shows talk title");
ok((await a2.title()) === "COMP1010 Week 3 · StageType", "audience tab title uses talk title");
await a2.click("#panel summary");
await a2.selectOption("#face", "atkinson");
await a2.click('#weightSeg [data-v="700"]');
await a2.click('#flowSeg [data-v="settled"]');
const fd = await a2.$eval("#feed", (f) => ({ ff: getComputedStyle(f).fontFamily, fw: getComputedStyle(f).fontWeight, flow: document.documentElement.dataset.flow, interim: getComputedStyle(document.querySelector("#interim")).display }));
ok(fd.ff.includes("Atkinson") && fd.fw === "700" && fd.flow === "settled" && fd.interim === "none", "reader prefs applied: " + JSON.stringify(fd));
ok((await a2.evaluate(() => localStorage.getItem("stl-face"))) === "atkinson", "reader prefs persisted");
await a2.keyboard.press("Escape"); await a2.click("#panel summary");
const m2 = await ctx.newPage(); track(m2, "mic-title");
await m2.goto(`${base}/mic/${room2}#${tok2}`);
await m2.waitForFunction(() => document.querySelector("#talk").textContent === "COMP1010 Week 3");
ok(true, "mic page learns the title from the pairing ping");
const push2 = (body) => fetch(`${base}/api/room/${room2}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok2}` }, body: JSON.stringify(body) });
await push2({ text: "One.", final: true }); await push2({ text: "Two.", final: true }); await push2({ text: "Three.", final: true });
await push2({ text: "still talking", final: false });
await a2.waitForFunction(() => document.querySelectorAll("#feed p:not(#interim)").length === 3);
await p.waitForFunction(() => document.querySelectorAll("#ticker .prev").length === 2);
ok(true, "ticker shows 3 lines at depth 3");
ok((await p.$eval("#ticker .interim", (e) => getComputedStyle(e).display)) === "none", "settled flow hides interim on ticker");
await a2.setViewportSize({ width: 430, height: 880 });
await a2.screenshot({ path: `${SHOTS}/audience-prefs.png` });
await p.screenshot({ path: `${SHOTS}/presenter-prefs.png` });
await p.click("#stopBtn");
await a2.waitForFunction(() => !document.querySelector("#endCard").hidden);
ok((await a2.textContent("#state")) === "Talk ended", "ends with 'Talk ended'");
ok((await a2.$$eval(".confetti", (n) => n.length)) === 0, "no confetti anywhere");
ok(await p.$eval("#title", (i) => !i.disabled), "title unlocked after end");

// ---- Join codes, typing box, standalone ticker
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
const joinCode = await p.textContent("#joinCode");
ok(/^[A-Z]{4}$/.test(joinCode) && !(await p.$eval("#joinLine", (e) => e.hidden)), "console shows a 4-letter join code: " + joinCode);
await p.click("#fsQrBtn");
ok((await p.textContent("#fsCodeText")) === joinCode && await p.isVisible("#fsCode"), "fullscreen card shows the code large");
await p.keyboard.press("Escape");
await p.click("#tabMic");
ok(await p.$eval("#joinLine", (e) => e.hidden), "code hidden on the mic tab (that QR carries the write key)");
await p.click("#tabAudience");
const roomJ = (await p.textContent("#urlDisplay")).split("/").pop();
// join page: typing the code lands on the reader
const j = await ctx.newPage(); track(j, "join");
await j.goto(`${base}/join`);
await j.fill("#code", joinCode.toLowerCase());
await j.waitForURL(`**/live/${roomJ}`);
ok(true, "join page resolves the code to the reader");
await j.waitForFunction(() => document.querySelector("#state").textContent === "Live");
// wrong code shakes and explains
const j2 = await ctx.newPage(); track(j2, "join-bad");
await j2.goto(`${base}/join`);
await j2.fill("#code", "ZZZZ");
await j2.waitForFunction(() => document.querySelector("#err").textContent.length > 0);
ok((await j2.textContent("#err")).includes("No talk"), "bad code gets a clear message");
await j2.screenshot({ path: `${SHOTS}/join.png` });
// short link redirect
const j3 = await ctx.newPage(); track(j3, "join-short");
await j3.goto(`${base}/j/${joinCode}`);
await j3.waitForURL(`**/live/${roomJ}`);
ok(true, "/j/CODE redirects to the reader");
await j3.close();
// typing box: interim while typing, final on Enter
await p.click("#typed");
await p.keyboard.type("Typed by hand");
await j.waitForFunction(() => document.querySelector("#interim").textContent === "Typed by hand");
ok(true, "typing shows as interim on the phones");
await p.keyboard.press("Enter");
await j.waitForFunction(() => [...document.querySelectorAll("#feed p:not(#interim)")].some((x) => x.textContent === "Typed by hand"));
ok((await p.inputValue("#typed")) === "" && (await j.textContent("#interim")) === "", "Enter sends the line and clears the box and the interim");
// standalone ticker with prefs in the query string
const tkUrl = await p.evaluate(() => tickerUrl());
ok(tkUrl.includes(`/ticker/${roomJ}?`) && tkUrl.includes("face=") && tkUrl.includes("ring="), "second-screen URL carries the prefs: " + tkUrl.split("?")[1]);
const tkp = await ctx.newPage(); track(tkp, "ticker");
await tkp.setViewportSize({ width: 1280, height: 200 });
await tkp.goto(`${base}/ticker/${roomJ}?style=paper&face=inter&weight=500&depth=1&flow=settled&ring=lilac`);
await tkp.waitForFunction(() => document.querySelector("#ticker").textContent.includes("Typed by hand"));
const tkst = await tkp.evaluate(() => ({ style: document.body.dataset.style, ff: getComputedStyle(document.body).fontFamily, fw: getComputedStyle(document.body).fontWeight, bg: getComputedStyle(document.body).backgroundColor, prev: document.querySelectorAll(".prev").length }));
ok(tkst.style === "paper" && tkst.ff.includes("Inter") && tkst.fw === "500" && tkst.bg === "rgb(251, 241, 228)" && tkst.prev === 0, "standalone ticker honours query prefs: " + JSON.stringify(tkst));
await p.click("#typed"); await p.keyboard.type("half a"); await new Promise((r) => setTimeout(r, 400));
ok((await tkp.$eval(".interim", (e) => getComputedStyle(e).display)) === "none", "settled ticker hides typed interim");
await p.keyboard.press("Enter");
await tkp.waitForFunction(() => document.querySelector("#ticker").textContent.includes("half a"));
await tkp.screenshot({ path: `${SHOTS}/ticker-paper.png` });
const tki = await ctx.newPage(); track(tki, "ticker-ink");
await tki.setViewportSize({ width: 1280, height: 200 });
await tki.goto(`${base}/ticker/${roomJ}?face=fraunces&depth=2`);
await tki.waitForFunction(() => document.querySelector("#ticker").textContent.includes("half a"));
await tki.screenshot({ path: `${SHOTS}/ticker-ink.png` });
await p.screenshot({ path: `${SHOTS}/presenter-join.png` });
await p.click('[data-pref="style"] [data-v="paper"]');
ok((await p.$eval("#ticker", (t) => t.dataset.style)) === "paper", "console ticker switches to paper");
await p.click('[data-pref="style"] [data-v="ink"]');
await p.click("#stopBtn");
await tkp.waitForFunction(() => document.querySelector("#ticker").classList.contains("over"));
ok(true, "standalone ticker notices the end");
ok(await p.$eval("#typed", (i) => i.disabled) && await p.$eval("#joinLine", (e) => e.hidden), "typing box and code retire with the room");

// ---- Phone handoff: the laptop mic steps aside for the phone and only comes back on its own if the phone drops
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
ok((await p.textContent("#micSource")) === "Laptop mic" && await p.evaluate(() => window.__rec().started === true), "laptop mic live before the phone joins");
ok(!(await p.$eval("#floatBtn", (b) => b.disabled)) || !(await p.evaluate(() => "documentPictureInPicture" in window)), "float button enabled while live where PiP exists");
const roomH = (await p.textContent("#urlDisplay")).split("/").pop();
await p.click("#tabMic"); const tokH = (await p.textContent("#urlDisplay")).split("#")[1]; await p.click("#tabAudience");
const phone = (body) => fetch(`${base}/api/room/${roomH}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokH}` }, body: JSON.stringify({ source: "phone", ...body }) });
// the real mic page announces itself on Go live
const mh = await ctx.newPage(); track(mh, "mic-handoff");
await mh.addInitScript(() => { window.SpeechRecognition = class { start() {} stop() { this.onend?.(); } }; });
await mh.goto(`${base}/mic/${roomH}#${tokH}`);
ok(await mh.isVisible("#guide") && (await mh.$$eval("#guide li", (l) => l.length)) === 3, "mic page shows the three-step guide before going live");
await mh.click("#go");
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Phone mic live");
ok(await p.evaluate(() => window.__rec().started === false && paused === true), "console paused the laptop recogniser when the phone went live");
ok((await p.textContent("#liveText")) === "Live · Phone mic" && (await p.textContent("#pauseBtn")) === "Resume mic", "console status shows the phone as the mic");
ok(!(await mh.isVisible("#guide")), "guide gives way to the echo once live");
// phone words flow with their source; nothing doubled
await phone({ text: "From the pocket.", final: true });
await p.waitForFunction(() => document.querySelector("#ticker").textContent.includes("From the pocket."));
ok((await p.textContent("#ticker")).split("From the pocket.").length === 2, "phone line appears once on the ticker");
// presenter pauses the phone: laptop stays paused, console says why
await mh.click("#go");
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Phone mic paused");
ok(await p.evaluate(() => paused === true && window.__rec().started === false), "laptop mic stays paused after a deliberate phone pause");
ok((await p.textContent("#notice")).includes("Resume mic"), "notice tells the presenter how to take over: " + JSON.stringify(await p.textContent("#notice")));
// phone back on, then it vanishes: after the server marks it lost the laptop comes back by itself
await mh.click("#go");
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Phone mic live");
await mh.close();
ok(true, "phone tab closed (goodbye sent on pagehide)");
await p.waitForFunction(() => document.querySelector("#micSource").textContent !== "Phone mic live", null, { timeout: 5000 });
ok((await p.textContent("#micSource")) === "Phone mic paused", "closing the phone tab announces a pause immediately: " + await p.textContent("#micSource"));
// simulate the lost case directly: live again, then silence past the threshold isn't testable in 45 s here,
// so check the console's lost handling via a synthetic event
await phone({ ping: true, live: true });
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Phone mic live");
await p.evaluate(() => onPhone(false, true));
ok(await p.evaluate(() => paused === false && window.__rec().started === true), "on a dropped phone the laptop mic resumes by itself");
ok((await p.textContent("#notice")).includes("back on"), "notice explains the takeover");
await p.screenshot({ path: `${SHOTS}/presenter-handoff.png` });
// presenter manually resumes while the phone is live: their call, allowed
await phone({ ping: true, live: false }); // sync the relay with the synthetic drop above
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Phone mic paused");
await phone({ ping: true, live: true });
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Phone mic live");
await p.click("body", { position: { x: 5, y: 5 } });
await p.keyboard.press("Space");
await p.waitForFunction(() => paused === false);
ok(await p.evaluate(() => paused === false && window.__rec().started === true), "space resumes the laptop mic even while the phone is live (presenter's call)");
await p.click("#stopBtn");
ok((await p.textContent("#micSource")) === "Laptop mic", "labels reset after the talk");

// ---- Transcript survives: on the phone, on the console, through a reload
await p.fill("#title", "Persist 101");
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
const roomP = (await p.textContent("#urlDisplay")).split("/").pop();
await p.click("#tabMic"); const tokP = (await p.textContent("#urlDisplay")).split("#")[1]; await p.click("#tabAudience");
const pushP = (text) => fetch(`${base}/api/room/${roomP}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokP}` }, body: JSON.stringify({ text, final: true, source: "phone" }) });
const ap = await ctx.newPage(); track(ap, "audience-persist");
await ap.goto(`${base}/live/${roomP}`);
await ap.waitForFunction(() => document.querySelector("#state").textContent === "Live");
for (let i = 1; i <= 60; i++) await pushP(`Sentence number ${i}.`);
await ap.waitForFunction(() => document.querySelectorAll("#feed p:not(#interim)").length === 60);
await p.waitForFunction(() => transcript.length === 60);
ok(await p.evaluate(() => finals.length === 50 && transcript.length === 60), "console keeps the full transcript beyond the ticker's 50-line tail");
await new Promise((r) => setTimeout(r, 1000));
ok(await ap.evaluate(() => JSON.parse(localStorage.getItem(`stl-talk-${location.pathname.split("/").pop()}`)).lines.length === 60), "reader saved 60 lines on the phone");
ok(await p.evaluate(() => JSON.parse(localStorage.getItem("st-talks"))[0].title === "Persist 101"), "console indexed the talk on this machine");
// console reload mid-talk resumes the same room
await p.reload();
await p.waitForFunction(() => typeof room !== "undefined" && room && room.id, null, { timeout: 10000 });
await p.waitForSelector("#stopBtn:not([hidden])");
ok((await p.evaluate(() => room.id)) === roomP && (await p.evaluate(() => transcript.length)) === 60, "console reload resumed the room with the transcript intact");
ok((await p.inputValue("#title")) === "Persist 101" && (await p.textContent("#notice")).includes("Picked"), "resumed console restores the title and says so");
await pushP("After the reload.");
await p.waitForFunction(() => transcript.length === 61);
ok(await p.evaluate(() => transcript[60] === "After the reload."), "lines keep flowing into the resumed transcript");
// console export during the talk
ok(!(await p.$eval("#saveTxMd", (b) => b.disabled)), "export enabled mid-talk");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#saveTxMd")]);
ok(dl.suggestedFilename().startsWith("persist-101-") && dl.suggestedFilename().endsWith(".md"), "markdown named after the title: " + dl.suggestedFilename());
const md = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
ok(md.startsWith("# Persist 101") && md.includes("Sentence number 60.") && md.includes("After the reload."), "markdown has the heading and every line");
// end the talk; the reader page and a fresh visit both keep it
await p.click("#stopBtn");
await ap.waitForFunction(() => !document.querySelector("#endCard").hidden);
ok((await p.textContent("#transcriptStat")).includes("saved on this machine") && !(await p.$eval("#saveTxTxt", (b) => b.disabled)), "console export still works after End talk");
const [dl2] = await Promise.all([p.waitForEvent("download"), p.click("#saveTxTxt")]);
ok(dl2.suggestedFilename().endsWith(".txt"), "txt export after end: " + dl2.suggestedFilename());
await new Promise((r) => setTimeout(r, 300));
const ap2 = await ctx.newPage(); track(ap2, "audience-restored");
await ap2.goto(`${base}/live/${roomP}`);
await ap2.waitForFunction(() => document.querySelector("#state").textContent === "Saved on this phone");
ok((await ap2.$$eval("#feed p:not(#interim)", (n) => n.length)) === 61 && !(await ap2.$eval("#endCard", (c) => c.hidden)), "reopening the link after the room is gone shows the saved talk with the export card");
ok((await ap2.textContent("#talkTitle")) === "Persist 101" && (await ap2.title()).startsWith("Persist 101"), "restored reader keeps the title");
await ap2.setViewportSize({ width: 430, height: 880 });
await ap2.screenshot({ path: `${SHOTS}/audience-saved.png` });
const jp = await ctx.newPage(); track(jp, "join-saved");
await jp.goto(`${base}/join`);
ok(await jp.isVisible("#saved") && (await jp.textContent("#savedList")).includes("Persist 101"), "join page lists the saved talk");
await jp.setViewportSize({ width: 430, height: 880 });
await jp.screenshot({ path: `${SHOTS}/join-saved.png` });
await p.screenshot({ path: `${SHOTS}/presenter-transcript.png` });
// reader restore + still-live room: no duplicates after a reload mid-talk
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
const roomR = (await p.textContent("#urlDisplay")).split("/").pop();
await p.click("#tabMic"); const tokR = (await p.textContent("#urlDisplay")).split("#")[1]; await p.click("#tabAudience");
const ar = await ctx.newPage(); track(ar, "audience-reload");
await ar.goto(`${base}/live/${roomR}`);
await ar.waitForFunction(() => document.querySelector("#state").textContent === "Live");
for (const t of ["Alpha.", "Beta.", "Gamma."]) await fetch(`${base}/api/room/${roomR}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokR}` }, body: JSON.stringify({ text: t, final: true }) });
await ar.waitForFunction(() => document.querySelectorAll("#feed p:not(#interim)").length === 3);
await new Promise((r) => setTimeout(r, 1000));
await ar.reload();
await ar.waitForFunction(() => document.querySelector("#state").textContent === "Live");
await fetch(`${base}/api/room/${roomR}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokR}` }, body: JSON.stringify({ text: "Delta.", final: true }) });
await ar.waitForFunction(() => document.querySelectorAll("#feed p:not(#interim)").length === 4);
ok((await ar.$$eval("#feed p:not(#interim)", (n) => n.map((x) => x.textContent).join(" "))) === "Alpha. Beta. Gamma. Delta.", "reader reload mid-talk restores its copy and merges the backlog without duplicates");
await p.click("#stopBtn");

// ---- Deepgram through the relay (mock upstream): choose the engine, speak, words land everywhere
await p.evaluate(() => { localStorage.removeItem("st-engine"); });
await p.reload();
await p.waitForFunction(() => document.querySelector("#engine") && !document.querySelector("#engine").disabled);
await p.waitForFunction(() => !document.querySelector('#engine option[value="deepgram"]').disabled);
ok(true, "console learned the relay offers Deepgram");
await p.selectOption("#engine", "deepgram");
await p.click("#startBtn");
await p.waitForSelector("#stopBtn:not([hidden])");
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Laptop mic · Deepgram");
ok(true, "console streams to the relay with the Deepgram engine");
ok(await p.$eval("#engine", (s) => s.disabled), "engine locked while live");
const roomD = (await p.textContent("#urlDisplay")).split("/").pop();
const ad = await ctx.newPage(); track(ad, "audience-deepgram");
await ad.goto(`${base}/live/${roomD}`);
await ad.waitForFunction(() => document.querySelector("#state").textContent === "Live");
await p.waitForFunction(() => document.querySelector("#ticker").textContent.includes("Hello from the relay."), null, { timeout: 15000 });
ok(true, "relay-side transcript reaches the console ticker");
await ad.waitForFunction(() => [...document.querySelectorAll("#feed p:not(#interim)")].some((x) => x.textContent === "Hello from the relay."));
ok(true, "and every phone");
await p.waitForFunction(() => transcript.includes("Second line"), null, { timeout: 15000 });
ok(await p.evaluate(() => transcript.join("|")) === "Hello from the relay.|Second line", "utterance end closes the second line: " + await p.evaluate(() => transcript.join("|")));
await p.click("#pauseBtn");
await p.waitForFunction(() => document.querySelector("#micSource").textContent === "Laptop mic paused");
ok(true, "pause stops the audio link");
await p.click("#stopBtn");
ok(!(await p.$eval("#engine", (s) => s.disabled)), "engine unlocked after end");
await p.selectOption("#engine", "browser");
await p.screenshot({ path: `${SHOTS}/presenter-trim.png` });

// ---- Demo: signed noise until the phone scans, then typing lands on it
const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const lap = await dctx.newPage(); track(lap, "demo-laptop");
await lap.goto(`${base}/demo`);
await lap.waitForFunction(() => document.querySelector("#link").dataset.url);
const demoUrl = await lap.$eval("#link", (e) => e.dataset.url);
ok(/\/live\/d[0-9a-f]{12}\?s=/.test(demoUrl) && await lap.isVisible("#qr svg"), "demo shows a signed QR: " + demoUrl.split("/live/")[1].slice(0, 20));
const demoId = demoUrl.split("/live/")[1].split("?")[0];
ok((await (await fetch(`${base}/api/room/${demoId}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status) === 404, "room doesn't exist before the scan");
await lap.screenshot({ path: `${SHOTS}/demo-waiting.png` });
const ph = await dctx.newPage(); track(ph, "demo-phone");
await ph.setViewportSize({ width: 390, height: 800 });
await ph.goto(demoUrl);
await ph.waitForFunction(() => document.querySelector("#state").textContent === "Live");
ok((await ph.textContent("#talkTitle")) === "StageType demo", "scan brings the room alive on the phone");
await lap.waitForFunction(() => document.body.classList.contains("connected"), null, { timeout: 8000 });
ok((await lap.textContent("#statusText")).includes("Type something"), "laptop notices the phone");
await lap.click("#typed");
await lap.keyboard.type("Hello from the landing page");
await ph.waitForFunction(() => document.querySelector("#interim").textContent === "Hello from the landing page");
ok(true, "typing shows live on the phone");
await lap.keyboard.press("Enter");
await ph.waitForFunction(() => [...document.querySelectorAll("#feed p:not(#interim)")].some((x) => x.textContent === "Hello from the landing page"));
await lap.waitForFunction(() => document.querySelector("#ticker").textContent.includes("Hello from the landing page"));
ok(true, "Enter lands the line on the phone and the laptop bar");
await new Promise((r) => setTimeout(r, 1100));
await lap.screenshot({ path: `${SHOTS}/demo-connected.png` });
await ph.screenshot({ path: `${SHOTS}/demo-phone.png` });
const mob = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
const mp = await mob.newPage(); track(mp, "demo-mobile");
await mp.goto(`${base}/demo`);
ok(await mp.isVisible("#sample") && !(await mp.isVisible(".card")), "on a phone: sample instead of a QR to scan");
await mp.click("#sample");
await mp.waitForFunction(() => document.querySelector("#ticker").textContent.includes("Everyone here reads along"), null, { timeout: 15000 });
ok(true, "sample plays into the bar");
await mob.close(); await dctx.close();

console.log(errors.length ? "JS ERRORS:\n" + errors.join("\n") : "no JS errors on any page");
await browser.close();
await relay.shutdown();
await upstream.shutdown();
if (failed || errors.length) {
  console.error(`\n${failed} failed assertion(s), ${errors.length} JS error(s)`);
  Deno.exit(1);
}
console.log("\nall browser checks passed");
Deno.exit(0);
