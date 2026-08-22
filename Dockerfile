# Storage is Node's built-in node:sqlite — no native module to compile, so
# this is a plain single-stage build that works the same on any
# architecture your home server runs (ARM/Raspberry Pi included).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 3000
CMD ["node", "server/index.js"]
