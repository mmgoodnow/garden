FROM oven/bun:1.3.2

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright
RUN bunx playwright install --with-deps chromium chromium-headless-shell

COPY . .

ENV PORT=80
ENV DATA_DIR=/config
ENV DB_PATH=/config/garden.db

RUN mkdir -p /config

VOLUME ["/config"]
EXPOSE 80

CMD ["bun", "index.ts"]
