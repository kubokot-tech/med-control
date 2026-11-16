FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
RUN mkdir /data && chown node /data
USER node
VOLUME /data
ENV PORT=3900 SAMPLES_DIR=/data
EXPOSE 3900
HEALTHCHECK --interval=1m --timeout=5s CMD wget -qO- http://127.0.0.1:3900/healthz || exit 1
CMD ["node", "server.js"]
