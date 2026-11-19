FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build && chown -R node:node /app
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
