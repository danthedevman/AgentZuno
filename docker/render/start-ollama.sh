#!/bin/sh
set -eu
ollama serve &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" || true' TERM INT EXIT
attempt=0
until ollama list >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then exit 1; fi
  sleep 2
done
# Pull is idempotent and reuses the persistent model cache after redeploys.
OLLAMA_HOST=http://127.0.0.1:11434 ollama pull nomic-embed-text
wait "$server_pid"
