FROM oven/bun:1.3.2

ARG GIT_COMMIT_SHA=""
ARG GIT_COMMIT_MESSAGE=""

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
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV GIT_COMMIT_MESSAGE=${GIT_COMMIT_MESSAGE}

RUN mkdir -p /config

VOLUME ["/config"]
EXPOSE 80

CMD ["bun", "index.ts"]
