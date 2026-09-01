FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node index.mjs ./index.mjs
ENV PORT=8787
ENV EPD_OPERATOR_PROVIDER=none
ENV EPD_OPERATOR_MODE=disabled
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
