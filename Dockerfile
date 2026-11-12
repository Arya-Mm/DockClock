# One-command local stack for judges: docker compose up (see docker-compose.yml).
FROM node:24-alpine
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @dockclock/web build
ENV NODE_ENV=production RUN_WORKER_IN_WEB=1 PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @dockclock/db migrate && pnpm --filter @dockclock/db seed && pnpm --filter @dockclock/web start"]
