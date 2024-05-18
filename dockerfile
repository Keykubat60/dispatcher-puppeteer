# Verwenden Sie ein offizielles Node.js-Image als Basis
FROM node:16-slim

# Arbeitsverzeichnis im Container setzen
WORKDIR /app

# Kopieren der benötigten Dateien in den Container
COPY package.json .
COPY .env .

# Installieren von Abhängigkeiten
RUN apt-get update && apt-get install -y wget gnupg2 \
    && apt-get install -y curl \
    && curl -sL https://deb.nodesource.com/setup_16.x | bash - \
    && apt-get install -y nodejs \
    && apt-get install -y --no-install-recommends ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
    && npm install --no-cache-dir puppeteer-core puppeteer-extra puppeteer-extra-plugin-stealth dotenv

# Installieren von Chromium
RUN apt-get install -y chromium

# Bereinigen Sie unnötige Pakete und Dateien, um die Größe des Images zu reduzieren
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Kopieren des restlichen Codes
COPY . .

# Startkommando
CMD ["node", "/app/scripts/main.js"]
