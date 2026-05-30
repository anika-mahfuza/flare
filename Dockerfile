FROM node:20-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y \
    firefox-esr \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json .
RUN npm install --production
RUN npx playwright install firefox && chmod -R 777 /ms-playwright

COPY . .

EXPOSE 7860
USER node
CMD ["node", "server.js"]