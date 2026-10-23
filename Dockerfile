# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS client-build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY public ./public
COPY shared ./shared
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app
COPY --from=client-build /app/package*.json ./
COPY --from=client-build /app/node_modules ./node_modules
COPY --from=client-build /app/dist ./dist
COPY src ./src
COPY shared ./shared
COPY config.json ./config.json
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3210/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
