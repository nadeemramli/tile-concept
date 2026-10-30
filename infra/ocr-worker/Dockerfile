# Tile Concept OCR worker (TILE-22). Build from the repository root:
#   docker build -f infra/ocr-worker/Dockerfile -t tile-concept-ocr-worker:<commit> .
# Debian, not Alpine: sharp ships glibc binaries and Debian packages Tesseract
# with English data.
FROM node:24.19.0-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# Dependencies first, from the lockfile only, so code changes reuse the layer.
# The full lockfile is installed because the worker runs under tsx (a dev
# dependency) and imports the app's own OCR modules directly.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN corepack enable && pnpm install --frozen-lockfile \
 && pnpm store prune

# Only what the worker imports: the script, the OCR engine and the parsers it uses.
COPY tsconfig.json ./
COPY scripts/ocr ./scripts/ocr
COPY src/lib/ocr ./src/lib/ocr
COPY src/lib/parsers ./src/lib/parsers

RUN tesseract --version && tesseract --list-langs | grep -qx eng

USER node
ENTRYPOINT ["node_modules/.bin/tsx", "scripts/ocr/worker.mts"]
CMD ["--poll=10000"]
