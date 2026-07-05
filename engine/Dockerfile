# syntax=docker/dockerfile:1
#
# Engine image: Node 22 + Playwright/Chromium (for pdf/generate-pdf.mjs) + supercronic
# (for the in-container schedule, see docker/crontab).
#
# NOTE: we deliberately do NOT use mcr.microsoft.com/playwright:*-jammy here — that image
# pins its own Node version (currently 24.x) which would drift from the rest of this repo's
# Node 22 pin (.nvmrc, app/Dockerfile). Instead we start from node:22-slim (Debian, not
# Alpine — Alpine lacks reliable prebuilt Chromium support for Playwright) and install the
# browser + its OS deps explicitly. Image size cost: roughly +300-400MB for Chromium + libs.
#
# IMPORTANT: `playwright install --with-deps` must run in the SAME final image that runs
# the browser — it installs OS-level shared libraries (libglib2.0, X11/font/codec libs) via
# apt into the filesystem, not just the browser binary. Splitting this into an earlier build
# stage and `COPY --from=` only the browser binary into a fresh stage silently drops those
# shared libs and Chromium fails at launch (`error while loading shared libraries`,
# verified during assembly). So there is deliberately no separate deps/runner split here.

FROM node:22-slim AS base
WORKDIR /app
# Fixed browser install location, independent of $HOME — so it works regardless of which
# user (root during build, `node` at runtime) is active when it's read.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Installs Chromium + its OS-level libraries (fonts, codecs, X11 libs, etc. via apt).
# Requires root, which is the default user at this point in the build.
RUN npx playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

# ---- supercronic (container-native cron, drives docker/crontab) ----
# Statically-linked Go binary — safe to build in an isolated stage and copy across, unlike
# Chromium above (no shared-library dependents beyond libc).
FROM node:22-slim AS supercronic
ARG SUPERCRONIC_VERSION=v0.2.47
ARG SUPERCRONIC_SHA1=712d2ece75da6f6e530192a151488578153e4e96
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSLo /usr/local/bin/supercronic \
       "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
    && echo "${SUPERCRONIC_SHA1}  /usr/local/bin/supercronic" | sha1sum -c - \
    && chmod +x /usr/local/bin/supercronic

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production

COPY --from=supercronic /usr/local/bin/supercronic /usr/local/bin/supercronic
COPY --chown=node:node . .

# Directories the engine writes to at runtime — created up front, owned by the runtime
# user, so a bind/named volume mount target always exists even before the first
# tailor/apply run.
RUN mkdir -p ./output ./apply-log && chown -R node:node ./output ./apply-log

# node:22-slim already ships an unprivileged `node` user (uid 1000). Running Chromium as
# root requires either `--no-sandbox` (weaker isolation) or extra namespace plumbing;
# running as a normal user avoids both.
USER node

# Default: run the in-container schedule (see docker/crontab). Override the command to run
# a one-off CLI invocation instead, e.g.:
#   docker compose run --rm engine node src/cli.js discover
CMD ["supercronic", "-passthrough-logs", "docker/crontab"]
