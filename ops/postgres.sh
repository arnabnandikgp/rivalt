#!/usr/bin/env bash
# Source in an isolated acceptance supervisor; leaves only this run's data directory.
set -euo pipefail
: "${RIVALT_RUN_DIR:?run directory required}"
RIVALT_PG_IMAGE='docker.io/library/postgres@sha256:89f747171c4b0af0eacf5984550060be79786dbe286eb60cfa691d79d1e8b23f'
export RIVALT_PG_CONTAINER="rivalt-p05-$(date -u +%Y%m%d%H%M%S)-$$"
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-15432}"
python3 - "$RIVALT_PG_PORT" <<'PY'
import socket, sys
with socket.socket() as s: s.bind(('127.0.0.1', int(sys.argv[1])))
PY
mkdir -p "$RIVALT_RUN_DIR/postgres-data"
python3 - "$RIVALT_RUN_DIR/postgres.env" "$RIVALT_PG_PORT" <<'PY'
import os,secrets,sys
password=secrets.token_hex(24)
fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
    f.write('POSTGRES_USER=rivalt\nPOSTGRES_DB=rivalt\nPOSTGRES_PASSWORD='+password+'\n')
fd=os.open(sys.argv[1]+'.url',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f: f.write('postgresql://rivalt:'+password+'@127.0.0.1:'+sys.argv[2]+'/rivalt')
PY
export RIVALT_DATABASE_URL
RIVALT_DATABASE_URL="$(cat "$RIVALT_RUN_DIR/postgres.env.url")"
container run --detach --name "$RIVALT_PG_CONTAINER" --platform linux/arm64 --cpus 2 --memory 512M \
  --publish "127.0.0.1:$RIVALT_PG_PORT:5432" --env-file "$RIVALT_RUN_DIR/postgres.env" \
  --volume "$PWD/$RIVALT_RUN_DIR/postgres-data:/var/lib/postgresql" "$RIVALT_PG_IMAGE" \
  > "$RIVALT_RUN_DIR/postgres-container.txt"
ready=0
for _ in {1..60}; do
  # The image's temporary initialization server accepts Unix sockets before it
  # shuts down. TCP becomes ready only on the final server used by our clients.
  if container exec "$RIVALT_PG_CONTAINER" pg_isready -h 127.0.0.1 -U rivalt -d rivalt >/dev/null 2>&1; then ready=1;break;fi
  sleep 0.5
done
if [[ "$ready" != 1 ]]; then container logs "$RIVALT_PG_CONTAINER" > "$RIVALT_RUN_DIR/postgres.log" 2>&1;exit 1;fi
container exec "$RIVALT_PG_CONTAINER" postgres --version > "$RIVALT_RUN_DIR/postgres-version.txt"
test "$(cat "$RIVALT_RUN_DIR/postgres-version.txt")" = 'postgres (PostgreSQL) 18.6'
container --version > "$RIVALT_RUN_DIR/container-version.txt"
container image inspect "$RIVALT_PG_IMAGE" > "$RIVALT_RUN_DIR/postgres-image.json"
