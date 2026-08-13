# TR-STR-005: the frontend tree produces its own image, built from this tree alone.
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# TR-FE-005: the output is static assets any file server can serve.
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# TR-FE-007: the backend origin is substituted at container start, so the same
# built bundle serves any deployment.
ENV BACKEND_ORIGIN=http://backend:3000
EXPOSE 8080
