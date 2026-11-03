import socket

import pytest


def test_outbound_network_is_blocked_in_tests():
    with pytest.raises(RuntimeError, match="network"):
        socket.create_connection(("203.0.113.10", 443), timeout=1)
