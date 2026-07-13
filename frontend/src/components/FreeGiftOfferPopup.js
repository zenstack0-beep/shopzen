import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../utils/api';
import { useTheme } from '../context/ThemeContext';

export default function FreeGiftOfferPopup() {
  const [offer, setOffer] = useState(null);
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();
  const { settings } = useTheme();
  const symbol = settings?.currencySymbol || 'Rs.';

  useEffect(() => {
    let timer;
    API.get('/offers/active').then(({ data }) => {
      const active = (data || [])[0];
      if (!active) return;
      sessionStorage.setItem('sz_free_gift_campaign_available', '1');
      if (sessionStorage.getItem(`free_gift_offer_${active._id}`)) return;
      setOffer(active);
      // Give the storefront time to render before presenting the campaign.
      timer = setTimeout(() => {
        setVisible(true);
        sessionStorage.setItem(`free_gift_offer_${active._id}`, '1');
      }, Math.min(300, Math.max(0, Number(active.popupDelaySeconds ?? 1))) * 1000);
    }).catch(() => {});
    return () => clearTimeout(timer);
  }, []);

  if (!visible || !offer) return null;
  const close = () => setVisible(false);
  const shop = () => { close(); navigate('/shop'); };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" onClick={close} style={{ background:'rgba(15,23,42,.72)', backdropFilter:'blur(7px)' }}>
      <style>{`
        @keyframes giftPopupIn { from { opacity:0; transform:translateY(24px) scale(.92) } to { opacity:1; transform:none } }
        .gift-popup-card { animation:giftPopupIn .4s cubic-bezier(.2,.8,.2,1); }
      `}</style>
      <div className="gift-popup-card relative w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="relative px-5 pt-7 pb-5 text-center text-white" style={{ background:'var(--theme-gradient)' }}>
          <button onClick={close} aria-label="Close offer" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/20 text-xl text-white hover:bg-black/30">×</button>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-3xl">🎁</div>
          <p className="text-xs font-black uppercase tracking-[.24em] text-white/80">Limited-time free gift</p>
          <h2 className="mt-2 text-2xl font-black sm:text-3xl" style={{ fontFamily:'var(--font-display)' }}>{offer.title}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/90">{offer.description || `Spend ${symbol} ${Number(offer.minimumAmount).toLocaleString()} on qualifying products and choose your free gift.`}</p>
        </div>

        <div className="p-5 sm:p-6">
          <p className="mb-3 text-center text-sm font-bold text-gray-800">
            Spend at least {symbol} {Number(offer.minimumAmount).toLocaleString()} and choose {offer.freeItemCount} free item{offer.freeItemCount === 1 ? '' : 's'}
          </p>
          <div className={`grid gap-3 ${(offer.freeProducts || []).length === 1 ? 'grid-cols-1 max-w-[180px] mx-auto' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {(offer.freeProducts || []).slice(0, 6).map(product => {
              const price = product.salePrice > 0 && product.salePrice < product.price ? product.salePrice : product.price;
              return (
                <div key={product._id} className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 p-2 text-center">
                  <img src={product.thumbnail || product.images?.[0]} alt={product.name} className="mx-auto h-24 w-full rounded-xl object-contain bg-white" />
                  <p className="mt-2 line-clamp-2 text-xs font-bold text-gray-800">{product.name}</p>
                  <p className="mt-1 text-xs"><span className="text-gray-400 line-through">{symbol} {Number(price).toLocaleString()}</span> <strong className="text-green-600">FREE</strong></p>
                </div>
              );
            })}
          </div>
          {(offer.freeProducts || []).length > 6 && <p className="mt-2 text-center text-xs text-gray-400">+{offer.freeProducts.length - 6} more gifts available</p>}
          <button onClick={shop} className="btn-primary mt-5 w-full py-3 text-base">Shop Now &amp; Claim Your Gift</button>
          <p className="mt-2 text-center text-[11px] text-gray-400">Offer ends {new Date(offer.endsAt).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
