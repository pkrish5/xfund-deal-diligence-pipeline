FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/

RUN npm ci --workspace=packages/shared --workspace=apps/worker

COPY packages/shared/ packages/shared/
COPY apps/worker/ apps/worker/
COPY tsconfig.json ./

RUN npm run build -w packages/shared && npm run build -w apps/worker

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/apps/worker/package.json apps/worker/

RUN npm ci --workspace=packages/shared --workspace=apps/worker --omit=dev

COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/apps/worker/dist/ apps/worker/dist/
COPY --from=builder /app/packages/shared/src/db/migrations/ packages/shared/src/db/migrations/

ENV NODE_ENV=production
ENV SERVICE_NAME=diligence-worker
ENV PORT=8080

EXPOSE 8080

CMD ["node", "apps/worker/dist/server.js"]
