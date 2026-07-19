FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server/index.js"]
