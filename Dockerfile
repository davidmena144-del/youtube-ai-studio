# Single image for any container host (Render, Fly.io, Railway, Cloud Run, Koyeb).
#   web:    docker run -p 3000:3000 --env-file .env IMAGE
#   worker: docker run --env-file .env IMAGE npm run worker
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is needed by the media pipeline from phase 2.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Runtime dependencies only (tsx is one: the worker and migrations run TypeScript directly).
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY next.config.ts tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src
RUN useradd --create-home app && chown -R app /app/.next
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are serialised with an advisory lock, so several replicas may start together.
CMD ["sh", "-c", "npm run db:migrate && npx next start -p ${PORT:-3000}"]
