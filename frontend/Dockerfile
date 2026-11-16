FROM node:22.23.2-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Built from the repository root (docker-compose.yml): the app imports the shared dictionaries and modules in /locales and /shared
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:22.23.2-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .
COPY locales /locales
COPY shared /shared
RUN npm run build

FROM node:22.23.2-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3001
CMD ["node","server.js"]
