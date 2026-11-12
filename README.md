💎 London Luxe — Full-Stack Luxury E-Commerce Platform

A production-ready, full-stack bespoke luxury e-commerce web application featuring fine jewelry, handcrafted designer bags, and premium accessories. Built with clean vanilla JavaScript, Node.js, Express, and an embedded SQLite database.

🌟 Key Features
🛍️ Client & Storefront Experience
Smooth Auto-Swiping Hero Banners: Configurable promotional campaigns (up to 40% off, holiday sales) with custom background color/image support and linked collections.
Dynamic 20-Grid Product Catalog: Filter by category (Handbags, Jewelry), sort by price/popularity/newest, live search bar, and in-stock toggles.
Product Quick View Modal: Instant popup inspect with multi-angle views, specifications, and fast buy options without page reload.
Social Commerce Integration (WhatsApp & Instagram): Post-checkout redirect with pre-filled order information for direct client concierge chats.
Interactive Lightbox Reviews (Social Proof): Admin-uploaded genuine customer chat screenshots and feedback with click-to-expand full-screen lightbox viewing.
Wishlist & Favorites (❤️): Save favorite pieces into a dedicated sliding side drawer.
Live Order Tracking Stepper: 4-step real-time visual progress stepper (Order Placed ➔ Preparing ➔ Shipped ➔ Delivered) using Order Reference # and Billing Email.
Discount & Promo Coupon System: Apply promo codes (e.g. LUXE10 for 10% off, VIP50 for £50 off) with live subtotal recalculation in the cart drawer.
Theme Switcher: Seamless toggle between Luxury Midnight Dark Mode (🌙) and Classic Default Light Mode (☀️), remembered via localStorage.
Printable Luxury PDF Invoices: Clients can print or save official branded receipts directly from their account order history.
Floating WhatsApp Concierge: Instant one-tap direct concierge assistance accessible on all devices.
🛡️ Admin Command Center (/admin.html)
Executive Analytics Dashboard: Real-time revenue KPIs, total orders, registered users, and active products with interactive Chart.js graphs.
Full Products CRUD: Add, update, delete, manage stock levels, and upload product photography.
Live Orders Pipeline: Instant order status updates (Pending, Processing, Shipped, Delivered, Cancelled) with direct WhatsApp/Instagram buyer links.
Campaign & Banner Manager: Create timed promo banners with custom color gradients or uploaded image banners.
Customer Social Proof Manager: Upload customer chat screenshots, toggle visibility, and adjust display priorities.
Promotional Coupon Engine: Issue percentage-based or fixed-amount discount codes with minimum purchase limits.
Storefront Branding & Personal Settings: Change store name, slogan, contact emails, and social handles across the entire website from a single form.
Secure Authentication: Built-in password hashing with bcryptjs and session tokens via JWT.
🛠️ Technology Stack
Layer	Technologies Used
Front-End	Semantic HTML5, CSS3 (Custom Responsive Grid, CSS Variables), Vanilla JavaScript (ES6+), Chart.js
Back-End	Node.js, Express.js REST APIs
Database	SQLite3 via better-sqlite3 (WAL mode enabled)
Auth & Security	JWT (JSON Web Tokens), bcryptjs, Cookie-based sessions, Multer (file uploads)
🚀 Getting Started
Prerequisites

Make sure you have Node.js
 (v16 or higher) installed on your system.

Installation & Local Setup

Clone the repository:

bash
git clone https://github.com/your-username/london-luxe-store.git
cd london-luxe-store

Install project dependencies:

bash
npm install

Start the server:

bash
node server.js

Open in your browser:

Storefront: http://localhost:3000
Admin Command Center: http://localhost:3000/admin.html
🔐 Default Admin Credentials
Email: admin@londonluxe.test
Password: admin123

(Note: Admin credentials and password can be updated directly inside the Admin Settings tab).

📁 Project Structure
text
├── db.js                 # SQLite database schema, connections & initial seed data
├── server.js             # Express.js REST API routes and business logic
├── package.json          # Project dependencies & scripts
├── public/               # Static client assets
│   ├── index.html        # Public luxury storefront
│   ├── admin.html        # Admin management dashboard
│   ├── css/
│   │   └── styles.css    # Responsive styles, themes, and animations
│   ├── js/
│   │   ├── app.js        # Storefront dynamic logic & cart handling
│   │   └── admin.js      # Dashboard charts, reports & CRUD handling
│   └── uploads/          # Admin-uploaded product & review pictures
└── README.md             # Project documentation
📄 License

This project is open-source and available under the MIT License.
