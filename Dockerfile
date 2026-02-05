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
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium chromium-headless-shell

COPY . .

ENV PORT=80
ENV DATA_DIR=/config
ENV DB_PATH=/config/garden.db

RUN mkdir -p /config

VOLUME ["/config"]
EXPOSE 80

ENTRYPOINT ["tini", "--"]
CMD ["node", "--experimental-transform-types", "index.ts"]
