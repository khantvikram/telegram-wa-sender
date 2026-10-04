FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-freefont-ttf fonts-kacst fonts-thai-tlwg fonts-wqy-zenhei \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]

