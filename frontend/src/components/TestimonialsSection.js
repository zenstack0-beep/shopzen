/**
 * TestimonialsSection.js
 *
 * "What People Say About Us" — homepage testimonials section.
 * Loads BOTH:
 *   1. Store reviews   — GET /api/reviews/featured  (real approved reviews left on ShopZen)
 *   2. Google reviews  — GET /api/reviews/google     (live from Google Business Profile, cached server-side)
 *
 * Both sources are merged into ONE unified, continuously auto-scrolling row
 * (marquee-style) — no tabs, no "Store" vs "Google" split screens. Each card
 * carries a small badge so it's still clear which source a review came from.
 * Auto-scroll pauses on hover/touch/drag so customers can freely scroll the
 * row themselves (mouse drag, trackpad, or touch swipe) and resumes shortly
 * after they let go.
 *
 * Controlled from Admin → Layout Builder → Homepage → "Testimonials" toggle,
 * and configured from Admin → Reviews → Google Reviews panel.
 *
 * Renders nothing (returns null) if there is no data for either source yet —
 * so an unconfigured store never shows an empty gap on the homepage.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import API from '../utils/api';

/* ── Star rating (supports halves) ───────────────────────────────────────── */
function Stars({ value = 0, size = 14 }) {
  const rounded = Math.round((value || 0) * 2) / 2; // nearest half star
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => {
        const full = rounded >= i;
        const half = !full && rounded >= i - 0.5;
        return (
          <span key={i} style={{ position: 'relative', display: 'inline-block', width: size, height: size, lineHeight: `${size}px` }}>
            <span style={{ color: '#e5e7eb', fontSize: size }}>★</span>
            {(full || half) && (
              <span style={{
                position: 'absolute', left: 0, top: 0, overflow: 'hidden',
                width: full ? '100%' : '50%', color: '#facc15', fontSize: size,
              }}>★</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ── Avatar (photo if available, else initial bubble) ───────────────────── */
function Avatar({ name, photo, color }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  if (photo) {
    return <img src={photo} alt={name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" referrerPolicy="no-referrer" draggable={false} />;
  }
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
      style={{ background: color || 'var(--color-primary)' }}
    >
      {initial}
    </div>
  );
}

/* ── One review card (shared shape for store + Google reviews) ──────────── */
function ReviewCard({ name, photo, rating, text, meta, badge }) {
  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow flex-shrink-0 flex flex-col"
      style={{ width: 300 }}
    >
      <div className="flex items-center gap-3 mb-3">
        <Avatar name={name} photo={photo} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-gray-800 truncate">{name}</p>
          {meta && <p className="text-xs text-gray-400 truncate">{meta}</p>}
        </div>
        {badge}
      </div>
      <Stars value={rating} />
      {text && <p className="text-sm text-gray-600 mt-3 leading-relaxed line-clamp-5">{text}</p>}
    </div>
  );
}

/* ── Auto-scrolling row — pauses on hover / touch / drag, resumes after ──── */
function AutoScrollRow({ children }) {
  const containerRef = useRef(null);
  const pausedRef     = useRef(false);
  const resumeTimerRef = useRef(null);
  const draggingRef   = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);

  // ── Continuous auto-scroll loop ───────────────────────────────────────────
  useEffect(() => {
    let rafId;
    const SPEED_PX_PER_FRAME = 0.6; // gentle, readable pace

    const tick = () => {
      const el = containerRef.current;
      if (el && !pausedRef.current) {
        el.scrollLeft += SPEED_PX_PER_FRAME;
        // The track is rendered twice back-to-back for a seamless loop —
        // once we've scrolled past the first copy, jump back by exactly
        // that width so the loop is invisible.
        const half = el.scrollWidth / 2;
        if (el.scrollLeft >= half) {
          el.scrollLeft -= half;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const pause = () => { pausedRef.current = true; };
  const resumeSoon = (delay = 1500) => {
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => { pausedRef.current = false; }, delay);
  };

  // ── Manual scroll: native touch/trackpad scrolling always works because
  // this is a real overflow-x:auto container. We add simple mouse-drag
  // support too, so desktop mouse users can grab and drag it sideways. ──────
  const onMouseDown = (e) => {
    const el = containerRef.current;
    if (!el) return;
    draggingRef.current = true;
    pause();
    dragStartXRef.current = e.pageX;
    dragStartScrollRef.current = el.scrollLeft;
    el.style.cursor = 'grabbing';
  };
  const onMouseMove = (e) => {
    if (!draggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    const walked = e.pageX - dragStartXRef.current;
    el.scrollLeft = dragStartScrollRef.current - walked;
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const el = containerRef.current;
    if (el) el.style.cursor = 'grab';
    resumeSoon();
  };

  return (
    <div
      ref={containerRef}
      className="testimonials-scroll-row flex gap-4 overflow-x-auto"
      style={{ cursor: 'grab', scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
      onMouseEnter={pause}
      onMouseLeave={() => { endDrag(); resumeSoon(300); }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onTouchStart={pause}
      onTouchEnd={() => resumeSoon(800)}
    >
      <style>{`.testimonials-scroll-row::-webkit-scrollbar { display: none; }`}</style>
      {children}
    </div>
  );
}

/* ── Main section ─────────────────────────────────────────────────────────── */
export default function TestimonialsSection({ settings }) {
  const [storeReviews, setStoreReviews] = useState([]);
  const [google, setGoogle] = useState({ enabled: false, rating: 0, totalRatings: 0, reviews: [], mapsUrl: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      API.get('/reviews/featured?limit=12').catch(() => ({ data: [] })),
      API.get('/reviews/google').catch(() => ({ data: { enabled: false, rating: 0, totalRatings: 0, reviews: [], mapsUrl: '' } })),
    ]).then(([storeRes, googleRes]) => {
      if (cancelled) return;
      setStoreReviews(Array.isArray(storeRes.data) ? storeRes.data : []);
      setGoogle(googleRes.data || { enabled: false, rating: 0, totalRatings: 0, reviews: [], mapsUrl: '' });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Merge both sources into ONE unified, time-sorted list ────────────────
  const combined = useMemo(() => {
    const storeItems = storeReviews.map(r => ({
      key: `s-${r._id}`,
      source: 'store',
      name: `${r.user?.firstName || ''} ${r.user?.lastName || ''}`.trim() || 'Verified Customer',
      photo: r.user?.avatar,
      rating: r.rating,
      text: r.comment,
      meta: r.product?.name,
      time: r.createdAt ? new Date(r.createdAt).getTime() : 0,
      isVerified: !!r.isVerifiedPurchase,
    }));
    const googleItems = (google.reviews || []).map(r => ({
      key: `g-${r.time}-${r.authorName}`,
      source: 'google',
      name: r.authorName,
      photo: r.authorPhoto,
      rating: r.rating,
      text: r.text,
      meta: r.relativeTime,
      time: r.time || 0,
      isVerified: false,
    }));
    return [...storeItems, ...googleItems].sort((a, b) => b.time - a.time);
  }, [storeReviews, google]);

  if (loading) return null;             // don't flash an empty section while fetching
  if (combined.length === 0) return null; // nothing to show — no gap left on the homepage

  const title    = settings?.sectionTestimonialsTitle    || '💬 What People Say About Us';
  const subtitle = settings?.sectionTestimonialsSubtitle || 'Real feedback from real customers';
  const hasGoogle = google.enabled && google.reviews.length > 0;

  const renderCard = (item) => (
    <ReviewCard
      key={item.key}
      name={item.name}
      photo={item.photo}
      rating={item.rating}
      text={item.text}
      meta={item.meta}
      badge={
        item.source === 'google' ? (
          <span className="text-xs flex-shrink-0" title="Google review">🌐</span>
        ) : item.isVerified ? (
          <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
            ✓ Verified
          </span>
        ) : null
      }
    />
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.028em', color: 'var(--color-dark)' }}>
            {title}
          </h2>
          <p className="text-gray-400 text-sm mt-1.5">{subtitle}</p>
        </div>

        {/* Compact aggregate rating chip when Google reviews are mixed in */}
        {hasGoogle && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xl font-black text-gray-900">{google.rating.toFixed(1)}</span>
            <Stars value={google.rating} size={16} />
            <span className="text-xs text-gray-400">({google.totalRatings.toLocaleString()} Google)</span>
            {google.mapsUrl && (
              <a href={google.mapsUrl} target="_blank" rel="noreferrer" className="text-xs font-bold hover:underline ml-1" style={{ color: 'var(--color-primary)' }}>
                View on Google →
              </a>
            )}
          </div>
        )}
      </div>

      {/* Unified auto-scrolling row — hover/touch/drag to scroll manually */}
      <AutoScrollRow>
        {combined.map(renderCard)}
        {/* Render the same list a second time back-to-back for a seamless loop */}
        {combined.map(item => renderCard({ ...item, key: `${item.key}-dup` }))}
      </AutoScrollRow>

      <div className="flex items-center justify-between mt-4">
        {hasGoogle ? (
          <p className="text-[11px] text-gray-300">Some reviews provided by Google</p>
        ) : <span />}
        <Link to="/shop" className="text-sm font-bold hover:underline" style={{ color: 'var(--color-primary)' }}>
          Shop the products people are loving →
        </Link>
      </div>
    </section>
  );
}