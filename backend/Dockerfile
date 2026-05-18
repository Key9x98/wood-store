FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile || pnpm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate \
 && pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini \
 && addgroup -g 10001 cms \
 && adduser -D -u 10001 -G cms cms
COPY --from=build --chown=cms:cms /app/dist ./dist
COPY --from=build --chown=cms:cms /app/node_modules ./node_modules
COPY --from=build --chown=cms:cms /app/prisma ./prisma
COPY --chown=cms:cms package.json ./
USER cms
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
