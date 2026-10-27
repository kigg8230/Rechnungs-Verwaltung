FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Create persistent data directory for SQLite and PDFs
RUN mkdir -p /app/data/uploads

EXPOSE 3000

CMD ["node", "server.js"]
