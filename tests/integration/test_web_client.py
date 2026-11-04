"""The browser script is dependency-free; exercise it with Node when available."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from goer_localgo.api.main import app


ROOT = Path(__file__).resolve().parents[2]


def test_browser_script_is_served():
    response = TestClient(app).get("/chat.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]
    assert "renderCards" in response.text


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is needed for browser-script unit tests")
def test_browser_script_sessions_and_rendering():
    result = subprocess.run(
        [shutil.which("node"), "--test", str(ROOT / "tests/web/chat.test.cjs")],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
