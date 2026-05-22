import React, { useState } from 'react';
import { useSeasonal } from '../context/SeasonalContext';

/**
 * CouponBanner – Floating coupon campaign highlight shown when campaign has isCouponCampaign=true.
 */
export default function CouponBanner() {
  const { campaign } = useSeasonal();
  const [copied, setCopied] = useState(false);
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

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(`coupon_dismissed_${campaign._id}`, '1'); } catch {}
  };

  const bg = campaign.theme?.primaryColor || '#7c3aed';

  return (
    <div style={{
      position: 'fixed', bottom: 80, right: 16, zIndex: 1200,
      background: '#fff', borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
      border: `2px solid ${bg}20`, maxWidth: 300, overflow: 'hidden',
      animation: 'slideInUp 0.5s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <style>{`@keyframes slideInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`}</style>
      
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${bg}, ${campaign.theme?.secondaryColor||'#a78bfa'})`, padding:'14px 16px', position:'relative' }}>
        <button onClick={dismiss} style={{
          position:'absolute',top:8,right:8,background:'rgba(255,255,255,0.2)',
          border:'none',color:'#fff',cursor:'pointer',borderRadius:'50%',
          width:22,height:22,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,
        }}>✕</button>
        <p style={{ color:'rgba(255,255,255,0.85)', fontSize:11, margin:0, fontWeight:600 }}>🏷️ Exclusive Offer</p>
        <p style={{ color:'#fff', fontSize:14, margin:'2px 0 0', fontWeight:800 }}>
          {campaign.couponValue}{campaign.couponType==='percentage'?'% OFF':' OFF'} {campaign.name}
        </p>
        {campaign.couponDescription && (
          <p style={{ color:'rgba(255,255,255,0.8)', fontSize:11, margin:'4px 0 0' }}>{campaign.couponDescription}</p>
        )}
      </div>

      {/* Coupon code */}
      <div style={{ padding:'14px 16px' }}>
        <p style={{ fontSize:11, color:'#6b7280', margin:'0 0 8px' }}>Your coupon code:</p>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{
            flex:1, background:'#f8f7ff', border:`2px dashed ${bg}`, borderRadius:10,
            padding:'8px 12px', fontFamily:'monospace', fontWeight:900,
            fontSize:18, letterSpacing:'0.15em', color:bg, textAlign:'center',
          }}>
            {campaign.couponCode}
          </div>
          <button onClick={copy} style={{
            background: copied ? '#10b981' : bg, color:'#fff', border:'none',
            borderRadius:10, padding:'8px 14px', cursor:'pointer', fontWeight:700, fontSize:12,
            transition:'background 0.2s', flexShrink:0,
          }}>
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
        {campaign.couponMinOrder > 0 && (
          <p style={{ fontSize:10, color:'#9ca3af', margin:'6px 0 0', textAlign:'center' }}>
            Min. order: {campaign.couponMinOrder}
          </p>
        )}
        {campaign.endDate && (
          <p style={{ fontSize:10, color:'#ef4444', margin:'4px 0 0', textAlign:'center', fontWeight:600 }}>
            ⏰ Expires: {new Date(campaign.endDate).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}
