FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY runtime.tgz /tmp/runtime.tgz
RUN tar -xzf /tmp/runtime.tgz -C /app && rm /tmp/runtime.tgz
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm prune --prod
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm","start"]
