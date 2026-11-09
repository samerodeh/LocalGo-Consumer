"""Compatibility imports; tool implementations live in individual modules.

New code should import from ``goer_localgo.tools.catalog.<tool_name>``.
"""

from goer_localgo.tools.catalog.get_menu import GetMenuInput, GetMenuTool
from goer_localgo.tools.catalog.get_product import GetProductInput, GetProductTool
from goer_localgo.tools.catalog.search_menu import SearchMenuInput, SearchMenuTool

__all__ = [
    "GetMenuInput", "GetMenuTool",
    "GetProductInput", "GetProductTool",
    "SearchMenuInput", "SearchMenuTool",
]
