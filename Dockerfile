FROM node:24-bookworm AS buildinfo

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY .git .git
COPY scripts/build-info.ts scripts/build-info.ts

RUN node --experimental-transform-types scripts/build-info.ts /app/build-info.json

FROM node:24-bookworm


ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_NO_WARNINGS=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY . .

COPY --from=buildinfo /app/build-info.json /app/build-info.json

ENV PORT=80
ENV DATA_DIR=/config
ENV DB_PATH=/config/garden.db
ENV BUILD_INFO_PATH=/app/build-info.json

RUN mkdir -p /config

VOLUME ["/config"]
EXPOSE 80

ENTRYPOINT ["tini", "--"]
CMD ["node", "--experimental-transform-types", "index.ts"]
