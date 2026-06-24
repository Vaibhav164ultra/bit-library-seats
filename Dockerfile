# Use official Node.js 20 lightweight Alpine image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy server code and frontend files
COPY server/ ./server/
COPY index.html ./
COPY print-qrs.html ./

# Expose port 3001 (default Express server port)
EXPOSE 3001

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Run the backend server
CMD ["node", "server/index.js"]
