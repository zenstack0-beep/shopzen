/**
 * CategoryPage.js — SEO-friendly category landing page
 * Route: /category/:slug  (e.g. /category/audio, /category/electronics)
 *
 * Features:
 *  - Canonical URL at /category/:slug (clean, no query params)
 *  - Unique SEO title + meta description per category
 *  - BreadcrumbList + Organization JSON-LD schemas
 *  - 200–500 word category description for Google rankings
 *  - All products in that category rendered with pagination
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { gsap } from 'gsap';
import API from '../../utils/api';
import { useCart } from '../../context/CartContext';
import { useTheme } from '../../context/ThemeContext';
import useSEO from '../../hooks/useSEO';

// ── Category SEO content library ─────────────────────────────────────────────
// 200-500 word descriptions keyed by category slug for Google ranking signals.
const CATEGORY_DESCRIPTIONS = {
  audio: `Discover our premium audio collection at ShopZen — your one-stop destination for high-quality sound equipment in Sri Lanka. Whether you're a music enthusiast, a professional audiophile, or simply looking for a reliable pair of headphones for daily commuting, we have exactly what you need.

Our audio range includes wireless Bluetooth headphones, noise-cancelling earbuds, portable Bluetooth speakers, home theatre systems, soundbars, and professional studio monitors. Every product is sourced from trusted global brands including Sony, JBL, Bose, Philips, and more — all backed by manufacturer warranties and our 14-day return policy.

Wireless audio technology has transformed how we experience music and entertainment. Our Bluetooth headphones deliver crystal-clear sound with deep bass and precise highs, while long battery life ensures your music never stops. For commuters and fitness enthusiasts, our true wireless earbuds offer a secure, tangle-free fit with active noise cancellation that blocks out the world.

Home audio is equally important — our range of soundbars and speaker systems transform any living room into a cinema-like experience. With Dolby Atmos support and multi-room connectivity, you can fill every corner of your home with rich, immersive sound.

Shop with confidence at ShopZen: fast delivery across Sri Lanka, secure payment options, and a dedicated customer support team ready to help you find the perfect audio product. Compare prices, read verified reviews, and enjoy the best deals on audio equipment available online in Sri Lanka today.`,

  electronics: `ShopZen brings you Sri Lanka's widest selection of electronics — from the latest smartphones and laptops to smart home devices and essential accessories. Whether you need cutting-edge technology for work, entertainment, or everyday life, our electronics collection has you covered.

Explore flagship smartphones from Samsung, Apple, and other leading brands, all available at competitive prices with fast delivery to your doorstep. Our laptop range covers everything from lightweight ultrabooks for professionals to powerful gaming laptops for enthusiasts.

Smart home technology is reshaping how we live, and ShopZen is at the forefront. Browse smart bulbs, robot vacuums, security cameras, and Wi-Fi routers that make your home more connected and convenient. Our accessories category includes screen protectors, cases, chargers, power banks, and cables to keep your devices running and protected.

All electronics at ShopZen come with official warranty coverage. Our product pages include detailed specifications, real customer reviews, and high-resolution images so you can make a fully informed purchase. We offer flexible payment options and easy returns, making online electronics shopping in Sri Lanka safe and straightforward.

Whether you're upgrading your setup or searching for the perfect gift, ShopZen is the trusted choice for electronics in Sri Lanka. Fast delivery, best prices, and authentic products — every time.`,

  appliances: `Transform your home with ShopZen's comprehensive range of home appliances — the best selection available online in Sri Lanka. From kitchen essentials to large household appliances, we stock everything you need to make daily life easier, more efficient, and more enjoyable.

Our kitchen appliance range includes air fryers, microwave ovens, blenders, food processors, electric kettles, rice cookers, and coffee machines from globally trusted brands like Philips, Panasonic, Bajaj, and Tefal. Every appliance is designed to save you time in the kitchen without sacrificing the quality of your cooking.

For the laundry room, choose from front-load and top-load washing machines, dryers, and ironing systems that handle even the heaviest loads with ease. Our refrigerators and freezers come in a range of capacities, finishes, and energy ratings to suit every household size and budget.

ShopZen's air conditioner collection covers split ACs, portable ACs, and inverter models that keep your home cool efficiently — perfect for Sri Lanka's tropical climate. All major brands including Carrier, Midea, and LG are available with installation support.

Shop appliances online at ShopZen with total confidence: browse detailed specifications, compare models side-by-side, read verified buyer reviews, and complete your purchase securely. We deliver across Sri Lanka with careful packaging to ensure your appliance arrives in perfect condition. Enjoy the convenience of the best home appliances at the best prices — only at ShopZen.`,
};

// Generate a default description for any category not in the library
function getDefaultDescription(catName) {
  return `Explore ShopZen's complete ${catName} collection — the best selection of ${catName} products available online in Sri Lanka. We bring you top brands, competitive prices, and fast island-wide delivery.

Every ${catName} product in our range is carefully selected for quality and value. Browse detailed specifications, compare models, and read verified customer reviews to make a confident buying decision.

At ShopZen, we believe great shopping starts with great choice. Our ${catName} range is regularly updated with the latest models and best deals, so you'll always find what you're looking for at a price that works for you.

Shop ${catName} online at ShopZen with fast delivery across Sri Lanka, secure checkout, and our 14-day hassle-free return policy. Our customer support team is always on hand to help you find the perfect product.`;
}

const Stars = ({ rating = 0 }) => (
  <div className="flex gap-0.5">
    {[1,2,3,4,5].map(s => (
      <svg key={s} className={`w-3 h-3 ${s <= Math.round(rating) ? 'text-yellow-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
      </svg>
    ))}
  </div>
);

export default function CategoryPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { settings } = useTheme();
  const { addItem } = useCart();
  const sym = settings?.currencySymbol || 'Rs.';
  const gridRef = useRef(null);

  const [category,   setCategory]   = useState(null);
  const [products,   setProducts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [catLoading, setCatLoading] = useState(true);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total,      setTotal]      = useState(0);
  const [sortBy,     setSortBy]     = useState('newest');
  const [addedId,    setAddedId]    = useState(null);

  // Load category metadata
  useEffect(() => {
    setCatLoading(true);
    API.get('/categories/all')
      .then(r => {
        const cats = r.data || [];
        const found = cats.find(c => c.slug === slug);
        setCategory(found || null);
      })
      .catch(() => setCategory(null))
      .finally(() => setCatLoading(false));
  }, [slug]);

  // Load products for this category
  const fetchProducts = useCallback(() => {
    if (!category) return;
    setLoading(true);
    const q = new URLSearchParams({ page, limit: 12, sort: sortBy, category: category._id });
    API.get(`/products?${q}`)
      .then(r => {
        setProducts(r.data.products || []);
        setTotalPages(r.data.pages || 1);
        setTotal(r.data.total || 0);
        setTimeout(() => {
          if (gridRef.current) {
            gsap.fromTo(gridRef.current.children,
              { y: 30, opacity: 0 },
              { y: 0, opacity: 1, duration: 0.5, stagger: 0.05, ease: 'power2.out' }
            );
          }
        }, 50);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, sortBy, category]);

  useEffect(() => { setPage(1); }, [sortBy, slug]);
  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.style.scrollBehavior = '';
    });
  }, [page]);

  const handleAdd = (e, product) => {
    e.preventDefault();
    if (product.variants?.length > 0) { navigate(`/product/${product.slug}`); return; }
    addItem(product);
    setAddedId(product._id);
    setTimeout(() => setAddedId(null), 1200);
  };

  // ── SEO ───────────────────────────────────────────────────────────────────
  const catName = category?.name || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const siteUrl = window.__SHOPZEN_SEO__?.siteUrl || window.location.origin;
  const canonicalUrl = `${siteUrl}/category/${slug}`;

  const seoTitle = category
    ? `${category.name} — Buy Online in Sri Lanka | ShopZen`
    : `${catName} | ShopZen Sri Lanka`;

  const seoDesc = category?.description
    ? category.description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
    : `Shop the best ${catName} online in Sri Lanka. Top brands, best prices, fast delivery. Browse our full ${catName} range at ShopZen.`;

  useSEO({
    title: seoTitle,
    description: seoDesc,
    url: canonicalUrl,
    breadcrumbs: [
      { name: 'Shop', url: '/shop' },
      { name: catName, url: `/category/${slug}` },
    ],
  });

  const displayDescription = CATEGORY_DESCRIPTIONS[slug] || getDefaultDescription(catName);

  if (catLoading) {
    return (
      <div style={{ background: 'var(--body-bg)', minHeight: '100vh' }}
        className="flex items-center justify-center">
        <div className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}/>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--body-bg)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="border-b" style={{ background: 'var(--card-bg)' }}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-3 flex-wrap">
            <Link to="/" style={{ color: 'var(--color-primary)' }}>Home</Link>
            <span>/</span>
            <Link to="/shop" style={{ color: 'var(--color-primary)' }}>Shop</Link>
            <span>/</span>
            <span className="font-medium text-gray-600">{catName}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-gray-900 mb-2"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
            {catName}
          </h1>
          <p className="text-sm text-gray-400">{total} product{total !== 1 ? 's' : ''} found</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6">
        {/* Sort bar */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-500">{total} results</p>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 outline-none"
            style={{ background: 'var(--card-bg)', borderColor: '#e5e7eb' }}>
            <option value="newest">Newest</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="popular">Most Popular</option>
          </select>
        </div>

        {/* Products grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="rounded-2xl animate-pulse" style={{ background: 'var(--card-bg)', height: '280px' }}/>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-5xl mb-4">🔍</p>
            <p className="font-semibold">No products found in this category yet.</p>
            <Link to="/shop" className="mt-4 inline-block text-sm font-medium"
              style={{ color: 'var(--color-primary)' }}>Browse all products →</Link>
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map(product => {
              const price = product.salePrice || product.price;
              const hasDiscount = product.salePrice && product.salePrice < product.price;
              const discount = hasDiscount
                ? Math.round((1 - product.salePrice / product.price) * 100)
                : 0;

              return (
                <Link key={product._id} to={`/product/${product.slug}`}
                  className="group rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1"
                  style={{ background: 'var(--card-bg)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
                  {/* Image */}
                  <div className="relative overflow-hidden aspect-square bg-gray-50">
                    <img
                      src={product.thumbnail || product.images?.[0]}
                      alt={product.name}
                      className="w-full h-full object-contain p-3 transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    {hasDiscount && (
                      <span className="absolute top-2 left-2 text-white text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--color-primary)' }}>
                        -{discount}%
                      </span>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-3">
                    {product.brand && (
                      <p className="text-xs text-gray-400 mb-0.5">{product.brand}</p>
                    )}
                    <h3 className="text-sm font-semibold text-gray-800 line-clamp-2 mb-1"
                      style={{ fontFamily: 'var(--font-body)' }}>
                      {product.name}
                    </h3>
                    {product.ratings?.count > 0 && (
                      <div className="flex items-center gap-1 mb-1">
                        <Stars rating={product.ratings.average}/>
                        <span className="text-xs text-gray-400">({product.ratings.count})</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <div>
                        <span className="font-bold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>
                          {sym}{price?.toLocaleString()}
                        </span>
                        {hasDiscount && (
                          <span className="text-xs text-gray-400 line-through ml-1">
                            {sym}{product.price?.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={e => handleAdd(e, product)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all duration-200"
                        style={{
                          background: addedId === product._id ? '#22c55e' : 'var(--color-primary)',
                          color: '#fff',
                        }}>
                        {addedId === product._id ? '✓' : '+'}
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-8">
            {[...Array(totalPages)].map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i + 1)}
                className="w-9 h-9 rounded-full text-sm font-semibold transition-all"
                style={{
                  background: page === i + 1 ? 'var(--color-primary)' : 'var(--card-bg)',
                  color: page === i + 1 ? '#fff' : 'var(--color-primary)',
                  border: `1px solid var(--color-primary)`,
                }}>
                {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* Category Description (SEO content block) */}
        <div className="mt-12 rounded-2xl p-6 sm:p-8"
          style={{ background: 'var(--card-bg)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <h2 className="text-xl font-bold text-gray-800 mb-4"
            style={{ fontFamily: 'var(--font-display)' }}>
            About {catName}
          </h2>
          <div className="text-sm text-gray-600 leading-relaxed space-y-3">
            {displayDescription.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>

        {/* Related category links */}
        <div className="mt-8 text-sm text-gray-400 text-center">
          <span>Explore more: </span>
          <Link to="/shop" style={{ color: 'var(--color-primary)' }} className="mx-1">All Products</Link>
          <span>·</span>
          <Link to="/shop?onSale=true" style={{ color: 'var(--color-primary)' }} className="mx-1">Sale</Link>
          <span>·</span>
          <Link to="/shop?featured=true" style={{ color: 'var(--color-primary)' }} className="mx-1">Featured</Link>
        </div>
      </div>
    </div>
  );
}