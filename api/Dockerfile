FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY package*.json LICENSE ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
COPY --chown=node:node sdk ./sdk
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node mock-data ./mock-data
RUN mkdir -p /app/installation && chown node:node /app/installation
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
