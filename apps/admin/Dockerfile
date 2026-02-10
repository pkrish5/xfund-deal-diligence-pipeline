FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/

RUN npm ci --workspace=packages/shared --workspace=apps/admin

COPY packages/shared/ packages/shared/
COPY apps/admin/ apps/admin/
COPY tsconfig.json ./

RUN npm run build -w packages/shared && npm run build -w apps/admin

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/apps/admin/package.json apps/admin/

RUN npm ci --workspace=packages/shared --workspace=apps/admin --omit=dev

COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/apps/admin/dist/ apps/admin/dist/
COPY --from=builder /app/packages/shared/src/db/migrations/ packages/shared/src/db/migrations/

ENV NODE_ENV=production
ENV SERVICE_NAME=diligence-admin
ENV PORT=8080

EXPOSE 8080

CMD ["node", "apps/admin/dist/server.js"]
