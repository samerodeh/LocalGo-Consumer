"""Exercise the real FastAPI process against the local Postman Supabase stand-in.

Run with DISPATCH_TEST_API=http://127.0.0.1:18083 after starting dispatch.sim.yaml
and FastAPI as documented in its context file. Never points at production.
"""
import os
import uuid
import httpx

base = os.environ['DISPATCH_TEST_API']
if not base.startswith('http://127.0.0.1:'):
    raise RuntimeError('This check is restricted to a local simulation')
api = httpx.Client(base_url=base, timeout=15)
driver = {'Authorization': 'Bearer simulation-driver'}
customer = {'Authorization': 'Bearer simulation-customer'}
other = {'Authorization': 'Bearer simulation-other'}
mock = httpx.Client(base_url='http://127.0.0.1:4910/supabase', timeout=15, headers=driver)
checks = 0

def check(value, message):
    global checks
    assert value, message
    checks += 1

initial_activity = api.get('/driver/activity', headers=driver).json()['today']
api.post('/driver/availability', json={'online': False}, headers=driver)
order_id = str(uuid.uuid4())
body = {
    'id': order_id, 'restaurant_name': 'Al Taib', 'restaurant_address': 'Montreal',
    'customer_name': 'Simulation Customer', 'dropoff_address': '1510 De Maisonneuve Ouest',
    'latitude': 45.496339, 'longitude': -73.578666, 'subtotal': 20,
    'delivery_fee': 5, 'tip': 2, 'total': 27,
    'items': [{'name': 'Chicken shawarma', 'quantity': 2}],
    'delivery_instructions': 'Leave by the blue door', 'entry_code': '1234', 'delivery_preference': 'Leave at door',
}
check(api.get('/health').status_code == 200, 'API must be running')
check(api.get('/orders/feed').status_code == 401, 'anonymous feed must be denied')
check(api.get('/orders/feed', headers=customer).status_code == 403, 'customer must not drive')
check(api.get('/orders/feed', headers=other).status_code == 403, 'a second account must not drive')
check(api.post('/orders', json=body, headers=customer).status_code == 200, 'consumer order must reach dispatch')
feed = api.get('/orders/feed', headers=driver).json()['orders']
check(any(o['id'] == order_id and o['status'] == 'available' for o in feed), 'driver must receive consumer order')
check(api.post(f'/orders/{order_id}/accept', headers=driver).status_code == 409, 'offline acceptance must fail')
check(api.post('/driver/availability', json={'online': True}, headers=driver).json()['online'], 'driver must go online')
offer = api.post('/driver/offers/next', headers=driver).json()['offer']
check(offer['orderId'] == order_id, 'online driver must receive a timed offer')
check(offer['order']['guaranteedPayCents'] == 700 and offer['order']['tipCents'] == 200, 'offer must include full base and tip payout without waiting for feed polling')
check(offer['order']['entryCode'] == '1234' and offer['order']['deliveryInstructions'] == body['delivery_instructions'], 'consumer instructions must survive dispatch')
repeated = api.post('/driver/offers/next', headers=driver).json()['offer']
check(repeated['expiresAt'] == offer['expiresAt'], 'refresh must not reset expiry')
check(api.post(f'/orders/{order_id}/accept', headers=driver).status_code == 200, 'approved driver must claim')
check(api.post(f'/orders/{order_id}/accept', headers=driver).status_code == 409, 'duplicate claim must conflict')
check(api.post('/driver/offers/next', headers=driver).json()['offer'] is None, 'no distracting offer during an active job')
check(api.post('/driver/availability', json={'online': False}, headers=driver).json()['online'] is False, 'driver must go offline')
check(any(o['id'] == order_id and o['status'] == 'accepted' for o in api.get('/orders/feed', headers=driver).json()['orders']), 'active delivery must survive offline mode')
check(api.post(f'/orders/{order_id}/status', json={'status': 'picked_up', 'verified_items': []}, headers=driver).status_code == 422, 'pickup checklist must be complete')
check(api.post(f'/orders/{order_id}/status', json={'status': 'delivered'}, headers=driver).status_code == 409, 'cannot skip pickup')
mock.post('/__control', json={'failure': 'mirror'})
check(api.post(f'/orders/{order_id}/status', json={'status': 'picked_up', 'verified_items': [0]}, headers=driver).status_code == 502, 'failed customer update must not report success')
mock.post('/__control', json={})
for status, photo_field in [('picked_up', 'pickup_photo_url'), ('delivered', 'dropoff_photo_url')]:
    stage = 'pickup' if status == 'picked_up' else 'dropoff'
    name = f'{order_id}/{stage}-fixture.jpg'
    photo = f'https://sxednzdbbfjxdvezmouf.supabase.co/storage/v1/object/public/order-photos/{name}'
    if status == 'delivered':
        missing = photo.replace('-fixture.jpg', '-missing.jpg')
        check(api.post(f'/orders/{order_id}/status', json={'status': status, 'photo_url': missing}, headers=driver).status_code == 422, 'nonexistent proof must be rejected')
    mock.post(f'/storage/v1/object/order-photos/{name}', json={}).raise_for_status()
    response = api.post(f'/orders/{order_id}/status', json={'status': status, 'photo_url': photo, 'verified_items': [0]}, headers=driver)
    check(response.status_code == 200, f'{status} must be acknowledged')
    rows = mock.get('/rest/v1/orders', params={'id': f'eq.{order_id}'}, headers=customer).json()
    check(rows[0]['delivery_status'] == status and rows[0][photo_field] == photo, 'customer must see progress and proof photo')
    rows = api.get('/orders/feed', headers=driver).json()['orders']
    check(next(o for o in rows if o['id'] == order_id)['status'] == status, 'driver and customer progress must agree')
stats = api.get('/driver/activity', headers=driver).json()
check(stats['today']['earningsCents'] == (initial_activity['earningsCents'] or 0) + 700, 'driver must earn 5 CAD plus the entire 2 CAD tip')
check(stats['today']['deliveries'] == initial_activity['deliveries'] + 1 and len(stats['week']) == 7, 'activity must count actual completed deliveries')
mock.post('/__control', json={'failure': 'overlay'})
check(api.get('/orders/feed', headers=driver).status_code == 502, 'overlay outage must not return misleading available orders')
mock.post('/__control', json={})
print(f'{checks} HTTP integration checks passed against the real FastAPI process and simulated Supabase.')
