FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/ingress/package.json apps/ingress/

# Install all dependencies
RUN npm ci --workspace=packages/shared --workspace=apps/ingress

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/ingress/ apps/ingress/
COPY tsconfig.json ./

# Build
RUN npm run build -w packages/shared && npm run build -w apps/ingress

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/apps/ingress/package.json apps/ingress/

RUN npm ci --workspace=packages/shared --workspace=apps/ingress --omit=dev

COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/apps/ingress/dist/ apps/ingress/dist/
COPY --from=builder /app/packages/shared/src/db/migrations/ packages/shared/src/db/migrations/

ENV NODE_ENV=production
ENV SERVICE_NAME=diligence-ingress
ENV PORT=8080

EXPOSE 8080

CMD ["node", "apps/ingress/dist/server.js"]
