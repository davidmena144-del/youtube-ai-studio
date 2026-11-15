# Optional: worker/CLI image for running the media worker anywhere Docker runs.
# The default free setup does NOT need this image (the worker runs on GitHub Actions directly).
#   worker: docker run --env-file .env IMAGE
#   cli:    docker run --env-file .env IMAGE npm run studio -- status
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is used by the media pipeline (Phase 4).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Runtime dependencies only (tsx is one: the worker, CLI and migrations run TypeScript directly).
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src
RUN useradd --create-home app
USER app
# Migrations are serialised with an advisory lock, so several containers may start together.
CMD ["sh", "-c", "npm run db:migrate && npm run worker:once"]
