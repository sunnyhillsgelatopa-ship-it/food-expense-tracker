FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN mkdir -p data public/uploads
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
