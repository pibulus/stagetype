// Zero-internet LAN caption pipe: reads lines from stdin (or spawns a local speech command via --cmd)
// and posts them to a StageType room on the local network.
//
// Usage:
//   STAGETYPE_MIC_URL="http://localhost:8787/mic/<id>#<token>" whisper-stream -m ggml-base.en.bin | deno task listen-local
//   whisper-stream -m ggml-base.en.bin | deno task listen-local "http://localhost:8787/mic/<id>#<token>" --speaker Host
//   deno task listen-local "http://localhost:8787/mic/<id>#<token>" --speaker Host --cmd "whisper-stream -m ggml-base.en.bin"

export interface LocalTarget {
  origin: string;
  roomId: string;
  token: string;
  speaker?: string;
  phoneId?: string;
}

export function parseMicTarget(rawUrl: string, speaker?: string): LocalTarget {
  const u = new URL(rawUrl.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Expected an http:// or https:// StageType mic pairing URL");
  }
  const m = u.pathname.match(/^\/(?:mic|live)\/([a-z0-9]{6,64})\/?$/i);
  const roomId = m?.[1] || "";
  const token = u.hash.replace(/^#/, "").trim();
  if (!roomId || !token) {
    throw new Error("Expected a StageType mic pairing URL ending with /mic/<roomId>#<token>");
  }
  const spk = speaker?.trim() || u.searchParams.get("speaker")?.trim() || undefined;
  return { origin: u.origin, roomId, token, ...(spk ? { speaker: spk.slice(0, 24) } : {}) };
}

// Strips ANSI escape codes, whisper-stream bracketed timestamps ([00:00.000 --> 00:05.000]), and blank-audio markers.
export function cleanTranscriptLine(raw: string): string {
  // If a line contains carriage-return redraws (\r), keep the last non-empty segment on that line.
  const segments = raw.split("\r").map((s) => s.trim()).filter(Boolean);
  const line = segments.length ? segments[segments.length - 1] : raw;
  return line
    // deno-lint-ignore no-control-regex
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\[\d{2}:\d{2}[:.\d\s->]+\]/g, "")
    .replace(/\[(BLANK_AUDIO|MUSIC|SILENCE|NOISE|INAUDIBLE)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function postLocalLine(
  target: LocalTarget,
  text: string,
  isFinal = true,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const cleaned = cleanTranscriptLine(text);
  if (!cleaned) return false;
  const res = await fetchFn(`${target.origin}/api/room/${target.roomId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.token}`,
    },
    body: JSON.stringify({
      text: cleaned,
      final: isFinal,
      source: "phone",
      ...(target.phoneId ? { phone: target.phoneId } : {}),
      ...(target.speaker ? { speaker: target.speaker } : {}),
    }),
  });
  return res.ok;
}

if (import.meta.main) {
  const args = [...Deno.args];
  let urlArg = Deno.env.get("STAGETYPE_MIC_URL") || "";
  let speaker = Deno.env.get("STAGETYPE_SPEAKER") || undefined;
  let cmd = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--speaker" && args[i + 1]) {
      speaker = args[++i];
    } else if (args[i] === "--cmd" && args[i + 1]) {
      cmd = args[++i];
    } else if (!args[i].startsWith("--") && !urlArg) {
      urlArg = args[i];
    }
  }
  if (!urlArg) {
    console.error(
      'Usage: whisper-stream ... | deno task listen-local "http://localhost:8787/mic/<roomId>#<token>" [--speaker Name] [--cmd "..."]',
    );
    Deno.exit(1);
  }
  const target = parseMicTarget(urlArg, speaker);
  target.phoneId = `cli-${crypto.randomUUID().slice(0, 8)}`;

  const sendPing = async (live: boolean): Promise<boolean> => {
    try {
      const r = await fetch(`${target.origin}/api/room/${target.roomId}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${target.token}` },
        body: JSON.stringify({ ping: true, source: "phone", live, phone: target.phoneId }),
      });
      return r.ok;
    } catch {
      return false;
    }
  };

  // Verify the room and pairing token on the relay before announcing connection
  const connected = await sendPing(true);
  if (!connected) {
    console.error(
      `[StageType listen-local] Could not connect to ${target.origin}/api/room/${target.roomId} (relay unreachable, room closed, or invalid token).`,
    );
    Deno.exit(1);
  }
  console.error(
    `[StageType listen-local] Connected to ${target.origin}/live/${target.roomId}${
      target.speaker ? ` as ${target.speaker}` : ""
    }. Reading lines from ${cmd ? `command (${cmd})` : "stdin"}...`,
  );

  let child: Deno.ChildProcess | null = null;
  let sourceStream: ReadableStream<Uint8Array> = Deno.stdin.readable;
  if (cmd) {
    child = new Deno.Command("sh", { args: ["-c", cmd], stdout: "piped", stderr: "inherit" }).spawn();
    sourceStream = child.stdout;
  }

  const heartbeat = setInterval(() => {
    sendPing(true);
  }, 20_000);
  const shutdown = async () => {
    clearInterval(heartbeat);
    try {
      child?.kill("SIGTERM");
    } catch { /* already exited */ }
    await sendPing(false);
    Deno.exit(0);
  };
  try {
    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);
  } catch { /* signal listeners optional */ }

  try {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of sourceStream) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const ok = await postLocalLine(target, line, true).catch(() => false);
        if (!ok && cleanTranscriptLine(line)) {
          console.error("[StageType listen-local] Warning: failed to post line to room.");
        }
      }
    }
    if (buf.trim()) {
      const ok = await postLocalLine(target, buf, true).catch(() => false);
      if (!ok && cleanTranscriptLine(buf)) {
        console.error("[StageType listen-local] Warning: failed to post final line to room.");
      }
    }
  } finally {
    clearInterval(heartbeat);
    try {
      child?.kill("SIGTERM");
    } catch { /* already exited */ }
    await sendPing(false);
  }
}
