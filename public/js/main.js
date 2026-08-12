window.SITE = { user: null, cartCount: 0 };

function formatPrice(n) {
  return '$' + Number(n).toFixed(2).replace(/\.00$/, '');
}
window.formatPrice = formatPrice;

const Toast = {
  show(message, opts = {}) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span>${message}</span>`;
    if (opts.actionLabel && opts.actionHref) {
      const a = document.createElement('a');
      a.href = opts.actionHref; a.textContent = opts.actionLabel;
      el.appendChild(a);
    }
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
  }
};
window.Toast = Toast;

async function refreshSiteState() {
  try {
    const [{ user }, cart] = await Promise.all([API.get('/api/auth/me'), API.get('/api/cart')]);
    SITE.user = user;
    SITE.cartCount = cart.count || 0;
    renderAccountArea();
    renderCartBadge();
  } catch (e) {  }
}

function renderCartBadge() {
  document.querySelectorAll('.js-cart-count').forEach(el => {
    el.textContent = SITE.cartCount;
    el.style.display = SITE.cartCount > 0 ? 'flex' : 'none';
  });
}

function renderAccountArea() {
  const slot = document.getElementById('account-slot');
  const mobileSlot = document.getElementById('mobile-account-slot');
  if (!slot) return;
  if (SITE.user) {
    const initial = SITE.user.name ? SITE.user.name[0].toUpperCase() : 'A';
    slot.innerHTML = `
      <div class="dropdown" id="account-dropdown">
        <button class="account-pill" id="account-pill-btn"><span class="avatar-circle">${initial}</span> ${SITE.user.name.split(' ')[0]}</button>
        <div class="dropdown-panel">
          <a href="/dashboard.html">Dashboard</a>
          <a href="/orders.html">Orders</a>
          <a href="/saved-items.html">Saved Items</a>
          <a href="/addresses.html">Addresses</a>
          <a href="/account-settings.html">Account Settings</a>
          ${SITE.user.role === 'admin' ? '<div class="dropdown-divider"></div><a href="/admin/index.html">Admin Dashboard</a>' : ''}
          <div class="dropdown-divider"></div>
          <button id="logout-btn">Log Out</button>
        </div>
      </div>`;
    document.getElementById('account-pill-btn').addEventListener('click', () => {
      document.getElementById('account-dropdown').classList.toggle('open');
    });
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await API.post('/api/auth/logout');
      SITE.user = null;
      Toast.show('You have been logged out.');
      renderAccountArea();
      if (/dashboard|orders|saved-items|addresses|payment-methods|account-settings/.test(location.pathname) || location.pathname.startsWith('/admin')) {
        location.href = '/index.html';
      }
    });
  } else {
    slot.innerHTML = `<a href="/login.html" class="btn btn-ghost btn-sm">Log In</a><a href="/signup.html" class="btn btn-primary btn-sm">Sign Up</a>`;
  }
  if (mobileSlot) {
    mobileSlot.innerHTML = SITE.user
      ? `<a href="/dashboard.html">Dashboard</a><a href="/orders.html">Orders</a><a href="/saved-items.html">Saved Items</a>${SITE.user.role === 'admin' ? '<a href="/admin/index.html">Admin</a>' : ''}<a href="#" id="mobile-logout">Log Out</a>`
      : `<a href="/login.html">Log In</a><a href="/signup.html">Sign Up</a>`;
    const ml = document.getElementById('mobile-logout');
    if (ml) ml.addEventListener('click', async (e) => { e.preventDefault(); await API.post('/api/auth/logout'); location.href = '/index.html'; });
  }
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('account-dropdown');
  if (dd && !dd.contains(e.target)) dd.classList.remove('open');
});

function initMobileDrawer() {
  const btn = document.querySelector('.mobile-menu-btn');
  const drawer = document.getElementById('mobile-drawer');
  if (!btn || !drawer) return;
  btn.addEventListener('click', () => drawer.classList.add('open'));
  drawer.querySelector('.mobile-drawer-backdrop').addEventListener('click', () => drawer.classList.remove('open'));
  drawer.querySelector('.mobile-close').addEventListener('click', () => drawer.classList.remove('open'));
}

async function addToCart(productId, variantId, qty = 1) {
  try {
    const cart = await API.post('/api/cart', { productId, variantId: variantId || null, qty });
    SITE.cartCount = cart.count || 0;
    renderCartBadge();
    Toast.show('✓ Added to cart', { actionLabel: 'View Cart', actionHref: '/cart.html' });
    return cart;
  } catch (e) {
    Toast.show(e.message || 'Could not add to cart.');
  }
}
window.addToCart = addToCart;

async function toggleFavorite(productId, btnEl) {
  if (!SITE.user) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); return; }
  const active = btnEl.classList.contains('active');
  try {
    if (active) { await API.del('/api/wishlist/' + productId); btnEl.classList.remove('active'); Toast.show('Removed from saved items.'); }
    else { await API.post('/api/wishlist', { productId }); btnEl.classList.add('active'); Toast.show('Saved to your favorites.'); }
  } catch (e) { Toast.show(e.message || 'Something went wrong.'); }
}
window.toggleFavorite = toggleFavorite;

function requireAuthOrRedirect() {
  if (!SITE.user) {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return false;
  }
  return true;
}
window.requireAuthOrRedirect = requireAuthOrRedirect;

function productCardHTML(p) {
  const price = p.discount_price ? p.discount_price : p.price;
  const img = p.image || Placeholder.productImage('p' + p.id, p.name);
  return `
  <div class="product-card" data-product-id="${p.id}">
    <a href="/product.html?id=${p.slug || p.id}">
      <div class="product-media">
        ${p.is_new ? '<div class="product-badges"><span class="badge badge-new">New</span></div>' : (p.discount_price ? '<div class="product-badges"><span class="badge badge-sale">Sale</span></div>' : '')}
        <button class="product-favorite js-fav-btn" data-product-id="${p.id}" onclick="event.preventDefault(); toggleFavorite(${p.id}, this)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z"/></svg>
        </button>
        <img src="${img}" alt="${p.name}" loading="lazy">
        <div class="quick-add"><button onclick="event.preventDefault(); addToCart(${p.id}, null, 1)">Quick Add</button></div>
      </div>
      <div class="product-brand">${p.brand_name || (p.brand ? p.brand.name : '')}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-price">
        ${p.discount_price ? `<span class="price-sale">${formatPrice(p.discount_price)}</span><span class="price-strike">${formatPrice(p.price)}</span>` : `<span>${formatPrice(price)}</span>`}
      </div>
    </a>
  </div>`;
}
window.productCardHTML = productCardHTML;

const AIAssistant = {
  history: [],
  state: 'closed',

  loadState() {
    try { this.history = JSON.parse(sessionStorage.getItem('ai_history') || '[]'); } catch (e) { this.history = []; }
    this.state = sessionStorage.getItem('ai_panel_state') || 'closed';
  },
  saveHistory() {
    try { sessionStorage.setItem('ai_history', JSON.stringify(this.history)); } catch (e) {}
  },
  saveState() {
    try { sessionStorage.setItem('ai_panel_state', this.state); } catch (e) {}
  },

  init() {
    if (document.getElementById('ai-sidebar')) return;
    this.loadState();

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <aside class="ai-sidebar" id="ai-sidebar">
        <div class="ai-panel-header">
          <div class="title">✨ Fashion Assistant</div>
          <div class="ai-header-actions">
            <button id="ai-minimize" aria-label="Minimize" title="Minimize">−</button>
            <button id="ai-close" aria-label="Close" title="Close">✕</button>
          </div>
        </div>
        <div class="ai-panel-body" id="ai-body"></div>
        <div class="ai-panel-input">
          <input type="text" id="ai-input" placeholder="Ask about styling or products..." />
          <button id="ai-send">➤</button>
        </div>
      </aside>
      <button class="ai-min-tab" id="ai-min-tab" aria-label="Reopen Fashion Assistant">✨</button>`;
    document.body.appendChild(wrap);

    document.getElementById('ai-minimize').addEventListener('click', () => this.minimize());
    document.getElementById('ai-close').addEventListener('click', () => this.close());
    document.getElementById('ai-min-tab').addEventListener('click', () => this.open());
    document.getElementById('ai-send').addEventListener('click', () => this.send());
    document.getElementById('ai-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.send(); });

    const navTrigger = document.getElementById('ai-nav-trigger');
    if (navTrigger) navTrigger.addEventListener('click', () => this.toggle());
    const navTriggerMobile = document.getElementById('ai-nav-trigger-mobile');
    if (navTriggerMobile) navTriggerMobile.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('mobile-drawer')?.classList.remove('open');
      this.open();
    });

    if (this.history.length) this.replayHistory();
    else this.renderWelcome();

    this.applyState();
  },

  applyState() {
    const sidebar = document.getElementById('ai-sidebar');
    const tab = document.getElementById('ai-min-tab');
    sidebar.classList.toggle('open', this.state === 'open');
    tab.classList.toggle('visible', this.state === 'minimized');
  },
  open() { this.state = 'open'; this.saveState(); this.applyState(); document.getElementById('ai-input').focus(); },
  minimize() { this.state = 'minimized'; this.saveState(); this.applyState(); },
  close() { this.state = 'closed'; this.saveState(); this.applyState(); },
  toggle() { this.state === 'open' ? this.minimize() : this.open(); },

  renderWelcome() {
    this.appendAssistant("Hi! I'm your Fashion Assistant — ask me to put together an outfit, get styling advice, or help finding something in the shop.", [
      { type: 'quick', label: 'Style an outfit', prompt: 'Put together an outfit for me' },
      { type: 'quick', label: 'What should I wear?', prompt: 'What should I wear to a wedding?' },
      { type: 'quick', label: 'Find a product', prompt: 'Show me new arrivals' },
      { type: 'quick', label: 'Find a brand', prompt: 'Show me all brands' },
    ], [], [], false);
  },
  replayHistory() {
    const body = document.getElementById('ai-body');
    body.innerHTML = '';
    this.history.forEach(m => {
      if (m.role === 'user') this.appendUser(m.text, false);
      else this.appendAssistant(m.text, m.actions, m.products, m.brands, false);
    });
    body.scrollTop = body.scrollHeight;
  },

  appendUser(text, record = true) {
    const body = document.getElementById('ai-body');
    const el = document.createElement('div');
    el.className = 'ai-msg user';
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    if (record) { this.history.push({ role: 'user', text }); this.saveHistory(); }
  },
  appendAssistant(text, actions = [], products = [], brands = [], record = true) {
    const body = document.getElementById('ai-body');
    const el = document.createElement('div');
    el.className = 'ai-msg assistant';
    el.textContent = text;
    body.appendChild(el);

    if (products && products.length) {
      const strip = document.createElement('div');
      strip.className = 'ai-product-strip';
      strip.innerHTML = products.map(p => `<div class="ai-product-card">${productCardHTML(p)}</div>`).join('');
      body.appendChild(strip);
    }
    if (brands && brands.length) {
      const row = document.createElement('div');
      row.className = 'ai-actions-row';
      row.innerHTML = brands.map(b => `<button class="ai-action-btn" data-nav="/brand.html?slug=${b.slug}">${b.name}</button>`).join('');
      body.appendChild(row);
    }
    if (actions && actions.length) {
      const row = document.createElement('div');
      row.className = 'ai-actions-row';
      actions.forEach(a => {
        const btn = document.createElement('button');
        btn.className = 'ai-action-btn';
        btn.textContent = a.label;
        btn.addEventListener('click', () => this.handleAction(a));
        row.appendChild(btn);
      });
      body.appendChild(row);
    }
    body.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => location.href = b.dataset.nav));
    body.scrollTop = body.scrollHeight;
    if (record) { this.history.push({ role: 'assistant', text, actions, products, brands }); this.saveHistory(); }
  },
  handleAction(a) {
    if (a.type === 'quick') { document.getElementById('ai-input').value = a.prompt; this.send(); return; }
    const map = {
      open_cart: '/cart.html',
      open_orders: '/orders.html',
      open_wishlist: '/saved-items.html',
      open_profile: '/dashboard.html',
      open_addresses: '/addresses.html',
      open_brands: '/brands.html',
      open_login: '/login.html',
      open_categories: '/shop.html',
    };
    if (a.type === 'open_order' && a.payload) { location.href = '/order-detail.html?id=' + a.payload.orderId; return; }
    if (a.type === 'track_order') { location.href = '/orders.html'; return; }
    if (a.type === 'open_category' && a.payload) { location.href = '/shop.html?category=' + (a.payload.slug || a.payload.category); return; }
    if (a.type === 'open_brand' && a.payload) { location.href = '/brand.html?slug=' + a.payload.slug; return; }
    if (a.type === 'open_product' && a.payload) { location.href = '/product.html?id=' + a.payload.id; return; }
    if (a.type === 'search_products') {
      const p = a.payload || {};
      const q = new URLSearchParams();
      if (p.category) q.set('category', p.category);
      if (p.brand) q.set('brand', p.brand);
      if (p.color) q.set('color', p.color);
      if (p.minPrice) q.set('minPrice', p.minPrice);
      if (p.maxPrice) q.set('maxPrice', p.maxPrice);
      if (p.q) q.set('q', p.q);
      location.href = '/shop.html' + (q.toString() ? '?' + q.toString() : '');
      return;
    }
    if (map[a.type]) { location.href = map[a.type]; return; }
  },
  getContext() {
    const body = document.body;
    return {
      page: body.dataset.page || null,
      productId: body.dataset.productId || null,
      categorySlug: body.dataset.categorySlug || null,
    };
  },
  async send() {
    const input = document.getElementById('ai-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    this.appendUser(message);
    const bodyEl = document.getElementById('ai-body');
    const typingEl = document.createElement('div');
    typingEl.className = 'ai-msg assistant ai-typing-wrap';
    typingEl.innerHTML = `<div class="ai-typing"><span></span><span></span><span></span></div>`;
    bodyEl.appendChild(typingEl);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    try {
      const res = await API.post('/api/ai/chat', { message, context: this.getContext(), history: this.history.slice(-10) });
      typingEl.remove();
      this.appendAssistant(res.reply, res.actions, res.products, res.brands);
    } catch (e) {
      typingEl.remove();
      this.appendAssistant("Sorry, I couldn't process that. Please try again.");
    }
  }
};
window.AIAssistant = AIAssistant;

async function injectPartials() {
  const headerSlot = document.getElementById('site-header-slot');
  const footerSlot = document.getElementById('site-footer-slot');
  const jobs = [];
  if (headerSlot) jobs.push(fetch('/partials/header.html').then(r => r.text()).then(html => headerSlot.innerHTML = html));
  if (footerSlot) jobs.push(fetch('/partials/footer.html').then(r => r.text()).then(html => footerSlot.innerHTML = html));
  await Promise.all(jobs);
}

function dashNavHTML(active) {
  const items = [
    { key: 'dashboard', href: '/dashboard.html', label: 'Dashboard' },
    { key: 'orders', href: '/orders.html', label: 'Orders' },
    { key: 'saved', href: '/saved-items.html', label: 'Saved Items' },
    { key: 'addresses', href: '/addresses.html', label: 'Addresses' },
    { key: 'payments', href: '/payment-methods.html', label: 'Payment Methods' },
    { key: 'settings', href: '/account-settings.html', label: 'Account Settings' },
  ];
  return `<nav class="dash-nav">
    ${items.map(i => `<a href="${i.href}" class="${active === i.key ? 'active' : ''}">${i.label}</a>`).join('')}
    <button class="logout-link" id="dash-logout-btn">Log Out</button>
  </nav>`;
}
window.dashNavHTML = dashNavHTML;
function initDashLogout() {
  const btn = document.getElementById('dash-logout-btn');
  if (btn) btn.addEventListener('click', async () => { await API.post('/api/auth/logout'); location.href = '/index.html'; });
}
window.initDashLogout = initDashLogout;

document.addEventListener('DOMContentLoaded', async () => {
  await injectPartials();
  initMobileDrawer();
  await refreshSiteState();
  AIAssistant.init();
  document.dispatchEvent(new Event('chrome:ready'));
});

