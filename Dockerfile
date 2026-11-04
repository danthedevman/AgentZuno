FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js jsconfig.json ./
COPY src ./src
COPY public ./public
COPY api/sdk ./api/sdk
COPY docs ./docs
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
COPY LICENSE /usr/share/doc/agentzuno/LICENSE
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
