# Single-service image: build the Vite SPA, then run FastAPI serving the SPA + API
# from one origin (SameSite=Lax cookies, zero CORS). One Railway service.

# --- Stage 1: build the SPA ---------------------------------------------------------
# Pinned to the BUILD platform, not the target: the output is plain JS/CSS and works on any
# architecture, so pinning keeps the Vite build native even when the final image is arm64 —
# otherwise a multi-arch build runs pnpm under QEMU and takes an order of magnitude longer.
# Node 24 = Active LTS (security support to 2028-04-30). Node 20 went end-of-life on
# 2026-04-30 and this stage sat on it for three months. Keep in step with node-version in
# .github/workflows/ci.yml and the engines field in package.json; dependabot's docker
# ecosystem now proposes the bumps so it cannot drift silently again.
# Named on Docker Hub, which Dependabot reads (through ECR Public it was answered with 429s).
# CI's BuildKit resolves docker.io through mirror.gcr.io instead (.github/actions/stack).
FROM --platform=$BUILDPLATFORM node:24-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS frontend
WORKDIR /app
# Pin pnpm 10 (matches lockfileVersion 9.0). corepack's bundled default is incompatible
# with the Node line above, so install explicitly.
RUN npm install -g pnpm@10.18.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# Only SPA inputs: a backend, workflow or docs edit must not rebuild the frontend. Vite also
# reads the coverage floor while resolving its config, even for a production build, and
# imports the iOS launch-image generator (vite.config · iosStartupImages).
COPY index.html vite.config.ts tsconfig.json ./
COPY scripts/coverage-floor.json scripts/startup-images.mjs ./scripts/
COPY src ./src
COPY public ./public
# .git is dockerignored, so the build stamp's sha comes in as a build arg: Railway passes
# RAILWAY_GIT_COMMIT_SHA automatically for declared ARGs; other builders may pass GIT_SHA.
# Falls back to 'dev' in the label — update detection doesn't depend on it (swUpdate.ts).
ARG RAILWAY_GIT_COMMIT_SHA=""
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA:-$RAILWAY_GIT_COMMIT_SHA}
RUN pnpm build

# --- Stage 2: backend runtime -------------------------------------------------------
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58
WORKDIR /app/backend

# pg_dump for the pre-migration safety dump in start.sh (and manual in-container dumps).
# It comes from PGDG, not from Debian: bookworm ships client 15, and pg_dump refuses to dump
# a server NEWER than itself. So every migration logged «pre-migration dump failed —
# continuing, but fix your backups» and then migrated with no backup at all — on CI and on
# every self-hosted box following SETUP.md.
#
# ⚠️ This must be >= the HIGHEST server major this image will ever be pointed at, not just
# the one in docker-compose.yml. Pinning it to the compose image (16) is what broke it the
# second time: compose runs postgres:16, but Railway production runs 18.x, so a client that
# matched compose still could not dump production — and start.sh's guard skipped the dump
# silently on every deploy. A newer client dumps an older server fine, never the reverse,
# so one pin at the highest server covers every deployment target:
#     Railway production 18.x  ─┐
#     docker-compose  16       ─┴─> postgresql-client-18
# Verify with `SHOW server_version` against each target before lowering this.
#
# The key is fetched by the builder itself (no curl/gnupg in the image); apt reads an
# ASCII-armored keyring directly as long as it is named .asc.
ARG PG_CLIENT_MAJOR=18
ADD --checksum=sha256:0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76 --chmod=644 https://www.postgresql.org/media/keys/ACCC4CF8.asc /etc/apt/keyrings/pgdg.asc
# ffmpeg decodes uploaded voice memos server-side: waveform peaks + the STT re-encode
# (docs/planning/audio-player-markers.md). Missing ffmpeg degrades to a flat seek bar.
# fonts-dejavu-core: the server-side Kroki/plan renderer (app/kroki.py) needs a real
# sans font — PIL labels AND resvg's <text> letters in the tactical-symbol pack; without
# it the symbol letters (F/W/…) silently vanish from the rendered glyphs.
RUN echo "deb [signed-by=/etc/apt/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends "postgresql-client-${PG_CLIENT_MAJOR}" ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install the environment as its runtime owner. A late recursive chown of /app copied the
# whole venv into another image layer on every SPA change (24–49 s on Railway).
RUN useradd --uid 10001 --create-home app \
    && install -d -o app -g app /app/backend /data/storage /mnt/data/storage
USER app

# Install Python deps first from the lockfile alone, so editing backend code doesn't
# re-resolve/re-download every dependency (this layer is cached unless deps change).
# `--extra georef` ships the CV alignment stack (cv2/numpy/scipy, ~60 MB): without it the
# server reports autoAlignConfigured=false and «Automatisch ausrichten» plus the alignment
# worker are silently absent from the deployment (observed on FWO prod 11.09.2026).
COPY --chown=app:app backend/pyproject.toml backend/uv.lock /app/backend/
RUN uv sync --locked --no-dev --no-install-project --extra georef

# Then the app code (+ install the project itself into the existing venv).
COPY --chown=app:app backend/ /app/backend/
RUN uv sync --locked --no-dev --extra georef

# SPA build + public assets (plans, leitungskataster, symbols seed source).
COPY --from=frontend --chown=app:app /app/dist /app/dist
COPY --chown=app:app public /app/public
# Synthetic demo dataset (Musterdorf) — small (~276K). Needed in-image so the demo deployment's
# in-process auto-reset (DEMO_RESET_SECONDS) can read examples/demo-data/incident.workspace.json.
COPY --chown=app:app examples /app/examples

ENV SPA_DIR=/app/dist
# Railway volume mount for media / snapshots / reference files.
ENV MEDIA_STORAGE_DIR=/mnt/data/storage
ENV SEED_DATABASE=true

# Empty compose volumes inherit the app-owned storage directories created above. Railway's
# root-owned mount still needs its documented override; /ready checks actual writability.
RUN chmod +x /app/backend/start.sh
# Which build is this? A release number cannot tell a from-source build of `main` apart from a
# published image of the same tag. .git is dockerignored, so the sha comes in as a build arg
# (release.yml passes GIT_SHA; Railway passes RAILWAY_GIT_COMMIT_SHA for a declared ARG).
# Surfaced by /health and /api/system – see Settings.build.
# Last in the stage on purpose: a changing sha invalidates no layer above it.
ARG GIT_SHA=""
ARG RAILWAY_GIT_COMMIT_SHA=""
# CI identifies the complete image without invalidating the frontend's test-build layer.
# Source/release deployments still use GIT_SHA / Railway's SHA in BOTH stages as before.
ARG RUNTIME_GIT_SHA=""
ARG BUILD_TIME=""
ENV GIT_SHA=${GIT_SHA:-$RAILWAY_GIT_COMMIT_SHA} \
    BUILD_TIME=${BUILD_TIME}
ENV GIT_SHA=${RUNTIME_GIT_SHA:-$GIT_SHA}

USER app
CMD ["/app/backend/start.sh"]
