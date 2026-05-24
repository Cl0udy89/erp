FROM oven/bun:1.3.13 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --ignore-scripts

FROM deps AS build
WORKDIR /app

COPY . .
ENV CLOCKIFY_KEY=build_time_placeholder
ENV DATABASE_URL=mysql://erp:erp_password@mysql:3306/erp
ENV BACKEND_API_URL=http://backend-api:4001
ENV CLOCKIFY_SYNC_URL=http://clockify-sync:4000
ENV API_INTERNAL_TOKEN=build-time-placeholder-token
RUN bun run build

FROM oven/bun:1.3.13 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]

FROM deps AS sync-service
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY . .

EXPOSE 4000
CMD ["bun", "src/services/clockify-sync-service.ts"]

FROM deps AS backend-api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4001

COPY . .

EXPOSE 4001
CMD ["bun", "src/services/backend-api-service.ts"]
