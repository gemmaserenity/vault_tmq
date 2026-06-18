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

  const isSubscription = type === 'subscription';
  const params = new URLSearchParams();

  params.set('mode', isSubscription ? 'subscription' : 'payment');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product]', productId);
  params.set('line_items[0][price_data][unit_amount]', String(price));
  params.set('line_items[0][quantity]', '1');

  if (isSubscription) {
    params.set('line_items[0][price_data][recurring][interval]', 'month');
    params.set('line_items[0][price_data][recurring][interval_count]', '1');
    if (planCount) params.set('metadata[plan_count]', String(planCount));
  } else {
    // customer_creation only valid in payment mode
    params.set('customer_creation', 'always');
    params.set('allow_promotion_codes', 'true');
  }

  params.set('success_url', `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${origin}/`);
  params.set('metadata[product_name]', name);
  params.set('metadata[product_id]', productId);
  params.set('metadata[type]', type);

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
    console.error('Stripe error:', JSON.stringify(session));
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
