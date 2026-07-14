FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
