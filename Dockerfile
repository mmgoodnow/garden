FROM node:24-bookworm


ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_NO_WARNINGS=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

ARG GIT_SHA
ARG GIT_COMMIT_MESSAGE

ENV GIT_COMMIT_SHA=$GIT_SHA
ENV GIT_COMMIT_MESSAGE=$GIT_COMMIT_MESSAGE

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl tini \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev
# Playwright's branded Chrome installer only supports amd64 on Linux.
RUN npx playwright install --with-deps chromium chromium-headless-shell \
  && curl -fsSL -o /tmp/google-chrome.deb \
    "https://dl.google.com/linux/direct/google-chrome-stable_current_$(dpkg --print-architecture).deb" \
  && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
  && google-chrome --version \
  && rm /tmp/google-chrome.deb \
  && rm -rf /var/lib/apt/lists/*

COPY . .

ENV PORT=80
ENV DATA_DIR=/config
ENV DB_PATH=/config/garden.db

RUN mkdir -p /config

VOLUME ["/config"]
EXPOSE 80

ENTRYPOINT ["tini", "--"]
CMD ["node", "--experimental-strip-types", "index.ts"]
