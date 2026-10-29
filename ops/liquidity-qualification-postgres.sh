#!/usr/bin/env bash
# Source only from the owned P34 supervisor. Keep prior data and create fresh DBs.
set -euo pipefail
if [[ -z "${RIVALT_PG_REUSE_DIR:-}" ]]; then
  source ops/postgres.sh
else
  python3 - "$RIVALT_PG_REUSE_DIR" "$RIVALT_PG_PORT" <<'PY'
from pathlib import Path
from urllib.parse import urlparse
import sys
root=Path(sys.argv[1]).resolve()
assert root.is_relative_to(Path('.local/liquidity-execution/qualification').resolve())
assert (root/'postgres-data').is_dir()
for name in ['postgres.env','postgres.env.url']:
    assert (root/name).is_file() and (root/name).stat().st_mode & 0o077 == 0
url=urlparse((root/'postgres.env.url').read_text())
assert url.hostname=='127.0.0.1' and url.port==int(sys.argv[2])
PY
  python3 ops/check-ports.py "$RIVALT_PG_PORT"
  export RIVALT_PG_CONTAINER="rivalt-p34-$(date -u +%Y%m%d%H%M%S)-$$"
  export RIVALT_DATABASE_URL
  RIVALT_DATABASE_URL="$(cat "$RIVALT_PG_REUSE_DIR/postgres.env.url")"
  container run --detach --name "$RIVALT_PG_CONTAINER" --platform linux/arm64 --cpus 2 --memory 512M \
    --publish "127.0.0.1:$RIVALT_PG_PORT:5432" --env-file "$RIVALT_PG_REUSE_DIR/postgres.env" \
    --volume "$PWD/$RIVALT_PG_REUSE_DIR/postgres-data:/var/lib/postgresql" \
    'docker.io/library/postgres@sha256:89f747171c4b0af0eacf5984550060be79786dbe286eb60cfa691d79d1e8b23f' \
    > "$RIVALT_RUN_DIR/postgres-container.txt"
  ready=0
  for _ in {1..60}; do
    if container exec "$RIVALT_PG_CONTAINER" pg_isready -U rivalt -d rivalt >/dev/null 2>&1; then ready=1;break;fi
    sleep 0.5
  done
  test "$ready" == 1
  container exec "$RIVALT_PG_CONTAINER" postgres --version > "$RIVALT_RUN_DIR/postgres-version.txt"
  test "$(cat "$RIVALT_RUN_DIR/postgres-version.txt")" = 'postgres (PostgreSQL) 18.6'
  printf '%s\n' "$RIVALT_PG_REUSE_DIR" > "$RIVALT_RUN_DIR/postgres-storage-path.txt"
fi
# WAL reclamation is performed by PostgreSQL checkpoints, never filesystem deletion.
# Keep durability/fsync enabled and preserve every database and retained transaction.
container exec "$RIVALT_PG_CONTAINER" psql -U rivalt -d rivalt -v ON_ERROR_STOP=1 \
  -c "ALTER SYSTEM SET max_wal_size='64MB'" -c "ALTER SYSTEM SET min_wal_size='32MB'" \
  -c "ALTER SYSTEM SET checkpoint_timeout='30s'" -c 'SELECT pg_reload_conf()' -c 'CHECKPOINT' \
  > "$RIVALT_RUN_DIR/postgres-bounded-wal.txt"
