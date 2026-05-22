import React, { useEffect, useState } from 'react';
import { useSeasonal } from '../context/SeasonalContext';

/**
 * FlashSaleBanner – Shown when active campaign has isFlashSale=true.
 * Displays a countdown timer strip below the header.
 */
const CountdownTimer = ({ endTime, color }) => {
  const [time, setTime] = useState({ d:0, h:0, m:0, s:0 });
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const calc = () => {
      const diff = new Date(endTime) - Date.now();
      if (diff <= 0) { setExpired(true); return; }
      setTime({ d:Math.floor(diff/86400000), h:Math.floor((diff%86400000)/3600000), m:Math.floor((diff%3600000)/60000), s:Math.floor((diff%60000)/1000) });
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [endTime]);

  if (expired) return null;

  const Cell = ({ v, label }) => (
    <div style={{ textAlign:'center' }}>
      <div style={{
        background: 'rgba(0,0,0,0.3)', color: '#fff', borderRadius: 8,
        padding: '4px 10px', fontSize: 20, fontWeight: 900,
        fontVariantNumeric: 'tabular-nums', minWidth: 44, lineHeight: 1.3,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>{String(v).padStart(2,'0')}</div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 2, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap: 6 }}>
      {time.d > 0 && <><Cell v={time.d} label="days"/><span style={{color:'rgba(255,255,255,0.5)',fontSize:20,paddingBottom:12}}>:</span></>}
      <Cell v={time.h} label="hrs"/>
      <span style={{color:'rgba(255,255,255,0.5)',fontSize:20,paddingBottom:12}}>:</span>
      <Cell v={time.m} label="min"/>
      <span style={{color:'rgba(255,255,255,0.5)',fontSize:20,paddingBottom:12}}>:</span>
      <Cell v={time.s} label="sec"/>
    </div>
  );
};

export default function FlashSaleBanner() {
  const { campaign } = useSeasonal();
  const [dismissed, setDismissed] = useState(false);

  if (!campaign?.isFlashSale || !campaign?.flashSaleEndTime || dismissed) return null;

  const expired = new Date(campaign.flashSaleEndTime) < new Date();
  if (expired) return null;

  const bg = campaign.theme?.primaryColor || '#dc2626';

  return (
    <div style={{
      background: `linear-gradient(135deg, ${bg}, ${campaign.theme?.secondaryColor || '#f59e0b'})`,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      flexWrap: 'wrap',
      position: 'relative',
    }}>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <p style={{ fontWeight: 900, fontSize: 16, margin: 0, textShadow:'0 1px 4px rgba(0,0,0,0.3)' }}>
          {campaign.flashSaleTitle || '⚡ Flash Sale'}
        </p>
        {campaign.flashSaleSubtitle && (
          <p style={{ fontSize: 12, opacity: 0.85, margin: 0, marginTop: 1 }}>{campaign.flashSaleSubtitle}</p>
        )}
        {campaign.discountPercent > 0 && (
          <p style={{ fontSize: 11, opacity: 0.9, margin: 0, marginTop: 2 }}>
            Up to <strong>{campaign.discountPercent}% OFF</strong>
            {campaign.couponCode && <> · Use <strong style={{fontFamily:'monospace',letterSpacing:'0.05em',background:'rgba(0,0,0,0.2)',padding:'1px 6px',borderRadius:4}}>{campaign.couponCode}</strong></>}
          </p>
        )}
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ color:'rgba(255,255,255,0.7)', fontSize:11, fontWeight:700, textTransform:'uppercase' }}>Ends in:</div>
        <CountdownTimer endTime={campaign.flashSaleEndTime} color={bg}/>
      </div>

      {campaign.pageSlug && (
        <a href={`/campaign/${campaign.pageSlug}`}
          style={{
            background: 'rgba(255,255,255,0.25)', color:'#fff', padding:'8px 18px',
            borderRadius:10, fontWeight:700, fontSize:13, textDecoration:'none',
            border:'1px solid rgba(255,255,255,0.3)',
            backdropFilter:'blur(4px)', transition:'background 0.2s',
          }}
          onMouseEnter={e=>e.target.style.background='rgba(255,255,255,0.35)'}
          onMouseLeave={e=>e.target.style.background='rgba(255,255,255,0.25)'}
        >
          Shop Sale →
        </a>
      )}

      <button onClick={() => setDismissed(true)} style={{
        position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
        background:'rgba(0,0,0,0.2)', border:'none', color:'rgba(255,255,255,0.7)',
        cursor:'pointer', borderRadius:'50%', width:24, height:24,
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:12,
      }}>✕</button>
    </div>
  );
}
