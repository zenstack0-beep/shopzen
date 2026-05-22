# 🛍️ ShopZen — Full-Stack E-Commerce Platform

A complete, production-ready e-commerce web application built with React, Node.js, Express, MongoDB, and Tailwind CSS.

---

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Tailwind CSS, React Router v6, Recharts |
| Backend | Node.js, Express.js |
| Database | MongoDB (Mongoose ODM) |
| Auth | JWT (JSON Web Tokens) |
| State | Context API (Cart + Auth) |

---

## 📁 Project Structure

```
ecommerce/
├── backend/
│   ├── models/          # Mongoose models
│   ├── routes/          # API routes
│   ├── middleware/       # Auth middleware
│   ├── server.js        # Entry point
│   ├── seed.js          # Database seeder
│   └── .env             # Environment variables
└── frontend/
    └── src/
        ├── pages/
        │   ├── admin/   # Admin panel pages
        │   └── customer/ # Customer-facing pages
        ├── context/     # React contexts
        └── utils/       # API utility
```

---

## ⚡ Setup & Installation

### Prerequisites
- Node.js 16+
- MongoDB (local or MongoDB Atlas)

### 1. Backend Setup

```bash
cd backend
npm install
```

Edit `.env`:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/ecommerce
JWT_SECRET=your_very_secret_key_here_change_this
FRONTEND_URL=http://localhost:3000
```

Seed the database (creates admin account + categories):
```bash
node seed.js
```

Start the backend:
```bash
npm run dev    # Development (with nodemon)
npm start      # Production
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm start
```

The app will run at `http://localhost:3000`

---

## 🔐 Default Admin Credentials

```
Email:    admin@shopzen.lk
Password: Admin@123456
```

Admin panel URL: `http://localhost:3000/admin`

---

## ✨ Features

### 🛒 Customer-Facing Store
- **Homepage** — Hero slider with banners, featured products, sale items, new arrivals
- **Product Catalog** — Filter by category, price range, sale status; sort by price/rating/popularity
- **Product Detail** — Multiple images, specifications, reviews, related products
- **Shopping Cart** — Slide-out drawer, quantity controls, real-time totals
- **Checkout** — Full billing form with all Sri Lanka districts, COD + bank transfer
- **Order Tracking** — Live order status with progress indicator
- **User Accounts** — Register, login, profile management, order history, wishlist
- **Search** — Live product search with overlay

### 🛠️ Admin Panel
- **Dashboard** — Revenue charts, order stats, top products, recent orders
- **Products** — Full CRUD with images, specifications, stock management
- **Orders** — Order management, status updates, tracking numbers
- **Categories** — Manage product categories
- **Customers** — View all customers, suspend/activate accounts
- **Coupons** — Create percentage/fixed discount codes with expiry
- **Banners** — Manage homepage hero banners and promos
- **Reviews** — Moderate and approve customer reviews
- **Settings** — Store info, delivery, payment, SEO, advanced config
- **Notifications** — Real-time order notifications with bell icon

### 💳 Payment Methods
- Direct Bank Transfer
- Cash on Delivery (COD)

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register customer |
| POST | /api/auth/login | Login |
| GET | /api/products | List products (with filters) |
| POST | /api/orders | Place order |
| GET | /api/orders/:id | Track order |
| GET | /api/admin/dashboard | Admin dashboard stats |
| PUT | /api/orders/admin/:id/status | Update order status |

---

## 🎨 Customization

### Rename the store
1. Update `storeName` in Admin → Settings → Store
2. Update the title in `frontend/public/index.html`
3. Replace "ShopZen" references in `CustomerLayout.js` and `Footer`

### Add your brand colors
Edit `frontend/src/index.css`:
```css
:root {
  --color-primary: #b5451b;      /* Change to your brand color */
  --color-primary-dark: #8b3214;
  --color-accent: #f0a500;
}
```

### Connect to MongoDB Atlas (Production)
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/ecommerce
```

---

## 📦 Production Deployment

### Build Frontend
```bash
cd frontend
npm run build
```

### Serve with Express
```js
// Add to backend/server.js
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/build/index.html')));
```

---

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 5000 |
| MONGODB_URI | MongoDB connection string | localhost |
| JWT_SECRET | JWT signing secret | (required) |
| FRONTEND_URL | Frontend URL for CORS | http://localhost:3000 |

---

Made with ❤️ for Sri Lankan e-commerce
