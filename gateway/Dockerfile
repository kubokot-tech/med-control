FROM node:22.23.2-alpine
# --no-scripts: the busybox trigger is killed (signal 9) by the NAS build sandbox
RUN apk add --no-cache --no-scripts su-exec
WORKDIR /app
# Built from the repository root (docker-compose.yml): the code imports the shared modules in /shared and reads the dictionaries in /locales
COPY gateway/package.json gateway/package-lock.json ./
# --omit=optional: pdf.js only reads text here and does not need its native canvas
RUN npm ci --omit=dev --omit=optional
COPY db/migrations /app/migrations
COPY gateway/src ./src
COPY gateway/fonts ./fonts
COPY shared /shared
COPY locales /locales
COPY gateway/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown node:node /data /app
EXPOSE 3000
# Starts as root only to give the data volume to the `node` user, then drops privileges.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node","src/server.js"]
