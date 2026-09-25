# Security

## Reporting a vulnerability

Please email **pibulus@gmail.com** with "StageType security" in the subject, rather than opening a public issue. Include what you found, how to reproduce it, and what you think the impact is. You'll get a reply within a week.

## What StageType protects

- **Write access to a room.** Only holders of the room's token can add captions or end a talk. Tokens are 32 hex characters, compared in constant time, sent in an `Authorization` header or WebSocket subprotocol, and never in a URL the server sees. The phone mic link carries its token in the `#fragment`.
- **The relay's resources.** Rooms, listeners per room, backlog length, request body size and demo rooms are all capped. Demo ids are HMAC-signed and stored nowhere until used.
- **Keys.** The Deepgram key lives only on the relay. Browsers never see it.

## What it deliberately doesn't do

- **Reading is public to anyone with the link or join code.** A talk is a public room by design. Don't caption anything you wouldn't say to the room.
- **No accounts, no stored transcripts on the server.** Copies live on the devices of the people who were there.
- **Browser speech sends audio to Google or Apple.** Use the Deepgram engine, or later the on-device Mac app, when that matters.

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-and-privacy).
