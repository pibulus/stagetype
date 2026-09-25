# Deploying StageType

The relay isn't tied to a LAN. Put it on any box with an address and https and the whole thing works over the internet the way Jackbox does: the audience joins from cellular, the phone mic gets its https, and the join code works from anywhere. What it needs is **one process on one machine**, because rooms live in memory. That rules out multi-isolate serverless (Deno Deploy, Lambda) until rooms move to a shared store, and rules in any small VPS, a Raspberry Pi with a tunnel, or a Fly machine.

Fly, from a clone:

```bash
fly launch --copy-config --no-deploy   # takes fly.toml as is; pick your own app name
fly deploy
```

Set a demo secret so `/demo` QR codes survive restarts: `fly secrets set STAGETYPE_SECRET=$(openssl rand -hex 32)`.

`fly.toml` pins one machine that never sleeps (a sleeping machine ends every talk). The `Dockerfile` runs the relay with the exact permissions it needs and nothing more. Any Docker host works the same way: `docker build -t stagetype . && docker run -p 8787:8787 stagetype`, then put https in front of it.

## Environment

| Variable | Default | What it does |
| :--- | :--- | :--- |
| `PORT` | `8787` | Port the relay listens on |
| `STAGETYPE_SECRET` | random per process | Signs `/demo` room ids. **Set it in production**, or every demo QR dies on restart |
| `DEEPGRAM_API_KEY` | unset | Turns on the Deepgram engine. Without it, browser speech only |
| `DEEPGRAM_MODEL` | `nova-3` | Deepgram model for the relay-side engine |
| `DEEPGRAM_URL` | Deepgram's live endpoint | Override for a proxy or a test double |

Copy `.env.example` to `.env` for local work and run with `deno run --env-file ...`, or export the variables. On Fly, use secrets:

```bash
fly secrets set STAGETYPE_SECRET=$(openssl rand -hex 32)
fly secrets set DEEPGRAM_API_KEY=dg_…
```

## Launch checklist

- [ ] `STAGETYPE_SECRET` set
- [ ] https in front of the relay (Fly does this; anywhere else, a reverse proxy)
- [ ] One instance only, never scaled to zero
- [ ] `DEEPGRAM_API_KEY` set if you want the Deepgram engine
- [ ] `deno task ci` and `deno task e2e` green on the commit you ship

## Rehearsing on a local network

Mobile Safari and mobile Chrome enforce HTTPS for microphone access (`getUserMedia` and Web Speech API are blocked over plain local `http://192.168.x.x`).

For wireless lapel mic rehearsals on a local network, expose the local port via `cloudflared`:

```bash
cloudflared tunnel --url http://localhost:8787
```

Scan the resulting `https://*.trycloudflare.com` QR code with your phone to use the phone as your wireless stage microphone.

The same applies to the audience: a QR that points at `http://192.168.x.x:8787` only works for phones on the same wifi. At a meetup where people are on cellular, run the presenter console through the tunnel URL (or a small public host) so the audience QR is reachable from anywhere. The relay is a single process with rooms in memory, so it wants one instance, not a serverless fleet.
