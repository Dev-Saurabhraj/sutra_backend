# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# tsx + prisma CLI are kept so `db:push` / `db:seed` can run inside the container
RUN npm ci --include=dev && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets
COPY --from=build /app/dist ./dist
# bill photos; mounted as a volume in docker-compose
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
