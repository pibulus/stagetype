# Deploying StageType

The relay isn't tied to a LAN. Put it on any single box with an address and https and the whole thing works over the internet the way Jackbox does: the audience joins from cellular, the phone mic gets its https, and the join code works from anywhere. What it needs is **one process on one machine**, because rooms live in memory. That rules out multi-isolate serverless (Deno Deploy, Lambda) until rooms move to a shared store, and rules in **a single Linux box behind Cloudflare Tunnel (e.g. CHONK systemd)**, any small VPS, or a single Fly machine.

## Option 1: Single Linux box + systemd + Cloudflare Tunnel (Recommended first home)

Bind strictly to loopback (`HOST=127.0.0.1`) so every external request passes through Cloudflare TLS, and set `TRUST_PROXY=cloudflare` so rate limits isolate each attendee's real IP via `CF-Connecting-IP` (only trusted from loopback):

```bash
# EnvironmentFile=/etc/stagetype.env (chmod 600)
PORT=8787
HOST=127.0.0.1
TRUST_PROXY=cloudflare
MAX_ASSET_RAM_MB=128
STAGETYPE_SECRET=<openssl rand -hex 32>
STAGETYPE_VERSION=<git rev-parse --short HEAD>
# Leave DEEPGRAM_API_KEY unset for free browser-speech-only launch,
# OR pair it with STAGETYPE_DEEPGRAM_PASS so anonymous visitors cannot drain your balance.
```

Run with scoped Deno permissions (`deno task start`) and set systemd `MemoryMax=512M` + `Restart=always`. Probe health at `/healthz` and deployed commit at `/version.json`.

## Option 2: Fly.io (`fly.toml`)

```bash
fly launch --copy-config --no-deploy   # takes fly.toml (512mb, syd, /healthz check)
fly secrets set STAGETYPE_SECRET=$(openssl rand -hex 32)
# Only set DEEPGRAM_API_KEY publicly if you also gate it with STAGETYPE_DEEPGRAM_PASS:
# fly secrets set DEEPGRAM_API_KEY=dg_… STAGETYPE_DEEPGRAM_PASS=$(openssl rand -hex 16)
fly deploy
```

`fly.toml` pins one `512mb` machine that never sleeps (a sleeping machine ends every talk). The `Dockerfile` runs with scoped `--allow-read=/app`, explicit `--allow-env=...`, and a `/healthz` `HEALTHCHECK`.

## Environment

| Variable | Default | What it does |
| :--- | :--- | :--- |
| `PORT` | `8787` | Port the relay listens on (`1..65535`) |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` behind `cloudflared` / local reverse proxy) |
| `TRUST_PROXY` | unset | `cloudflare` (reads `CF-Connecting-IP` from loopback only), `fly` (`Fly-Client-IP`), or blank |
| `MAX_ASSET_RAM_MB` | `128` | Global RAM cap (MB) for live shared images across all open rooms |
| `STAGETYPE_SECRET` | random per process | Signs `/demo` room ids. **Set in production**, or demo QRs die on restart |
| `DEEPGRAM_API_KEY` | unset | Turns on the Deepgram engine. Without it, browser speech only |
| `STAGETYPE_DEEPGRAM_PASS` | unset | Pass code gating `WS /api/room/:id/audio` (strongly recommended on public relays) |
| `DEEPGRAM_MODEL` | `nova-3` | Deepgram model for the relay-side engine |
| `DEEPGRAM_URL` | Deepgram's live endpoint | Override for a proxy or a test double |
| `STAGETYPE_VERSION` | `dev` | Commit SHA served at `/version.json` |

## Launch checklist

- [ ] `STAGETYPE_SECRET` set (32+ random bytes)
- [ ] `HOST=127.0.0.1` + `TRUST_PROXY=cloudflare` on box/tunnel (or `TRUST_PROXY=fly` on Fly)
- [ ] https in front of the relay, one instance only, never scaled to zero
- [ ] `DEEPGRAM_API_KEY` unset for open browser-only launch, **or** gated with `STAGETYPE_DEEPGRAM_PASS`
- [ ] `deno task ci` and `deno task e2e` green on the commit you ship
- [ ] `/healthz` answers `{"ok":true,...}` and `/version.json` matches git HEAD

## Rehearsing on a local network

Mobile Safari and mobile Chrome enforce HTTPS for microphone access (`getUserMedia` and Web Speech API are blocked over plain local `http://192.168.x.x`). Expose the local port via `cloudflared`:

```bash
cloudflared tunnel --url http://localhost:8787
```

## Zero-internet LAN mode (`deno task listen-local`)

Pipe any local on-device transcriber (such as `whisper-stream`) into a room using the pairing URL from the **Mic** modal (prefer the env var so the `#token` stays out of shell history and `ps`):

```bash
STAGETYPE_MIC_URL="http://localhost:8787/mic/<roomId>#<token>" whisper-stream -m ggml-base.en.bin | deno task listen-local --speaker Host
# Or spawn the command directly:
STAGETYPE_MIC_URL="http://localhost:8787/mic/<roomId>#<token>" deno task listen-local --speaker Host --cmd "whisper-stream -m ggml-base.en.bin"
```
