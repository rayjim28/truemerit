"""Delivery presentation, saved totals and private order access."""
import os
import tempfile
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_tmp = tempfile.TemporaryDirectory(prefix='truemerit-order-details-')
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(_tmp.name) / 'test.db')
os.environ['APP_ENV'] = 'development'
os.environ['PAYMENT_MODE'] = 'demo'
os.environ['SESSION_SECRET'] = 'isolated-order-detail-test-secret-123456789012345'
import main
from database import Customer, EmailOutbox, Order, SessionLocal
from security import CUSTOMER_COOKIE, create_customer_token
from backend.guest_orders import guest_order_token
from backend.order_details import order_detail_view


def data():
    return dict(status='paid', fulfillment_status='unfulfilled', subtotal_cents=3998,
                shipping_cents=795, discount_cents=500, tax_cents=210,
                paid_total_cents=4503, created_at='2026-11-21T12:30:00+00:00')


@pytest.mark.parametrize('fulfillment,current', [('unfulfilled',0), ('processing',1), ('shipped',2), ('delivered',3)])
def test_delivery_steps_highlight_only_the_stored_stage(fulfillment, current):
    order = data()
    order['fulfillment_status'] = fulfillment
    before = deepcopy(order)
    view = order_detail_view(order)
    assert [i for i, step in enumerate(view['progress']) if step['current']] == [current]
    assert [s['state'] for s in view['progress'][:current]] == ['complete'] * current
    assert all(s['state'] == 'upcoming' for s in view['progress'][current+1:])
    assert view['progress'][current]['state'] == ('complete' if current == 3 else 'current')
    assert order == before, 'Rendering must not alter stored status or amounts'


@pytest.mark.parametrize('status,title', [
    ('demo', 'No delivery scheduled'), ('pending', 'Awaiting payment confirmation'),
    ('expired', 'Payment not completed'), ('checkout_error', 'Payment not completed'),
    ('refunded', 'Order refunded'), ('unrecognized', 'Delivery status unavailable'),
])
def test_nonpaid_or_refunded_orders_do_not_claim_active_delivery(status, title):
    order = data(); order.update(status=status, fulfillment_status='shipped')
    view = order_detail_view(order)
    assert view['delivery_title'] == title
    assert view['progress'] == []


def test_unknown_delivery_state_has_no_invented_progress():
    order = data(); order['fulfillment_status'] = 'unrecognized'
    assert order_detail_view(order)['progress'] == []
    assert order_detail_view(order)['delivery_title'] == 'Delivery status unavailable'


def test_totals_include_saved_tax_and_do_not_subtract_refunds_twice():
    order = data(); order.update(paid_total_cents=0, refunded_cents=1200, status='partially_refunded')
    assert order_detail_view(order)['total_cents'] == 4503
    order['paid_total_cents'] = 4510
    assert order_detail_view(order)['total_cents'] == 4510
    assert len(order_detail_view(order)['progress']) == 4
    order['status'] = 'demo'
    assert order_detail_view(order)['total_cents'] == 4503


def test_stripe_and_demo_address_names_and_dates():
    order = data(); order['shipping_details'] = {'name':'Stripe recipient', 'address':{'line1':'123 Example Lane','city':'Test City','state':'MD','postal_code':'20000','country':'US'}}
    view = order_detail_view(order)
    assert view['address_lines'][0] == 'Stripe recipient'
    assert 'Test City MD 20000' in view['address_lines']
    assert view['placed_date'] == 'Nov 21, 2026'
    order['shipping_details'] = {'address':{'name':'Demo recipient','line1':'123 Example Lane'}}
    assert order_detail_view(order)['address_lines'][0] == 'Demo recipient'
    order['created_at'] = None
    assert order_detail_view(order)['placed_date'] == 'Date unavailable'


def saved_order(customer_id=None):
    oid = str(uuid.uuid4())
    with SessionLocal() as db:
        order = Order(id=oid, email='order-review@example.com', customer_id=customer_id,
                      status='paid', fulfillment_status='processing', subtotal_cents=3998,
                      shipping_cents=795, discount_cents=500, tax_cents=210, paid_total_cents=4503,
                      created_at=datetime(2026,11,21,tzinfo=timezone.utc),
                      shipping_details={'name':'Example recipient','address':{'line1':'123 Sample Lane','city':'Sample City','state':'MD','postal_code':'20000'}},
                      items_snapshot=[{'name':'Sample cleaning tool','qty':2,'price_cents':1999,'image_url':''}])
        db.add(order); db.commit()
        return oid, guest_order_token(order)


def test_private_guest_order_refreshes_saved_tracking_without_side_effects():
    with TestClient(main.app) as client:
        oid, token = saved_order()
        path = '/guest/orders/' + token
        first = client.get(path)
        assert first.status_code == 200
        assert 'Preparing your order' in first.text
        assert 'Example recipient' in first.text and oid in first.text
        assert '$45.03' in first.text
        assert first.headers['Cache-Control'] == 'no-store, private'
        assert first.headers['Referrer-Policy'] == 'no-referrer'
        assert 'noindex' in first.headers['X-Robots-Tag']
        with SessionLocal() as db:
            before = db.query(EmailOutbox).count()
            order = db.get(Order, oid); order.fulfillment_status = 'shipped'
            order.tracking_number = 'SAMPLE123456'; order.carrier = 'Example carrier'
            db.commit()
        refreshed = client.get(path)
        assert 'Your order has shipped' in refreshed.text and 'SAMPLE123456' in refreshed.text
        assert 'method="get"' in refreshed.text
        assert client.get(path[:-5] + 'wrong').status_code == 404
        assert client.get('/guest/orders/' + oid).status_code == 404
        with SessionLocal() as db:
            assert db.query(EmailOutbox).count() == before
            assert db.get(Order, oid).status == 'paid'


def test_account_order_stays_owner_only_and_escapes_saved_content():
    with TestClient(main.app) as client:
        with SessionLocal() as db:
            first = Customer(full_name='Review One',email='one@example.com',password_hash='unused',email_verified=True)
            second = Customer(full_name='Review Two',email='two@example.com',password_hash='unused',email_verified=True)
            db.add_all([first,second]); db.commit(); first_id, second_id = first.id, second.id
        oid, _ = saved_order(first_id)
        assert client.get('/account/orders/' + oid).status_code == 401
        client.cookies.set(CUSTOMER_COOKIE, create_customer_token(second_id,1))
        assert client.get('/account/orders/' + oid).status_code == 404
        client.cookies.set(CUSTOMER_COOKIE, create_customer_token(first_id,1))
        with SessionLocal() as db:
            order = db.get(Order,oid); order.carrier = '<script>bad()</script>'
            db.commit()
        response = client.get('/account/orders/' + oid)
        assert response.status_code == 200
        assert 'href="/account"' in response.text
        assert '&lt;script&gt;bad()&lt;/script&gt;' in response.text
        assert '<script>bad()</script>' not in response.text
        assert response.headers['Cache-Control'] == 'no-store, private'
