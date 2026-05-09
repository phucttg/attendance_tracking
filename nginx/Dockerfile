# Stage 1: build the React client
FROM node:22-alpine AS client-builder

WORKDIR /app

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ .

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# Stage 2: serve via Nginx
FROM nginx:alpine

COPY --from=client-builder /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
