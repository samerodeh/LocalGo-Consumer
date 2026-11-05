"""Generate backend/app/menu_prices.json from src/data/menu.ts.

Why this exists separately from build_menu_dataset.py:

`pricing.py` decides what a customer is charged, so its price source has to be
committed, small, and reviewable in a diff. Goer's generated `app/goer/data/
menu.json` is none of those — it is a large derived artifact carrying allergens,
Arabic names and diet tags, and it belongs to an optional subsystem that is
allowed to be absent. Pointing the money path at it once meant an untracked file
could silently take checkout down on deploy.

Prices, ids and display names only. Run this after editing src/data/menu.ts, and
commit the result:

    python scripts/build_menu_prices.py
"""

import json
import re
from decimal import Decimal
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
MENU_TS = BACKEND.parent / "src" / "data" / "menu.ts"
OUT = BACKEND / "app" / "menu_prices.json"

# Matches one MenuItem literal's id, name and price. Names are single-quoted in
# menu.ts and may contain escaped quotes; ids never do.
ENTRY = re.compile(
    r"\{\s*id:\s*'(?P<id>[^']+)'\s*,\s*"
    r"name:\s*'(?P<name>(?:[^'\\]|\\.)*)'\s*,"
    r"(?P<rest>[^}]*?)"
    r"price:\s*(?P<price>\d+(?:\.\d+)?)",
    re.S,
)


def main() -> int:
    if not MENU_TS.exists():
        print(f"error: {MENU_TS} not found", file=sys.stderr)
        return 1

    source = MENU_TS.read_text(encoding="utf-8")
    items: list[dict[str, object]] = []
    seen: set[str] = set()

    arrays = []
    for array_name, merchant_id in [("menuItems", "al-taib"),
                                    ("chateauKababMenuItems", "chateau-kabab")]:
        declaration = f"export const {array_name}: MenuItem[] = ["
        start = source.index(declaration)
        end = source.index("\n];", start)
        arrays.append((start, end, merchant_id))

    for m in ENTRY.finditer(source):
        merchant_id = next((merchant for start, end, merchant in arrays
                            if start <= m.start() < end), None)
        if merchant_id is None:
            print("error: menu item outside a known restaurant array", file=sys.stderr)
            return 1
        item_id = m.group("id")
        if item_id in seen:
            print(f"error: duplicate id in menu.ts: {item_id}", file=sys.stderr)
            return 1
        seen.add(item_id)
        items.append(
            {
                "id": item_id,
                "name": m.group("name").replace("\\'", "'"),
                "merchant_id": merchant_id,
                # Integer cents at generation time, so nothing downstream ever
                # multiplies a float by 100 at charge time.
                "price_cents": int(Decimal(m.group("price")) * 100),
            }
        )

    if not items:
        print("error: parsed 0 items — has menu.ts changed shape?", file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(int(i["price_cents"]) for i in items)
    print(f"wrote {OUT.relative_to(BACKEND)} — {len(items)} items, ${total / 100:.2f} if you bought one of everything")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
