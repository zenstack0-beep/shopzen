import React, { useState, useEffect, useRef } from 'react';
import useSEO from '../../hooks/useSEO';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useSeasonal } from '../../context/SeasonalContext';
import API from '../../utils/api';
import toast from 'react-hot-toast';

const COUNTRIES = ['Sri Lanka','Australia','Bangladesh','Canada','China','France','Germany','India','Indonesia','Italy','Japan','Malaysia','Maldives','Nepal','Netherlands','Pakistan','Philippines','Saudi Arabia','Singapore','South Korea','Spain','Thailand','UAE','United Kingdom','United States','Vietnam','Other'];
const SL_CITIES = ['Colombo 1','Colombo 2','Colombo 3','Colombo 4','Colombo 5','Colombo 6','Colombo 7','Colombo 8','Colombo 9','Colombo 10','Akarawitia','Angoda','Athurugiriya','Attidiya','Avissawella','Battaramulla','Boralesgamuwa','Dehiwala','Homagama','Kaduwela','Kesbewa','Kottawa','Kotte','Maharagama','Malabe','Moratuwa','Mount Lavinia','Nugegoda','Pannipitiya','Piliyandala','Rajagiriya','Ratmalana','Sri Jayawardenepura Kotte','Wattala','Wellampitiya','Gampaha','Kalutara','Kandy','Matale','Nuwara Eliya','Galle','Matara','Hambantota','Jaffna','Trincomalee','Batticaloa','Kurunegala','Anuradhapura','Polonnaruwa','Badulla','Ratnapura','Kegalle','Other'];

// PayHere form submitter
const PayHereForm = ({ data, onCancel }) => {
  const formRef = useRef();
  useEffect(() => { if (formRef.current) formRef.current.submit(); }, []);
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
        <div className="text-4xl mb-3 float">💳</div>
        <h3 className="font-bold text-gray-900 text-lg mb-2">Redirecting to PayHere</h3>
        <p className="text-gray-500 text-sm mb-4">Please wait, redirecting to secure payment...</p>
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
        <form ref={formRef} method="POST" action={data.checkoutUrl}>
          {Object.entries(data).filter(([k]) => k !== 'checkoutUrl').map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        </form>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600 underline">Cancel</button>
      </div>
    </div>
  );
};

// Field component defined OUTSIDE Checkout so it never remounts on re-render
// (defining it inside would cause focus loss on every keystroke)
const F = ({ label, value, onChange, type='text', required, placeholder, col2 }) => (
  <div className={col2 ? 'sm:col-span-2' : ''}>
    <label className="form-label">{label} {required && <span className="text-red-500">*</span>}</label>
    <input type={type} value={value} onChange={onChange} required={required} placeholder={placeholder} className="form-input" />
  </div>
);

export default function Checkout() {
  const { items, subtotal, clearCart } = useCart();
  useSEO({ title: 'Checkout', noindex: true });
  const { user } = useAuth();
  const { settings } = useTheme();
  const { campaign } = useSeasonal();
  const navigate = useNavigate();

  const sym = settings?.currencySymbol || 'Rs.';

  const [loading, setLoading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponData, setCouponData] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardData, setGiftCardData] = useState(null);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [shipDiff, setShipDiff] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [notes, setNotes] = useState('');
  const [gateways, setGateways] = useState([]);
  const [deliveryServices, setDeliveryServices] = useState([]);
  const [selectedDelivery, setSelectedDelivery] = useState('');
  const [payHereData, setPayHereData] = useState(null);

  const [billing, setBilling] = useState({
    firstName: user?.firstName || '', lastName: user?.lastName || '',
    country: 'Sri Lanka', street: '', city: '',
    phone: user?.phone || '', email: user?.email || '',
  });
  const [shipping, setShipping] = useState({
    firstName: '', lastName: '', country: 'Sri Lanka', street: '', city: '', phone: ''
  });

  useEffect(() => { if (items.length === 0) navigate('/cart'); }, [items, navigate]);

  // Load payment gateways and delivery services
  useEffect(() => {
    API.get('/payments/gateways').then(r => {
      setGateways(r.data || []);
    }).catch(() => {});

    API.get('/delivery').then(r => {
      const svcs = (r.data?.services || r.data || []);
      setDeliveryServices(svcs);
      if (svcs.length > 0) setSelectedDelivery(svcs[0].code);
    }).catch(() => {});
  }, []);

  // Set default payment method once gateways load
  useEffect(() => {
    if (paymentMethod) return; // already set
    if (settings?.bankTransferEnabled !== false) { setPaymentMethod('bank_transfer'); return; }
    if (settings?.codEnabled !== false) { setPaymentMethod('cod'); return; }
    if (gateways.length > 0) setPaymentMethod(gateways[0].gateway);
  }, [settings, gateways, paymentMethod]);

  // Pre-fill coupon from seasonal campaign
  useEffect(() => {
    if (campaign?.couponCode && !couponCode) setCouponCode(campaign.couponCode);
  }, [campaign, couponCode]);

  // Calculate delivery fee from selected service (zone-aware)
  const selectedDeliveryService = deliveryServices.find(s => s.code === selectedDelivery);
  const getDeliveryRate = (svc) => {
    if (!svc) return null;
    const city = (billing?.city || '').toLowerCase();
    if (city && svc.zoneRates?.length > 0) {
      const zr = svc.zoneRates.find(z => z.zones?.some(a => a.toLowerCase() === city || city.includes(a.toLowerCase())));
      if (zr) return zr;
    }
    return svc.rates?.[0] || null;
  };
  const deliveryRate = getDeliveryRate(selectedDeliveryService);
  const deliveryFee = deliveryRate
    ? (deliveryRate.freeAbove && subtotal >= deliveryRate.freeAbove ? 0 : deliveryRate.price)
    : (subtotal >= (settings?.freeDeliveryThreshold || 5000) ? 0 : (settings?.standardDelivery || 600));

  const couponDiscount = couponData?.discount || 0;
  const giftCardDiscount = giftCardData ? Math.min(giftCardData.balance, subtotal - couponDiscount + deliveryFee) : 0;
  const total = Math.max(0, subtotal - couponDiscount - giftCardDiscount + deliveryFee);

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    try {
      const { data } = await API.post('/coupons/validate', { code: couponCode.toUpperCase(), orderAmount: subtotal });
      setCouponData(data);
      toast.success(`✅ Coupon applied! ${sym} ${data.discount.toLocaleString()} discount`);
    } catch (err) { toast.error(err.response?.data?.message || 'Invalid coupon'); setCouponData(null); }
    finally { setCouponLoading(false); }
  };

  const applyGiftCard = async () => {
    if (!giftCardCode.trim()) return;
    setGiftCardLoading(true);
    try {
      const { data } = await API.post('/gift-cards/validate', { code: giftCardCode.toUpperCase() });
      setGiftCardData(data);
      toast.success(`🎁 Gift card applied! Balance: ${sym} ${data.balance.toLocaleString()}`);
    } catch (err) { toast.error(err.response?.data?.message || 'Invalid gift card'); setGiftCardData(null); }
    finally { setGiftCardLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!agreedTerms) { toast.error('Please agree to terms and conditions'); return; }
    if (!paymentMethod) { toast.error('Please select a payment method'); return; }
    setLoading(true);
    try {
      const orderData = {
        items: items.map(i => ({ productId: i._id, name: i.name, quantity: i.quantity })),
        billing, shipping: shipDiff ? shipping : billing,
        shipToDifferentAddress: shipDiff,
        paymentMethod,
        couponCode: couponData ? couponCode : undefined,
        giftCard: giftCardData ? giftCardCode : undefined,
        notes,
        deliveryService: selectedDelivery || undefined,
      };

      const { data } = await API.post('/orders', orderData);

      // Handle gateway payments
      if (paymentMethod === 'payhere') {
        const phData = await API.post('/payments/payhere/init', {
          orderId: data.orderId,
          amount: data.total,
          currency: settings?.currency || 'LKR',
          customerName: `${billing.firstName} ${billing.lastName}`,
          email: billing.email,
          phone: billing.phone,
          address: billing.street,
          city: billing.city,
          country: billing.country,
        });
        clearCart();
        setPayHereData(phData.data);
        setLoading(false);
        return;
      }

      if (paymentMethod === 'stripe') {
        clearCart();
        navigate(`/order-success/${data.orderId}?gateway=stripe&total=${data.total}`);
        return;
      }

      clearCart();
      navigate(`/order-success/${data.orderId}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Order failed. Please try again.');
    } finally { setLoading(false); }
  };

  const hasAnyPayment = settings?.bankTransferEnabled !== false || settings?.codEnabled !== false || gateways.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8" style={{ background: 'var(--body-bg)' }}>
      {payHereData && <PayHereForm data={payHereData} onCancel={() => setPayHereData(null)} />}

      <nav className="text-sm text-gray-500 flex items-center gap-2 mb-2">
        <Link to="/" style={{ color: 'var(--color-primary)' }}>Home</Link><span>/</span>
        <Link to="/cart" style={{ color: 'var(--color-primary)' }}>Cart</Link><span>/</span>
        <span className="text-gray-800 font-medium">Checkout</span>
      </nav>
      <h1 className="text-3xl font-bold text-gray-900 mb-6" style={{ fontFamily: 'var(--font-display)' }}>Checkout</h1>

      {/* Seasonal coupon banner */}
      {campaign?.couponCode && (
        <div className="rounded-xl p-3 mb-6 flex items-center gap-3 text-white text-sm" style={{ background: 'var(--theme-gradient)' }}>
          <span className="text-lg">🎉</span>
          <span><strong>{campaign.name}</strong> — Use code <strong className="font-mono bg-white/20 px-1.5 rounded">{campaign.couponCode}</strong> for {campaign.discountPercent > 0 ? `${campaign.discountPercent}% off` : 'a discount'}!</span>
          <button type="button" onClick={() => applyCoupon()} className="ml-auto bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-semibold">Apply</button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid lg:grid-cols-3 gap-8">
          {/* LEFT — Billing */}
          <div className="lg:col-span-2 space-y-5">
            <div className="rounded-2xl border border-gray-100 p-6" style={{ background: 'var(--card-bg)' }}>
              <h2 className="text-xl font-bold text-gray-900 mb-5" style={{ fontFamily: 'var(--font-display)' }}>Billing Details</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <F label="First name" value={billing.firstName} onChange={e=>setBilling(p=>({...p,firstName:e.target.value}))} required />
                <F label="Last name" value={billing.lastName} onChange={e=>setBilling(p=>({...p,lastName:e.target.value}))} required />
                <div className="sm:col-span-2">
                  <label className="form-label">Country <span className="text-red-500">*</span></label>
                  <select value={billing.country} onChange={e=>setBilling(p=>({...p,country:e.target.value,city:''}))} required className="form-input">
                    {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label">Street address <span className="text-red-500">*</span></label>
                  <input value={billing.street} onChange={e=>setBilling(p=>({...p,street:e.target.value}))} required className="form-input" placeholder="House number and street name" />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label">Town / City <span className="text-red-500">*</span></label>
                  {billing.country === 'Sri Lanka' ? (
                    <select value={billing.city} onChange={e=>setBilling(p=>({...p,city:e.target.value}))} required className="form-input">
                      <option value="">Select city…</option>
                      {SL_CITIES.map(d => <option key={d}>{d}</option>)}
                    </select>
                  ) : (
                    <input value={billing.city} onChange={e=>setBilling(p=>({...p,city:e.target.value}))} required className="form-input" placeholder="Your city" />
                  )}
                </div>
                <div>
                  <label className="form-label">Phone <span className="text-red-500">*</span></label>
                  <input type="tel" value={billing.phone} onChange={e=>setBilling(p=>({...p,phone:e.target.value}))} required className="form-input" placeholder="+94 7X XXX XXXX" />
                </div>
                <F label="Email" type="email" value={billing.email} onChange={e=>setBilling(p=>({...p,email:e.target.value}))} required />

              </div>
            </div>

            {/* Ship to different address */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={shipDiff} onChange={e=>setShipDiff(e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: 'var(--color-primary)' }} />
                <span className="font-semibold text-gray-800 text-sm">Ship to a different address?</span>
              </label>
              {shipDiff && (
                <div className="grid sm:grid-cols-2 gap-4 mt-5 pt-5 border-t border-gray-100">
                  <F label="First name" value={shipping.firstName} onChange={e=>setShipping(p=>({...p,firstName:e.target.value}))} required />
                  <F label="Last name" value={shipping.lastName} onChange={e=>setShipping(p=>({...p,lastName:e.target.value}))} required />
                  <div className="sm:col-span-2">
                    <label className="form-label">Country</label>
                    <select value={shipping.country} onChange={e=>setShipping(p=>({...p,country:e.target.value}))} className="form-input">
                      {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2"><label className="form-label">Street address</label><input value={shipping.street} onChange={e=>setShipping(p=>({...p,street:e.target.value}))} required className="form-input"/></div>
                  <div className="sm:col-span-2"><label className="form-label">City</label><input value={shipping.city} onChange={e=>setShipping(p=>({...p,city:e.target.value}))} required className="form-input"/></div>
                  <div><label className="form-label">Phone</label><input type="tel" value={shipping.phone} onChange={e=>setShipping(p=>({...p,phone:e.target.value}))} className="form-input"/></div>
                </div>
              )}
            </div>

            {/* Order Notes */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <label className="form-label">Order notes (optional)</label>
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="Special delivery instructions…" className="form-input resize-none" />
            </div>
          </div>

          {/* RIGHT — Order Summary + Payment */}
          <div className="space-y-4">
            {/* Order Items */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <h2 className="text-lg font-bold text-gray-900 mb-4" style={{ fontFamily: 'var(--font-display)' }}>Your Order</h2>
              <div className="space-y-3 mb-4 pb-4 border-b border-gray-100">
                {items.map(item => (
                  <div key={item._id} className="flex items-center gap-3">
                    <img src={item.thumbnail || item.images?.[0] || 'https://via.placeholder.com/48'} alt={item.name} className="w-11 h-11 rounded-lg object-cover bg-gray-50 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">× {item.quantity}</p>
                    </div>
                    <p className="text-sm font-bold text-gray-900">{sym} {((item.salePrice || item.price) * item.quantity).toLocaleString()}</p>
                  </div>
                ))}
              </div>

              {/* Price breakdown */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-semibold">{sym} {subtotal.toLocaleString()}</span>
                </div>
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span className="flex items-center gap-1">
                      🏷️ Coupon
                      <button type="button" onClick={() => { setCouponData(null); setCouponCode(''); }} className="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>
                    </span>
                    <span>−{sym} {couponDiscount.toLocaleString()}</span>
                  </div>
                )}
                {giftCardDiscount > 0 && (
                  <div className="flex justify-between text-purple-600">
                    <span className="flex items-center gap-1">
                      🎁 Gift Card
                      <button type="button" onClick={() => { setGiftCardData(null); setGiftCardCode(''); }} className="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>
                    </span>
                    <span>−{sym} {giftCardDiscount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Delivery</span>
                  <span className={deliveryFee === 0 ? 'text-green-600 font-semibold' : ''}>
                    {deliveryFee === 0 ? 'FREE 🎉' : `${sym} ${deliveryFee.toLocaleString()}`}
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold text-gray-900 pt-3 border-t border-gray-100">
                  <span>Total</span>
                  <span style={{ color: 'var(--color-primary)' }}>{sym} {total.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Delivery Service Selection */}
            {deliveryServices.length > 0 && (
              <div className="rounded-2xl border border-gray-100 p-4" style={{ background: 'var(--card-bg)' }}>
                <h3 className="font-semibold text-gray-800 mb-3 text-sm">🚚 Delivery Method</h3>
                <div className="space-y-2">
                  {deliveryServices.map(svc => {
                    const city = billing?.city || '';
                    let rate = null;
                    if (city && svc.zoneRates?.length > 0) {
                      const cl = city.toLowerCase();
                      rate = svc.zoneRates.find(zr => zr.zones?.some(z => z.toLowerCase() === cl || cl.includes(z.toLowerCase())));
                    }
                    if (!rate) rate = svc.rates?.[0];
                    const freeAbove = rate?.freeAbove || svc.freeShippingThreshold || 0;
                    const cost = rate ? (freeAbove && subtotal >= freeAbove ? 0 : rate.price) : 0;
                    const eta = rate?.estimatedDays || svc.estimatedDays || '';
                    return (
                      <label key={svc.code} className={`flex items-start justify-between gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedDelivery === svc.code ? 'bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}
                        style={selectedDelivery === svc.code ? { borderColor: 'var(--color-primary)' } : {}}>
                        <div className="flex items-start gap-2">
                          <input type="radio" name="delivery" value={svc.code} checked={selectedDelivery === svc.code} onChange={() => setSelectedDelivery(svc.code)} style={{ accentColor: 'var(--color-primary)', marginTop: '2px' }} />
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{svc.name}</p>
                            {eta && <p className="text-xs text-gray-500">🕐 {eta}</p>}
                            {svc.coverageAreas && <p className="text-xs text-gray-400">{svc.coverageAreas}</p>}
                            {freeAbove > 0 && subtotal < freeAbove && (
                              <p className="text-xs text-primary font-medium mt-0.5">
                                Add {sym} {(freeAbove - subtotal).toLocaleString()} more for free delivery
                              </p>
                            )}
                            {svc.deliveryNote && <p className="text-xs text-amber-600 mt-0.5">ℹ️ {svc.deliveryNote}</p>}
                          </div>
                        </div>
                        <span className={`text-sm font-bold flex-shrink-0 ${cost === 0 ? 'text-green-600' : 'text-gray-800'}`}>
                          {cost === 0 ? 'FREE 🎉' : `${sym} ${cost.toLocaleString()}`}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Coupon */}
            <div className="rounded-2xl border border-gray-100 p-4" style={{ background: 'var(--card-bg)' }}>
              <h3 className="font-semibold text-gray-800 mb-2 text-sm">🏷️ Coupon Code</h3>
              {couponData ? (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                  <span className="text-sm text-green-700 font-semibold">✓ {couponCode} — −{sym} {couponDiscount.toLocaleString()}</span>
                  <button type="button" onClick={() => { setCouponData(null); setCouponCode(''); }} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input value={couponCode} onChange={e=>setCouponCode(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&(e.preventDefault(),applyCoupon())} placeholder="Enter code" className="form-input text-sm flex-1 font-mono uppercase" />
                  <button type="button" onClick={applyCoupon} disabled={couponLoading} className="btn-outline text-sm py-2 px-3 flex-shrink-0">{couponLoading?'...':'Apply'}</button>
                </div>
              )}
              {campaign?.couponCode && !couponData && (
                <p className="text-xs mt-1.5" style={{ color: 'var(--color-primary)' }}>🎉 Try <strong className="font-mono">{campaign.couponCode}</strong></p>
              )}
            </div>

            {/* Gift Card */}
            <div className="rounded-2xl border border-gray-100 p-4" style={{ background: 'var(--card-bg)' }}>
              <h3 className="font-semibold text-gray-800 mb-2 text-sm">🎁 Gift Card</h3>
              {giftCardData ? (
                <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                  <span className="text-sm text-purple-700 font-semibold">✓ Balance: {sym} {giftCardData.balance.toLocaleString()}</span>
                  <button type="button" onClick={() => { setGiftCardData(null); setGiftCardCode(''); }} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input value={giftCardCode} onChange={e=>setGiftCardCode(e.target.value.toUpperCase())} placeholder="Gift card code" className="form-input text-sm flex-1 font-mono uppercase" />
                  <button type="button" onClick={applyGiftCard} disabled={giftCardLoading} className="btn-outline text-sm py-2 px-3 flex-shrink-0">{giftCardLoading?'...':'Apply'}</button>
                </div>
              )}
            </div>

            {/* Payment Method */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">💳 Payment Method</h3>
              {!hasAnyPayment && (
                <p className="text-sm text-amber-600 bg-amber-50 rounded-xl p-3">No payment methods configured. Please contact the store admin.</p>
              )}
              <div className="space-y-3">
                {/* Bank Transfer */}
                {settings?.bankTransferEnabled !== false && (
                  <div className={`pay-method-card ${paymentMethod==='bank_transfer'?'selected':''}`}
                    onClick={()=>setPaymentMethod('bank_transfer')}>
                    <div className="pay-method-radio"/>
                    <div className="pay-method-icon">🏦</div>
                    <div>
                      <div className="pay-method-label">Direct Bank Transfer</div>
                      <div className="pay-method-desc">Transfer & send us proof of payment</div>
                    </div>
                  </div>
                )}
                {paymentMethod==='bank_transfer' && (
                  <div className="ml-4 bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-1.5 text-xs">
                    <p className="text-gray-500 mb-2 font-semibold">Transfer using your order number as reference:</p>
                    {settings?.bankName && <p><span className="text-gray-400 w-24 inline-block">Bank:</span><span className="font-bold text-gray-700">{settings.bankName}</span></p>}
                    {settings?.bankAccountName && <p><span className="text-gray-400 w-24 inline-block">Account:</span><span className="font-bold text-gray-700">{settings.bankAccountName}</span></p>}
                    {settings?.bankAccountNumber && <p><span className="text-gray-400 w-24 inline-block">Number:</span><span className="font-mono font-black text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-200">{settings.bankAccountNumber}</span></p>}
                    {settings?.bankBranch && <p><span className="text-gray-400 w-24 inline-block">Branch:</span><span className="font-bold text-gray-700">{settings.bankBranch}</span></p>}
                  </div>
                )}

                {/* Cash on Delivery */}
                {settings?.codEnabled !== false && (
                  <div className={`pay-method-card ${paymentMethod==='cod'?'selected':''}`}
                    onClick={()=>setPaymentMethod('cod')}>
                    <div className="pay-method-radio"/>
                    <div className="pay-method-icon">💵</div>
                    <div>
                      <div className="pay-method-label">Cash on Delivery</div>
                      <div className="pay-method-desc">Pay when your order arrives</div>
                    </div>
                  </div>
                )}

                {/* Online Payment Gateways */}
                {gateways.map(gw => (
                  <div key={gw.gateway} className={`pay-method-card ${paymentMethod===gw.gateway?'selected':''}`}
                    onClick={()=>setPaymentMethod(gw.gateway)}>
                    <div className="pay-method-radio"/>
                    <div className="pay-method-icon">
                      {gw.logo ? <img src={gw.logo} alt={gw.displayName} style={{height:24,objectFit:'contain'}}/> : '🔌'}
                    </div>
                    <div>
                      <div className="pay-method-label flex items-center gap-2">
                        {gw.displayName}
                        {!gw.isLive && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">Sandbox</span>}
                      </div>
                      <div className="pay-method-desc">
                        {gw.gateway==='payhere'&&'Redirected to PayHere secure checkout'}
                        {gw.gateway==='stripe'&&'Pay securely with your card via Stripe'}
                        {gw.gateway==='paypal'&&'Pay via your PayPal account'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Terms & Submit */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <label className="flex items-start gap-2 cursor-pointer mb-4">
                <input type="checkbox" checked={agreedTerms} onChange={e=>setAgreedTerms(e.target.checked)} className="mt-0.5 w-4 h-4 rounded flex-shrink-0" style={{accentColor:'var(--color-primary)'}}/>
                <span className="text-sm text-gray-600">I agree to the <span className="underline cursor-pointer" style={{color:'var(--color-primary)'}}>terms and conditions</span> <span className="text-red-500">*</span></span>
              </label>
              <button type="submit" disabled={loading || !agreedTerms || !paymentMethod}
                className="btn-primary w-full py-3.5 text-base flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                {loading ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Placing Order...</>
                ) : (
                  <>Place Order — {sym} {total.toLocaleString()}{['payhere','stripe','paypal'].includes(paymentMethod) ? ' →' : ''}</>
                )}
              </button>
              {['payhere','stripe','paypal'].includes(paymentMethod) && (
                <p className="text-xs text-gray-400 text-center mt-2 flex items-center justify-center gap-1">
                  🔒 Secure payment via {gateways.find(g=>g.gateway===paymentMethod)?.displayName}
                </p>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}