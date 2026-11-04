"""Legacy imports remain valid while each tool has its own implementation."""

import ast
from pathlib import Path

import pytest

from goer_localgo.tools import catalog_tools
from goer_localgo.tools.catalog.get_menu import GetMenuInput, GetMenuTool
from goer_localgo.tools.catalog.get_product import GetProductInput, GetProductTool
from goer_localgo.tools.catalog.search_menu import SearchMenuInput, SearchMenuTool


@pytest.mark.parametrize("tool,schema,module", [
    (GetMenuTool, GetMenuInput, "get_menu"),
    (GetProductTool, GetProductInput, "get_product"),
    (SearchMenuTool, SearchMenuInput, "search_menu"),
])
def test_one_tool_per_module_and_legacy_import_identity(tool, schema, module):
    assert tool.__module__ == f"goer_localgo.tools.catalog.{module}"
    assert getattr(catalog_tools, tool.__name__) is tool
    assert getattr(catalog_tools, schema.__name__) is schema
    path = Path(catalog_tools.__file__).parent / "catalog" / f"{module}.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    tools = [node for node in tree.body if isinstance(node, ast.ClassDef)
             and any(isinstance(base, ast.Name) and base.id == "BaseTool" for base in node.bases)]
    assert len(tools) == 1
    assert tools[0].name == tool.__name__
