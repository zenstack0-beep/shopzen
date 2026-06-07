import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../utils/api';

/**
 * PopupBanner – Overlay popup shown on site entry.
 * Respects frequency settings: always, once_per_session, once_per_day
 */
export default function PopupBanner() {
  const navigate = useNavigate();
  const [banner, setBanner] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    API.get('/banners?position=popup')
      .then(r => {
        const active = (r.data || []).filter(b => {
          if (!b.isActive) return false;
          const now = Date.now();
          if (b.startDate && new Date(b.startDate) > now) return false;
          if (b.endDate && new Date(b.endDate) < now) return false;
          return true;
        });
        if (active.length === 0) return;
        const b = active[0]; // Show first active popup

        // Check frequency
        const freq = b.popupFrequency || 'once_per_session';
        const key = `popup_${b._id}`;

        if (freq === 'once_per_session' && sessionStorage.getItem(key)) return;
        if (freq === 'once_per_day') {
          const last = localStorage.getItem(key);
          if (last && Date.now() - Number(last) < 86400000) return;
        }

        setBanner(b);
        const delay = (b.popupDelay || 3) * 1000;
        const timer = setTimeout(() => {
          setShow(true);
          if (freq === 'once_per_session') sessionStorage.setItem(key, '1');
          if (freq === 'once_per_day') localStorage.setItem(key, Date.now());
        }, delay);

        return () => clearTimeout(timer);
      })
      .catch(() => {});
  }, []);

  if (!show || !banner) return null;

  const widthMap = { sm: '400px', md: '540px', lg: '720px' };
  const maxW = widthMap[banner.popupWidth || 'md'];

  const close = () => setShow(false);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.3s ease',
      }}
      onClick={close}
    >
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes popIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}`}</style>
      <div
        style={{
          background: '#fff', borderRadius: '20px', overflow: 'hidden',
          width: '100%', maxWidth: maxW, position: 'relative',
          animation: 'popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: '0 40px 80px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={close}
          style={{
            position: 'absolute', top: '12px', right: '12px', zIndex: 1,
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'rgba(0,0,0,0.15)', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '16px', fontWeight: 'bold',
          }}
        >✕</button>

        {/* Banner image */}
        {banner.image && (
          <div style={{ position: 'relative', paddingBottom: '50%', background: '#f3f4f6' }}>
            <img src={banner.image} alt={banner.title}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}

        {/* Content */}
        <div style={{ padding: '28px 28px 24px' }}>
          {banner.title && (
            <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', marginBottom: '8px', lineHeight: 1.3 }}>
              {banner.title}
            </h2>
          )}
          {banner.subtitle && (
            <p style={{ fontSize: '15px', color: '#6b7280', marginBottom: '20px', lineHeight: 1.5 }}>
              {banner.subtitle}
            </p>
          )}
          {banner.link && (
            <button
              onClick={() => { close(); navigate(banner.link); }}
              style={{
                display: 'inline-block',
                background: banner.buttonBgColor || '#3b82f6',
                color: banner.buttonColor || '#fff',
                padding: '12px 28px',
                borderRadius: '12px',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              {banner.buttonText || 'Shop Now'}
            </button>
          )}
          <button
            onClick={close}
            style={{
              display: 'block', marginTop: '12px', background: 'none', border: 'none',
              color: '#9ca3af', fontSize: '13px', cursor: 'pointer', padding: '4px',
            }}
          >
            No thanks,
          </button>
        </div>
      </div>
    </div>
  );
}