FROM node:22.14.0-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN addgroup -S botlio && adduser -S botlio -G botlio \
  && mkdir -p /var/lib/botlio-leads \
  && chown -R botlio:botlio /app /var/lib/botlio-leads
USER botlio
ENV NODE_ENV=production
CMD ["node", "src/server.mjs"]
