# Backup sidecar: pg_dump/pg_restore from the postgres image, rsync for the local mirror, rclone for the encrypted cloud copy.
FROM postgres:16.13
RUN apt-get update && apt-get install -y --no-install-recommends rsync rclone curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY backup-loop.sh /backup-loop.sh
ENTRYPOINT ["bash", "/backup-loop.sh"]
