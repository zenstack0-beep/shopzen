import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSeasonal } from '../context/SeasonalContext';

/**
 * CouponBanner – Draggable floating coupon widget.
 * - Desktop: full card, draggable anywhere on screen
 * - Mobile: starts as a small pill, tap to expand into draggable card
 * - Position persists in sessionStorage so it stays where the user left it
 * - Tap ✕ to dismiss for the session
 */
export default function CouponBanner() {
  const { campaign } = useSeasonal();
  const [copied,    setCopied]    = useState(false);
  const [expanded,  setExpanded]  = useState(false);
  const [dragging,  setDragging]  = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(`coupon_dismissed_${campaign?._id}`) === '1'; } catch { return false; }
  });

  // Position state — null means "use default CSS position"
  const [pos, setPos] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`coupon_pos_${campaign?._id}`);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const dragRef    = useRef(null);
  const offsetRef  = useRef({ x: 0, y: 0 });
  const didMoveRef = useRef(false); // distinguish drag from click

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  // ── Drag handlers ──────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    // Only drag on the header bar, not on buttons inside it
    if (e.target.closest('button')) return;
    e.preventDefault();
    didMoveRef.current = false;

    const el = dragRef.current;
    const rect = el.getBoundingClientRect();
    offsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    setDragging(true);

    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;

      didMoveRef.current = true;

      const newX = clientX - offsetRef.current.x;
      const newY = clientY - offsetRef.current.y;

      // Clamp to viewport
      const maxX = window.innerWidth  - el.offsetWidth;
      const maxY = window.innerHeight - el.offsetHeight;
      const clampedX = Math.max(0, Math.min(newX, maxX));
      const clampedY = Math.max(0, Math.min(newY, maxY));

      const newPos = { x: clampedX, y: clampedY };
      setPos(newPos);
      try { sessionStorage.setItem(`coupon_pos_${campaign?._id}`, JSON.stringify(newPos)); } catch {}
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend',  onUp);
  }, [campaign?._id]);

  // Reset position if campaign changes
  useEffect(() => {
    setPos(null);
  }, [campaign?._id]);

  if (!campaign?.isCouponCampaign || !campaign?.couponCode || dismissed) return null;

  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(campaign.couponCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const dismiss = (e) => {
    e.stopPropagation();
    setDismissed(true);
    try { sessionStorage.setItem(`coupon_dismissed_${campaign._id}`, '1'); } catch {}
  };

  const bg  = campaign.theme?.primaryColor  || '#7c3aed';
  const bg2 = campaign.theme?.secondaryColor || '#a78bfa';

  // Compute inline position style
  const posStyle = pos
    ? { left: pos.x, top: pos.y, bottom: 'auto', right: 'auto' }
    : isMobile
      ? { bottom: 72, left: 12 }
      : { bottom: 80, right: 16 };

  const cardVisible = !isMobile || expanded;

  return (
    <>
      <style>{`
        @keyframes couponSlideIn {
          from { opacity:0; transform:translateY(10px) scale(0.97); }
          to   { opacity:1; transform:translateY(0)    scale(1); }
        }
        .coupon-drag-handle { cursor: grab; }
        .coupon-drag-handle:active { cursor: grabbing; }
        .coupon-no-select { user-select: none; -webkit-user-select: none; }
      `}</style>

      {/* ── Mobile collapsed pill ── */}
      {isMobile && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            position: 'fixed', zIndex: 1200, ...posStyle,
            background: `linear-gradient(135deg,${bg},${bg2})`,
            color: '#fff', border: 'none', borderRadius: 999,
            padding: '8px 14px 8px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 800, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
            animation: 'couponSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
            whiteSpace: 'nowrap',
          }}
        >
          🏷️ {campaign.couponCode}
          <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '1px 7px', fontSize: 11 }}>
            {campaign.couponValue}{campaign.couponType === 'percentage' ? '%' : ''} OFF
          </span>
        </button>
      )}

      {/* ── Full card (desktop always / mobile when expanded) ── */}
      {cardVisible && (
        <div
          ref={dragRef}
          className={dragging ? 'coupon-no-select' : ''}
          style={{
            position: 'fixed', zIndex: 1200, ...posStyle,
            background: '#fff', borderRadius: 16,
            boxShadow: dragging
              ? '0 24px 60px rgba(0,0,0,0.28)'
              : '0 12px 40px rgba(0,0,0,0.16)',
            border: `2px solid ${bg}30`,
            width: 260, overflow: 'hidden',
            animation: 'couponSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
            transition: dragging ? 'none' : 'box-shadow 0.2s',
          }}
        >
          {/* ── Drag handle header ── */}
          <div
            className="coupon-drag-handle"
            onMouseDown={onPointerDown}
            onTouchStart={onPointerDown}
            style={{
              background: `linear-gradient(135deg,${bg},${bg2})`,
              padding: '10px 12px',
              position: 'relative',
              touchAction: 'none',
            }}
          >
            {/* Drag hint dots */}
            <div style={{
              position: 'absolute', top: 5, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', gap: 3,
            }}>
              {[0,1,2,3,4,5].map(i => (
                <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.45)' }} />
              ))}
            </div>

            {/* Collapse button (mobile only) */}
            {isMobile && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                style={{
                  position: 'absolute', top: 8, right: 32,
                  background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
                  cursor: 'pointer', borderRadius: '50%', width: 20, height: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
                }}>▾</button>
            )}

            {/* Dismiss button */}
            <button onClick={dismiss} style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
              cursor: 'pointer', borderRadius: '50%', width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
            }}>✕</button>

            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10, margin: '8px 0 0', fontWeight: 600 }}>🏷️ Exclusive Offer</p>
            <p style={{ color: '#fff', fontSize: 13, margin: '2px 0 0', fontWeight: 800 }}>
              {campaign.couponValue}{campaign.couponType === 'percentage' ? '% OFF' : ' OFF'} {campaign.name}
            </p>
          </div>

          {/* ── Coupon code body ── */}
          <div style={{ padding: '10px 12px' }}>
            <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 6px' }}>Your coupon code:</p>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{
                flex: 1, background: '#f8f7ff', border: `2px dashed ${bg}`,
                borderRadius: 8, padding: '6px 8px', fontFamily: 'monospace',
                fontWeight: 900, fontSize: 15, letterSpacing: '0.12em',
                color: bg, textAlign: 'center',
              }}>
                {campaign.couponCode}
              </div>
              <button onClick={copy} style={{
                background: copied ? '#10b981' : bg, color: '#fff', border: 'none',
                borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                fontWeight: 700, fontSize: 11, transition: 'background 0.2s', flexShrink: 0,
              }}>
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
            {campaign.couponMinOrder > 0 && (
              <p style={{ fontSize: 9, color: '#9ca3af', margin: '5px 0 0', textAlign: 'center' }}>
                Min. order: {campaign.couponMinOrder}
              </p>
            )}
            {campaign.endDate && (
              <p style={{ fontSize: 9, color: '#ef4444', margin: '3px 0 0', textAlign: 'center', fontWeight: 600 }}>
                ⏰ Expires: {new Date(campaign.endDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}