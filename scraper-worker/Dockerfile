FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
