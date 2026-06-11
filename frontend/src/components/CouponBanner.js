import React, { useState } from 'react';
import { useSeasonal } from '../context/SeasonalContext';

/**
 * CouponBanner – Floating coupon pill on mobile, card on desktop.
 * On mobile it starts collapsed (just a small pill) to avoid covering content.
 * Tap the pill to expand; tap ✕ to dismiss for the session.
 */
export default function CouponBanner() {
  const { campaign } = useSeasonal();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);   // mobile starts collapsed
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(`coupon_dismissed_${campaign?._id}`) === '1'; } catch { return false; }
  });

  if (!campaign?.isCouponCampaign || !campaign?.couponCode || dismissed) return null;

  const copy = () => {
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

  const bg = campaign.theme?.primaryColor || '#7c3aed';
  const bg2 = campaign.theme?.secondaryColor || '#a78bfa';

  return (
    <>
      <style>{`
        @keyframes couponSlideIn {
          from { opacity:0; transform:translateY(12px); }
          to   { opacity:1; transform:translateY(0); }
        }
        /* On desktop always show full card */
        @media (min-width: 640px) {
          .coupon-pill { display: none !important; }
          .coupon-card { display: block !important; }
        }
        /* On mobile show pill or expanded card, not both */
        @media (max-width: 639px) {
          .coupon-card-mobile-hidden { display: none !important; }
        }
      `}</style>

      {/* ── Mobile pill (collapsed state) ── */}
      <button
        className="coupon-pill"
        onClick={() => setExpanded(true)}
        style={{
          position:'fixed', bottom:72, right:12, zIndex:1200,
          background:`linear-gradient(135deg,${bg},${bg2})`,
          color:'#fff', border:'none', borderRadius:999,
          padding:'8px 14px 8px 10px',
          display:'flex', alignItems:'center', gap:6,
          fontSize:12, fontWeight:800, cursor:'pointer',
          boxShadow:'0 4px 20px rgba(0,0,0,0.22)',
          animation:'couponSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
          whiteSpace:'nowrap',
        }}
      >
        🏷️ {campaign.couponCode}
        <span style={{ background:'rgba(255,255,255,0.25)', borderRadius:999, padding:'1px 7px', fontSize:11 }}>
          {campaign.couponValue}{campaign.couponType==='percentage'?'%':''} OFF
        </span>
      </button>

      {/* ── Full card (desktop always, mobile only when expanded) ── */}
      <div
        className={expanded ? 'coupon-card' : 'coupon-card coupon-card-mobile-hidden'}
        style={{
          position:'fixed', bottom:72, right:12, zIndex:1200,
          background:'#fff', borderRadius:16,
          boxShadow:'0 12px 40px rgba(0,0,0,0.16)',
          border:`2px solid ${bg}20`,
          width: 260,                   /* narrower than before (was 300) */
          overflow:'hidden',
          animation:'couponSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        {/* Header */}
        <div style={{ background:`linear-gradient(135deg,${bg},${bg2})`, padding:'10px 12px', position:'relative' }}>
          <button onClick={dismiss} style={{
            position:'absolute', top:6, right:6,
            background:'rgba(255,255,255,0.2)', border:'none', color:'#fff',
            cursor:'pointer', borderRadius:'50%', width:20, height:20,
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:10,
          }}>✕</button>
          {/* On mobile show a collapse arrow too */}
          <button
            className="coupon-pill"   /* reuse class to hide on desktop */
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            style={{
              position:'absolute', top:6, right:30,
              background:'rgba(255,255,255,0.2)', border:'none', color:'#fff',
              cursor:'pointer', borderRadius:'50%', width:20, height:20,
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:10,
            }}>▾</button>
          <p style={{ color:'rgba(255,255,255,0.85)', fontSize:10, margin:0, fontWeight:600 }}>🏷️ Exclusive Offer</p>
          <p style={{ color:'#fff', fontSize:13, margin:'2px 0 0', fontWeight:800 }}>
            {campaign.couponValue}{campaign.couponType==='percentage'?'% OFF':' OFF'} {campaign.name}
          </p>
        </div>

        {/* Code */}
        <div style={{ padding:'10px 12px' }}>
          <p style={{ fontSize:10, color:'#6b7280', margin:'0 0 6px' }}>Your coupon code:</p>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <div style={{
              flex:1, background:'#f8f7ff', border:`2px dashed ${bg}`,
              borderRadius:8, padding:'6px 8px', fontFamily:'monospace',
              fontWeight:900, fontSize:15, letterSpacing:'0.12em',
              color:bg, textAlign:'center',
            }}>
              {campaign.couponCode}
            </div>
            <button onClick={copy} style={{
              background: copied ? '#10b981' : bg, color:'#fff', border:'none',
              borderRadius:8, padding:'6px 10px', cursor:'pointer',
              fontWeight:700, fontSize:11, transition:'background 0.2s', flexShrink:0,
            }}>
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
          {campaign.couponMinOrder > 0 && (
            <p style={{ fontSize:9, color:'#9ca3af', margin:'5px 0 0', textAlign:'center' }}>
              Min. order: {campaign.couponMinOrder}
            </p>
          )}
          {campaign.endDate && (
            <p style={{ fontSize:9, color:'#ef4444', margin:'3px 0 0', textAlign:'center', fontWeight:600 }}>
              ⏰ Expires: {new Date(campaign.endDate).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
    </>
  );
}