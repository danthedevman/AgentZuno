FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
ARG PUBLIC_SITE_URL=https://agentzuno.com/
COPY index.html vite.config.js jsconfig.json ./
COPY src ./src
COPY public ./public
COPY api/sdk ./api/sdk
COPY docs ./docs
COPY scripts ./scripts
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
COPY LICENSE /usr/share/doc/agentzuno/LICENSE
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/render/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
