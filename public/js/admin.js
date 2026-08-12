const AdminAPI = window.API; // reuse same fetch wrapper

// Pages that only the owner (role 'admin') may access at all, even if a
// brand_admin tries to navigate straight to the URL.
const OWNER_ONLY_PAGES = ['brands', 'categories', 'users'];

async function adminGuard(activeKey) {
  let me;
  try { me = await API.get('/api/auth/me'); } catch (e) { me = { user: null }; }
  if (!me.user || (me.user.role !== 'admin' && me.user.role !== 'brand_admin')) {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname);
    return null;
  }
  if (OWNER_ONLY_PAGES.includes(activeKey) && me.user.role !== 'admin') {
    location.href = '/admin/index.html';
    return null;
  }

  const sidebarHTML = await (await fetch('/admin/_sidebar.html')).text();
  document.getElementById('admin-sidebar-slot').innerHTML = sidebarHTML;
  document.querySelectorAll('.admin-nav a[data-key]').forEach(a => { if (a.dataset.key === activeKey) a.classList.add('active'); });

  // Brand admins only manage their own brand's products and orders — hide
  // the owner-only sections of the nav rather than just relying on the
  // backend rejecting the request.
  if (me.user.role === 'brand_admin') {
    OWNER_ONLY_PAGES.forEach(key => {
      const link = document.querySelector(`.admin-nav a[data-key="${key}"]`);
      if (link) link.remove();
    });
    const badge = document.getElementById('admin-role-badge');
    if (badge) badge.textContent = 'Brand Admin';
  }

  document.getElementById('admin-logout-link').addEventListener('click', async (e) => {
    e.preventDefault(); await API.post('/api/auth/logout'); location.href = '/index.html';
  });
  return me.user;
}
window.adminGuard = adminGuard;

if (!window.Toast) {
  window.Toast = {
    show(message) {
      let container = document.getElementById('toast-container');
      if (!container) { container = document.createElement('div'); container.id = 'toast-container'; document.body.appendChild(container); }
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3000);
    }
  };
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
window.escapeHTML = escapeHTML;
