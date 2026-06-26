// Stripe webhook → Supabase enrollment + Resend welcome email
// Events handled:
//   checkout.session.completed  → one-time purchase OR first subscription payment
//   invoice.paid                → recurring subscription payment (tracks plan progress)

export async function onRequestPost(context) {
  const { request, env } = context;

  const sig    = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  // Verify Stripe signature
  const isValid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(event.data.object, env);
  } else if (event.type === 'invoice.paid') {
    await handleInvoicePaid(event.data.object, env);
  }

  return new Response('ok', { status: 200 });
}

// ─── checkout.session.completed ───────────────────────────────────────────────

async function handleCheckoutCompleted(session, env) {
  const email      = session.customer_details?.email || session.customer_email;
  const productId  = session.metadata?.product_id;
  const productName = session.metadata?.product_name;
  const type       = session.metadata?.type;
  const planCount  = parseInt(session.metadata?.plan_count || '0', 10);
  const sessionId  = session.id;
  const amountPaid = session.amount_total;

  if (!email || !productId) return;

  // Write enrollment to Supabase
  await supabaseInsert(env, 'tmq_vault_enrollments', {
    student_email:            email,
    course_id:                productId,
    stripe_session_id:        sessionId,
    stripe_payment_intent_id: session.payment_intent || null,
    amount_paid_cents:        amountPaid,
  });

  // If this is a payment plan subscription, start tracking it
  if (type === 'subscription' && planCount > 0 && session.subscription) {
    await supabaseInsert(env, 'tmq_vault_payment_plans', {
      student_email:          email,
      course_id:              productId,
      stripe_subscription_id: session.subscription,
      payments_made:          1,
      payments_required:      planCount,
      status:                 'active',
    });
  }

  // Send welcome email via Resend
  await sendWelcomeEmail(env, email, productName, type, planCount);
}

// ─── invoice.paid (subscription payment #2, #3, …) ───────────────────────────

async function handleInvoicePaid(invoice, env) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  // Fetch current plan record
  const plan = await supabaseFetch(
    env,
    `tmq_vault_payment_plans?stripe_subscription_id=eq.${subscriptionId}&select=*`
  );

  if (!plan || plan.length === 0) return;

  const record = plan[0];
  const newCount = record.payments_made + 1;

  // Update payment count
  await supabasePatch(
    env,
    `tmq_vault_payment_plans?stripe_subscription_id=eq.${subscriptionId}`,
    { payments_made: newCount }
  );

  // All payments complete — alert Gemma to cancel the subscription manually
  if (newCount >= record.payments_required) {
    await supabasePatch(
      env,
      `tmq_vault_payment_plans?stripe_subscription_id=eq.${subscriptionId}`,
      { status: 'complete' }
    );

    await sendAdminAlert(env, {
      studentEmail:   record.student_email,
      courseId:       record.course_id,
      subscriptionId,
      paymentsRequired: record.payments_required,
    });
  }
}

// ─── Supabase helpers ──────────────────────────────────────────────────────────

async function supabaseInsert(env, table, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: supabaseHeaders(env),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase insert error (${table}):`, err);
  }
}

async function supabaseFetch(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: supabaseHeaders(env),
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabasePatch(env, path, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: supabaseHeaders(env),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Supabase patch error:', err);
  }
}

function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal,resolution=merge-duplicates',
  };
}

// ─── Resend emails ─────────────────────────────────────────────────────────────

async function sendWelcomeEmail(env, to, productName, type, planCount) {
  const isPlan = type === 'subscription' && planCount > 0;

  const html = `
    <div style="background:#0f0720;color:#f5f0e8;font-family:Georgia,serif;padding:48px 32px;max-width:560px;margin:0 auto;">
      <p style="color:#c9a84c;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:24px;">♛ The Manifesting Queen</p>
      <h1 style="font-size:32px;font-weight:300;line-height:1.2;margin-bottom:16px;">
        You're in, ${to.split('@')[0]}.<br>Welcome to The Vault.
      </h1>
      <hr style="border:none;border-top:1px solid rgba(201,168,76,0.3);margin:24px 0;">
      <p style="color:#a89cc8;line-height:1.75;margin-bottom:16px;">
        Your purchase of <strong style="color:#f5f0e8;">${productName}</strong> is confirmed.
        ${isPlan ? `<br><em style="color:#c9a84c;">Payment plan: ${planCount} monthly payments. Payment 1 of ${planCount} received.</em>` : ''}
      </p>
      <p style="color:#a89cc8;line-height:1.75;margin-bottom:24px;">
        The Vault portal is being built for you right now. You will receive a separate email with your personal access link as soon as it opens — you are on the priority list.
      </p>
      <p style="color:#a89cc8;line-height:1.75;margin-bottom:8px;">
        In the meantime, if you have any questions, simply reply to this email.
      </p>
      <p style="color:#a89cc8;line-height:1.75;">
        With love and frequency,<br>
        <strong style="color:#f5f0e8;">Gemma</strong><br>
        <em>The Manifesting Queen</em>
      </p>
      <hr style="border:none;border-top:1px solid rgba(201,168,76,0.15);margin:32px 0 16px;">
      <p style="font-size:11px;color:#5a4d7a;">
        © 2026 The Manifesting Queen · <a href="https://themanifestingqueen.com" style="color:#c9a84c;">themanifestingqueen.com</a>
      </p>
    </div>
  `;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Gemma <gemma@themanifestingqueen.com>',
      to:      [to],
      subject: `You're in — Welcome to The Vault ♛`,
      html,
    }),
  });
}

async function sendAdminAlert(env, { studentEmail, courseId, subscriptionId, paymentsRequired }) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Vault System <gemma@themanifestingqueen.com>',
      to:      ['gemma@themanifestingqueen.com'],
      subject: `ACTION REQUIRED: Cancel subscription for ${studentEmail}`,
      html: `
        <p><strong>A payment plan is now complete.</strong></p>
        <p>Student: ${studentEmail}<br>
        Course: ${courseId}<br>
        Payments made: ${paymentsRequired} / ${paymentsRequired}</p>
        <p><strong>Please cancel this Stripe subscription immediately:</strong><br>
        Subscription ID: <code>${subscriptionId}</code></p>
        <p>
          <a href="https://dashboard.stripe.com/subscriptions/${subscriptionId}">
            Open in Stripe Dashboard →
          </a>
        </p>
        <p style="color:#cc0000;">⚠️ If you do not cancel, the student will continue to be charged.</p>
      `,
    }),
  });
}

// ─── Stripe signature verification (HMAC-SHA256, Web Crypto) ──────────────────

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!secret || !sigHeader) return false;

  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.split('='))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');

  return hex === signature;
}
