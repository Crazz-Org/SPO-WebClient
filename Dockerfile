# ============================================================
# Stage 1: Build
# ============================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Release version (e.g. v1.80.0), passed by the deploy as a build argument.
# Declared after npm ci so the dependency layer stays cached across releases.
ARG APP_VERSION

# Copy source code and build configs
COPY tsconfig.json tsconfig.client.json vite.config.ts ./
COPY src/ src/
COPY public/ public/

# Build server (TypeScript -> dist/) and client (Vite -> public/app.js + app.css)
# Stamp the version into package.json (the same stamp release.yml uses); vite reads it
# into __APP_VERSION__. With no argument the manifest keeps its committed version.
RUN if [ -n "$APP_VERSION" ]; then npm version "${APP_VERSION#v}" --no-git-tag-version --allow-same-version; fi
RUN npm run build

# ============================================================
# Stage 2: Production
# ============================================================
FROM node:22-bookworm-slim AS production

# Install p7zip for CAB extraction (7zip-min needs 7za binary on Linux)
RUN apt-get update && \
    apt-get install -y --no-install-recommends p7zip-full && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user inside container (fixed UID/GID for bind-mount permissions)
RUN groupadd -r -g 1001 spo && useradd -r -u 1001 -g spo -m spo

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# The stamped manifest, so the server reads the release version at runtime
COPY --from=builder /app/package.json ./package.json

# Copy built artifacts from builder stage
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/public/ ./public/

# Create runtime directories (mounted as volumes in production)
RUN mkdir -p /app/cache /app/webclient-cache /app/logs && \
    chown -R spo:spo /app

# Switch to non-root user
USER spo

EXPOSE 8080

# Readiness probe. /api/startup-status is a Server-Sent Events stream that writes its 200
# header BEFORE initialisation finishes, so "did it answer 200?" is green for a gateway
# that is listening but hung. This consumes the stream instead and succeeds only on a
# `ready` event; a hung start produces no such event and the probe fails.
# start-period covers the 120 s the deploy health gate allows (policy SEC-R-3): a slow
# start is never marked unhealthy, a hung one never turns healthy. The deploy script in
# SPO-Deploy reads this status and rolls the deployment back when it never becomes `healthy`.
HEALTHCHECK --interval=10s --timeout=5s --start-period=120s --retries=3 \
    CMD node -e 'const http=require("http");const t=setTimeout(()=>process.exit(1),4000);const r=http.get("http://localhost:8080/api/startup-status",s=>{if(s.statusCode!==200)process.exit(1);let b="";s.setEncoding("utf8");s.on("data",c=>{b+=c;if(b.includes(`"phase":"ready"`)){clearTimeout(t);process.exit(0)}});s.on("end",()=>process.exit(1))});r.on("error",()=>process.exit(1))'

CMD ["node", "--disable-warning=DEP0040", "dist/server/server.js"]
