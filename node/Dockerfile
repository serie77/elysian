# Elysian node: indexer, relayer and batch executor. Build from the repo root:
#   docker build -f node/Dockerfile -t elysian-node .
# Needs a persistent volume at /data and these variables: ALCHEMY_KEY (or RPC_URL), RELAYER_KEY, EXECUTOR_KEY.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core packages/core
COPY node node
COPY circuits/package.json circuits/package.json
COPY contracts/package.json contracts/package.json
COPY contracts/deployments contracts/deployments
COPY web/package.json web/package.json
RUN npm install --workspace=@elysian/node --workspace=@elysian/core --no-audit --no-fund \
 && npm run build --workspace=@elysian/core
ENV DEPLOYMENT=robinhood DATA_DIR=/data PORT=8787
EXPOSE 8787
CMD ["npm", "start", "--workspace=@elysian/node"]
