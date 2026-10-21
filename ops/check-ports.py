"""Refuse live listeners without mistaking TCP TIME_WAIT for an occupied port."""
import socket
import sys

for value in sys.argv[1:]:
    port = int(value)
    if not 1 <= port <= 65535:
        raise SystemExit(f"Invalid acceptance listener port: {port}")
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
            probe.listen(1)
        except OSError as error:
            raise SystemExit(f"Acceptance listener 127.0.0.1:{port} unavailable: {error.strerror}") from error
