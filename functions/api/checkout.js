export async function onRequestPost(context) {
  const { request, env } = context;

  const origin = new URL(request.url).origin;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { productId, price, name, type, planCount } = body;

  if (!productId || !price || !name) {
    return json({ error: 'Missing required fields' }, 400);
  }

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe not configured' }, 500);
  }

  const lineItem = type === 'subscription'
    ? {
        price_data: {
          currency: 'usd',
          product: productId,
          unit_amount: price,
          recurring: { interval: 'month', interval_count: 1 },
        },
        quantity: 1,
      }
    : {
        price_data: {
          currency: 'usd',
          product: productId,
          unit_amount: price,
        },
        quantity: 1,
      };

  const params = new URLSearchParams({
    mode:                          type === 'subscription' ? 'subscription' : 'payment',
    'line_items[0][price_data][currency]':    lineItem.price_data.currency,
    'line_items[0][price_data][product]':     lineItem.price_data.product,
    'line_items[0][price_data][unit_amount]': String(lineItem.price_data.unit_amount),
    'line_items[0][quantity]':                '1',
    success_url: `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}/`,
    'customer_email': '',
    'metadata[product_name]': name,
    'metadata[product_id]':   productId,
    'metadata[type]':         type,
  });

  if (type === 'subscription') {
    params.set('line_items[0][price_data][recurring][interval]', 'month');
    params.set('line_items[0][price_data][recurring][interval_count]', '1');
    if (planCount) params.set('metadata[plan_count]', String(planCount));
  }

  // allow promo codes
  params.set('allow_promotion_codes', 'true');

  // collect email for enrollment webhook
  params.set('customer_creation', 'always');

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok) {
    console.error('Stripe error:', session);
    return json({ error: session.error?.message || 'Stripe error' }, 500);
  }

  return json({ url: session.url });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
