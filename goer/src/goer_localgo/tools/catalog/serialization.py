"""Shared JSON serialization and turn-local catalog result recording."""

import json
from typing import Any

from goer_localgo.domain.cards import record_catalog_result


def dump_result(payload: Any, tool: str | None = None) -> str:
    if tool is not None:
        record_catalog_result(tool, payload)
    return json.dumps(payload, ensure_ascii=False)


def error_result(code: str, message: str, **details: Any) -> str:
    return dump_result({"error": {"code": code, "message": message, **details}})
