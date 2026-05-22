import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useSeasonal } from '../../context/SeasonalContext';
import { useTheme } from '../../context/ThemeContext';
import API from '../../utils/api';
import { gsap } from 'gsap';
import WhatsAppWidget from '../../components/WhatsAppWidget';
import RunningBanner from '../../components/RunningBanner';
import PopupBanner from '../../components/PopupBanner';
import FlashSaleBanner from '../../components/FlashSaleBanner';
import CouponBanner from '../../components/CouponBanner';

/* ── Snow Effect ────────────────────────────────────────────── */
const SnowEffect = () => (
  <div className="snow-container" aria-hidden>
    {Array.from({length:20},(_,i)=>({id:i,left:Math.random()*100,delay:Math.random()*8,dur:5+Math.random()*8,size:0.6+Math.random()*1})).map(f=>(
      <div key={f.id} className="snowflake" style={{left:`${f.left}%`,animationDelay:`${f.delay}s`,animationDuration:`${f.dur}s`,fontSize:`${f.size}em`}}>❄</div>
    ))}
  </div>
);

/* ── Confetti ──────────────────────────────────────────────────── */
const ConfettiEffect = () => (
  <>
    {Array.from({length:22},(_,i)=>({id:i,left:Math.random()*100,delay:Math.random()*6,dur:3+Math.random()*6,color:['#b5451b','#f0a500','#3b82f6','#10b981','#8b5cf6','#ef4444','#f59e0b','#06b6d4'][i%8],size:6+Math.random()*8})).map(p=>(
      <div key={p.id} className="confetti-piece" style={{left:`${p.left}%`,animationDelay:`${p.delay}s`,animationDuration:`${p.dur}s`,background:p.color,width:p.size,height:p.size}}/>
    ))}
  </>
);

/* ── Cart Drawer ───────────────────────────────────────────────── */
const CartDrawer = ({ settings }) => {
  const { items, removeItem, updateQuantity, subtotal, isOpen, setIsOpen } = useCart();
  const navigate = useNavigate();
  const sym = settings?.currencySymbol || 'Rs.';
  const drawerRef = useRef(null);

  useEffect(() => {
    if (!drawerRef.current) return;
    if (isOpen) gsap.fromTo(drawerRef.current, { x: '100%', opacity: 0 }, { x: '0%', opacity: 1, duration: 0.4, ease: 'power3.out' });
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <>
      <div className="cart-overlay" style={{ zIndex: 50 }} onClick={() => setIsOpen(false)}/>
      <div ref={drawerRef} className="cart-drawer">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg" style={{fontFamily:'var(--font-display)'}}>My Cart</h2>
            <p className="text-xs text-gray-400 mt-0.5">{items.reduce((s,i)=>s+i.quantity,0)} items</p>
          </div>
          <button onClick={() => setIsOpen(false)}
            className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-all text-lg">✕</button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-14">
              <div className="text-5xl mb-3 float">🛒</div>
              <p className="text-gray-400 text-sm font-medium mb-4">Your cart is empty</p>
              <button onClick={() => { setIsOpen(false); navigate('/shop'); }} className="btn-primary text-sm px-5">Browse Products</button>
            </div>
          ) : items.map(item => (
            <div key={item.cartKey || item._id} className="flex gap-3 p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors">
              <Link to={`/product/${item.slug}`} onClick={() => setIsOpen(false)} className="flex-shrink-0">
                <img src={item.thumbnail||item.images?.[0]||'https://via.placeholder.com/64'} alt={item.name} className="w-16 h-16 object-cover rounded-xl"/>
              </Link>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 line-clamp-2 leading-snug">{item.displayName || item.name}</p>
                <p className="text-xs font-bold mt-0.5" style={{color:'var(--color-primary)'}}>{sym} {((item.salePrice||item.price)*item.quantity).toLocaleString()}</p>
                <div className="flex items-center gap-2 mt-2">
                  <button className="qty-btn !w-7 !h-7 text-base" onClick={()=>updateQuantity(item.cartKey||item._id,item.quantity-1)}>−</button>
                  <span className="text-sm font-bold w-5 text-center">{item.quantity}</span>
                  <button className="qty-btn !w-7 !h-7 text-base" onClick={()=>updateQuantity(item.cartKey||item._id,item.quantity+1)}>+</button>
                  <button onClick={()=>removeItem(item.cartKey||item._id)} className="ml-auto text-gray-300 hover:text-red-400 transition-colors p-1">✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-4 border-t border-gray-100 space-y-3 flex-shrink-0 bg-white">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm font-medium">Subtotal</span>
              <span className="text-2xl font-bold" style={{fontFamily:'var(--font-display)',color:'var(--color-primary)'}}>{sym} {subtotal.toLocaleString()}</span>
            </div>
            {settings?.freeDeliveryThreshold && subtotal < settings.freeDeliveryThreshold && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-2.5 text-center">
                <p className="text-xs text-amber-700 font-medium">Add {sym} {(settings.freeDeliveryThreshold - subtotal).toLocaleString()} more for <strong>FREE delivery! 🚚</strong></p>
                <div className="w-full bg-amber-100 rounded-full h-1.5 mt-1.5">
                  <div className="h-1.5 rounded-full bg-amber-400 transition-all" style={{width:`${Math.min(100,(subtotal/settings.freeDeliveryThreshold)*100)}%`}}/>
                </div>
              </div>
            )}
            <button onClick={() => { setIsOpen(false); navigate('/checkout'); }} className="btn-primary w-full py-3.5 text-base">
              Checkout →
            </button>
            <button onClick={() => { setIsOpen(false); navigate('/cart'); }} className="btn-outline w-full py-2.5 text-sm">View Full Cart</button>
          </div>
        )}
      </div>
    </>
  );
};

/* ── Header ────────────────────────────────────────────────────── */
const Header = ({ settings, campaign }) => {
  const { user, logout } = useAuth();
  const { itemCount, setIsOpen } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenu, setUserMenu] = useState(false);
  const [categories, setCategories] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();
  const headerRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', onScroll, {passive:true});
    API.get('/categories?limit=6').then(r => setCategories(r.data || [])).catch(()=>{});
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setMenuOpen(false); setUserMenu(false); setSearchOpen(false); }, [location]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) { navigate(`/shop?search=${encodeURIComponent(searchQuery)}`); setSearchOpen(false); setSearchQuery(''); }
  };

  // Announcement: campaign > custom setting > auto free-delivery
  const announcement = (() => {
    if (campaign?.announcement && campaign?.announcementEnabled !== false) return campaign.announcement;
    if (settings?.announcementEnabled !== false && settings?.announcementText) return settings.announcementText;
    if (settings?.freeDeliveryThreshold) return `🚚 Free delivery on orders over ${settings?.currencySymbol||'Rs.'} ${(settings.freeDeliveryThreshold||5000).toLocaleString()} — Shop now!`;
    return null;
  })();
  const announcementBg = campaign?.announcementBg || settings?.announcementBg || 'var(--theme-gradient)';
  const announcementLink = settings?.announcementLink || null;

  return (
    <header ref={headerRef} className={`sticky top-0 z-[45] transition-all duration-500 ${scrolled ? 'header-scrolled' : ''}`}
      style={{background: scrolled ? undefined : 'rgba(255,255,255,0.98)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderBottom: scrolled ? undefined : '1px solid rgba(0,0,0,0.05)'}}>
      
      {/* Ticker announcement */}
      {announcement && (
        <div className="announcement-bar overflow-hidden py-1.5 text-xs font-bold text-white"
          style={{background: announcementBg}}>
          <div className="ticker-wrap">
            <div className="ticker-track">
              {[...Array(6)].map((_, i) => (
                <span key={i} className="px-8">
                  {announcementLink
                    ? <a href={announcementLink} style={{color:'inherit',textDecoration:'none'}}>{announcement}</a>
                    : announcement
                  } &nbsp;✦&nbsp;
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-14 sm:h-16 gap-2">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 flex-shrink-0 group mr-2">
            {settings?.logoUrl ? (
              <img src={settings.logoUrl} alt={settings.storeName||'ShopZen'} className="h-8 sm:h-9 object-contain max-w-[140px]"/>
            ) : (
              <>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white transition-transform group-hover:scale-110 group-hover:rotate-3"
                  style={{background:'var(--theme-gradient)',boxShadow:'0 4px 14px var(--glow-primary)'}}>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                </div>
                <span className="font-bold text-base sm:text-xl text-gray-900 hidden xs:block" style={{fontFamily:'var(--font-display)',letterSpacing:'-0.02em'}}>
                  {settings?.storeName||'ShopZen'}
                </span>
              </>
            )}
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1 justify-center">
            {[['/', 'Home'], ['/shop', 'Shop']].map(([to,label]) => (
              <Link key={to} to={to} className={`px-3 py-2 text-sm font-semibold rounded-xl transition-all ${location.pathname===to?'text-gray-900 bg-gray-100':'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}>{label}</Link>
            ))}
            {categories.slice(0,4).map(cat => (
              <Link key={cat._id} to={`/shop/${cat.slug}`} className="px-3 py-2 text-sm font-semibold text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all">{cat.name}</Link>
            ))}
            {settings?.enableGiftCards !== false && (
              <Link to="/gift-cards" className="px-3 py-2 text-sm font-semibold text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all">🎁 Gifts</Link>
            )}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-0.5 ml-auto">
            {/* Search */}
            <button onClick={()=>setSearchOpen(true)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </button>
            {/* Wishlist */}
            {user && settings?.enableWishlist !== false && (
              <Link to="/wishlist" className="hidden sm:flex p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-red-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
              </Link>
            )}
            {/* Cart */}
            <button onClick={()=>setIsOpen(true)} className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
              {itemCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 text-white text-[9px] rounded-full min-w-[16px] h-4 flex items-center justify-center font-black bounce-in px-0.5"
                  style={{background:'var(--theme-gradient)',boxShadow:'0 2px 8px var(--glow-primary)'}}>
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
              )}
            </button>
            {/* User */}
            {user ? (
              <div className="relative ml-1">
                <button onClick={()=>setUserMenu(!userMenu)}
                  className="flex items-center gap-1.5 p-1 rounded-xl hover:bg-gray-100 transition-all">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold"
                    style={{background:'var(--theme-gradient)',boxShadow:'0 2px 10px var(--glow-primary)'}}>
                    {user.firstName?.[0]?.toUpperCase()}
                  </div>
                </button>
                {userMenu && (
                  <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-[60] scale-in">
                    <div className="px-4 py-2.5 border-b border-gray-50 mb-1">
                      <p className="text-sm font-bold text-gray-900">{user.firstName} {user.lastName}</p>
                      <p className="text-xs text-gray-400 truncate">{user.email}</p>
                    </div>
                    {[['/account','👤','My Account'],['/returns','↩️','Returns'],['/gift-cards','🎁','Gift Cards'],['/wishlist','❤️','Wishlist']].map(([to,icon,label])=>(
                      <Link key={to} to={to} className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors">{icon} {label}</Link>
                    ))}
                    {user.role==='admin' && <Link to="/admin" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 border-t mt-1">⚙️ Admin Panel</Link>}
                    <button onClick={()=>{logout();navigate('/');}} className="flex items-center gap-2.5 px-4 py-2 text-sm text-red-500 hover:bg-red-50 w-full text-left border-t mt-1 transition-colors">🚪 Logout</button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" className="hidden sm:flex btn-primary text-sm py-2 px-4 ml-2">Sign In</Link>
            )}
            {/* Hamburger */}
            <button onClick={()=>setMenuOpen(!menuOpen)} className="lg:hidden p-2 rounded-xl hover:bg-gray-100 text-gray-500 ml-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={menuOpen?"M6 18L18 6M6 6l12 12":"M4 6h16M4 12h16M4 18h16"}/>
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="lg:hidden border-t border-gray-100 py-3 space-y-0.5 fade-in">
            {[['/', '🏠 Home'],['/shop','🛍️ Shop'],['/gift-cards','🎁 Gift Cards'],['/wishlist','❤️ Wishlist'],['/returns','↩️ Returns'],['/account','👤 My Account']].map(([to,label])=>(
              <Link key={to} to={to} className="flex px-3 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">{label}</Link>
            ))}
            {categories.map(cat => <Link key={cat._id} to={`/shop/${cat.slug}`} className="flex px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50 rounded-xl">{cat.name}</Link>)}
            {!user && <div className="flex gap-2 px-3 pt-2"><Link to="/login" className="btn-primary flex-1 text-center text-sm py-2.5">Sign In</Link><Link to="/register" className="btn-outline flex-1 text-center text-sm py-2.5">Register</Link></div>}
          </div>
        )}
      </div>

      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/60 z-[55] flex items-start justify-center pt-14 sm:pt-20 px-4" onClick={()=>setSearchOpen(false)}>
          <form onSubmit={handleSearch} onClick={e=>e.stopPropagation()} className="w-full max-w-xl bg-white rounded-2xl overflow-hidden shadow-2xl scale-in">
            <div className="flex items-center gap-3 p-4">
              <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input autoFocus value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search products…" className="flex-1 text-gray-800 text-base outline-none font-medium" style={{fontSize:'16px'}}/>
              <button type="button" onClick={()=>setSearchOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 flex gap-2 flex-wrap">
              {categories.slice(0,5).map(cat => (
                <button key={cat._id} type="button" onClick={()=>{navigate(`/shop/${cat.slug}`);setSearchOpen(false);}}
                  className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:border-gray-300 transition-colors">{cat.name}</button>
              ))}
            </div>
          </form>
        </div>
      )}
    </header>
  );
};

/* ── Mobile Bottom Nav ─────────────────────────────────────────── */
const MobileBottomNav = ({ settings }) => {
  const { itemCount, setIsOpen } = useCart();
  const { user } = useAuth();
  const location = useLocation();
  const primary = 'var(--color-primary)';

  const tabs = [
    { to:'/', icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>, label:'Home' },
    { to:'/shop', icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>, label:'Shop' },
    { cart:true, icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>, label:'Cart' },
    { to: settings?.enableWishlist!==false ? '/wishlist' : '/shop', icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>, label:'Wishlist' },
    { to: user?'/account':'/login', icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>, label: user?'Me':'Login' },
  ];

  return (
    <div className="mobile-bottom-nav">
      {tabs.map((tab, i) => {
        const isActive = tab.to && location.pathname === tab.to;
        if (tab.cart) return (
          <button key={i} onClick={()=>setIsOpen(true)} className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative">
            <div className="relative">
              <span style={{color:isActive?primary:'#94a3b8'}}>{tab.icon}</span>
              {itemCount > 0 && (
                <span className="absolute -top-1.5 -right-2 text-white text-[9px] rounded-full min-w-[15px] h-3.5 flex items-center justify-center font-black px-0.5"
                  style={{background:'var(--theme-gradient)'}}>
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-bold" style={{color:isActive?primary:'#94a3b8'}}>{tab.label}</span>
          </button>
        );
        return (
          <Link key={i} to={tab.to} className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5">
            <span style={{color:isActive?primary:'#94a3b8'}}>{tab.icon}</span>
            <span className="text-[10px] font-bold" style={{color:isActive?primary:'#94a3b8'}}>{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
};

/* ── Footer ────────────────────────────────────────────────────── */
const Footer = ({ settings }) => {
  const dark  = settings?.darkBgColor || '#0f172a';
  const storeName = settings?.storeName || 'ShopZen';
  const [footerPages, setFooterPages] = React.useState([]);
  React.useEffect(() => { API.get('/pages?footer=true').then(r=>setFooterPages(r.data||[])).catch(()=>{}); }, []);

  return (
    <footer style={{background:dark,color:'#94a3b8'}}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-8">
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              {settings?.logoUrl
                ? <img src={settings.logoUrl} alt={storeName} className="h-7 object-contain" style={{filter:'brightness(0) invert(1)'}}/>
                : <span className="font-bold text-white text-lg" style={{fontFamily:'var(--font-display)'}}>{storeName}</span>
              }
            </div>
            <p className="text-sm leading-relaxed mb-4" style={{color:'#64748b'}}>{settings?.storeTagline||'Premium products, delivered.'}</p>
            <div className="flex gap-2 flex-wrap">
              {[['facebookUrl','#1877f2','f'],['instagramUrl','linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)','📷'],['twitterUrl','#1da1f2','𝕏'],['whatsappNumber','#25d366','💬']].map(([key,bg,icon])=>
                settings?.[key] && (
                  <a key={key} href={key==='whatsappNumber'?`https://wa.me/${settings[key].replace(/[^0-9]/g,'')}`:`${settings[key]}`}
                    target="_blank" rel="noreferrer"
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-xs text-white hover:scale-110 transition-transform"
                    style={{background:bg}}>{icon}</a>
                )
              )}
            </div>
          </div>
          {/* Shop */}
          <div>
            <h4 className="text-white font-bold mb-3 text-xs uppercase tracking-widest">Shop</h4>
            <ul className="space-y-2">
              {[['/',  'Home'],['/shop','All Products'],['/gift-cards','🎁 Gift Cards'],['/shop?onSale=true','Sale Items']].map(([to,label])=>(
                <li key={to}><Link to={to} className="text-sm hover:text-white transition-colors">{label}</Link></li>
              ))}
            </ul>
          </div>
          {/* Info */}
          <div>
            <h4 className="text-white font-bold mb-3 text-xs uppercase tracking-widest">Info</h4>
            <ul className="space-y-2">
              {[['/account','My Account'],['/returns','Returns'],['/forgot-password','Forgot Password']].map(([to,label])=>(
                <li key={to}><Link to={to} className="text-sm hover:text-white transition-colors">{label}</Link></li>
              ))}
              {footerPages.map(p=><li key={p.slug}><Link to={`/page/${p.slug}`} className="text-sm hover:text-white transition-colors">{p.title}</Link></li>)}
            </ul>
          </div>
          {/* Contact */}
          <div>
            <h4 className="text-white font-bold mb-3 text-xs uppercase tracking-widest">Contact</h4>
            <div className="space-y-2">
              {settings?.storeAddress && <p className="text-sm">📍 {settings.storeAddress}</p>}
              {settings?.storePhone   && <a href={`tel:${settings.storePhone}`} className="block text-sm hover:text-white transition-colors">📞 {settings.storePhone}</a>}
              {settings?.storeEmail   && <a href={`mailto:${settings.storeEmail}`} className="block text-sm hover:text-white transition-colors">✉️ {settings.storeEmail}</a>}
            </div>
          </div>
        </div>

        {/* Newsletter */}
        {settings?.enableNewsletter !== false && (
          <div className="border-t border-white/8 pt-8 mb-8">
            <div className="max-w-md">
              <p className="text-white font-bold mb-1 text-sm">📬 Stay Updated</p>
              <p className="text-xs mb-3" style={{color:'#64748b'}}>Exclusive deals and new arrivals straight to your inbox</p>
              <div className="flex gap-2">
                <input type="email" id="footer-nl" placeholder="your@email.com" className="flex-1 bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:border-white/30 transition-colors" style={{fontSize:'16px'}}/>
                <button onClick={()=>{const e=document.getElementById('footer-nl').value;if(e){fetch('/api/subscribers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e})}).then(()=>{document.getElementById('footer-nl').value='';alert('Subscribed 🎉');});}}}
                  className="flex-shrink-0 px-4 py-2 rounded-xl text-white text-sm font-bold transition-all hover:opacity-90" style={{background:'var(--theme-gradient)'}}>
                  Subscribe
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="border-t pt-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs" style={{borderColor:'rgba(255,255,255,0.06)',color:'#475569'}}>
          <p>© {new Date().getFullYear()} {storeName}. All rights reserved.</p>
          <div className="flex gap-4">
            {footerPages.filter(p=>['terms','privacy'].includes(p.slug)).map(p=>(
              <Link key={p.slug} to={`/page/${p.slug}`} className="hover:text-white transition-colors">{p.title}</Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};

/* ── Main Layout ───────────────────────────────────────────────── */
export default function CustomerLayout() {
  const { campaign } = useSeasonal();
  const { settings }  = useTheme();

  // Inject Google Search Console verification meta tag dynamically
  React.useEffect(() => {
    if (settings?.googleSearchConsole) {
      let el = document.querySelector('meta[name="google-site-verification"]');
      if (!el) {
        el = document.createElement('meta');
        el.name = 'google-site-verification';
        document.head.appendChild(el);
      }
      el.content = settings.googleSearchConsole;
    }
  }, [settings?.googleSearchConsole]);

  return (
    <div className="min-h-screen flex flex-col" style={{background:'var(--body-bg)',fontFamily:'var(--font-body)'}}>
      {campaign?.theme?.snowEffect     && <SnowEffect/>}
      {campaign?.theme?.confettiEffect && <ConfettiEffect/>}
      <RunningBanner />
      <FlashSaleBanner />
      <Header settings={settings} campaign={campaign}/>
      <CartDrawer settings={settings}/>
      <main className="flex-1 has-mobile-nav"><Outlet/></main>
      <Footer settings={settings}/>
      <MobileBottomNav settings={settings}/>
      <WhatsAppWidget />
      <PopupBanner />
      <CouponBanner />
    </div>
  );
}
