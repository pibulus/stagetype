// deno-lint-ignore-file no-window
import { chromium } from "playwright-core";
import { handler } from "../server.ts";

const relay = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, handler);
const base = `http://localhost:${relay.addr.port}`;
const SHOTS = new URL("./screenshots", import.meta.url).pathname;
await Deno.mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: Deno.env.get("CHROMIUM_PATH") || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const ctx = await browser.newContext({
  viewport: { width: 1200, height: 860 },
  deviceScaleFactor: 2,
});

const p = await ctx.newPage();

// Fake SpeechRecognition
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
await p.waitForSelector("#lobbyCard:not([hidden])");

// State 1: Lobby / Walk-in
await p.fill("#title", "Designing Tools with Personality, Utility, and Soul");
await p.waitForTimeout(300);
await p.screenshot({ path: `${SHOTS}/1-lobby-walkin.png` });
console.log("Captured 1-lobby-walkin.png");

// State 2: On-Air / Flow Hero Ticker
await p.click("#startBtn");
await p.waitForSelector("#onAirDeck:not([hidden])");
// Emit captions via local mic recogniser
await p.evaluate(() => {
  window.__rec().emit("Live captions on the big stage.", true);
  window.__rec().emit("Clear, readable, alive.", true);
});

await p.waitForFunction(() => document.querySelector("#ticker").textContent.includes("readable, alive."));
await p.waitForTimeout(500);
await p.screenshot({ path: `${SHOTS}/2-onair-hero.png` });
console.log("Captured 2-onair-hero.png");

// Screen 2: Backstage Rehearsal & Deck Settings
const backstageEl = await p.$("#backstage");
if (backstageEl) {
  await backstageEl.scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/4-backstage-deck.png` });
  console.log("Captured 4-backstage-deck.png");
}

// State 3: Wrap-Up / Decompression (Thermal Receipt)
await p.click("#stopBtn");
await p.waitForSelector("#receiptCard:not([hidden])");
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(500);
await p.screenshot({ path: `${SHOTS}/3-thermal-receipt.png` });
console.log("Captured 3-thermal-receipt.png");

await browser.close();
await relay.shutdown();
console.log("All screenshots successfully captured!");
