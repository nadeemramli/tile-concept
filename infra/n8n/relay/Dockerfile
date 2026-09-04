FROM node:24.19.0-alpine3.23

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY --chown=node:node server.mjs /app/server.mjs

USER node
EXPOSE 3000

CMD ["node", "/app/server.mjs"]

