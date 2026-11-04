FROM node:24-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY migrations ./migrations
ENV NODE_ENV=production TZ=America/Sao_Paulo DATA_DIR=/data API_PORT=3001
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s CMD wget -qO- http://127.0.0.1:3001/saude || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
