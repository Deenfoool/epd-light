FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .
RUN chown -R node:node /app

ENV PORT=8787
ENV EPD_OPERATOR_PROVIDER=none
ENV EPD_OPERATOR_MODE=disabled
ENV EPD_GATEWAY_AUTH_MODE=disabled
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
