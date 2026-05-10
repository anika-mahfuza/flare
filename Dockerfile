FROM ghcr.io/puppeteer/puppeteer:22.6.0

USER root
RUN apt-get update && apt-get install -y chromium

USER pptruser
WORKDIR /app
COPY --chown=pptruser:pptruser package.json .
RUN npm install
COPY --chown=pptruser:pptruser . .

EXPOSE 3000
CMD ["node", "server.js"]
