import React, { useEffect, useState, useCallback } from 'react';
import useSEO from '../../hooks/useSEO';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import API from '../../utils/api';
import toast from 'react-hot-toast';

const statusColors = {
  pending: 'status-pending',
  confirmed: 'status-confirmed',
  processing: 'status-processing',
  shipped: 'status-shipped',
  out_for_delivery: 'status-out_for_delivery',
  delivered: 'status-delivered',
  cancelled: 'status-cancelled',
};

// Countdown timer hook — returns { minutes, seconds, expired }
function useCancelCountdown(order, windowMinutes) {
  const [timeLeft, setTimeLeft] = useState(null);
  useEffect(() => {
    if (!order || !windowMinutes) return;
    const cancellableStatuses = ['pending', 'confirmed'];
    if (!cancellableStatuses.includes(order.orderStatus)) return;
    if (order.cancelRequest?.requested) return;

    const deadline = new Date(order.createdAt).getTime() + windowMinutes * 60 * 1000;
    const tick = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) { setTimeLeft({ expired: true }); return; }
      setTimeLeft({
        expired: false,
        minutes: Math.floor(diff / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [order, windowMinutes]);
  return timeLeft;
}

function CancelButton({ order, windowMinutes, onCancelled }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const timeLeft = useCancelCountdown(order, windowMinutes);

  const cancellableStatuses = ['pending', 'confirmed'];
  if (!cancellableStatuses.includes(order.orderStatus)) return null;
  if (order.orderStatus === 'cancelled') return null;

  // Already requested
  if (order.cancelRequest?.requested) {
    const s = order.cancelRequest.status;
    return (
      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
        s === 'pending'  ? 'bg-yellow-100 text-yellow-700' :
        s === 'approved' ? 'bg-red-100 text-red-600' :
                           'bg-gray-100 text-gray-500'}`}>
        {s === 'pending' ? '⏳ Cancel Requested' : s === 'approved' ? '🚫 Cancelled' : '❌ Cancel Rejected'}
      </span>
    );
  }

  if (!timeLeft || timeLeft.expired) return null;

  const handleRequest = async () => {
    setLoading(true);
    try {
      await API.post(`/orders/${order._id}/cancel-request`, { reason });
      toast.success('Cancellation request sent to admin');
      setOpen(false);
      onCancelled();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not submit cancel request');
    } finally { setLoading(false); }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2 py-1 rounded-lg transition-colors"
      >
        Cancel Order
        {!timeLeft.expired && (
          <span className="ml-1 text-gray-400">
            ({String(timeLeft.minutes).padStart(2,'0')}:{String(timeLeft.seconds).padStart(2,'0')})
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="font-bold text-gray-900 text-lg mb-1">Cancel Order?</h3>
            <p className="text-sm text-gray-500 mb-4">
              <span className="font-mono font-bold" style={{color:'var(--color-primary)'}}>{order.orderNumber}</span>
              {' — '}Rs. {order.total?.toLocaleString()}
            </p>
            <label className="form-label">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              className="form-input mb-4 resize-none"
              placeholder="e.g. Ordered by mistake, found better price..."
            />
            <div className="flex gap-3">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Keep Order
              </button>
              <button
                onClick={handleRequest}
                disabled={loading}
                className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors disabled:opacity-60"
              >
                {loading ? 'Submitting...' : 'Request Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function MyOrders() {
  const { user } = useAuth();
  useSEO({ title: 'My Orders', noindex: true });
  const { settings } = useTheme();
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelWindowMinutes, setCancelWindowMinutes] = useState(60);
  const sym = settings?.currencySymbol || 'Rs.';
  const primary = 'var(--color-primary)';
  const newOrderId = searchParams.get('new');

  const fetchOrders = useCallback(() => {
    API.get('/orders/my-orders')
      .then(r => setOrders(r.data || []))
      .catch(() => toast.error('Could not load orders'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Load cancel window from settings
  useEffect(() => {
    API.get('/settings').then(r => {
      if (r.data?.cancelWindowMinutes) setCancelWindowMinutes(Number(r.data.cancelWindowMinutes));
    }).catch(() => {});
  }, []);

  const pendingPaymentOrders = orders.filter(
    o => o.paymentMethod === 'bank_transfer' && o.paymentStatus !== 'paid'
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8" style={{ background: 'var(--body-bg)' }}>
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg"
          style={{ background: 'var(--theme-gradient)' }}>
          {user?.firstName?.[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>My Orders</h1>
          <p className="text-gray-500 text-sm">{user?.email}</p>
        </div>
        <Link to="/account" className="ml-auto text-sm font-medium hover:underline" style={{ color: primary }}>
          ← My Account
        </Link>
      </div>

      {/* Payment Pending Banner */}
      {pendingPaymentOrders.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-2xl flex-shrink-0">🏦</div>
            <div className="flex-1">
              <p className="font-bold text-amber-800 text-base mb-1">
                Payment Required — {pendingPaymentOrders.length} order{pendingPaymentOrders.length > 1 ? 's' : ''} awaiting payment
              </p>
              <p className="text-sm text-amber-700 mb-3">Please complete your bank transfer and upload the payment slip.</p>
              <div className="space-y-2">
                {pendingPaymentOrders.map(order => (
                  <div key={order._id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-amber-200">
                    <div>
                      <span className="font-mono font-bold text-amber-800 text-sm">{order.orderNumber}</span>
                      <span className="text-xs text-amber-600 ml-2">— {sym} {order.total?.toLocaleString()}</span>
                    </div>
                    <Link to={`/track-order/${order._id}`} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'var(--color-primary)' }}>
                      Upload Slip →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New order highlight */}
      {newOrderId && (
        <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-4 mb-6 flex items-center gap-3">
          <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div className="flex-1">
            <p className="font-bold text-green-800 text-sm">Order placed successfully!</p>
            <p className="text-xs text-green-600">A confirmation email has been sent to you.</p>
          </div>
          <Link to={`/track-order/${newOrderId}`} className="text-xs font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
            Track →
          </Link>
        </div>
      )}

      {/* Orders list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
          Loading orders…
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">📦</div>
          <p className="text-gray-500 mb-2">You haven't placed any orders yet.</p>
          <Link to="/shop" className="btn-primary inline-block mt-2">Start Shopping →</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map(order => {
            const isNew = order._id === newOrderId;
            const needsPayment = order.paymentMethod === 'bank_transfer' && order.paymentStatus !== 'paid';
            return (
              <div key={order._id} className="rounded-2xl border p-5 hover-lift transition-all"
                style={{
                  background: 'var(--card-bg)',
                  borderColor: isNew ? 'var(--color-primary)' : needsPayment ? '#fcd34d' : 'transparent',
                  borderWidth: (isNew || needsPayment) ? '2px' : '1px',
                }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-mono text-sm font-bold" style={{ color: primary }}>{order.orderNumber}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(order.createdAt).toLocaleDateString('en-LK', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                    {needsPayment && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full mt-1">
                        ⏳ Awaiting Payment
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isNew && (
                      <span className="text-xs font-bold text-white px-2 py-0.5 rounded-full" style={{ background: 'var(--color-primary)' }}>New</span>
                    )}
                    <span className={`badge ${statusColors[order.orderStatus] || ''} capitalize`}>
                      {order.orderStatus?.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                {/* Items preview */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  {order.items?.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-2 py-1">
                      <img src={item.image || 'https://via.placeholder.com/30'} alt="" className="w-5 h-5 rounded object-cover" />
                      {item.name} ×{item.quantity}
                    </div>
                  ))}
                  {order.items?.length > 3 && <span className="text-xs text-gray-400 self-center">+{order.items.length - 3} more</span>}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 flex-wrap gap-2">
                  <div>
                    <p className="font-bold text-gray-900">{sym} {order.total?.toLocaleString()}</p>
                    <p className="text-xs text-gray-400 capitalize">
                      {order.paymentMethod?.replace(/_/g, ' ')} ·{' '}
                      <span className={order.paymentStatus === 'paid' ? 'text-green-600' : 'text-amber-600'}>
                        {order.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Pending'}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <CancelButton order={order} windowMinutes={cancelWindowMinutes} onCancelled={fetchOrders} />
                    <Link to={`/track-order/${order._id}`} className="text-sm font-semibold hover:underline" style={{ color: primary }}>
                      {needsPayment ? '📤 Upload Slip →' : 'Track Order →'}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}