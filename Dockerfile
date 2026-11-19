# StageType on the open web: one small box, one process, rooms in memory.
FROM denoland/deno:2.9.7
WORKDIR /app
COPY deno.json deno.lock server.ts signed_noise.ts ./
COPY *.html ghost.svg shared.js deepgram.js sw.js manifest.webmanifest apple-touch-icon.png og-image.png ./
COPY vendor ./vendor
RUN deno cache server.ts
ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787
USER deno
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["deno", "eval", "const r = await fetch('http://127.0.0.1:' + (Deno.env.get('PORT') || '8787') + '/healthz'); if (!r.ok) Deno.exit(1);"]
CMD ["run", "--allow-net", "--allow-read=/app", "--allow-env=PORT,HOST,TRUST_PROXY,FLY_APP_NAME,STAGETYPE_SECRET,DEEPGRAM_API_KEY,DEEPGRAM_MODEL,DEEPGRAM_URL,STAGETYPE_DEEPGRAM_PASS,STAGETYPE_VERSION,MAX_ASSET_RAM_MB", "--allow-sys=networkInterfaces", "server.ts"]
