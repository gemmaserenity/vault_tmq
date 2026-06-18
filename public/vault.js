async function startCheckout(btn) {
  const card = btn.closest('[data-product-id]') || btn;
  const productId = card.dataset.productId || btn.dataset.productId;
  const price     = parseInt(card.dataset.price    || btn.dataset.price, 10);
  const name      = card.dataset.name              || btn.dataset.name;
  const type      = card.dataset.type              || btn.dataset.type   || 'one-time';
  const planCount = parseInt(btn.dataset.planCount || '0', 10);

  if (!productId || !price) return;

  showLoading(true);

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, price, name, type, planCount }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Checkout failed');
    }

    const { url } = await res.json();
    window.location.href = url;
  } catch (e) {
    showLoading(false);
    alert('Something went wrong — please try again or contact gemma@themanifestingqueen.com');
    console.error(e);
  }
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}
