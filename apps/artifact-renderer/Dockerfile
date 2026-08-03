# Chromium comes from Alpine's package repo rather than puppeteer's bundled
# download: the dependency is `puppeteer-core`, so `pnpm install` stays fast for
# every developer who never touches this service.
FROM node:22-alpine

RUN apk add --no-cache \
      chromium \
      tini \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto \
      font-noto-emoji

ENV CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-package-lock

COPY dist ./dist

# Chromium spawns helper processes that leak as zombies under PID 1.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

EXPOSE 8080
