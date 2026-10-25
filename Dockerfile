# Site Atlas in a container.
#   docker build -t site-atlas .
#   docker run -d --name site-atlas -p 4800:4800 -v site-atlas:/data -e SITE_ATLAS_TOKEN=<secret> site-atlas
#   docker exec site-atlas site-atlas scan https://example.com
# The canvas listens on every interface of the container and needs the token (see README, "Run on a server").

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build && pnpm pack --out site-atlas.tgz

FROM node:24-bookworm-slim
ENV SITE_ATLAS_HOME=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /app/site-atlas.tgz /tmp/site-atlas.tgz
RUN npm install -g /tmp/site-atlas.tgz && rm /tmp/site-atlas.tgz \
    && site-atlas setup --with-deps \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && useradd --create-home atlas && mkdir -p /data && chown atlas:atlas /data
USER atlas
VOLUME /data
EXPOSE 4800
ENTRYPOINT ["site-atlas"]
CMD ["canvas", "--host", "0.0.0.0", "--port", "4800"]
