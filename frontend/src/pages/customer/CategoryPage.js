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

// Inject ItemList JSON-LD using only live catalogue records.
function injectCategorySchemas(products, catName, canonicalUrl, aggregateRating) {
  // Remove old schemas injected by this function
  ['cat-faq-schema', 'cat-itemlist-schema'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  if (products && products.length > 0) {
    const itemListSchema = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${catName} — Buy Online in Sri Lanka | ShopZen`,
      url: canonicalUrl,
      ...(aggregateRating ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: aggregateRating.average,
          reviewCount: aggregateRating.count,
          bestRating: '5',
          worstRating: '1',
        },
      } : {}),
      mainEntity: {
        '@type': 'ItemList',
        name: catName,
        numberOfItems: products.length,
        itemListElement: products.slice(0, 20).map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Product',
            name: p.name,
            url: `${window.__SHOPZEN_SEO__?.siteUrl || window.location.origin}/product/${p.slug}`,
            image: p.thumbnail || p.images?.[0] || undefined,
            ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
            offers: {
              '@type': 'Offer',
              priceCurrency: 'LKR',
              price: String(Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price)
                ? p.salePrice
                : p.price || 0),
              availability: (p.stock > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            },
            ...(p.ratings?.count > 0 ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: Number(p.ratings.average).toFixed(1),
                reviewCount: p.ratings.count,
                bestRating: '5',
                worstRating: '1',
              },
            } : {}),
          },
        })),
      },
    };
    const listEl = document.createElement('script');
    listEl.type = 'application/ld+json';
    listEl.id = 'cat-itemlist-schema';
    listEl.textContent = JSON.stringify(itemListSchema);
    document.head.appendChild(listEl);
  }
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
    API.get('/categories/all?inventory=true')
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

  // ── SEO ───────────────────────────────────────────────────────────────────
  const catName = category?.name || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const siteUrl = window.__SHOPZEN_SEO__?.siteUrl || window.location.origin;
  const canonicalUrl = `${siteUrl}/category/${slug}`;

  const seoTitle = category
    ? `${category.name} — Buy Online in Sri Lanka`
    : catName;

  const seoDesc = category?.description
    ? category.description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
    : `Browse ${total} currently available ${catName} product${total === 1 ? '' : 's'} at ShopZen with islandwide delivery in Sri Lanka.`;

  // Build aggregate rating across all loaded products for CollectionPage schema
  const categoryAggregateRating = React.useMemo(() => {
    const rated = products.filter(p => p.ratings?.count > 0);
    if (!rated.length) return null;
    const totalRatings = rated.reduce((sum, p) => sum + p.ratings.count, 0);
    const weightedSum  = rated.reduce((sum, p) => sum + p.ratings.average * p.ratings.count, 0);
    return {
      count: totalRatings,
      average: (weightedSum / totalRatings).toFixed(1),
    };
  }, [products]);

  // Inject an ItemList built only from products actually returned by the API.
  useEffect(() => {
    if (!category || products.length === 0) return;
    injectCategorySchemas(products, catName, canonicalUrl, categoryAggregateRating);
    return () => {
      ['cat-faq-schema', 'cat-itemlist-schema'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, category, categoryAggregateRating]);

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

  useSEO({
    title: seoTitle,
    description: seoDesc,
    url: canonicalUrl,
    keywords: `${catName}, buy ${catName} online sri lanka, ${catName} price in sri lanka, best ${catName.toLowerCase()} brands, ${catName.toLowerCase()} delivery colombo, ${catName.toLowerCase()} online shopping, shopzen sri lanka`,
    breadcrumbs: [
      { name: 'Shop', url: '/shop' },
      { name: catName, url: `/category/${slug}` },
    ],
    noindexFollow: !catLoading && (!category || (!loading && total === 0)),
  });

  const displayDescription = category?.description
    ? category.description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : `Browse the ${total} ${catName} product${total === 1 ? '' : 's'} currently available from ShopZen. Product names, prices, stock status, specifications, and offers are loaded from the live store catalogue.`;

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
                      alt={`${product.brand ? product.brand + ' ' : ''}${product.name}${product.category?.name ? ' — ' + product.category.name : ''} — buy online Sri Lanka`}
                      className="w-full h-full object-contain p-3 transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      width="300"
                      height="300"
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

        {/* Internal linking — related categories and brands for SEO + UX */}
        <div className="mt-8 rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Also explore
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/shop" className="text-xs px-3 py-1.5 rounded-full font-medium border transition-colors"
              style={{ color: 'var(--color-primary)', borderColor: 'var(--color-primary)', background: 'transparent' }}>
              All Products
            </Link>
            <Link to="/shop?onSale=true" className="text-xs px-3 py-1.5 rounded-full font-medium border transition-colors"
              style={{ color: 'var(--color-primary)', borderColor: 'var(--color-primary)', background: 'transparent' }}>
              Sale Items
            </Link>
            <Link to="/shop?featured=true" className="text-xs px-3 py-1.5 rounded-full font-medium border transition-colors"
              style={{ color: 'var(--color-primary)', borderColor: 'var(--color-primary)', background: 'transparent' }}>
              Featured
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
