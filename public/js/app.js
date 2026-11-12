/* ---------------- helpers ---------------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '£' + Number(n).toFixed(2);

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------------- state ---------------- */
const state = {
  user: null,
  categories: [],
  cart: [],
  banners: [],
  activeBannerIndex: 0,
  bannerInterval: null,
  activeBannerId: null, // If set, filters products to this banner campaign
  filter: 'all',
  q: '',
  page: 1,
  limit: 20, // Max 20 grids per page
  sort: 'featured',
  inStockOnly: false,
  authMode: 'login',
  activeHistoryTab: 'new', // 'new' or 'past'
  favorites: [],
  appliedCoupon: null
};

/* ---------------- DYNAMIC WEBSITE SETTINGS (NAME, TAGLINE, SOCIALS) ---------------- */
let siteSettings = {
  site_name: 'London Luxe',
  site_tagline: 'Luxury Bags & Fine Jewelry',
  instagram_handle: 'londonluxe.official',
  whatsapp_number: '447000000000',
  contact_email: 'hello@londonluxe.test'
};

async function loadSiteSettings() {
  try {
    const s = await api('/api/settings');
    if (s && s.site_name) {
      siteSettings = { ...siteSettings, ...s };
      applySiteSettings();
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function applySiteSettings() {
  // Update document title
  document.title = `${siteSettings.site_name} — ${siteSettings.site_tagline}`;

  // Replace site name across all header/footer logos and brand elements
  document.querySelectorAll('.logo').forEach((el) => {
    el.textContent = siteSettings.site_name;
  });

  // Footer paragraphs and copyright
  const footerDesc = $('#footerBrandDesc');
  if (footerDesc) {
    footerDesc.textContent = `${siteSettings.site_name} brings together considered design and lasting quality in every handbag and fine piece.`;
  }
  const footerCopy = $('#footerCopyright');
  if (footerCopy) {
    footerCopy.innerHTML = `&copy; 2026 ${esc(siteSettings.site_name)}. All rights reserved. Built with Node.js, Express &amp; SQLite.`;
  }

  // Footer email link
  const footerMail = $('#footerEmailLink');
  if (footerMail) {
    footerMail.textContent = siteSettings.contact_email;
    footerMail.href = `mailto:${siteSettings.contact_email}`;
  }
}

/* ---------------- AUTO-SWIPING BANNERS (5 SECONDS L TO R) ---------------- */
async function loadBanners() {
  try {
    state.banners = await api('/api/banners');
    const container = $('#bannerSliderContainer');
    if (!state.banners || !state.banners.length) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    renderBannerSlider();
    startBannerAutoplay();
  } catch (err) {
    console.error('Failed to load banners:', err);
  }
}

function renderBannerSlider() {
  const track = $('#bannerTrack');
  const dotsWrap = $('#bannerDots');
  const banners = state.banners;

  track.innerHTML = banners.map((b) => {
    let bgStyle = b.bg_color || '#0a1128';
    let isImg = false;
    if (b.image) {
      isImg = true;
      // High contrast dark luxury gradient so text remains readable while picture shows clearly
      bgStyle = `linear-gradient(rgba(10,17,40,0.3), rgba(10,17,40,0.45)), url('${esc(b.image)}') center/cover no-repeat`;
    }

    return `
      <div class="banner-slide ${isImg ? 'has-image' : ''}" style="background: ${bgStyle}; color: ${esc(b.text_color || '#ffffff')}">
        <div class="promo-content">
          <span class="promo-badge">Special Feature</span>
          <h2 class="promo-title">${esc(b.title)}</h2>
          ${b.subtitle ? `<p class="promo-subtitle">${esc(b.subtitle)}</p>` : ''}
          <button class="btn btn-gold banner-cta-btn" data-banner-campaign="${b.id}" data-banner-title="${esc(b.title)}">
            ${esc(b.button_text || 'Explore Collection')}
          </button>
        </div>
      </div>
    `;
  }).join('');

  dotsWrap.innerHTML = banners.map((_, idx) => `
    <div class="banner-dot ${idx === 0 ? 'active' : ''}" data-dot="${idx}"></div>
  `).join('');

  // Attach campaign click events
  track.querySelectorAll('[data-banner-campaign]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bId = Number(btn.dataset.bannerCampaign);
      const bTitle = btn.dataset.bannerTitle;
      activateBannerCampaign(bId, bTitle);
    });
  });

  // Pause autoplay when customer hovers to read or click
  const container = $('#bannerSliderContainer');
  container.onmouseenter = () => clearInterval(state.bannerInterval);
  container.onmouseleave = () => startBannerAutoplay();

  // Touch Swipe Support for Mobile & Tablet Users
  let touchStartX = 0;
  let touchEndX = 0;
  container.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    clearInterval(state.bannerInterval);
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    if (touchStartX - touchEndX > 45) {
      nextBanner(); // Swiped left -> show next
    } else if (touchEndX - touchStartX > 45) {
      prevBanner(); // Swiped right -> show prev
    }
    startBannerAutoplay();
  }, { passive: true });

  dotsWrap.querySelectorAll('[data-dot]').forEach((d) => {
    d.addEventListener('click', () => {
      goToBanner(Number(d.dataset.dot));
      resetBannerAutoplay();
    });
  });

  $('#bannerPrevBtn').onclick = () => {
    prevBanner();
    resetBannerAutoplay();
  };
  $('#bannerNextBtn').onclick = () => {
    nextBanner();
    resetBannerAutoplay();
  };
}

function goToBanner(index) {
  if (!state.banners.length) return;
  state.activeBannerIndex = (index + state.banners.length) % state.banners.length;
  const track = $('#bannerTrack');
  track.style.transform = `translateX(-${state.activeBannerIndex * 100}%)`;

  document.querySelectorAll('.banner-dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === state.activeBannerIndex);
  });
}

function nextBanner() {
  goToBanner(state.activeBannerIndex + 1);
}

function prevBanner() {
  goToBanner(state.activeBannerIndex - 1);
}

function startBannerAutoplay() {
  clearInterval(state.bannerInterval);
  if (state.banners.length > 1) {
    // 6.5s interval: provides ample reading comfort before sliding
    state.bannerInterval = setInterval(() => {
      nextBanner();
    }, 6500);
  }
}

function resetBannerAutoplay() {
  startBannerAutoplay();
}

function activateBannerCampaign(bannerId, bannerTitle) {
  state.activeBannerId = bannerId;
  $('#campaignTitle').textContent = bannerTitle;
  $('#campaignBar').style.display = 'flex';
  state.page = 1;
  loadProducts(1);
  document.getElementById('collections').scrollIntoView({ behavior: 'smooth' });
}

$('#clearCampaignBtn').addEventListener('click', () => {
  state.activeBannerId = null;
  $('#campaignBar').style.display = 'none';
  state.page = 1;
  loadProducts(1);
});

/* ---------------- products & pagination (20 grids max) ---------------- */
async function loadProducts(page = 1) {
  state.page = page;
  const grid = $('#productGrid');
  grid.innerHTML = '<p class="empty" style="grid-column: 1/-1; text-align:center; padding:3rem 0; color:var(--grey)">Loading products…</p>';

  try {
    const params = new URLSearchParams();
    if (state.filter !== 'all') params.set('category', state.filter);
    if (state.activeBannerId) params.set('banner_id', state.activeBannerId);
    if (state.q) params.set('q', state.q);
    if (state.sort) params.set('sort', state.sort);
    if (state.inStockOnly) params.set('in_stock', '1');
    params.set('page', state.page);
    params.set('limit', state.limit); // 20

    const res = await api('/api/products?' + params.toString());
    renderProducts(res.products);
    renderPagination(res.pagination);
  } catch (e) {
    grid.innerHTML = `<p class="empty" style="grid-column: 1/-1; text-align:center; padding:3rem 0; color:var(--crimson)">Could not load products: ${esc(e.message)}</p>`;
    $('#paginationWrap').style.display = 'none';
  }
}

function renderProducts(products) {
  const grid = $('#productGrid');
  if (!products.length) {
    grid.innerHTML = '<p class="empty" style="grid-column: 1/-1; text-align:center; padding:3rem 0; color:var(--grey)">No luxury pieces found matching this collection.</p>';
    return;
  }

  grid.innerHTML = products.map((p) => {
    const mediaHtml = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
      : `<div class="product-placeholder" style="background:${esc(p.color || '#228B22')}">${esc(p.name.charAt(0))}</div>`;

    const stockStatus = p.stock <= 0
      ? `<span class="stock-pill low">Out of Stock</span>`
      : (p.stock <= 5 ? `<span class="stock-pill low">🔥 Only ${p.stock} Left!</span>` : `<span class="stock-pill">${p.stock} in stock</span>`);

    const isFav = state.favorites && state.favorites.some(f => f.product_id === p.id);

    // Social Proof Urgency: Simulating live interest badge
    const viewersCount = (p.views && p.views > 0) ? Math.min(28, Math.max(3, Math.floor(p.views / 2) + 2)) : Math.floor((p.id * 7) % 15) + 3;

    return `
      <article class="product-card" data-product-id="${p.id}">
        <div class="product-media">
          ${mediaHtml}
          <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${p.id}" aria-label="Add to Favorites" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav ? '#e11d48' : 'none'}" stroke="${isFav ? '#e11d48' : '#ffffff'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
          <button class="quick-view-btn" data-quick-view="${p.id}" title="Quick View Piece">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Quick View
          </button>
          ${p.badge ? `<span class="badge-tag">${esc(p.badge)}</span>` : ''}
          ${p.banner_id ? `<span class="banner-indicator-tag">Special Edit</span>` : ''}
          ${stockStatus}
        </div>
        <div class="product-content">
          <div class="product-meta-row">
            <span class="product-cat">${esc(p.category_name || 'Bespoke')}</span>
            <span class="viewers-badge" title="Customer interest in last 24h">
              <span class="pulse-dot"></span> ${viewersCount} viewing now
            </span>
          </div>
          <h3 class="product-name" style="cursor:pointer" data-quick-view="${p.id}">${esc(p.name)}</h3>
          <p class="product-desc">${esc(p.description || '')}</p>
          <ul class="product-features-list">
            ${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}
          </ul>
          <div class="price-row">
            <span class="price">${money(p.price)}</span>
            ${p.old_price ? `<span class="price-old">${money(p.old_price)}</span>` : ''}
          </div>
          <div class="product-actions">
            <button class="btn btn-outline" data-add="${p.id}" ${p.stock <= 0 ? 'disabled' : ''} style="color:var(--navy);border-color:var(--navy)">
              Add to Bag
            </button>
            <button class="btn btn-gold" data-buy-now="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
              Buy Now
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderPagination(pg) {
  const wrap = $('#paginationWrap');
  if (!pg || pg.totalPages <= 1) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'flex';
  let html = `
    <button class="page-btn" data-page="${pg.page - 1}" ${!pg.hasPrev ? 'disabled' : ''}>&larr; Prev</button>
  `;

  for (let i = 1; i <= pg.totalPages; i++) {
    html += `
      <button class="page-btn ${i === pg.page ? 'active' : ''}" data-page="${i}">${i}</button>
    `;
  }

  html += `
    <button class="page-btn" data-page="${pg.page + 1}" ${!pg.hasNext ? 'disabled' : ''}>Next &rarr;</button>
    <span class="page-info">Page ${pg.page} of ${pg.totalPages} (${pg.totalCount} items)</span>
  `;

  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (p >= 1 && p <= pg.totalPages && p !== pg.page) {
        loadProducts(p);
        $('#collections').scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

/* ---------------- categories & tabs ---------------- */
async function loadCategories() {
  state.categories = await api('/api/categories');
  renderTabs();
  renderAccordion();
  bindNavLinks();
}

function renderTabs() {
  const tabs = [{ slug: 'all', name: 'All Products' }, ...state.categories];
  $('#tabs').innerHTML = tabs.map((c) => `
    <button class="tab ${state.filter === c.slug ? 'active' : ''}" data-filter="${esc(c.slug)}">${esc(c.name)}</button>
  `).join('');

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.filter;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      loadProducts(1);
    });
  });
}

async function renderAccordion() {
  const box = $('#accordion');
  const lists = await Promise.all(
    state.categories.map((c) => api('/api/products?category=' + encodeURIComponent(c.slug) + '&limit=6'))
  );

  box.innerHTML = state.categories.map((c, i) => `
    <div class="acc-item">
      <button class="acc-header">
        <span class="acc-icon"><svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg></span>
        <span class="acc-title"><strong>${esc(c.name)}</strong><small>${esc(c.description || '')}</small></span>
        <svg class="chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="acc-body">
        <div class="acc-inner">
          <ul>
            ${(lists[i].products || []).slice(0, 6).map((p) => `<li><span>${esc(p.name)}</span><strong>${money(p.price)}</strong></li>`).join('')}
          </ul>
          <a href="#collections" class="btn btn-view-all btn-sm" data-goto="${esc(c.slug)}">View All In ${esc(c.name)}</a>
        </div>
      </div>
    </div>
  `).join('');

  box.querySelectorAll('.acc-item').forEach((item) => {
    const header = item.querySelector('.acc-header');
    const body = item.querySelector('.acc-body');
    header.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      box.querySelectorAll('.acc-item.open').forEach((o) => {
        if (o !== item) { o.classList.remove('open'); o.querySelector('.acc-body').style.maxHeight = null; }
      });
      if (isOpen) { item.classList.remove('open'); body.style.maxHeight = null; }
      else { item.classList.add('open'); body.style.maxHeight = body.scrollHeight + 'px'; }
    });
  });

  box.querySelectorAll('[data-goto]').forEach((a) => {
    a.addEventListener('click', () => {
      state.filter = a.dataset.goto;
      renderTabs();
      loadProducts(1);
    });
  });
}

function bindNavLinks() {
  document.querySelectorAll('[data-nav-cat]').forEach((a) => {
    a.addEventListener('click', () => {
      state.filter = a.dataset.navCat;
      renderTabs();
      loadProducts(1);
    });
  });
}

/* ---------------- cart ---------------- */
async function loadCart() {
  if (!state.user) { state.cart = []; renderCart(); return; }
  try { state.cart = await api('/api/cart'); } catch { state.cart = []; }
  renderCart();
}

function renderCart() {
  const count = state.cart.reduce((s, i) => s + i.quantity, 0);
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
  $('#cartCount').textContent = count;

  const subEl = $('#cartSubtotal');
  if (subEl) subEl.textContent = money(subtotal);

  let discount = 0;
  if (state.appliedCoupon && subtotal > 0) {
    if (state.appliedCoupon.discount_type === 'percentage') {
      discount = (subtotal * state.appliedCoupon.discount_value) / 100;
    } else {
      discount = Math.min(state.appliedCoupon.discount_value, subtotal);
    }
    const dRow = $('#discountRow');
    if (dRow) {
      dRow.style.display = 'flex';
      $('#appliedCouponCode').textContent = state.appliedCoupon.code;
      $('#cartDiscount').textContent = `-${money(discount)}`;
    }
  } else {
    const dRow = $('#discountRow');
    if (dRow) dRow.style.display = 'none';
  }

  const finalTotal = Math.max(0, subtotal - discount);
  $('#cartTotal').textContent = money(finalTotal);
  $('#checkoutBtn').disabled = state.cart.length === 0;

  const box = $('#cartItems');
  if (!state.cart.length) {
    box.innerHTML = `<p class="empty" style="text-align:center;padding:2rem 0;color:var(--grey)">${state.user ? 'Your luxury cart is empty.' : 'Please sign in to view your bag.'}</p>`;
    return;
  }

  box.innerHTML = state.cart.map((i) => `
    <div class="cart-item">
      <div class="cart-swatch" style="background:${i.image ? `url('${esc(i.image)}') center/cover` : esc(i.color || '#228B22')}"></div>
      <div class="cart-info">
        <strong>${esc(i.name)}</strong>
        <span>${money(i.price)}</span>
        <div class="qty">
          <button data-qty="${i.id}" data-delta="-1">−</button>
          <span>${i.quantity}</span>
          <button data-qty="${i.id}" data-delta="1">+</button>
        </div>
      </div>
      <button class="icon-btn" data-remove="${i.id}" aria-label="Remove">&times;</button>
    </div>
  `).join('');

  box.querySelectorAll('[data-qty]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = state.cart.find((i) => i.id === Number(btn.dataset.qty));
      const qty = item.quantity + Number(btn.dataset.delta);
      try {
        state.cart = await api(`/api/cart/${item.id}`, { method: 'PATCH', body: { quantity: qty } });
        renderCart();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  box.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        state.cart = await api(`/api/cart/${btn.dataset.remove}`, { method: 'DELETE' });
        renderCart();
        toast('Item removed from cart');
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

async function addToCart(productId) {
  if (!state.user) { openAuth('login'); toast('Please sign in to add pieces to your cart.'); return; }
  try {
    state.cart = await api('/api/cart', { method: 'POST', body: { product_id: productId, quantity: 1 } });
    renderCart();
    toast('Added to cart', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------------- FAVORITES ---------------- */
async function loadFavorites() {
  if (!state.user) {
    state.favorites = [];
    renderFavorites();
    return;
  }
  try {
    state.favorites = await api('/api/favorites');
  } catch (e) {
    state.favorites = [];
  }
  renderFavorites();
}

function renderFavorites() {
  const box = $('#favoritesItems');
  const countEl = $('#favCount');
  if (countEl) countEl.textContent = state.favorites.length;
  if (!box) return;

  if (!state.user) {
    box.innerHTML = `<p class="empty" style="text-align:center;padding:2rem 0;color:var(--grey)">Please sign in to view your favorite pieces.</p>`;
    return;
  }

  if (!state.favorites.length) {
    box.innerHTML = `<p class="empty" style="text-align:center;padding:2rem 0;color:var(--grey)">You haven't added any favorites yet.</p>`;
    return;
  }

  box.innerHTML = state.favorites.map(f => `
    <div class="cart-item">
      <div class="cart-swatch" style="background:${f.image ? `url('${esc(f.image)}') center/cover` : '#228B22'}"></div>
      <div class="cart-info">
        <strong>${esc(f.name)}</strong>
        <span>${money(f.price)}</span>
        <div style="margin-top:0.4rem;">
          <button class="btn btn-gold btn-sm" style="font-size:0.75rem;padding:0.3rem 0.6rem;" onclick="addToCart(${f.product_id});">Add to Bag</button>
        </div>
      </div>
      <button class="icon-btn" onclick="toggleFavorite(${f.product_id})" aria-label="Remove favorite">&times;</button>
    </div>
  `).join('');
}

async function toggleFavorite(productId) {
  if (!state.user) {
    openAuth('login');
    toast('Please sign in to save favorites.');
    return;
  }

  const existing = state.favorites.find(f => f.product_id === productId);
  try {
    if (existing) {
      await api(`/api/favorites/${existing.id}`, { method: 'DELETE' });
      state.favorites = state.favorites.filter(f => f.product_id !== productId);
      toast('Removed from favorites');
    } else {
      const added = await api('/api/favorites', { method: 'POST', body: { product_id: productId } });
      state.favorites.unshift(added);
      toast('Added to favorites! ❤️', 'ok');
    }
    renderFavorites();
    // Re-render product heart icons
    document.querySelectorAll(`.fav-btn[data-fav="${productId}"]`).forEach(btn => {
      const isFav = !existing;
      btn.classList.toggle('active', isFav);
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', isFav ? '#e11d48' : 'none');
        svg.setAttribute('stroke', isFav ? '#e11d48' : '#ffffff');
      }
    });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function openFavoritesDrawer() {
  closeAll();
  $('#favoritesDrawer').classList.add('open');
  $('#overlay').classList.add('show');
}

/* ---------------- INSTANT BUY & CHECKOUT WITH INSTAGRAM / WHATSAPP REDIRECTION ---------------- */
function showOrderSuccessModal(order) {
  closeAll();
  $('#successOrderRef').textContent = `Order Reference: #${order.id} • Total: ${money(order.total)}`;

  // Prepare custom message for social chats
  const itemsText = (order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'Store Order';
  const prefilledText = encodeURIComponent(`Hello ${siteSettings.site_name}! I just placed Order #${order.id} (${itemsText}) for ${money(order.total)}. I would like to confirm my order details.`);

  const igHandle = siteSettings.instagram_handle || 'londonluxe.official';
  const waNumber = siteSettings.whatsapp_number || '447000000000';

  // Direct Social Redirection
  $('#btnRedirectInstagram').href = `https://instagram.com/${igHandle}`;
  $('#btnRedirectInstagram').onclick = (e) => {
    window.open(`https://instagram.com/${igHandle}`, '_blank');
  };

  $('#btnRedirectWhatsapp').href = `https://wa.me/${waNumber}?text=${prefilledText}`;

  openModal('#orderSuccessModal');
}

/* ---------------- DIRECT INSTANT "BUY NOW" ---------------- */
async function initiateInstantBuy(productId) {
  if (!state.user) {
    openAuth('login');
    toast('Please sign in to proceed with direct purchase.');
    return;
  }
  try {
    const product = await api(`/api/products/${productId}`);
    $('#instantProductId').value = product.id;
    $('#instantProductSummary').innerHTML = `
      <div>
        <strong>${esc(product.name)}</strong>
        <div style="color:var(--grey);font-size:.85rem">Quantity: 1 piece</div>
      </div>
      <div style="font-size:1.2rem;font-weight:800;color:var(--navy)">${money(product.price)}</div>
    `;
    $('#instantShipName').value = state.user.name || '';
    $('#instantShipEmail').value = state.user.email || '';
    $('#instantShipInstagram').value = '';
    $('#instantShipWhatsapp').value = '';
    $('#instantBuyMsg').textContent = '';
    openModal('#instantBuyModal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#instantBuyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#instantBuyMsg');
  msg.className = 'form-msg';

  const payload = {
    product_id: Number($('#instantProductId').value),
    quantity: 1,
    instagram: $('#instantShipInstagram').value.trim(),
    whatsapp: $('#instantShipWhatsapp').value.trim(),
    shipping: {
      name: $('#instantShipName').value.trim(),
      email: $('#instantShipEmail').value.trim(),
      address: $('#instantShipAddress').value.trim(),
      city: $('#instantShipCity').value.trim(),
      zip: $('#instantShipZip').value.trim()
    }
  };

  try {
    const order = await api('/api/orders/instant-buy', { method: 'POST', body: payload });
    toast(`Order #${order.id} confirmed!`, 'ok');
    loadProducts(state.page);
    showOrderSuccessModal(order);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ---------------- CLIENT ACCOUNT & SEPARATED PURCHASE HISTORY ---------------- */
function renderAccount() {
  const body = $('#accountBody');
  if (!state.user) {
    body.innerHTML = '<p class="section-sub">You are not signed in.</p>';
    return;
  }
  body.innerHTML = `
    <div style="background:#f8fafc;padding:1.2rem;border-radius:14px;margin-bottom:1.2rem">
      <strong style="color:var(--navy);font-size:1.1rem">${esc(state.user.name)}</strong>
      <p style="color:var(--grey);font-size:.9rem">${esc(state.user.email)}</p>
      <span class="status-pill delivered" style="margin-top:.4rem;display:inline-block">${esc(state.user.role)}</span>
    </div>

    <!-- History Tabs: New Orders vs Past Purchases -->
    <div class="history-tabs">
      <button class="history-tab-btn ${state.activeHistoryTab === 'new' ? 'active' : ''}" id="tabNewOrders">
        Active Orders (<span id="activeOrdersCount">0</span>)
      </button>
      <button class="history-tab-btn ${state.activeHistoryTab === 'past' ? 'active' : ''}" id="tabPastOrders">
        Past Purchases (<span id="pastOrdersCount">0</span>)
      </button>
    </div>

    <div id="ordersList"><p class="section-sub">Loading purchase history…</p></div>
    <button class="btn btn-outline" id="logoutBtn" style="color:var(--crimson);border-color:var(--crimson);width:100%;margin-top:1.2rem">Sign Out</button>
  `;

  $('#tabNewOrders').onclick = () => {
    state.activeHistoryTab = 'new';
    $('#tabNewOrders').classList.add('active');
    $('#tabPastOrders').classList.remove('active');
    loadOrdersHistory();
  };

  $('#tabPastOrders').onclick = () => {
    state.activeHistoryTab = 'past';
    $('#tabPastOrders').classList.add('active');
    $('#tabNewOrders').classList.remove('active');
    loadOrdersHistory();
  };

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null; state.cart = [];
    updateAccountBtn(); renderCart(); closeAll();
    toast('Signed out successfully');
  });

  loadOrdersHistory();
}

async function loadOrdersHistory() {
  const box = $('#ordersList');
  if (!box) return;
  try {
    const res = await api('/api/orders/history');
    $('#activeOrdersCount').textContent = res.activeOrders.length;
    $('#pastOrdersCount').textContent = res.pastOrders.length;

    const list = state.activeHistoryTab === 'new' ? res.activeOrders : res.pastOrders;

    if (!list.length) {
      box.innerHTML = `<p class="section-sub" style="padding:1.5rem 0;text-align:center">No ${state.activeHistoryTab === 'new' ? 'active / pending' : 'past / delivered'} purchases found.</p>`;
      return;
    }

    box.innerHTML = list.map((o) => `
      <div class="order-box">
        <header>
          <span>Order #${o.id} &bull; <small style="color:var(--grey)">${esc(o.created_at)}</small></span>
          <span class="status-pill ${esc(o.status)}">${esc(o.status)}</span>
        </header>
        <ul>${o.items.map((i) => `<li>${i.quantity} × ${esc(i.name)} — <strong>${money(i.price * i.quantity)}</strong></li>`).join('')}</ul>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.6rem;border-top:1px solid #f1f5f9;padding-top:.4rem">
          <small style="color:var(--grey)">Deliver to: ${esc(o.shipping_city)}</small>
          <div style="display:flex;gap:.5rem;align-items:center;">
            <button class="btn btn-outline btn-sm" style="font-size:.72rem;padding:.25rem .6rem;" onclick="printInvoice(${o.id})">
              🧾 Print Invoice
            </button>
            <strong style="color:var(--navy);font-size:.95rem">${money(o.total)}</strong>
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = `<p class="section-sub">${esc(e.message)}</p>`;
  }
}

function updateAccountBtn() {
  $('#accountBtn').textContent = state.user ? state.user.name.split(' ')[0] : 'Sign In';
}

/* ---------------- drawer & modals ---------------- */
function openDrawer() { $('#cartDrawer').classList.add('open'); $('#overlay').classList.add('show'); }
function closeAll() {
  document.querySelectorAll('.drawer, .modal').forEach((el) => el.classList.remove('open'));
  $('#overlay').classList.remove('show');
}
function openModal(id) { closeAll(); $(id).classList.add('open'); $('#overlay').classList.add('show'); }

function openAuth(mode) {
  state.authMode = mode;
  $('#authTitle').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
  $('#authSubmit').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
  $('#nameField').hidden = mode === 'login';
  $('#authSwitchText').textContent = mode === 'login' ? 'New customer?' : 'Already have an account?';
  $('#authSwitch').textContent = mode === 'login' ? 'Create an account' : 'Sign in';
  $('#authMsg').textContent = '';
  openModal('#authModal');
}

/* ---------------- customer feedback / contact form ---------------- */
$('#contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = $('#contactMsg');
  msgEl.className = 'form-msg';
  const payload = {
    name: $('#contactName').value.trim(),
    email: $('#contactEmail').value.trim(),
    subject: $('#contactSubject').value.trim(),
    message: $('#contactMessage').value.trim()
  };
  try {
    const res = await api('/api/messages', { method: 'POST', body: payload });
    msgEl.textContent = res.message || 'Message sent!';
    msgEl.className = 'form-msg ok';
    $('#contactForm').reset();
    toast('Message sent to our concierge', 'ok');
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'form-msg error';
  }
});

/* ---------------- events ---------------- */
$('#cartBtn').addEventListener('click', openDrawer);
$('#closeCart').addEventListener('click', closeAll);
const favBtn = $('#favoritesBtn');
if (favBtn) favBtn.addEventListener('click', openFavoritesDrawer);
const closeFav = $('#closeFavorites');
if (closeFav) closeFav.addEventListener('click', closeAll);
$('#overlay').addEventListener('click', closeAll);
document.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', closeAll));

$('#accountBtn').addEventListener('click', () => {
  if (state.user) { renderAccount(); openModal('#accountModal'); }
  else openAuth('login');
});

$('#authSwitch').addEventListener('click', () => openAuth(state.authMode === 'login' ? 'register' : 'login'));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#authMsg');
  msg.className = 'form-msg';
  const payload = {
    email: $('#authEmail').value.trim(),
    password: $('#authPassword').value,
  };
  if (state.authMode === 'register') payload.name = $('#authName').value.trim();

  try {
    const data = await api(`/api/auth/${state.authMode}`, { method: 'POST', body: payload });
    state.user = data.user;
    updateAccountBtn();
    await loadCart();
    await loadFavorites();
    await loadProducts(state.page);
    closeAll();
    toast(state.authMode === 'login' ? 'Welcome back!' : 'Account registered!', 'ok');
    $('#authForm').reset();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

$('#sortFilter').addEventListener('change', (e) => {
  state.sort = e.target.value;
  loadProducts(1);
});

$('#stockFilter').addEventListener('change', (e) => {
  state.inStockOnly = e.target.checked;
  loadProducts(1);
});

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = $('#searchInput').value.trim();
  loadProducts(1);
  document.getElementById('collections').scrollIntoView({ behavior: 'smooth' });
});

let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    loadProducts(1);
  }, 350);
});

$('#productGrid').addEventListener('click', (e) => {
  const quickBtn = e.target.closest('[data-quick-view]');
  if (quickBtn) {
    openQuickView(Number(quickBtn.dataset.quickView));
    return;
  }

  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    toggleFavorite(Number(favBtn.dataset.fav));
    return;
  }

  const addBtn = e.target.closest('[data-add]');
  if (addBtn) addToCart(Number(addBtn.dataset.add));

  const buyBtn = e.target.closest('[data-buy-now]');
  if (buyBtn) initiateInstantBuy(Number(buyBtn.dataset.buyNow));
});

/* ---------------- COUPON APPLICATION (CART) ---------------- */
const applyCouponBtn = $('#applyCouponBtn');
if (applyCouponBtn) {
  applyCouponBtn.addEventListener('click', async () => {
    const input = $('#cartCouponInput');
    const msg = $('#couponMsg');
    const code = (input.value || '').trim();
    if (!code) return;

    if (!state.user) {
      msg.style.display = 'block';
      msg.style.color = '#dc2626';
      msg.textContent = 'Please sign in to apply coupon codes.';
      return;
    }

    const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
    msg.style.display = 'block';
    msg.style.color = 'var(--grey)';
    msg.textContent = 'Verifying…';

    try {
      const res = await api('/api/coupons/apply', {
        method: 'POST',
        body: { code, subtotal }
      });
      state.appliedCoupon = res;
      msg.style.color = '#16a34a';
      msg.textContent = `✓ Coupon "${res.code}" applied! -${money(res.discount_amount)}`;
      renderCart();
      toast(`Promo code ${res.code} applied!`, 'ok');
    } catch (e) {
      state.appliedCoupon = null;
      msg.style.color = '#dc2626';
      msg.textContent = e.message;
      renderCart();
    }
  });
}

$('#checkoutBtn').addEventListener('click', () => {
  if (!state.user) { openAuth('login'); return; }
  $('#checkoutMsg').textContent = '';
  $('#shipName').value = state.user.name || '';
  $('#shipEmail').value = state.user.email || '';
  $('#shipInstagram').value = '';
  $('#shipWhatsapp').value = '';
  openModal('#checkoutModal');
});

$('#checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#checkoutMsg');
  msg.className = 'form-msg';
  try {
    const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount = state.appliedCoupon ? state.appliedCoupon.discount_amount : 0;
    const couponCode = state.appliedCoupon ? state.appliedCoupon.code : '';

    const order = await api('/api/orders', {
      method: 'POST',
      body: {
        instagram: $('#shipInstagram').value.trim(),
        whatsapp: $('#shipWhatsapp').value.trim(),
        coupon_code: couponCode,
        discount_amount: discount,
        shipping: {
          name: $('#shipName').value.trim(),
          email: $('#shipEmail').value.trim(),
          address: $('#shipAddress').value.trim(),
          city: $('#shipCity').value.trim(),
          zip: $('#shipZip').value.trim(),
        },
      },
    });
    $('#checkoutForm').reset();
    state.appliedCoupon = null;
    await loadCart();
    toast(`Order #${order.id} placed — ${money(order.total)}`, 'ok');
    loadProducts(state.page);
    showOrderSuccessModal(order);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ---------------- CUSTOMER REVIEWS / SOCIAL PROOF ---------------- */
async function loadReviews() {
  try {
    const reviews = await api('/api/reviews');
    const grid = $('#reviewsGrid');
    const empty = $('#reviewsEmpty');
    if (!grid) return;
    if (!reviews || reviews.length === 0) {
      grid.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      return;
    }
    grid.style.display = 'grid';
    if (empty) empty.style.display = 'none';
    grid.innerHTML = reviews.map(r => `
      <div class="review-card" data-img="${esc(r.image)}" data-caption="${esc(r.caption || '')}">
        <img src="${esc(r.image)}" alt="${esc(r.caption || 'Customer review')}" loading="lazy">
        <span class="review-card-expand">&#x26F6;</span>
        ${r.caption ? `<div class="review-card-caption">${esc(r.caption)}</div>` : ''}
      </div>
    `).join('');
    // Attach lightbox click handlers
    grid.querySelectorAll('.review-card').forEach(card => {
      card.addEventListener('click', () => openLightbox(card.dataset.img, card.dataset.caption));
    });
  } catch (e) { console.error('Reviews load error:', e); }
}

function openLightbox(imgSrc, caption) {
  const lb = $('#reviewLightbox');
  if (!lb) return;
  $('#lightboxImg').src = imgSrc;
  $('#lightboxCaption').textContent = caption || '';
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const lb = $('#reviewLightbox');
  if (!lb) return;
  lb.classList.remove('open');
  document.body.style.overflow = '';
  $('#lightboxImg').src = '';
}

// Lightbox close events
document.addEventListener('DOMContentLoaded', () => {
  const lb = $('#reviewLightbox');
  if (!lb) return;
  $('#lightboxClose').addEventListener('click', closeLightbox);
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
});

/* ---------------- 2. PRODUCT QUICK VIEW MODAL ---------------- */
async function openQuickView(productId) {
  try {
    const p = await api(`/api/products/${productId}`);
    const content = $('#quickViewContent');
    if (!content) return;

    const mediaHtml = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" style="width:100%;height:340px;object-fit:cover;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.12)">`
      : `<div style="width:100%;height:340px;background:${esc(p.color || '#0a1128')};border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:3rem;font-weight:800">${esc(p.name.charAt(0))}</div>`;

    const isFav = state.favorites && state.favorites.some(f => f.product_id === p.id);

    content.innerHTML = `
      <div>${mediaHtml}</div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">
          <span class="product-cat" style="font-size:.85rem;color:var(--emerald);font-weight:700;">${esc(p.category_name || 'Luxury Edit')}</span>
          ${p.badge ? `<span class="badge-tag" style="position:static">${esc(p.badge)}</span>` : ''}
        </div>
        <h2 style="font-size:1.6rem;color:var(--navy);margin-bottom:.5rem;line-height:1.2;">${esc(p.name)}</h2>
        <div class="price-row" style="margin-bottom:1rem;">
          <span class="price" style="font-size:1.5rem;">${money(p.price)}</span>
          ${p.old_price ? `<span class="price-old" style="font-size:1.1rem;">${money(p.old_price)}</span>` : ''}
        </div>
        <p style="color:#4b5563;font-size:.92rem;line-height:1.6;margin-bottom:1.2rem;">${esc(p.description || 'Exclusive handcrafted item finished with the highest quality standards.')}</p>
        
        <div style="background:#f8fafc;padding:.8rem 1rem;border-radius:10px;margin-bottom:1.2rem;">
          <div style="font-size:.82rem;font-weight:700;color:var(--navy);margin-bottom:.4rem;">Key Highlights:</div>
          <ul class="product-features-list" style="margin:0;padding-left:1.2rem;">
            ${(p.features || ['Premium Bespoke Design', 'Complimentary Insured Shipping', 'Authenticity Certificate Included']).map(f => `<li>${esc(f)}</li>`).join('')}
          </ul>
        </div>

        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:1.2rem;">
          <span class="stock-pill ${p.stock <= 5 ? 'low' : ''}">${p.stock > 0 ? (p.stock <= 5 ? `🔥 Only ${p.stock} Left` : `${p.stock} in stock`) : 'Out of Stock'}</span>
          <span style="font-size:.8rem;color:var(--grey);">• Fast express delivery available</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;">
          <button class="btn btn-outline" onclick="addToCart(${p.id}); closeAll();" ${p.stock <= 0 ? 'disabled' : ''} style="color:var(--navy);border-color:var(--navy)">
            Add to Bag
          </button>
          <button class="btn btn-gold" onclick="closeAll(); initiateInstantBuy(${p.id});" ${p.stock <= 0 ? 'disabled' : ''}>
            Buy Now
          </button>
        </div>
      </div>
    `;

    openModal('#quickViewModal');
  } catch (e) {
    toast('Error loading product details', 'error');
  }
}

/* ---------------- 3. FLOATING WHATSAPP CHAT BUBBLE ---------------- */
function setupFloatingWhatsApp() {
  const btn = $('#floatingWhatsAppBtn');
  if (!btn) return;
  const wa = siteSettings.whatsapp_number || '447000000000';
  const site = siteSettings.site_name || 'London Luxe';
  const text = encodeURIComponent(`Hello ${site}! I am browsing your online store and would like personalized assistance.`);
  btn.href = `https://wa.me/${wa}?text=${text}`;
}

/* ---------------- 4. LIVE ORDER TRACKING ---------------- */
const navTrackBtn = $('#navTrackOrderBtn');
if (navTrackBtn) {
  navTrackBtn.addEventListener('click', (e) => {
    e.preventDefault();
    $('#trackOrderResult').style.display = 'none';
    $('#trackOrderForm').reset();
    openModal('#trackOrderModal');
  });
}

const trackForm = $('#trackOrderForm');
if (trackForm) {
  trackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderId = $('#trackOrderId').value.trim();
    const email = $('#trackEmail').value.trim();
    const resBox = $('#trackOrderResult');
    resBox.style.display = 'block';
    resBox.innerHTML = '<p style="text-align:center;color:var(--grey)">Checking order records…</p>';

    try {
      const data = await api(`/api/orders/track?order_id=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`);
      
      const statusMap = {
        'pending': { step: 1, title: 'Order Received', desc: 'Your luxury order is logged and awaiting dispatch preparation.' },
        'ongoing': { step: 2, title: 'In Preparation', desc: 'Craftsmen are inspecting, packing, and preparing your piece.' },
        'processing': { step: 2, title: 'Processing Order', desc: 'Your bespoke parcel is being packaged with seal.' },
        'shipped': { step: 3, title: 'Dispatched & On the Way', desc: 'Courier has picked up your parcel with trackable priority service.' },
        'delivered': { step: 4, title: 'Delivered', desc: 'Package delivered to recipient. Thank you for choosing us!' },
        'cancelled': { step: 0, title: 'Order Cancelled', desc: 'This order was cancelled. Please contact concierge.' }
      };

      const info = statusMap[data.status.toLowerCase()] || { step: 2, title: data.status, desc: 'Your order is progressing smoothly.' };
      const currentStep = info.step;

      resBox.innerHTML = `
        <div style="background:#f8fafc;border-radius:12px;padding:1.2rem;border:1px solid #e2e8f0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <div>
              <strong style="color:var(--navy);font-size:1rem;">Order #${data.id}</strong>
              <div style="font-size:.78rem;color:var(--grey);">${esc(data.created_at)}</div>
            </div>
            <span class="status-pill ${esc(data.status)}">${esc(data.status)}</span>
          </div>

          <!-- Progress Stepper -->
          <div class="tracking-stepper">
            <div class="step-item ${currentStep >= 1 ? 'completed' : ''}">
              <div class="step-circle">1</div>
              <div class="step-label">Placed</div>
            </div>
            <div class="step-item ${currentStep >= 2 ? 'completed' : ''}">
              <div class="step-circle">2</div>
              <div class="step-label">Preparing</div>
            </div>
            <div class="step-item ${currentStep >= 3 ? 'completed' : ''}">
              <div class="step-circle">3</div>
              <div class="step-label">Shipped</div>
            </div>
            <div class="step-item ${currentStep >= 4 ? 'completed' : ''}">
              <div class="step-circle">4</div>
              <div class="step-label">Delivered</div>
            </div>
          </div>

          <div style="background:#fff;padding:.8rem;border-radius:8px;border:1px solid #f1f5f9;margin-top:1rem;">
            <div style="font-weight:700;color:var(--navy);font-size:.9rem;">${esc(info.title)}</div>
            <div style="font-size:.82rem;color:var(--grey);margin-top:.2rem;">${esc(info.desc)}</div>
          </div>

          <div style="margin-top:1rem;font-size:.85rem;">
            <div style="color:var(--navy);font-weight:700;margin-bottom:.3rem;">Items in Order:</div>
            ${data.items.map(i => `<div style="display:flex;justify-content:space-between;color:#4b5563;font-size:.82rem;padding:.2rem 0;"><span>${i.quantity}x ${esc(i.name)}</span><span>${money(i.price * i.quantity)}</span></div>`).join('')}
            <div style="border-top:1px solid #e2e8f0;margin-top:.5rem;padding-top:.4rem;display:flex;justify-content:space-between;font-weight:800;color:var(--navy);">
              <span>Total Paid</span>
              <span>${money(data.total)}</span>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      resBox.innerHTML = `
        <div style="background:#fee2e2;color:#dc2626;padding:1rem;border-radius:10px;font-size:.85rem;text-align:center;">
          ${esc(err.message)}
        </div>
      `;
    }
  });
}

/* ---------------- 6. PRINTABLE LUXURY INVOICE ---------------- */
async function printInvoice(orderId) {
  try {
    toast('Generating invoice…', 'ok');
    const data = await api(`/api/orders/${orderId}/invoice`);
    const o = data.order;
    const items = data.items || [];
    const set = data.settings || siteSettings;

    const printWin = window.open('', '_blank', 'width=800,height=900');
    if (!printWin) {
      toast('Please allow popups to print invoice', 'error');
      return;
    }

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice #${o.id} — ${esc(set.site_name || 'London Luxe')}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0a1128; padding: 40px; margin: 0; background: #fff; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0a1128; padding-bottom: 20px; }
          .logo { font-size: 26px; font-weight: 800; color: #0a1128; letter-spacing: -0.5px; }
          .tagline { color: #f59e0b; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
          .invoice-meta { text-align: right; }
          .invoice-title { font-size: 24px; font-weight: 800; color: #0a1128; margin: 0; }
          .customer-details { display: flex; justify-content: space-between; margin: 30px 0; background: #f8fafc; padding: 20px; border-radius: 8px; }
          table { width: 100%; border-collapse: collapse; margin: 30px 0; }
          th { text-align: left; padding: 12px 14px; background: #0a1128; color: #fff; font-size: 13px; text-transform: uppercase; }
          td { padding: 14px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
          .total-row { display: flex; justify-content: flex-end; margin-top: 20px; }
          .total-box { width: 280px; background: #f8fafc; padding: 15px; border-radius: 8px; }
          .total-line { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; }
          .total-final { font-size: 18px; font-weight: 800; color: #0a1128; border-top: 2px solid #0a1128; margin-top: 8px; padding-top: 8px; }
          .footer { text-align: center; margin-top: 50px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #64748b; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo">${esc(set.site_name || 'London Luxe')}</div>
            <div class="tagline">${esc(set.site_tagline || 'Bespoke Luxury & Fine Jewelry')}</div>
            <div style="font-size:12px;color:#64748b;margin-top:6px;">Mayfair, London, United Kingdom<br>Email: ${esc(set.contact_email || 'concierge@londonluxe.test')}</div>
          </div>
          <div class="invoice-meta">
            <h1 class="invoice-title">OFFICIAL INVOICE</h1>
            <div style="font-size:14px;font-weight:700;margin-top:5px;">Invoice Ref: #${o.id}</div>
            <div style="font-size:13px;color:#64748b;">Date: ${esc(o.created_at)}</div>
            <div style="font-size:13px;color:#16a34a;font-weight:700;margin-top:4px;">Status: ${esc(o.status.toUpperCase())}</div>
          </div>
        </div>

        <div class="customer-details">
          <div>
            <strong style="font-size:13px;color:#64748b;text-transform:uppercase;">Billed &amp; Shipped To:</strong>
            <div style="font-size:15px;font-weight:700;margin-top:5px;">${esc(o.shipping_name || 'Valued Client')}</div>
            <div style="font-size:14px;color:#334155;">${esc(o.shipping_address || '')}</div>
            <div style="font-size:14px;color:#334155;">${esc(o.shipping_city || '')} ${esc(o.shipping_zip || '')}</div>
            <div style="font-size:13px;color:#64748b;margin-top:4px;">Email: ${esc(o.shipping_email || '')}</div>
          </div>
          <div style="text-align:right;">
            <strong style="font-size:13px;color:#64748b;text-transform:uppercase;">Order Summary:</strong>
            <div style="font-size:13px;color:#334155;margin-top:5px;">Delivery: Express Insured Courier</div>
            ${o.whatsapp ? `<div style="font-size:13px;color:#334155;">WhatsApp: ${esc(o.whatsapp)}</div>` : ''}
            ${o.instagram ? `<div style="font-size:13px;color:#334155;">Instagram: @${esc(o.instagram.replace('@',''))}</div>` : ''}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item Description</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Unit Price</th>
              <th style="text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td><strong>${esc(i.name)}</strong><br><small style="color:#64748b">Complimentary Velvet Gift Packaging Included</small></td>
                <td style="text-align:center;">${i.quantity}</td>
                <td style="text-align:right;">£${Number(i.price).toFixed(2)}</td>
                <td style="text-align:right;font-weight:700;">£${Number(i.price * i.quantity).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="total-row">
          <div class="total-box">
            <div class="total-line"><span>Subtotal:</span><span>£${Number(o.total).toFixed(2)}</span></div>
            <div class="total-line"><span>Insured Shipping:</span><span style="color:#16a34a;font-weight:700;">FREE</span></div>
            <div class="total-line total-final"><span>Total Paid:</span><span>£${Number(o.total).toFixed(2)}</span></div>
          </div>
        </div>

        <div class="footer">
          <p>Thank you for choosing ${esc(set.site_name || 'London Luxe')}. All bespoke jewelry and luxury bags are guaranteed authentic.</p>
          <p style="margin-top:5px;">If you have any questions, reach out via WhatsApp (${esc(set.whatsapp_number || '+447000000000')}) or email (${esc(set.contact_email || 'hello@londonluxe.test')}).</p>
          <button class="no-print" onclick="window.print()" style="margin-top:15px;padding:10px 24px;background:#0a1128;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;">Print / Save as PDF</button>
        </div>
      </body>
      </html>
    `);
    printWin.document.close();
    printWin.focus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- THEME TOGGLER (DARK / DEFAULT LIGHT) ---------------- */
function initTheme() {
  const savedTheme = localStorage.getItem('london_luxe_theme') || 'light';
  applyTheme(savedTheme);

  const btn = $('#themeToggleBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const isDark = document.body.classList.contains('dark-mode');
      const newTheme = isDark ? 'light' : 'dark';
      applyTheme(newTheme);
      localStorage.setItem('london_luxe_theme', newTheme);
      toast(newTheme === 'dark' ? 'Dark theme enabled 🌙' : 'Default light theme enabled ☀️', 'ok');
    });
  }
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-mode', isDark);

  const icon = $('#themeToggleIcon');
  const txt = $('#themeToggleText');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  if (txt) txt.textContent = isDark ? 'Light' : 'Dark';
}

/* ---------------- init ---------------- */
(async function init() {
  initTheme();
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
  } catch { state.user = null; }
  await loadSiteSettings();
  updateAccountBtn();
  await loadBanners();
  await loadCategories();
  await loadFavorites();
  await loadProducts(1);
  await loadCart();
  await loadReviews();
  setupFloatingWhatsApp();
})();
