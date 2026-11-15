FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 RELAY_DATA_DIR=/data PORT=4318
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server ./apps/server
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/package.json ./package.json
# tsx is a production dependency for the TypeScript service.
USER node
VOLUME /data
EXPOSE 4318
CMD ["node", "--import", "tsx", "apps/server/main.ts"]
