FROM node:22-slim

LABEL org.opencontainers.image.source="https://github.com/magratheazaphod/baby-tracker" \
      org.opencontainers.image.description="Self-hosted baby-tracking PWA for two caregivers"

WORKDIR /app
ENV NODE_ENV=production

# sharp and better-sqlite3 both ship prebuilt binaries for linux/amd64 and
# linux/arm64 (glibc), so npm ci needs no compiler toolchain on either arch.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV DATA_DIR=/data
EXPOSE 3000

# node:22-slim has no curl; fetch is built into Node. /api/health runs a real
# database query, so this also catches a volume that failed to mount.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
