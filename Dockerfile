# StageType on the open web: one small box, one process, rooms in memory.
FROM denoland/deno:2.9.7
WORKDIR /app
COPY deno.json deno.lock server.ts ./
COPY *.html ghost.svg ./
COPY vendor ./vendor
RUN deno cache server.ts
ENV PORT=8787
EXPOSE 8787
USER deno
CMD ["run", "--allow-net", "--allow-read", "--allow-env", "--allow-sys=networkInterfaces", "server.ts"]
