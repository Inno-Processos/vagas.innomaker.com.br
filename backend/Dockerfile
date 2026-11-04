FROM node:24-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY servidor ./servidor
COPY public ./public
COPY migrations ./migrations
ENV NODE_ENV=production TZ=America/Sao_Paulo DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s CMD wget -qO- http://127.0.0.1:3000/saude || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "--import", "./servidor/registrar.js", "servidor/index.js"]
