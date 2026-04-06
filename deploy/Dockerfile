FROM node:22-alpine

WORKDIR /app

# Copy package descriptors first to maximize caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Expose backend port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["node", "backend/server.js"]
