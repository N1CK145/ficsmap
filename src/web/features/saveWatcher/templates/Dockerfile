# ficsmap save watcher: the bash script in a small image. Build and start with: docker compose up -d --build
FROM alpine:3.20
RUN apk add --no-cache bash curl inotify-tools tini
COPY ficsmap-watch.sh /usr/local/bin/ficsmap-watch.sh
RUN chmod 755 /usr/local/bin/ficsmap-watch.sh
# The list of uploaded saves; keep it in a volume so a new container does not upload them again.
VOLUME /state
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/ficsmap-watch.sh"]
