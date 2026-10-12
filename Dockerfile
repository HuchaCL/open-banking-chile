# The Hucha runner with the Chromium of the Playwright image; the tag follows playwright-core in package.json
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsup.config.ts ./
COPY src ./src
COPY sync ./sync
RUN npm ci --ignore-scripts && npm run build \
  && ln -s "$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -n 1)" /usr/bin/chromium
CMD ["node", "sync/run.mjs"]
