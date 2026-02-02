FROM oven/bun:1.3.2

ARG GIT_COMMIT_SHA=""
ARG GIT_COMMIT_MESSAGE=""

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright
RUN bunx playwright install --with-deps chromium chromium-headless-shell

COPY . .

RUN bun -e "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\
const shaArg = process.env.GIT_COMMIT_SHA ?? '';\
const msgArg = process.env.GIT_COMMIT_MESSAGE ?? '';\
let sha = shaArg; let message = msgArg;\
try {\
  if (!sha && existsSync('.git/HEAD')) {\
    const head = readFileSync('.git/HEAD', 'utf8').trim();\
    if (head.startsWith('ref:')) {\
      const ref = head.replace('ref:', '').trim();\
      const refPath = '.git/' + ref;\
      if (existsSync(refPath)) sha = readFileSync(refPath, 'utf8').trim();\
    } else {\
      sha = head;\
    }\
  }\
  if (!message && existsSync('.git/logs/HEAD')) {\
    const log = readFileSync('.git/logs/HEAD', 'utf8').trim().split('\\n').pop() ?? '';\
    const parts = log.split('\\t');\
    message = parts[1] ? parts[1].trim() : '';\
  }\
} catch {}\
writeFileSync('build-info.json', JSON.stringify({ sha, message }));" && rm -rf .git

ENV PORT=80
ENV DATA_DIR=/config
ENV DB_PATH=/config/garden.db
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV GIT_COMMIT_MESSAGE=${GIT_COMMIT_MESSAGE}
ENV BUILD_INFO_PATH=/app/build-info.json

RUN mkdir -p /config

VOLUME ["/config"]
EXPOSE 80

CMD ["bun", "index.ts"]
