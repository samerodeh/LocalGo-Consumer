"""Location checks shared by consumer quote/checkout, independent of HTTP clients."""

import math


def valid_delivery_point(latitude: float, longitude: float) -> bool:
    if (
        not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
        or (latitude == 0 and longitude == 0)
    ):
        return False
    lat, lon, center_lat, center_lon = map(
        math.radians, (latitude, longitude, 45.496339, -73.578666)
    )
    h = (
        math.sin((lat - center_lat) / 2) ** 2
        + math.cos(lat) * math.cos(center_lat) * math.sin((lon - center_lon) / 2) ** 2
    )
    return 6371 * 2 * math.asin(math.sqrt(min(1, h))) <= 3
