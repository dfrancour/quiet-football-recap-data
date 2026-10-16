# The live publisher (src/publisher.ts). It keeps its own checkout of the
# dataset on the /data volume, separate from this image's code, and pushes
# to it with a deploy key.

# Node 24 runs the TypeScript directly; pinned by digest, as Quiet Football's.
ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE}
RUN apt-get update \
  && apt-get install --yes --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY src ./src

# The commit this image was built from, for each commit's `Publisher:` trailer.
ARG PUBLISHER_BUILD=unknown
ENV PUBLISHER_BUILD=${PUBLISHER_BUILD} \
    NODE_ENV=production \
    HOME=/tmp \
    GIT_SSH_COMMAND="ssh -i /run/secrets/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/data/known_hosts -o StrictHostKeyChecking=accept-new"

RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

HEALTHCHECK --interval=5m --timeout=10s --start-period=2m --retries=2 \
  CMD ["node", "src/cli.ts", "status", "--data", "/data/repo", "--check"]

CMD ["sh", "-c", "exec node src/cli.ts run --data /data/repo --clone \"$PUBLISHER_REPO\""]
