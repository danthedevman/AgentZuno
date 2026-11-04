FROM ollama/ollama:latest
COPY docker/render/start-ollama.sh /usr/local/bin/start-agentzuno-ollama
ENTRYPOINT ["/bin/sh", "/usr/local/bin/start-agentzuno-ollama"]
