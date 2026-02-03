FROM node:24-bookworm

ARG GIT_COMMIT_SHA=""
ARG GIT_COMMIT_MESSAGE=""

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY . .

RUN node --experimental-transform-types scripts/build-info.ts /app/build-info.json && rm -rf .git

ENV PORT=80
ENV DATA_DIR=/config
ENV DB_PATH=/config/garden.db
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV GIT_COMMIT_MESSAGE=${GIT_COMMIT_MESSAGE}
ENV BUILD_INFO_PATH=/app/build-info.json

RUN mkdir -p /config

VOLUME ["/config"]
EXPOSE 80

CMD ["node", "--experimental-transform-types", "index.ts"]
