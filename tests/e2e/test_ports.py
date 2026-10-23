"""Actual socket probes for acceptance runtime isolation."""
import socket
import subprocess
import sys
import unittest
from pathlib import Path

CHECK = Path(__file__).resolve().parents[2] / 'ops/check-ports.py'

class Ports(unittest.TestCase):
    def probe(self, port):
        return subprocess.run([sys.executable, str(CHECK), str(port)], capture_output=True, text=True)

    def test_live_loopback_and_wildcard_listeners(self):
        for host in ('127.0.0.1', '0.0.0.0'):
            with self.subTest(host=host), socket.socket() as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind((host, 0))
                listener.listen(4)
                result = self.probe(listener.getsockname()[1])
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('live listener accepts connections', result.stderr)

    def test_unused_port(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        self.assertEqual(self.probe(port).returncode, 0)

    def test_time_wait_is_not_a_live_listener(self):
        with socket.socket() as listener, socket.socket() as client:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            client.connect(('127.0.0.1', port))
            connection, _ = listener.accept()
            connection.close()
            self.assertEqual(client.recv(1), b'')
        self.assertEqual(self.probe(port).returncode, 0)
