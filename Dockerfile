# syntax=docker/dockerfile:1
# Node 버전을 고정해 두면 어느 컴퓨터에서 빌드해도 같은 환경이 됩니다.
ARG NODE_VERSION=22-bookworm-slim

# ---------- base ----------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- dev: docker compose 개발용 ----------
# 소스는 볼륨으로 마운트하고, node_modules 는 컨테이너 안(named volume)에 둡니다.
FROM base AS dev
ENV NODE_ENV=development
COPY docker/dev-entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["dev-entrypoint.sh"]
CMD ["npm", "run", "dev"]

# ---------- deps: 운영 빌드용 의존성 ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- worker: 야간 작업 워커 운영 이미지 ----------
FROM base AS worker
ENV NODE_ENV=production TZ=Asia/Seoul
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node lib ./lib
COPY --chown=node:node worker ./worker
USER node
CMD ["node", "worker/index.ts"]

# ---------- prod: 최종 운영 이미지 ----------
FROM node:${NODE_VERSION} AS prod
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# 시작 시 마이그레이션 실행 + 계정 관리 스크립트(npm run accounts)용
COPY --chown=node:node db ./db
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.ts && exec node server.js"]
