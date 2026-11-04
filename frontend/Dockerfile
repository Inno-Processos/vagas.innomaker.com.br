FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV NODE_ENV=production WEB_PORT=3000 API_URL=http://backend:3001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s CMD wget -qO- http://127.0.0.1:3000/saude || exit 1
CMD ["node", "server.js"]
