const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '£' + Number(n).toFixed(2);

async function api(url, { method = 'GET', body } = {}) {
  const isFormData = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: isFormData ? {} : (body ? { 'Content-Type': 'application/json' } : {}),
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
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

let categories = [];
let products = [];
let orders = [];
let users = [];
let messages = [];
let banners = [];
let reportsData = null;
let currentReportMode = 'monthly';

let salesChartInstance = null;
let statusChartInstance = null;

/* ---------------- INITIALIZATION & AUTH ---------------- */
(async function init() {
  try {
    const me = await api('/api/auth/me');
    if (me.user.role !== 'admin') throw new Error('Not an admin');
    showAdminDashboard();
  } catch {
    $('#loginRoot').style.display = 'block';
    $('#adminRoot').style.display = 'none';
  }
})();

function showAdminDashboard() {
  $('#loginRoot').style.display = 'none';
  $('#adminRoot').style.display = 'flex';
  loadAllAdminData();
}

$('#adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#loginMsg');
  msg.className = 'form-msg';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: $('#adminEmail').value.trim(),
        password: $('#adminPassword').value,
      },
    });
    const me = await api('/api/auth/me');
    if (me.user.role !== 'admin') throw new Error('This account does not have administrator privileges.');
    showAdminDashboard();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ============================================================
   COUPONS & PROMO CODES (Admin Panel)
   ============================================================ */
async function loadAdminCoupons() {
  const tbody = $('#couponsTableBody');
  if (!tbody) return;
  try {
    const coupons = await api('/api/admin/coupons');
    if (!coupons.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem 0;color:var(--grey)">No promo coupons yet. Create one above!</td></tr>';
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color:var(--navy);letter-spacing:1px;font-size:.95rem;">${esc(c.code)}</strong></td>
        <td><span style="font-weight:700;color:#16a34a;">${c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `£${Number(c.discount_value).toFixed(2)} OFF`}</span></td>
        <td>${c.min_order > 0 ? `£${Number(c.min_order).toFixed(2)}` : 'No minimum'}</td>
        <td><span class="status-pill delivered">${c.active ? 'Active' : 'Disabled'}</span></td>
        <td><small style="color:var(--grey)">${esc(c.created_at)}</small></td>
        <td>
          <button class="btn btn-sm btn-outline" style="color:var(--crimson);border-color:var(--crimson);padding:.3rem .6rem;font-size:.78rem;" onclick="deleteCoupon(${c.id})">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--crimson)">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await api(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    toast('Coupon deleted', 'ok');
    loadAdminCoupons();
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#couponCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#couponFormMsg');
  msg.className = 'form-msg';

  const payload = {
    code: $('#couponCodeInput').value.trim(),
    discount_type: $('#couponTypeSelect').value,
    discount_value: Number($('#couponValueInput').value),
    min_order: Number($('#couponMinOrderInput').value) || 0
  };

  try {
    await api('/api/admin/coupons', { method: 'POST', body: payload });
    msg.textContent = '✓ Promotional coupon created and live!';
    msg.className = 'form-msg ok';
    e.target.reset();
    loadAdminCoupons();
    toast('Coupon created!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

$('#adminLogoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

/* ---------------- SIDEBAR NAVIGATION ---------------- */
document.querySelectorAll('.side-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const target = btn.dataset.view;
    const panel = $(`#view-${target}`);
    if (panel) panel.classList.add('active');
    // Lazy load reviews when that tab is clicked
    if (target === 'reviews') loadAdminReviews();
    if (target === 'coupons') loadAdminCoupons();
  });
});

/* ---------------- MASTER DATA LOADER ---------------- */
async function loadAllAdminData() {
  await Promise.all([
    loadBanners(),
    loadCategories(),
    loadProducts(),
    loadOrders(),
    loadUsers(),
    loadMessages(),
    loadSiteSettingsAdmin(),
    loadAdminProfile(),
    loadReports()
  ]);
}

/* ---------------- 1. REPORTS & CHARTS ---------------- */
async function loadReports() {
  try {
    reportsData = await api('/api/admin/reports');
    
    // Set KPIs
    $('#kpiRevenue').textContent = money(reportsData.kpis.revenue);
    $('#kpiOrders').textContent = reportsData.kpis.orders;
    $('#kpiUsers').textContent = reportsData.kpis.users;
    $('#kpiProducts').textContent = reportsData.kpis.products;

    renderSalesChart(currentReportMode);
    renderStatusChart(reportsData.statusDistribution);
    renderTopSelling(reportsData.topProducts);
    renderMostViewed(reportsData.mostViewed);
  } catch (err) {
    console.error('Failed to load reports:', err);
  }
}

function renderSalesChart(mode) {
  currentReportMode = mode;
  $('#btnReportDaily').className = mode === 'daily' ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';
  $('#btnReportWeekly').className = mode === 'weekly' ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';
  $('#btnReportMonthly').className = mode === 'monthly' ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';

  let dataset = [];
  let labels = [];

  if (mode === 'daily') {
    dataset = reportsData.dailySales || [];
    labels = dataset.map((d) => d.date);
    $('#chartHeading').textContent = 'Daily Sales & Revenue (Last 7 Days)';
  } else if (mode === 'weekly') {
    dataset = reportsData.weeklySales || [];
    labels = dataset.map((d) => d.week);
    $('#chartHeading').textContent = 'Weekly Sales & Revenue (Last 8 Weeks)';
  } else {
    dataset = reportsData.monthlySales || [];
    labels = dataset.map((d) => d.month);
    $('#chartHeading').textContent = 'Monthly Sales & Revenue (Last 12 Months)';
  }

  const revenues = dataset.map((d) => d.revenue);
  const orderCounts = dataset.map((d) => d.orders);

  if (salesChartInstance) salesChartInstance.destroy();

  const ctx = document.getElementById('salesChart').getContext('2d');
  salesChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['No Data'],
      datasets: [
        {
          label: 'Revenue (£)',
          data: revenues.length ? revenues : [0],
          backgroundColor: '#FBBF24',
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          label: 'Order Volume',
          data: orderCounts.length ? orderCounts : [0],
          type: 'line',
          borderColor: '#10B981',
          backgroundColor: '#10B981',
          borderWidth: 3,
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          position: 'left',
          title: { display: true, text: 'Revenue (£)' }
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Orders Count' }
        }
      }
    }
  });
}

function renderStatusChart(dist = []) {
  if (statusChartInstance) statusChartInstance.destroy();

  const labels = dist.map((d) => d.status.toUpperCase());
  const counts = dist.map((d) => d.count);
  const colorMap = {
    PENDING: '#f59e0b',
    ONGOING: '#0284c7',
    PROCESSING: '#0284c7',
    SHIPPED: '#6366f1',
    DELIVERED: '#10b981',
    RECEIVED: '#10b981',
    CANCELLED: '#ef4444'
  };

  const bgColors = labels.map((l) => colorMap[l] || '#94a3b8');

  const ctx = document.getElementById('statusChart').getContext('2d');
  statusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['None'],
      datasets: [{
        data: counts.length ? counts : [1],
        backgroundColor: bgColors.length ? bgColors : ['#cbd5e1'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

function renderTopSelling(top = []) {
  const tbody = $('#topProductsTable tbody');
  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--grey)">No order data yet</td></tr>';
    return;
  }
  tbody.innerHTML = top.map((p) => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td><span class="status-pill delivered">${p.units_sold} sold</span></td>
      <td><strong>${money(p.total_revenue)}</strong></td>
    </tr>
  `).join('');
}

function renderMostViewed(views = []) {
  const tbody = $('#mostViewedTable tbody');
  if (!views.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--grey)">No products</td></tr>';
    return;
  }
  tbody.innerHTML = views.map((p) => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${p.views} views</td>
      <td>${p.stock} units</td>
      <td><strong>${money(p.price)}</strong></td>
    </tr>
  `).join('');
}

$('#btnReportDaily').addEventListener('click', () => renderSalesChart('daily'));
$('#btnReportWeekly').addEventListener('click', () => renderSalesChart('weekly'));
$('#btnReportMonthly').addEventListener('click', () => renderSalesChart('monthly'));

/* ---------------- 2. PRODUCTS CRUD WITH PICTURE UPLOAD & BANNER LINK ---------------- */
async function loadCategories() {
  categories = await api('/api/categories');
  $('#pCategory').innerHTML = '<option value="">— Select Category —</option>' +
    categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function updateBannerSelectOptions() {
  $('#pBannerSelect').innerHTML = '<option value="">— None (Standard Catalog Product) —</option>' +
    banners.map((b) => `<option value="${b.id}">${esc(b.title)} ${b.active ? '(Active Campaign)' : '(Disabled)'}</option>`).join('');
}

async function loadProducts() {
  const res = await api('/api/products?limit=100');
  products = res.products || [];
  renderProductAdminTable();
}

function renderProductAdminTable() {
  const tbody = $('#productAdminTable tbody');
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--grey)">No products in catalog</td></tr>';
    return;
  }

  tbody.innerHTML = products.map((p) => {
    const thumb = p.image
      ? `<img src="${esc(p.image)}" style="width:38px;height:38px;border-radius:8px;object-fit:cover;margin-right:.6rem;vertical-align:middle">`
      : `<span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:${esc(p.color || '#228B22')};margin-right:.6rem;vertical-align:middle"></span>`;

    const bannerBadge = p.banner_title
      ? `<span class="status-pill ongoing" style="font-size:.7rem">${esc(p.banner_title)}</span>`
      : '<span style="color:var(--grey);font-size:.8rem">—</span>';

    return `
      <tr>
        <td>
          ${thumb}
          <strong>${esc(p.name)}</strong>
          ${p.featured ? '<span class="status-pill shipped" style="margin-left:.4rem">Featured</span>' : ''}
        </td>
        <td>${esc(p.category_name || 'Bespoke')}</td>
        <td>${bannerBadge}</td>
        <td><strong>${money(p.price)}</strong></td>
        <td>
          <span style="font-weight:700;color:${p.stock <= 5 ? 'var(--crimson)' : 'var(--navy)'}">${p.stock}</span>
        </td>
        <td>
          <div style="display:flex;gap:.4rem">
            <button class="btn btn-outline btn-sm" data-edit-p="${p.id}" style="color:var(--royal);border-color:var(--royal)">Edit</button>
            <button class="btn btn-outline btn-sm" data-del-p="${p.id}" style="color:var(--crimson);border-color:var(--crimson)">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-edit-p]').forEach((btn) => {
    btn.addEventListener('click', () => fillProductForm(Number(btn.dataset.editP)));
  });
  tbody.querySelectorAll('[data-del-p]').forEach((btn) => {
    btn.addEventListener('click', () => deleteProduct(Number(btn.dataset.delP)));
  });
}

// Handle Image Upload Button
$('#btnUploadImage').addEventListener('click', async () => {
  const fileInput = $('#pImageFile');
  if (!fileInput.files || !fileInput.files[0]) {
    toast('Please choose an image file first', 'error');
    return;
  }
  const fd = new FormData();
  fd.append('image', fileInput.files[0]);

  try {
    const res = await api('/api/upload', { method: 'POST', body: fd });
    $('#pImage').value = res.url;
    $('#pImageUrl').value = res.url;
    updateImagePreview(res.url);
    toast('Image uploaded successfully!', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#pImageUrl').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  $('#pImage').value = val;
  updateImagePreview(val);
});

function updateImagePreview(url) {
  const box = $('#imagePreviewBox');
  if (url) {
    box.innerHTML = `<img src="${esc(url)}" alt="Preview">`;
  } else {
    box.innerHTML = '<span style="color:var(--grey);font-size:.85rem">No image selected</span>';
  }
}

function fillProductForm(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;

  $('#formTitle').textContent = `Edit Product: ${p.name}`;
  $('#saveProductBtn').textContent = 'Update Product Details';
  $('#pId').value = p.id;
  $('#pName').value = p.name;
  $('#pDesc').value = p.description || '';
  $('#pPrice').value = p.price;
  $('#pOldPrice').value = p.old_price || '';
  $('#pStock').value = p.stock;
  $('#pCategory').value = p.category_id || '';
  $('#pBannerSelect').value = p.banner_id || '';
  $('#pBadge').value = p.badge || '';
  $('#pColor').value = p.color || '#228B22';
  $('#pImage').value = p.image || '';
  $('#pImageUrl').value = p.image || '';
  updateImagePreview(p.image);
  $('#pFeatures').value = (p.features || []).join('\n');
  $('#pFeatured').checked = !!p.featured;

  $('#view-products').scrollIntoView({ behavior: 'smooth' });
}

function resetProductForm() {
  $('#formTitle').textContent = 'Add New Product';
  $('#saveProductBtn').textContent = 'Save Product to Store';
  $('#productForm').reset();
  $('#pId').value = '';
  $('#pImage').value = '';
  $('#pImageUrl').value = '';
  $('#pBannerSelect').value = '';
  updateImagePreview('');
  $('#productMsg').textContent = '';
}

$('#resetProductBtn').addEventListener('click', resetProductForm);

$('#productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#productMsg');
  msg.className = 'form-msg';

  const id = $('#pId').value;
  const body = {
    name: $('#pName').value.trim(),
    description: $('#pDesc').value.trim(),
    price: Number($('#pPrice').value),
    old_price: $('#pOldPrice').value ? Number($('#pOldPrice').value) : null,
    stock: Number($('#pStock').value || 0),
    category_id: $('#pCategory').value ? Number($('#pCategory').value) : null,
    banner_id: $('#pBannerSelect').value ? Number($('#pBannerSelect').value) : null,
    badge: $('#pBadge').value.trim() || null,
    color: $('#pColor').value,
    image: $('#pImage').value || $('#pImageUrl').value.trim() || '',
    features: $('#pFeatures').value,
    featured: $('#pFeatured').checked
  };

  try {
    if (id) {
      await api(`/api/products/${id}`, { method: 'PUT', body });
      toast('Product updated successfully', 'ok');
    } else {
      await api('/api/products', { method: 'POST', body });
      toast('New product added to store!', 'ok');
    }
    resetProductForm();
    await loadProducts();
    await loadBanners();
    await loadReports();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ============================================================
   COUPONS & PROMO CODES (Admin Panel)
   ============================================================ */
async function loadAdminCoupons() {
  const tbody = $('#couponsTableBody');
  if (!tbody) return;
  try {
    const coupons = await api('/api/admin/coupons');
    if (!coupons.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem 0;color:var(--grey)">No promo coupons yet. Create one above!</td></tr>';
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color:var(--navy);letter-spacing:1px;font-size:.95rem;">${esc(c.code)}</strong></td>
        <td><span style="font-weight:700;color:#16a34a;">${c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `£${Number(c.discount_value).toFixed(2)} OFF`}</span></td>
        <td>${c.min_order > 0 ? `£${Number(c.min_order).toFixed(2)}` : 'No minimum'}</td>
        <td><span class="status-pill delivered">${c.active ? 'Active' : 'Disabled'}</span></td>
        <td><small style="color:var(--grey)">${esc(c.created_at)}</small></td>
        <td>
          <button class="btn btn-sm btn-outline" style="color:var(--crimson);border-color:var(--crimson);padding:.3rem .6rem;font-size:.78rem;" onclick="deleteCoupon(${c.id})">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--crimson)">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await api(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    toast('Coupon deleted', 'ok');
    loadAdminCoupons();
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#couponCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#couponFormMsg');
  msg.className = 'form-msg';

  const payload = {
    code: $('#couponCodeInput').value.trim(),
    discount_type: $('#couponTypeSelect').value,
    discount_value: Number($('#couponValueInput').value),
    min_order: Number($('#couponMinOrderInput').value) || 0
  };

  try {
    await api('/api/admin/coupons', { method: 'POST', body: payload });
    msg.textContent = '✓ Promotional coupon created and live!';
    msg.className = 'form-msg ok';
    e.target.reset();
    loadAdminCoupons();
    toast('Coupon created!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

async function deleteProduct(id) {
  if (!confirm('Are you sure you want to permanently delete this product?')) return;
  try {
    await api(`/api/products/${id}`, { method: 'DELETE' });
    toast('Product deleted', 'ok');
    await loadProducts();
    await loadBanners();
    await loadReports();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- 3. ORDERS MANAGEMENT & STATUS UPDATES ---------------- */
async function loadOrders() {
  orders = await api('/api/admin/orders');
  
  const pendingCount = orders.filter((o) => o.status === 'pending').length;
  const badge = $('#orderBadge');
  if (pendingCount > 0) {
    badge.textContent = pendingCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  renderOrdersTable();
}

$('#orderStatusFilter').addEventListener('change', renderOrdersTable);

function renderOrdersTable() {
  const tbody = $('#adminOrderTable tbody');
  const filter = $('#orderStatusFilter').value;
  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--grey)">No orders found</td></tr>';
    return;
  }

  const statuses = [
    { val: 'pending', label: 'Pending' },
    { val: 'ongoing', label: 'On-Going / Processing' },
    { val: 'shipped', label: 'Shipped' },
    { val: 'delivered', label: 'Delivered / Received' },
    { val: 'cancelled', label: 'Cancelled' }
  ];

  tbody.innerHTML = filtered.map((o) => {
    const instaHandle = (o.instagram || '').replace(/^@/, '');
    const instaLink = instaHandle
      ? `<a href="https://instagram.com/${esc(instaHandle)}" target="_blank" style="display:inline-flex;align-items:center;gap:3px;color:#e1306c;font-weight:700;text-decoration:none;margin-top:2px">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/></svg>
           @${esc(instaHandle)}
         </a>`
      : '';

    const cleanPhone = (o.whatsapp || '').replace(/[^0-9]/g, '');
    const waLink = cleanPhone
      ? `<a href="https://wa.me/${esc(cleanPhone)}" target="_blank" style="display:inline-flex;align-items:center;gap:3px;color:#25d366;font-weight:700;text-decoration:none;margin-top:2px">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
           ${esc(o.whatsapp)}
         </a>`
      : '';

    return `
      <tr>
        <td><strong>#${o.id}</strong><br><small style="color:var(--grey)">${esc(o.created_at)}</small></td>
        <td>
          <strong>${esc(o.shipping_name || o.customer_name)}</strong><br>
          <small style="color:var(--grey)">${esc(o.shipping_email || o.customer_email)}</small>
          ${instaLink ? `<div style="margin-top:3px">${instaLink}</div>` : ''}
          ${waLink ? `<div style="margin-top:2px">${waLink}</div>` : ''}
        </td>
        <td>
          <div style="font-size:.85rem">
            ${esc(o.shipping_address)}, ${esc(o.shipping_city)}<br>
            <span style="color:var(--grey)">${esc(o.shipping_zip || '')}</span>
          </div>
        </td>
        <td>
          <div style="font-size:.85rem">
            ${o.items.map((it) => `<div>${it.quantity}× <strong>${esc(it.name)}</strong> (${money(it.price * it.quantity)})</div>`).join('')}
          </div>
        </td>
        <td><strong style="color:var(--navy);font-size:1.05rem">${money(o.total)}</strong></td>
        <td>
          <select class="status-select ${esc(o.status)}" data-order-status="${o.id}">
            ${statuses.map((s) => `
              <option value="${s.val}" ${o.status === s.val ? 'selected' : ''}>${s.label}</option>
            `).join('')}
          </select>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-order-status]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const orderId = sel.dataset.orderStatus;
      const newStatus = sel.value;
      try {
        await api(`/api/admin/orders/${orderId}`, {
          method: 'PATCH',
          body: { status: newStatus }
        });
        sel.className = `status-select ${newStatus}`;
        toast(`Order #${orderId} status updated to ${newStatus}`, 'ok');
        await loadOrders();
        await loadReports();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- 4. USERS & CLIENTS ---------------- */
async function loadUsers() {
  users = await api('/api/admin/users');
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = $('#adminUsersTable tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--grey)">No registered accounts</td></tr>';
    return;
  }
  tbody.innerHTML = users.map((u) => `
    <tr>
      <td>#${u.id}</td>
      <td><strong>${esc(u.name)}</strong></td>
      <td>${esc(u.email)}</td>
      <td><span class="status-pill ongoing">${u.order_count} orders</span></td>
      <td><strong>${money(u.total_spent)}</strong></td>
      <td>
        <span class="status-pill ${u.role === 'admin' ? 'shipped' : 'delivered'}">${esc(u.role)}</span>
      </td>
      <td><small style="color:var(--grey)">${esc(u.created_at)}</small></td>
    </tr>
  `).join('');
}

/* ---------------- 5. CUSTOMER FEEDBACK & CONCIERGE MESSAGES ---------------- */
async function loadMessages() {
  messages = await api('/api/admin/messages');
  
  const unread = messages.filter((m) => m.status === 'unread').length;
  const badge = $('#msgBadge');
  if (unread > 0) {
    badge.textContent = unread;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  renderMessagesTable();
}

function renderMessagesTable() {
  const tbody = $('#adminMessagesTable tbody');
  if (!messages.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--grey)">No client messages</td></tr>';
    return;
  }

  tbody.innerHTML = messages.map((m) => `
    <tr>
      <td>#${m.id}</td>
      <td>
        <strong>${esc(m.name)}</strong><br>
        <small style="color:var(--grey)"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></small>
      </td>
      <td><strong>${esc(m.subject || 'General Inquiry')}</strong></td>
      <td style="max-width:320px"><div style="font-size:.88rem;color:var(--dark-grey)">${esc(m.message)}</div></td>
      <td><small style="color:var(--grey)">${esc(m.created_at)}</small></td>
      <td>
        <select class="status-select ${m.status === 'unread' ? 'pending' : 'delivered'}" data-msg-status="${m.id}">
          <option value="unread" ${m.status === 'unread' ? 'selected' : ''}>Unread</option>
          <option value="read" ${m.status === 'read' ? 'selected' : ''}>Reviewed</option>
          <option value="replied" ${m.status === 'replied' ? 'selected' : ''}>Replied</option>
        </select>
      </td>
      <td>
        <button class="btn btn-outline btn-sm" data-del-msg="${m.id}" style="color:var(--crimson);border-color:var(--crimson)">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-msg-status]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api(`/api/admin/messages/${sel.dataset.msgStatus}`, {
          method: 'PATCH',
          body: { status: sel.value }
        });
        toast('Message status updated', 'ok');
        await loadMessages();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  tbody.querySelectorAll('[data-del-msg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this message?')) return;
      try {
        await api(`/api/admin/messages/${btn.dataset.delMsg}`, { method: 'DELETE' });
        toast('Message deleted', 'ok');
        await loadMessages();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- 6. BANNERS & PROMOTIONAL CAMPAIGNS ---------------- */
async function loadBanners() {
  banners = await api('/api/admin/banners');
  updateBannerSelectOptions();
  renderBannersTable();
}

function renderBannersTable() {
  const tbody = $('#adminBannersTable tbody');
  if (!banners.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--grey)">No banners published</td></tr>';
    return;
  }

  tbody.innerHTML = banners.map((b) => `
    <tr>
      <td>
        <strong>${esc(b.title)}</strong><br>
        <small style="color:var(--grey)">${esc(b.subtitle || '')}</small>
      </td>
      <td>
        <span class="status-pill ongoing">${b.product_count} products linked</span>
      </td>
      <td>
        <span class="status-pill ${b.active ? 'delivered' : 'cancelled'}">${b.active ? 'Active & Visible' : 'Disabled (Hidden)'}</span>
      </td>
      <td>
        <button class="btn btn-outline btn-sm" data-edit-banner="${b.id}" style="color:var(--navy);border-color:var(--navy)">
          Edit
        </button>
        <button class="btn btn-outline btn-sm" data-toggle-banner="${b.id}" data-active="${b.active}">
          ${b.active ? 'Disable' : 'Enable'}
        </button>
        <button class="btn btn-outline btn-sm" data-del-banner="${b.id}" style="color:var(--crimson);border-color:var(--crimson);margin-left:.2rem">
          Delete
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit-banner]').forEach((btn) => {
    btn.addEventListener('click', () => fillBannerForm(Number(btn.dataset.editBanner)));
  });

  tbody.querySelectorAll('[data-toggle-banner]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggleBanner;
      const currentActive = btn.dataset.active === '1';
      try {
        await api(`/api/admin/banners/${id}`, {
          method: 'PUT',
          body: { active: !currentActive }
        });
        toast(`Banner ${!currentActive ? 'enabled' : 'disabled'}! Linked products updated in store`, 'ok');
        await loadBanners();
        await loadProducts();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  tbody.querySelectorAll('[data-del-banner]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this banner? Linked products will remain in store as general items.')) return;
      try {
        await api(`/api/admin/banners/${btn.dataset.delBanner}`, { method: 'DELETE' });
        toast('Banner deleted', 'ok');
        await loadBanners();
        await loadProducts();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- BANNER IMAGE UPLOAD & BACKGROUND MODE TOGGLE ---------------- */
$('#btnBannerBgColorMode').addEventListener('click', () => {
  $('#bImage').value = '';
  $('#bImageUrl').value = '';
  $('#bannerImgPreviewBox').innerHTML = '<span style="color:var(--grey);font-size:.8rem">No image uploaded (using color background)</span>';
  toast('Switched to Color/Gradient mode', 'ok');
});

$('#btnBannerBgImageMode').addEventListener('click', () => {
  $('#bImageUrl').focus();
  toast('Upload or paste an image URL for the banner background', 'ok');
});

$('#btnUploadBannerImg').addEventListener('click', async () => {
  const fileInput = $('#bImageFile');
  if (!fileInput.files || !fileInput.files[0]) {
    toast('Please choose a banner image file first', 'error');
    return;
  }
  const fd = new FormData();
  fd.append('image', fileInput.files[0]);

  try {
    const res = await api('/api/upload', { method: 'POST', body: fd });
    $('#bImage').value = res.url;
    $('#bImageUrl').value = res.url;
    updateBannerImagePreview(res.url);
    toast('Banner image uploaded successfully!', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#bImageUrl').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  $('#bImage').value = val;
  updateBannerImagePreview(val);
});

function updateBannerImagePreview(url) {
  const box = $('#bannerImgPreviewBox');
  if (url) {
    box.innerHTML = `<img src="${esc(url)}" alt="Banner Background Preview">`;
  } else {
    box.innerHTML = '<span style="color:var(--grey);font-size:.8rem">No image uploaded (using color background)</span>';
  }
}

function fillBannerForm(id) {
  const b = banners.find((x) => x.id === id);
  if (!b) return;

  $('#bannerFormTitle').textContent = `Edit Campaign: ${b.title}`;
  $('#saveBannerBtn').textContent = 'Update Campaign Banner';
  $('#bId').value = b.id;
  $('#bTitle').value = b.title;
  $('#bSubtitle').value = b.subtitle || '';
  $('#bBtnText').value = b.button_text || 'Shop Collection';
  $('#bBtnLink').value = b.button_link || '#collections';
  $('#bBgColor').value = b.bg_color || 'linear-gradient(135deg, #09090b 0%, #18181b 50%, #b45309 100%)';
  $('#bImage').value = b.image || '';
  $('#bImageUrl').value = b.image || '';
  updateBannerImagePreview(b.image);
  $('#bActive').checked = !!b.active;

  $('#view-banners').scrollIntoView({ behavior: 'smooth' });
}

function resetBannerForm() {
  $('#bannerFormTitle').textContent = 'Create New Campaign Banner';
  $('#saveBannerBtn').textContent = 'Save Campaign Banner';
  $('#bannerForm').reset();
  $('#bId').value = '';
  $('#bImage').value = '';
  $('#bImageUrl').value = '';
  updateBannerImagePreview('');
  $('#bActive').checked = true;
  $('#bannerMsg').textContent = '';
}

$('#resetBannerBtn').addEventListener('click', resetBannerForm);

$('#bannerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#bannerMsg');
  msg.className = 'form-msg';

  const id = $('#bId').value;
  const body = {
    title: $('#bTitle').value.trim(),
    subtitle: $('#bSubtitle').value.trim(),
    button_text: $('#bBtnText').value.trim(),
    button_link: $('#bBtnLink').value.trim(),
    bg_color: $('#bBgColor').value.trim(),
    image: $('#bImage').value || $('#bImageUrl').value.trim() || '',
    active: $('#bActive').checked ? 1 : 0
  };

  try {
    if (id) {
      await api(`/api/admin/banners/${id}`, { method: 'PUT', body });
      toast('Campaign banner updated successfully!', 'ok');
    } else {
      await api('/api/admin/banners', { method: 'POST', body });
      toast('New campaign banner published! Now you can link products to it.', 'ok');
    }
    resetBannerForm();
    await loadBanners();
    await loadProducts();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ============================================================
   COUPONS & PROMO CODES (Admin Panel)
   ============================================================ */
async function loadAdminCoupons() {
  const tbody = $('#couponsTableBody');
  if (!tbody) return;
  try {
    const coupons = await api('/api/admin/coupons');
    if (!coupons.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem 0;color:var(--grey)">No promo coupons yet. Create one above!</td></tr>';
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color:var(--navy);letter-spacing:1px;font-size:.95rem;">${esc(c.code)}</strong></td>
        <td><span style="font-weight:700;color:#16a34a;">${c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `£${Number(c.discount_value).toFixed(2)} OFF`}</span></td>
        <td>${c.min_order > 0 ? `£${Number(c.min_order).toFixed(2)}` : 'No minimum'}</td>
        <td><span class="status-pill delivered">${c.active ? 'Active' : 'Disabled'}</span></td>
        <td><small style="color:var(--grey)">${esc(c.created_at)}</small></td>
        <td>
          <button class="btn btn-sm btn-outline" style="color:var(--crimson);border-color:var(--crimson);padding:.3rem .6rem;font-size:.78rem;" onclick="deleteCoupon(${c.id})">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--crimson)">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await api(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    toast('Coupon deleted', 'ok');
    loadAdminCoupons();
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#couponCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#couponFormMsg');
  msg.className = 'form-msg';

  const payload = {
    code: $('#couponCodeInput').value.trim(),
    discount_type: $('#couponTypeSelect').value,
    discount_value: Number($('#couponValueInput').value),
    min_order: Number($('#couponMinOrderInput').value) || 0
  };

  try {
    await api('/api/admin/coupons', { method: 'POST', body: payload });
    msg.textContent = '✓ Promotional coupon created and live!';
    msg.className = 'form-msg ok';
    e.target.reset();
    loadAdminCoupons();
    toast('Coupon created!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ---------------- 7. WEBSITE GLOBAL NAME & PERSONAL ADMIN PROFILE ---------------- */
async function loadSiteSettingsAdmin() {
  try {
    const s = await api('/api/settings');
    if (s) {
      $('#settingSiteName').value = s.site_name || 'London Luxe';
      $('#settingSiteTagline').value = s.site_tagline || 'Luxury Bags & Fine Jewelry';
      $('#settingInstagram').value = s.instagram_handle || 'londonluxe.official';
      $('#settingWhatsapp').value = s.whatsapp_number || '447000000000';
      $('#settingEmail').value = s.contact_email || 'hello@londonluxe.test';
    }
  } catch (e) {
    console.error('Failed to load site settings:', e);
  }
}

$('#siteSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#siteSettingsMsg');
  msg.className = 'form-msg';

  const payload = {
    site_name: $('#settingSiteName').value.trim(),
    site_tagline: $('#settingSiteTagline').value.trim(),
    instagram_handle: $('#settingInstagram').value.trim(),
    whatsapp_number: $('#settingWhatsapp').value.trim(),
    contact_email: $('#settingEmail').value.trim()
  };

  try {
    await api('/api/admin/settings', { method: 'POST', body: payload });
    msg.textContent = `Website name successfully changed to "${payload.site_name}" everywhere!`;
    msg.className = 'form-msg ok';
    toast('Store branding updated!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ============================================================
   COUPONS & PROMO CODES (Admin Panel)
   ============================================================ */
async function loadAdminCoupons() {
  const tbody = $('#couponsTableBody');
  if (!tbody) return;
  try {
    const coupons = await api('/api/admin/coupons');
    if (!coupons.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem 0;color:var(--grey)">No promo coupons yet. Create one above!</td></tr>';
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color:var(--navy);letter-spacing:1px;font-size:.95rem;">${esc(c.code)}</strong></td>
        <td><span style="font-weight:700;color:#16a34a;">${c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `£${Number(c.discount_value).toFixed(2)} OFF`}</span></td>
        <td>${c.min_order > 0 ? `£${Number(c.min_order).toFixed(2)}` : 'No minimum'}</td>
        <td><span class="status-pill delivered">${c.active ? 'Active' : 'Disabled'}</span></td>
        <td><small style="color:var(--grey)">${esc(c.created_at)}</small></td>
        <td>
          <button class="btn btn-sm btn-outline" style="color:var(--crimson);border-color:var(--crimson);padding:.3rem .6rem;font-size:.78rem;" onclick="deleteCoupon(${c.id})">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--crimson)">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await api(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    toast('Coupon deleted', 'ok');
    loadAdminCoupons();
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#couponCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#couponFormMsg');
  msg.className = 'form-msg';

  const payload = {
    code: $('#couponCodeInput').value.trim(),
    discount_type: $('#couponTypeSelect').value,
    discount_value: Number($('#couponValueInput').value),
    min_order: Number($('#couponMinOrderInput').value) || 0
  };

  try {
    await api('/api/admin/coupons', { method: 'POST', body: payload });
    msg.textContent = '✓ Promotional coupon created and live!';
    msg.className = 'form-msg ok';
    e.target.reset();
    loadAdminCoupons();
    toast('Coupon created!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

async function loadAdminProfile() {
  try {
    const me = await api('/api/auth/me');
    if (me.user) {
      $('#profileName').value = me.user.name || '';
      $('#profileEmail').value = me.user.email || '';
    }
  } catch (e) {
    console.error('Failed to load profile:', e);
  }
}

$('#adminProfileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#adminProfileMsg');
  msg.className = 'form-msg';

  const payload = {
    name: $('#profileName').value.trim(),
    email: $('#profileEmail').value.trim(),
    current_password: $('#profileCurrentPassword').value,
    new_password: $('#profileNewPassword').value
  };

  try {
    await api('/api/admin/profile', { method: 'PUT', body: payload });
    msg.textContent = 'Admin profile & password updated successfully!';
    msg.className = 'form-msg ok';
    $('#profileCurrentPassword').value = '';
    $('#profileNewPassword').value = '';
    toast('Admin credentials saved!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ============================================================
   COUPONS & PROMO CODES (Admin Panel)
   ============================================================ */
async function loadAdminCoupons() {
  const tbody = $('#couponsTableBody');
  if (!tbody) return;
  try {
    const coupons = await api('/api/admin/coupons');
    if (!coupons.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem 0;color:var(--grey)">No promo coupons yet. Create one above!</td></tr>';
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color:var(--navy);letter-spacing:1px;font-size:.95rem;">${esc(c.code)}</strong></td>
        <td><span style="font-weight:700;color:#16a34a;">${c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `£${Number(c.discount_value).toFixed(2)} OFF`}</span></td>
        <td>${c.min_order > 0 ? `£${Number(c.min_order).toFixed(2)}` : 'No minimum'}</td>
        <td><span class="status-pill delivered">${c.active ? 'Active' : 'Disabled'}</span></td>
        <td><small style="color:var(--grey)">${esc(c.created_at)}</small></td>
        <td>
          <button class="btn btn-sm btn-outline" style="color:var(--crimson);border-color:var(--crimson);padding:.3rem .6rem;font-size:.78rem;" onclick="deleteCoupon(${c.id})">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--crimson)">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await api(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    toast('Coupon deleted', 'ok');
    loadAdminCoupons();
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#couponCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#couponFormMsg');
  msg.className = 'form-msg';

  const payload = {
    code: $('#couponCodeInput').value.trim(),
    discount_type: $('#couponTypeSelect').value,
    discount_value: Number($('#couponValueInput').value),
    min_order: Number($('#couponMinOrderInput').value) || 0
  };

  try {
    await api('/api/admin/coupons', { method: 'POST', body: payload });
    msg.textContent = '✓ Promotional coupon created and live!';
    msg.className = 'form-msg ok';
    e.target.reset();
    loadAdminCoupons();
    toast('Coupon created!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ============================================================
   COUPONS & PROMO CODES (Admin Panel)
   ============================================================ */
async function loadAdminCoupons() {
  const tbody = document.querySelector('#couponsTableBody');
  if (!tbody) return;
  try {
    const coupons = await api('/api/admin/coupons');
    if (!coupons.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem 0;color:var(--grey)">No promo coupons yet. Create one above!</td></tr>';
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color:var(--navy);letter-spacing:1px;font-size:.95rem;">${esc(c.code)}</strong></td>
        <td><span style="font-weight:700;color:#16a34a;">${c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `£${Number(c.discount_value).toFixed(2)} OFF`}</span></td>
        <td>${c.min_order > 0 ? `£${Number(c.min_order).toFixed(2)}` : 'No minimum'}</td>
        <td><span class="status-pill delivered">${c.active ? 'Active' : 'Disabled'}</span></td>
        <td><small style="color:var(--grey)">${esc(c.created_at)}</small></td>
        <td>
          <button class="btn btn-sm btn-outline" style="color:var(--crimson);border-color:var(--crimson);padding:.3rem .6rem;font-size:.78rem;" onclick="deleteCoupon(${c.id})">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--crimson)">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await api('/api/admin/coupons/' + id, { method: 'DELETE' });
    toast('Coupon deleted', 'ok');
    loadAdminCoupons();
  } catch (e) {
    toast(e.message, 'error');
  }
}

document.querySelector('#couponCreateForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.querySelector('#couponFormMsg');
  msg.className = 'form-msg';

  const payload = {
    code: document.querySelector('#couponCodeInput').value.trim(),
    discount_type: document.querySelector('#couponTypeSelect').value,
    discount_value: Number(document.querySelector('#couponValueInput').value),
    min_order: Number(document.querySelector('#couponMinOrderInput').value) || 0
  };

  try {
    await api('/api/admin/coupons', { method: 'POST', body: payload });
    msg.textContent = '✓ Promotional coupon created and live!';
    msg.className = 'form-msg ok';
    e.target.reset();
    loadAdminCoupons();
    toast('Coupon created!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});

/* ============================================================
   COUPONS & PROMO CODES (Admin Panel)
   ============================================================ */
async function loadAdminCoupons() {
  const tbody = $('#couponsTableBody');
  if (!tbody) return;
  try {
    const coupons = await api('/api/admin/coupons');
    if (!coupons.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem 0;color:var(--grey)">No promo coupons yet. Create one above!</td></tr>';
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color:var(--navy);letter-spacing:1px;font-size:.95rem;">${esc(c.code)}</strong></td>
        <td><span style="font-weight:700;color:#16a34a;">${c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `£${Number(c.discount_value).toFixed(2)} OFF`}</span></td>
        <td>${c.min_order > 0 ? `£${Number(c.min_order).toFixed(2)}` : 'No minimum'}</td>
        <td><span class="status-pill delivered">${c.active ? 'Active' : 'Disabled'}</span></td>
        <td><small style="color:var(--grey)">${esc(c.created_at)}</small></td>
        <td>
          <button class="btn btn-sm btn-outline" style="color:var(--crimson);border-color:var(--crimson);padding:.3rem .6rem;font-size:.78rem;" onclick="deleteCoupon(${c.id})">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--crimson)">${esc(err.message)}</td></tr>`;
  }
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await api(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    toast('Coupon deleted', 'ok');
    loadAdminCoupons();
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#couponCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#couponFormMsg');
  msg.className = 'form-msg';

  const payload = {
    code: $('#couponCodeInput').value.trim(),
    discount_type: $('#couponTypeSelect').value,
    discount_value: Number($('#couponValueInput').value),
    min_order: Number($('#couponMinOrderInput').value) || 0
  };

  try {
    await api('/api/admin/coupons', { method: 'POST', body: payload });
    msg.textContent = '✓ Promotional coupon created and live!';
    msg.className = 'form-msg ok';
    e.target.reset();
    loadAdminCoupons();
    toast('Coupon created!', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  }
});
