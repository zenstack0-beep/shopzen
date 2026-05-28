import React, { useEffect, useState, useCallback } from 'react';
import useSEO from '../../hooks/useSEO';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import API from '../../utils/api';
import toast from 'react-hot-toast';

const statusColors = {
  pending: 'status-pending', confirmed: 'status-confirmed',
  processing: 'status-processing', shipped: 'status-shipped',
  out_for_delivery: 'status-out_for_delivery', delivered: 'status-delivered',
  cancelled: 'status-cancelled',
};

// ── Countdown hook ────────────────────────────────────────────────────────────
// Returns:
//   null                              → settings not yet loaded
//   { eligible: false }               → order not in cancellable status
//   { eligible: true, open: false }   → window has expired OR cancellations disabled
//   { eligible: true, open: true, minutes, seconds }          → active timed window
function useCancelCountdown(orderId, orderCreatedAt, orderStatus, cancelRequested, windowMinutes) {
  const [state, setState] = useState(null);

  useEffect(() => {
    const cancellable = ['pending', 'confirmed'];

    // Not in a cancellable status — hide button entirely
    if (!cancellable.includes(orderStatus)) {
      setState({ eligible: false });
      return;
    }

    // Already has a cancel request (any status) — show badge not button
    if (cancelRequested) {
      setState({ eligible: true, open: false, hasCancelRequest: true });
      return;
    }

    // Settings not yet loaded — show skeleton
    if (windowMinutes === null || windowMinutes === undefined) {
      setState(null);
      return;
    }

    const winNum = Number(windowMinutes);

    // Admin disabled cancellations entirely
    if (winNum === 0) {
      setState({ eligible: true, open: false });
      return;
    }

    // Guard: invalid createdAt means we can't compute window — hide button
    const placed = new Date(orderCreatedAt).getTime();
    if (!isFinite(placed) || placed <= 0) {
      setState({ eligible: true, open: false });
      return;
    }

    const winMs    = winNum * 60 * 1000;
    const deadline = placed + winMs;

    const tick = () => {
      const diff = deadline - Date.now();
      if (!isFinite(diff) || diff <= 0) {
        setState({ eligible: true, open: false });
      } else {
        setState({
          eligible: true,
          open: true,
          minutes: Math.floor(diff / 60000),
          seconds: Math.floor((diff % 60000) / 1000),
          totalMs: diff,
        });
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, orderCreatedAt, orderStatus, cancelRequested, windowMinutes]);

  return state;
}

// ── CancelButton component ────────────────────────────────────────────────────
function CancelButton({ order, windowMinutes, onCancelled }) {
  const [open, setOpen]       = useState(false);
  const [reason, setReason]   = useState('');
  const [loading, setLoading] = useState(false);

  const cs = useCancelCountdown(
    order._id,
    order.createdAt,
    order.orderStatus,
    !!order.cancelRequest?.requested,
    windowMinutes,
  );

  // ── Early returns (order-level guards) ──

  // Order is cancelled — show nothing
  if (order.orderStatus === 'cancelled') return null;

  // Not in a cancellable status
  if (cs && !cs.eligible) return null;

  // Already submitted a cancel request — show status badge
  if (order.cancelRequest?.requested) {
    const s = order.cancelRequest.status;
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full ${
        s === 'pending'  ? 'bg-yellow-100 text-yellow-700' :
        s === 'approved' ? 'bg-red-100 text-red-600'       :
                           'bg-gray-100 text-gray-500'}`}>
        {s === 'pending'  ? '⏳ Cancel Requested' :
         s === 'approved' ? '🚫 Cancellation Approved' :
                            '❌ Request Rejected'}
      </span>
    );
  }

  // Settings still loading
  if (cs === null) {
    return <span className="inline-block w-28 h-7 rounded-lg bg-gray-100 animate-pulse" />;
  }

  // Window is closed
  if (cs && !cs.open) {
    // Admin disabled cancellations — show nothing at all
    if (Number(windowMinutes) === 0) return null;
    // Window has expired
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400 px-2 py-1 rounded-lg bg-gray-50 border border-gray-100">
        🔒 Cancel window closed
      </span>
    );
  }

  // ── Active window — show Cancel button with countdown ──
  const mm = cs.minutes !== undefined ? String(cs.minutes).padStart(2, '0') : null;
  const ss = cs.seconds !== undefined ? String(cs.seconds).padStart(2, '0') : null;

  // Urgency colour: red when < 5 min left
  const isUrgent = cs.totalMs !== undefined && cs.totalMs < 5 * 60 * 1000;

  const handleRequest = async () => {
    setLoading(true);
    try {
      await API.post(`/orders/${order._id}/cancel-request`, { reason });
      toast.success('Cancellation request sent to admin');
      setOpen(false);
      onCancelled();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not submit cancel request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold border px-3 py-1.5 rounded-lg transition-all ${
          isUrgent
            ? 'text-red-600 hover:text-red-800 border-red-300 hover:border-red-500 bg-red-50 hover:bg-red-100'
            : 'text-red-500 hover:text-red-700 border-red-200 hover:border-red-400 bg-red-50 hover:bg-red-100'
        }`}
      >
        <span>✕ Cancel Order</span>
        {/* Show countdown timer when in timed window */}
        {mm !== null && (
          <span className={`font-mono px-1.5 py-0.5 rounded-md text-[11px] ${
            isUrgent ? 'bg-red-200 text-red-700' : 'bg-red-100 text-red-600'
          }`}>
            {mm}:{ss}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-xl">✕</div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg leading-tight">Cancel this order?</h3>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{order.orderNumber}</p>
              </div>
            </div>

            {/* Countdown warning inside modal */}
            {mm !== null && (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-4 text-sm font-medium ${
                isUrgent ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                <span>⏱</span>
                <span>
                  Cancel window closes in{' '}
                  <strong className="font-mono">{mm}:{ss}</strong>
                </span>
              </div>
            )}

            <div className="bg-gray-50 rounded-xl p-3 mb-4 flex items-center justify-between">
              <span className="text-sm text-gray-600">Order Total</span>
              <span className="font-bold text-gray-900">Rs. {order.total?.toLocaleString()}</span>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Reason for cancellation <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                className="form-input resize-none"
                placeholder="e.g. Changed my mind, found a better price, ordered by mistake..."
              />
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-5 text-xs text-amber-700">
              ⚠️ Your request will be reviewed by our team. You'll receive an email with the decision.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Keep Order
              </button>
              <button
                onClick={handleRequest}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Submitting...</>
                ) : 'Request Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MyOrders() {
  const { user }       = useAuth();
  useSEO({ title: 'My Orders', noindex: true });
  const { settings }   = useTheme();
  const [searchParams] = useSearchParams();

  const [orders, setOrders]                             = useState([]);
  const [loading, setLoading]                           = useState(true);
  // null = not loaded yet — prevents premature "expired" state on first render
  const [cancelWindowMinutes, setCancelWindowMinutes]   = useState(null);

  const sym      = settings?.currencySymbol || 'Rs.';
  const primary  = 'var(--color-primary)';
  const newOrderId = searchParams.get('new');

  const fetchOrders = useCallback(() => {
    setLoading(true);
    API.get('/orders/my-orders')
      .then(r => setOrders(r.data || []))
      .catch(() => toast.error('Could not load orders'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Load cancel window setting — keep null until response arrives so the
  // countdown hook doesn't flash "window closed" before we know the real value.
  useEffect(() => {
    API.get('/settings')
      .then(r => {
        const raw    = r.data?.cancelWindowMinutes;
        // Treat missing/empty/null/undefined as the default (60 min)
        const parsed = (raw !== undefined && raw !== null && String(raw).trim() !== '')
          ? Number(raw)
          : 60;
        setCancelWindowMinutes(isNaN(parsed) ? 60 : parsed);
      })
      .catch(() => setCancelWindowMinutes(60)); // fallback on API error
  }, []);

  const pendingPaymentOrders = orders.filter(
    o => o.paymentMethod === 'bank_transfer' && o.paymentStatus !== 'paid'
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8" style={{ background: 'var(--body-bg)' }}>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg"
          style={{ background: 'var(--theme-gradient)' }}>
          {user?.firstName?.[0] || '?'}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>My Orders</h1>
          <p className="text-gray-500 text-sm">{user?.email}</p>
        </div>
        <Link to="/account" className="ml-auto text-sm font-medium hover:underline" style={{ color: primary }}>
          ← My Account
        </Link>
      </div>

      {/* Payment pending compact notice */}
      {pendingPaymentOrders.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <span className="text-lg">🏦</span>
          <p className="text-sm text-amber-800 font-medium flex-1">
            <strong>{pendingPaymentOrders.length} order{pendingPaymentOrders.length > 1 ? 's' : ''}</strong> awaiting bank transfer payment — click <strong>Upload Slip</strong> on any highlighted order below.
          </p>
        </div>
      )}

      {/* New order success banner */}
      {newOrderId && (
        <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-4 mb-6 flex items-center gap-3">
          <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div className="flex-1">
            <p className="font-bold text-green-800 text-sm">Order placed successfully!</p>
            <p className="text-xs text-green-600">A confirmation email has been sent to you.</p>
          </div>
          <Link to={`/track-order/${newOrderId}`} className="text-xs font-semibold hover:underline" style={{ color: primary }}>
            Track →
          </Link>
        </div>
      )}

      {/* Cancel window info banner (only when window is finite and set) */}
      {cancelWindowMinutes !== null && Number(cancelWindowMinutes) > 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 mb-5 text-xs text-blue-700">
          <span>⏱</span>
          <span>Orders can be cancelled within <strong>{cancelWindowMinutes} minute{cancelWindowMinutes !== 1 ? 's' : ''}</strong> of placing. After that, please contact support.</span>
        </div>
      )}

      {/* Orders list */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: primary, borderTopColor: 'transparent' }} />
          Loading your orders…
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📦</div>
          <p className="text-gray-600 font-medium mb-1">No orders yet</p>
          <p className="text-gray-400 text-sm mb-4">When you place an order, it will appear here.</p>
          <Link to="/shop" className="btn-primary inline-block">Start Shopping →</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map(order => {
            const isNew        = order._id === newOrderId;
            const needsPayment = order.paymentMethod === 'bank_transfer' && order.paymentStatus !== 'paid';

            return (
              <div key={order._id}
                className="rounded-2xl border p-5 transition-all"
                style={{
                  background:  'var(--card-bg)',
                  borderColor: isNew ? primary : needsPayment ? '#fcd34d' : '#e5e7eb',
                  borderWidth: (isNew || needsPayment) ? '2px' : '1px',
                  boxShadow: isNew ? `0 0 0 4px ${primary}15` : 'none',
                }}>

                {/* Top row */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-mono text-sm font-bold" style={{ color: primary }}>{order.orderNumber}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(order.createdAt).toLocaleDateString('en-LK', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {needsPayment && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full mt-1.5">
                        ⏳ Awaiting Payment
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isNew && (
                      <span className="text-xs font-bold text-white px-2 py-0.5 rounded-full" style={{ background: primary }}>✓ New</span>
                    )}
                    <span className={`badge ${statusColors[order.orderStatus] || ''} capitalize text-xs`}>
                      {order.orderStatus?.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                {/* Items preview */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  {order.items?.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-100">
                      {item.image && <img src={item.image} alt="" className="w-6 h-6 rounded object-cover" />}
                      <span>{item.name}</span>
                      <span className="text-gray-400">×{item.quantity}</span>
                    </div>
                  ))}
                  {order.items?.length > 3 && (
                    <span className="text-xs text-gray-400 self-center px-2">+{order.items.length - 3} more</span>
                  )}
                </div>

                {/* Footer row */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 flex-wrap gap-3">
                  <div>
                    <p className="font-bold text-gray-900 text-base">{sym} {order.total?.toLocaleString()}</p>
                    <p className="text-xs text-gray-400 capitalize mt-0.5">
                      {order.paymentMethod?.replace(/_/g, ' ')} ·{' '}
                      <span className={order.paymentStatus === 'paid' ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}>
                        {order.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Payment Pending'}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <CancelButton
                      order={order}
                      windowMinutes={cancelWindowMinutes}
                      onCancelled={fetchOrders}
                    />
                    <Link to={`/track-order/${order._id}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:opacity-90"
                      style={{ color: primary, borderColor: `${primary}40`, background: `${primary}0d` }}>
                      {needsPayment ? '📤 Upload Slip' : '📍 Track Order'} →
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