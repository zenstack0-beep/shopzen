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
    let waitingForRelease = null;
    API.get('/offers/active').then(({ data }) => {
      const active = (data || [])[0];
      if (!active) return;
      sessionStorage.setItem('sz_free_gift_campaign_available', '1');
      if (sessionStorage.getItem(`free_gift_offer_${active._id}`)) return;
      setOffer(active);
      // Give the storefront time to render before presenting the campaign.
      const showWhenAvailable = () => {
        if (window.__shopzenPopupBusy) {
          waitingForRelease = showWhenAvailable;
          window.addEventListener('shopzen:popup-released', waitingForRelease, { once:true });
          return;
        }
        window.__shopzenPopupBusy = `free-gift:${active._id}`;
        setVisible(true);
        sessionStorage.setItem(`free_gift_offer_${active._id}`, '1');
      };
      timer = setTimeout(showWhenAvailable, Math.min(300, Math.max(0, Number(active.popupDelaySeconds ?? 1))) * 1000);
    }).catch(() => {});
    return () => { clearTimeout(timer); if (waitingForRelease) window.removeEventListener('shopzen:popup-released', waitingForRelease); };
  }, []);

  if (!visible || !offer) return null;
  const close = () => {
    setVisible(false);
    if (window.__shopzenPopupBusy === `free-gift:${offer._id}`) window.__shopzenPopupBusy = null;
    setTimeout(() => window.dispatchEvent(new Event('shopzen:popup-released')), 300);
  };
  const shop = () => { close(); navigate('/shop'); };
  const levels = offer.tiers?.length
    ? offer.tiers
    : [{ minimumAmount: offer.minimumAmount, freeItemCount: offer.freeItemCount, freeProducts: offer.freeProducts || [] }];
  const totalProducts = new Set(levels.flatMap(level => (level.freeProducts || []).map(product => product._id))).size;
  const levelGrid = levels.length === 1
    ? 'grid-cols-1 max-w-xl mx-auto'
    : levels.length === 2
      ? 'grid-cols-2 max-w-3xl mx-auto'
      : levels.length === 3
        ? 'grid-cols-2 lg:grid-cols-3'
        : 'grid-cols-2 lg:grid-cols-4';

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-2 sm:p-4" onClick={close} style={{ background:'rgba(15,23,42,.72)', backdropFilter:'blur(7px)' }}>
      <style>{`
        @keyframes giftPopupIn { from { opacity:0; transform:translateY(24px) scale(.92) } to { opacity:1; transform:none } }
        .gift-popup-card { animation:giftPopupIn .4s cubic-bezier(.2,.8,.2,1); }
      `}</style>
      <div className="gift-popup-card relative w-full max-w-5xl max-h-[97vh] overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="relative px-4 pt-4 pb-3 sm:px-5 sm:pt-5 sm:pb-4 text-center text-white" style={{ background:'var(--theme-gradient)' }}>
          <button onClick={close} aria-label="Close offer" className="absolute right-2 top-2 sm:right-3 sm:top-3 flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-black/20 text-xl text-white hover:bg-black/30">×</button>
          <div className="mx-auto mb-1 flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-white/20 text-2xl">🎁</div>
          <p className="text-[9px] sm:text-xs font-black uppercase tracking-[.2em] text-white/80">Limited-time free gift</p>
          <h2 className="mt-1 text-lg sm:text-2xl font-black" style={{ fontFamily:'var(--font-display)' }}>{offer.title}</h2>
          <p className="mx-auto mt-1 max-w-2xl text-xs sm:text-sm text-white/90">{offer.description || 'Spend more on qualifying products to unlock more free gift choices.'}</p>
        </div>

        <div className="p-2.5 sm:p-4">
          <p className="mb-2 text-center text-[11px] sm:text-sm font-bold text-gray-800">{levels.length} price level{levels.length === 1 ? '' : 's'} · {totalProducts} free gift choice{totalProducts === 1 ? '' : 's'}</p>
          <div className={`grid gap-2 sm:gap-3 ${levelGrid}`}>
            {levels.map((level, levelIndex) => (
              <div key={level._id || levelIndex} className="min-w-0 rounded-xl sm:rounded-2xl border border-purple-100 bg-purple-50/50 p-1.5 sm:p-3">
                <div className="mb-1.5 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-0.5 sm:gap-1"><strong className="text-[10px] sm:text-sm text-purple-800">{symbol} {Number(level.minimumAmount).toLocaleString()}+</strong><span className="self-start rounded-full bg-green-100 px-1.5 py-0.5 sm:px-2 sm:py-1 text-[8px] sm:text-[11px] font-bold text-green-700">CHOOSE {level.freeItemCount}</span></div>
                <div className={`grid gap-1 sm:gap-2 ${(level.freeProducts || []).length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {(level.freeProducts || []).map(product => {
                    const price = product.salePrice > 0 && product.salePrice < product.price ? product.salePrice : product.price;
                    return <div key={product._id} className="min-w-0 overflow-hidden rounded-lg sm:rounded-xl border border-gray-100 bg-white p-1 text-center"><img src={product.thumbnail || product.images?.[0]} alt={product.name} className="mx-auto h-10 sm:h-16 w-full rounded-md object-contain bg-white"/><p className="mt-0.5 line-clamp-2 text-[8px] sm:text-[10px] font-bold leading-tight text-gray-800">{product.name}</p><p className="mt-0.5 text-[8px] sm:text-[10px] whitespace-nowrap"><span className="text-gray-400 line-through">{symbol} {Number(price).toLocaleString()}</span> <strong className="text-green-600">FREE</strong></p></div>;
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 sm:mt-3 flex items-center gap-2"><button onClick={shop} className="btn-primary flex-1 py-2 sm:py-2.5 text-xs sm:text-sm">Shop Now &amp; Claim Your Gift</button><p className="hidden sm:block text-[10px] text-gray-400 whitespace-nowrap">Ends {new Date(offer.endsAt).toLocaleDateString()}</p></div>
        </div>
      </div>
    </div>
  );
}
