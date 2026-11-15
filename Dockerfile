# Single image for any container host (Render, Fly.io, Railway, Cloud Run, Koyeb).
#   web:    docker run -p 3000:3000 --env-file .env IMAGE
#   worker: docker run --env-file .env IMAGE npm run worker
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is needed by the media pipeline from phase 2.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
RUN useradd --create-home app && chown -R app /app
USER app
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npx next start -p ${PORT:-3000}"]
