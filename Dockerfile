FROM node:24-bookworm-slim

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AGENT_URL=http://127.0.0.1:2000 \
    LOCAL_DB_PATH=/app/.beeblio/beeblio.sqlite \
    DEBIAN_FRONTEND=noninteractive

# Configure apt retries and install python3 runtime for Eve agent analysis and helper scripts
RUN echo 'Acquire::Retries "3";' > /etc/apt/apt.conf.d/80-retries && \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-pandas \
    python-is-python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm matching packageManager in package.json
RUN npm install -g pnpm@11.17.0

WORKDIR /app

# Copy dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Configure generous fetch timeouts so large binaries download reliably
RUN pnpm config set fetch-timeout 300000 && \
    pnpm config set fetch-retries 5 && \
    pnpm install --frozen-lockfile

# Copy application source code
COPY . .

# Build Next.js application (.next) and Eve agent (.output), then clean package caches
RUN pnpm build && pnpm build:eve && \
    pnpm store prune && \
    rm -rf /root/.local/share/pnpm/store /root/.cache /tmp/*

# Create data directory and projects mount point
RUN mkdir -p /app/.beeblio /projects

# Define persistent volumes
VOLUME ["/app/.beeblio", "/projects"]

# Expose Next.js web interface
EXPOSE 3000

# Health check using Node 24 native fetch
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/icon.svg').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start migrations, Eve agent, and Next.js UI
CMD ["node", "scripts/docker-start.mjs"]
