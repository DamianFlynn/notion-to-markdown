# Build stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build TypeScript code
RUN npm run build

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create directories for static content that will be mounted as volumes
RUN mkdir -p content static/images

# Set environment variables
ENV NODE_ENV=production
ENV NOTION_TOKEN=""

# Command to run the application using the compiled JavaScript
CMD ["node", "dist/src/index.js"]


