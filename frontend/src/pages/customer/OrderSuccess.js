import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import API from '../../utils/api';
import { useTheme } from '../../context/ThemeContext';
import useSEO, { trackPurchase } from '../../hooks/useSEO';

export function OrderSuccess() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { settings } = useTheme();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const sym = settings?.currencySymbol || 'Rs.';
  const gateway = searchParams.get('gateway');

  useSEO({ title: 'Order Confirmed', noindex: true });

  useEffect(() => {
    let attempts = 0;
    const fetchOrder = async () => {
      try {
        const { data } = await API.get(`/orders/${id}`);
        setOrder(data);
        setLoading(false);
        if (data && data.paymentStatus !== 'failed') {
          trackPurchase(data, data.items || []);
        }
        if (gateway && data.paymentStatus === 'pending' && attempts === 0) {
          attempts++;
        }
      } catch { setLoading(false); }
    };
    fetchOrder();
  }, [id, gateway]);

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-4" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}/>
        <p className="text-gray-500">Loading your order...</p>
      </div>
    </div>
  );

  const isPaid         = order?.paymentStatus === 'paid';
  const isBankTransfer = order?.paymentMethod === 'bank_transfer';
  const isCOD          = order?.paymentMethod === 'cod';
  const isGateway      = ['payhere','stripe','paypal'].includes(order?.paymentMethod);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16" style={{ background: 'var(--body-bg)' }}>
      <div className="w-full max-w-lg fade-in">

        {/* Success Icon */}
        <div className="text-center mb-6">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 bounce-in ${isPaid ? 'bg-green-100' : 'bg-amber-100'}`}>
            {isPaid ? (
              <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
              </svg>
            ) : (
              <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            )}
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            {isPaid ? 'Payment Confirmed! 🎉' : 'Order Placed!'}
          </h1>
          {order && (
            <p className="text-gray-500 mt-1">
              Order: <span className="font-mono font-bold text-lg" style={{ color: 'var(--color-primary)' }}>{order.orderNumber}</span>
            </p>
          )}
          <p className="text-gray-400 text-sm mt-1">Thank you! We'll send a confirmation to {order?.billing?.email}</p>
        </div>

        {/* Gateway confirmed */}
        {isGateway && isPaid && (
          <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-5 mb-4">
            <h3 className="font-bold text-green-800 mb-1 flex items-center gap-2">✅ Payment Successful</h3>
            <p className="text-sm text-green-700">Your payment was received and your order is now confirmed. We'll start processing it right away!</p>
            {order?.paymentReference && <p className="text-xs text-green-600 mt-1 font-mono">Ref: {order.paymentReference}</p>}
          </div>
        )}

        {/* Gateway pending */}
        {isGateway && !isPaid && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5 mb-4">
            <h3 className="font-bold text-amber-800 mb-1">⏳ Awaiting Payment Confirmation</h3>
            <p className="text-sm text-amber-700">Your order has been placed. Once payment is confirmed it will be processed automatically.</p>
          </div>
        )}

        {/* Bank Transfer */}
        {isBankTransfer && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5 mb-4">
            <h3 className="font-bold text-amber-800 mb-3 flex items-center gap-2 text-base">🏦 Bank Transfer Instructions</h3>
            <p className="text-sm text-amber-700 mb-4">
              Transfer <strong>{sym} {order.total?.toLocaleString()}</strong> using{' '}
              <span className="font-mono font-bold bg-amber-100 px-1.5 py-0.5 rounded">{order.orderNumber}</span> as reference.
            </p>
            <div className="bg-white rounded-xl p-4 space-y-2.5 border border-amber-100">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Bank Account Details</p>
              {[
                ['Bank',           settings?.bankName],
                ['Account Name',   settings?.bankAccountName],
                ['Account Number', settings?.bankAccountNumber],
                ['Branch',         settings?.bankBranch],
              ].filter(([,v]) => v).map(([label, value]) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">{label}</span>
                  <span className={`text-sm font-bold text-gray-900 ${label==='Account Number'?'font-mono bg-gray-50 px-2 py-0.5 rounded border border-gray-200':''}`}>{value}</span>
                </div>
              ))}
              <div className="flex justify-between items-center border-t border-gray-100 pt-2">
                <span className="text-sm text-gray-500">Amount</span>
                <span className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>{sym} {order.total?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Reference</span>
                <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">{order.orderNumber}</span>
              </div>
            </div>
            <p className="text-xs text-amber-600 mt-3">⚠️ Your order will be processed after payment confirmation.</p>
          </div>
        )}

        {/* COD */}
        {isCOD && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 mb-4">
            <p className="font-bold text-green-800 mb-1">💵 Cash on Delivery</p>
            <p className="text-sm text-green-700">Please have <strong>{sym} {order.total?.toLocaleString()}</strong> ready when your order arrives.</p>
          </div>
        )}

        {/* Order Summary */}
        {order && (
          <div className="rounded-2xl border border-gray-100 p-5 mb-4" style={{ background: 'var(--card-bg)' }}>
            <h3 className="font-semibold text-gray-800 mb-3 text-sm">Order Summary</h3>
            <div className="space-y-2 mb-3">
              {order.items?.slice(0,4).map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <img src={item.image || 'https://via.placeholder.com/40'} alt={item.name} className="w-10 h-10 rounded-lg object-cover bg-gray-50 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">× {item.quantity}</p>
                  </div>
                  <p className="text-sm font-bold">{sym} {item.subtotal?.toLocaleString()}</p>
                </div>
              ))}
              {order.items?.length > 4 && <p className="text-xs text-gray-400 text-center">+ {order.items.length - 4} more items</p>}
            </div>
            <div className="border-t border-gray-100 pt-3 space-y-1 text-sm">
              {order.couponDiscount > 0 && <div className="flex justify-between text-green-600"><span>Coupon</span><span>−{sym} {order.couponDiscount?.toLocaleString()}</span></div>}
              {order.giftCardDiscount > 0 && <div className="flex justify-between text-purple-600"><span>Gift Card</span><span>−{sym} {order.giftCardDiscount?.toLocaleString()}</span></div>}
              <div className="flex justify-between text-gray-600"><span>Delivery</span><span>{sym} {order.shippingCost?.toLocaleString()}</span></div>
              <div className="flex justify-between font-bold text-gray-900 text-base pt-1 border-t border-gray-100">
                <span>Total</span><span>{sym} {order.total?.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-center flex-wrap">
          <Link to={`/track-order/${id}`} className="btn-primary text-sm">Track Order →</Link>
          <Link to="/shop" className="btn-outline text-sm">Continue Shopping</Link>
        </div>
      </div>
    </div>
  );
}

export function OrderTracking() {
  const { id } = useParams();
  const { settings } = useTheme();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const sym = settings?.currencySymbol || 'Rs.';

  useEffect(() => { API.get(`/orders/${id}`).then(r => setOrder(r.data)).finally(() => setLoading(false)); }, [id]);

  const steps = ['pending','confirmed','processing','shipped','out_for_delivery','delivered'];
  const statusLabels = { pending:'Order Placed', confirmed:'Confirmed', processing:'Processing', shipped:'Shipped', out_for_delivery:'Out for Delivery', delivered:'Delivered', cancelled:'Cancelled' };
  const currentStep = steps.indexOf(order?.orderStatus);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (!order) return <div className="text-center py-20 text-gray-500">Order not found</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10" style={{ background: 'var(--body-bg)' }}>
      <h1 className="text-2xl font-bold text-gray-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>Track Order</h1>
      <p className="text-gray-500 text-sm mb-6">
        <span className="font-mono font-semibold" style={{ color: 'var(--color-primary)' }}>{order.orderNumber}</span>
        {' · '}{order.deliveryServiceName || 'Standard Delivery'}
        {' · '}<span className={`font-medium ${order.paymentStatus==='paid'?'text-green-600':'text-amber-600'}`}>
          {order.paymentStatus==='paid'?'✅ Paid':'⏳ Payment Pending'}
        </span>
      </p>

      <div className="rounded-2xl border border-gray-100 p-6 mb-6" style={{ background: 'var(--card-bg)' }}>
        {order.orderStatus === 'cancelled' ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">❌</div>
            <p className="font-bold text-red-600">Order Cancelled</p>
          </div>
        ) : (
          <>
            <div className="relative flex justify-between">
              <div className="absolute top-4 left-0 right-0 h-1 bg-gray-200 -z-0 rounded-full">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0,(currentStep/(steps.length-1))*100)}%`, background: 'var(--theme-gradient)' }}/>
              </div>
              {steps.map((step, i) => (
                <div key={step} className="flex flex-col items-center gap-2 z-10">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all shadow-sm ${i<=currentStep?'text-white':'bg-gray-100 text-gray-400'}`}
                    style={i<=currentStep?{background:'var(--color-primary)'}:{}}>
                    {i<currentStep?'✓':i+1}
                  </div>
                  <span className={`text-xs font-medium text-center hidden sm:block ${i<=currentStep?'':'text-gray-400'}`}
                    style={i<=currentStep?{color:'var(--color-primary)'}:{}}>{statusLabels[step]}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 text-center">
              <p className="text-lg font-bold text-gray-900">{statusLabels[order.orderStatus]||order.orderStatus}</p>
              {order.trackingNumber && <p className="text-sm text-gray-500 mt-1">Tracking: <span className="font-mono font-bold" style={{color:'var(--color-primary)'}}>{order.trackingNumber}</span></p>}
            </div>
          </>
        )}
      </div>

      {order.paymentMethod==='bank_transfer' && order.paymentStatus==='pending' && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5 mb-6">
          <h3 className="font-bold text-amber-800 mb-2">🏦 Payment Required</h3>
          <p className="text-sm text-amber-700 mb-3">Transfer <strong>{sym} {order.total?.toLocaleString()}</strong> with reference <strong className="font-mono">{order.orderNumber}</strong></p>
          {settings?.bankAccountNumber && (
            <div className="bg-white rounded-xl p-3 text-sm space-y-1 border border-amber-100">
              {settings.bankName && <p><span className="text-gray-400">Bank:</span> <span className="font-semibold ml-2">{settings.bankName}</span></p>}
              {settings.bankAccountNumber && <p><span className="text-gray-400">Account:</span> <span className="font-mono font-bold ml-2">{settings.bankAccountNumber}</span></p>}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 p-6 mb-6" style={{ background: 'var(--card-bg)' }}>
        <h2 className="font-semibold text-gray-900 mb-4">Items</h2>
        <div className="space-y-3">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <img src={item.image||'https://via.placeholder.com/48'} alt={item.name} className="w-12 h-12 rounded-lg object-cover bg-gray-50"/>
              <div className="flex-1"><p className="text-sm font-medium text-gray-800">{item.name}</p><p className="text-xs text-gray-500">× {item.quantity}</p></div>
              <p className="text-sm font-bold">{sym} {item.subtotal?.toLocaleString()}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 mt-4 pt-4 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{sym} {order.subtotal?.toLocaleString()}</span></div>
          {order.couponDiscount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>−{sym} {order.couponDiscount?.toLocaleString()}</span></div>}
          <div className="flex justify-between text-gray-600"><span>Delivery</span><span>{sym} {order.shippingCost?.toLocaleString()}</span></div>
          <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-100 pt-2"><span>Total</span><span>{sym} {order.total?.toLocaleString()}</span></div>
        </div>
      </div>

      {order.statusHistory?.length > 0 && (
        <div className="rounded-2xl border border-gray-100 p-6" style={{ background: 'var(--card-bg)' }}>
          <h2 className="font-semibold text-gray-900 mb-4">History</h2>
          <div className="space-y-3">
            {[...order.statusHistory].reverse().map((h,i) => (
              <div key={i} className="flex gap-3">
                <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{background:'var(--color-primary)'}}/>
                <div>
                  <p className="text-sm font-semibold text-gray-800 capitalize">{h.status?.replace(/_/g,' ')}</p>
                  {h.note && <p className="text-xs text-gray-500">{h.note}</p>}
                  <p className="text-xs text-gray-400">{new Date(h.updatedAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}