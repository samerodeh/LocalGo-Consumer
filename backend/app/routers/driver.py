"""Approved-driver availability, expiring offers and activity summaries."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, StrictBool
from .orders import _require_driver, _map_row
from .. import config
from ..postgrest import REST_URL, client, headers

router = APIRouter(prefix='/driver', tags=['Driver workflow'])
LOCAL = ZoneInfo('America/Toronto')


class AvailabilityBody(BaseModel):
    online: StrictBool


@router.get('/availability')
async def availability(authorization: str | None = Header(default=None)):
    token, uid = await _require_driver(authorization)
    response = await client.get(f'{REST_URL}/driver_dispatch', headers=headers(token), params={'driver_id': f'eq.{uid}', 'select': 'is_online', 'limit': '1'})
    if response.status_code != 200:
        raise HTTPException(503, 'Driver availability could not be loaded')
    rows = response.json()
    return {'online': bool(rows and rows[0]['is_online'])}


@router.post('/availability')
async def set_availability(body: AvailabilityBody, authorization: str | None = Header(default=None)):
    token, _ = await _require_driver(authorization)
    response = await client.post(f'{REST_URL}/rpc/driver_set_online', headers=headers(token), json={'p_online': body.online})
    if response.status_code != 200:
        raise HTTPException(503, 'Driver availability could not be saved')
    return response.json()


@router.post('/offers/next')
async def next_offer(authorization: str | None = Header(default=None)):
    token, _ = await _require_driver(authorization)
    response = await client.post(f'{REST_URL}/rpc/driver_next_offer', headers=headers(token), json={})
    if response.status_code != 200:
        raise HTTPException(503, 'Delivery offers are unavailable')
    offer = response.json()
    if not offer:
        return {'offer': None}
    order = await client.get(f'{REST_URL}/orders', headers=headers(token), params={'id': f"eq.{offer['orderId']}", 'select': '*', 'limit': '1'})
    if order.status_code != 200:
        raise HTTPException(503, 'Offer details could not be loaded')
    rows = order.json()
    if not rows or rows[0].get('accepted_by'):
        return {'offer': None}
    return {'offer': {**offer, 'order': _map_row(rows[0], None), 'serverTime': datetime.now(timezone.utc).isoformat()}}



def _date(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace('Z', '+00:00'))


def summarize_activity(orders: list[dict], shifts: list[dict], now: datetime) -> dict:
    """Seven Toronto calendar days; incomplete pay stays unknown, never zero."""
    days = []
    for offset in range(6, -1, -1):
        day = now.astimezone(LOCAL).date() - timedelta(days=offset)
        start = datetime.combine(day, datetime.min.time(), LOCAL)
        end = start + timedelta(days=1)
        delivered = [o for o in orders if o.get('delivered_at') and start <= _date(o['delivered_at']) < end]
        active_seconds = 0
        for shift in shifts:
            first = max(_date(shift['started_at']), start)
            last = min(_date(shift['ended_at']) if shift.get('ended_at') else now, end)
            active_seconds += max(0, int((last.astimezone(timezone.utc) - first.astimezone(timezone.utc)).total_seconds()))
        pay = [o.get('driver_pay_cents') for o in delivered]
        days.append({'date': day.isoformat(), 'deliveries': len(delivered), 'earningsCents': sum(pay) if all(p is not None for p in pay) else None, 'activeSeconds': active_seconds})
    return {'today': days[-1], 'week': days, 'currency': 'CAD', 'supportEmail': config.DRIVER_SUPPORT_EMAIL}


@router.get('/activity')
async def activity(authorization: str | None = Header(default=None)):
    token, uid = await _require_driver(authorization)
    now = datetime.now(timezone.utc)
    first_day = now.astimezone(LOCAL).date() - timedelta(days=6)
    start = datetime.combine(first_day, datetime.min.time(), LOCAL).isoformat()
    orders = await client.get(f'{REST_URL}/orders', headers=headers(token), params={'accepted_by': f'eq.{uid}', 'delivery_status': 'eq.delivered', 'delivered_at': f'gte.{start}', 'select': 'delivered_at,driver_pay_cents', 'limit': '1000'})
    shifts = await client.get(f'{REST_URL}/driver_shifts', headers=headers(token), params={'driver_id': f'eq.{uid}', 'or': f'(ended_at.is.null,ended_at.gte.{start})', 'select': 'started_at,ended_at', 'limit': '1000'})
    if orders.status_code != 200 or shifts.status_code != 200:
        raise HTTPException(503, 'Driver activity is unavailable')
    if len(orders.json()) >= 1000 or len(shifts.json()) >= 1000:
        raise HTTPException(503, 'Activity is too large to summarize safely')
    return summarize_activity(orders.json(), shifts.json(), now)
