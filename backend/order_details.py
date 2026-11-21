"""Customer-facing labels derived from stored order state, without changing it."""
from datetime import datetime


def display_date(value):
    try:
        return datetime.fromisoformat(value).strftime('%b %d, %Y').replace(' 0', ' ')
    except (TypeError, ValueError):
        return 'Date unavailable'


def order_detail_view(order):
    status = order.get('status') or ''
    fulfillment = order.get('fulfillment_status') or 'unfulfilled'
    demo = status == 'demo'
    payment_labels = {
        'paid': ('Payment confirmed', 'success'),
        'partially_refunded': ('Partially refunded', 'notice'),
        'refunded': ('Refunded', 'notice'),
        'demo': ('DEMO ORDER / NOT PAID', 'notice'),
        'pending': ('Payment pending', 'notice'),
        'checkout_error': ('Payment not completed', 'notice'),
        'expired': ('Payment not completed', 'notice'),
    }
    payment_label, payment_tone = payment_labels.get(status, ('Payment status unavailable', 'notice'))
    delivery_labels = {
        'unfulfilled': 'Order received', 'processing': 'Preparing your order',
        'shipped': 'Your order has shipped', 'delivered': 'Marked as delivered',
    }
    delivery_title = 'Delivery status unavailable'
    delivery_note = 'Contact TrueMerit for help with the latest status of your order.'
    progress = []
    if demo:
        delivery_title = 'No delivery scheduled'
        delivery_note = 'This is a test order. No money was collected, and no real delivery is scheduled.'
    elif status == 'pending':
        delivery_title = 'Awaiting payment confirmation'
        delivery_note = 'Payment has not been confirmed. Refresh this page to check the saved order status.'
    elif status in ('checkout_error', 'expired'):
        delivery_title = 'Payment not completed'
        delivery_note = 'No confirmed payment is recorded. Contact TrueMerit if you need help with this order.'
    elif status == 'refunded':
        delivery_title = 'Order refunded'
        delivery_note = 'A refund is recorded for this order. Any delivery details below show the last saved shipment information.'
    elif status in ('paid', 'partially_refunded') and fulfillment in delivery_labels:
        delivery_title = delivery_labels[fulfillment]
        delivery_note = {
            'unfulfilled': 'Your order is received. Delivery details will appear here when TrueMerit updates your order.',
            'processing': 'TrueMerit has marked your order as processing. Tracking details will appear here when available.',
            'shipped': ('Use the carrier and tracking number below for delivery updates.' if order.get('tracking_number')
                        else 'TrueMerit has marked your order as shipped. Tracking details will appear here when available.'),
            'delivered': 'TrueMerit has marked your order as delivered. Contact us if you need help with your delivery.',
        }[fulfillment]
        steps = [('unfulfilled', 'Order received'), ('processing', 'Processing'),
                 ('shipped', 'Shipped'), ('delivered', 'Delivered')]
        active = [key for key, _ in steps].index(fulfillment)
        progress = [dict(label=label, current=i == active,
                         state='complete' if i < active or active == 3 else 'current' if i == active else 'upcoming',
                         note='Complete' if i < active or active == 3 else 'Current' if i == active else 'Upcoming')
                    for i, (_, label) in enumerate(steps)]

    shipping = order.get('shipping_details') or {}
    address = shipping.get('address') or {}
    address_lines = [shipping.get('name') or address.get('name'), address.get('line1'), address.get('line2'),
                     ' '.join(str(address.get(key) or '') for key in ('city', 'state', 'postal_code')).strip(),
                     address.get('country')]
    calculated_total = max(0, (order.get('subtotal_cents') or 0) + (order.get('shipping_cents') or 0)
                           - (order.get('discount_cents') or 0) + (order.get('tax_cents') or 0))
    return {
        'demo': demo, 'payment_label': payment_label, 'payment_tone': payment_tone,
        'delivery_title': delivery_title, 'delivery_note': delivery_note, 'progress': progress,
        'fulfillment_label': {'unfulfilled':'No shipment recorded', 'processing':'Processing',
                              'shipped':'Shipped', 'delivered':'Delivered'}.get(fulfillment, 'Unavailable'),
        'placed_date': display_date(order.get('created_at')),
        'shipped_date': display_date(order['shipped_at']) if order.get('shipped_at') else '',
        'address_lines': [str(line) for line in address_lines if line],
        'shipping_service': {'standard':'Standard delivery', 'express':'Express delivery'}.get(shipping.get('service'), ''),
        'total_cents': calculated_total if demo else order.get('paid_total_cents') or calculated_total,
    }
