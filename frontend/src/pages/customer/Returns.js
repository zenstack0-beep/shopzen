import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

export default function Returns() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [myReturns, setMyReturns] = useState([]);
  const [step, setStep] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [form, setForm] = useState({ reason: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const REASONS = ['Defective/Damaged product','Wrong item received','Item not as described','Changed my mind','Size/fit issue','Better price found elsewhere'];
  const STATUS_COLORS = { pending:'status-pending', approved:'status-confirmed', rejected:'status-cancelled', received:'status-processing', refunded:'badge-new' };

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    API.get('/orders/my-orders').then(r => setOrders(r.data.filter(o => o.orderStatus === 'delivered'))).catch(() => {});
    API.get('/returns/my-returns').then(r => setMyReturns(r.data)).catch(() => {});
  }, [user, navigate]);

  const toggleItem = (item) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.product === item.product?._id);
      if (exists) return prev.filter(i => i.product !== item.product?._id);
      return [...prev, { product: item.product?._id, name: item.name, quantity: item.quantity, reason: '', condition: 'opened' }];
    });
  };

  const handleSubmit = async () => {
    if (!form.reason) { toast.error('Select a reason'); return; }
    if (selectedItems.length === 0) { toast.error('Select at least one item to return'); return; }
    setSubmitting(true);
    try {
      await API.post('/returns', { order: selectedOrder._id, items: selectedItems, reason: form.reason, description: form.description });
      toast.success('Return request submitted! We will review it within 24 hours.');
      setStep(1); setSelectedOrder(null); setSelectedItems([]); setForm({ reason: '', description: '' });
      API.get('/returns/my-returns').then(r => setMyReturns(r.data));
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl font-bold text-gray-900 mb-2">Returns & Refunds</h1>
      <p className="text-gray-500 mb-8">Easy returns within 7 days of delivery</p>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* New Return */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
            <h2 className="font-semibold text-gray-900 mb-4">Request a Return</h2>

            {step === 1 && (
              <div>
                <p className="text-sm text-gray-500 mb-4">Select an order to return (only delivered orders eligible)</p>
                {orders.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <p>No delivered orders eligible for return</p>
                    <Link to="/shop" className="text-primary hover:underline text-sm mt-2 block">Continue Shopping</Link>
                  </div>
                ) : orders.map(order => (
                  <button key={order._id} onClick={() => { setSelectedOrder(order); setStep(2); }}
                    className="w-full text-left p-4 border-2 border-gray-100 rounded-xl hover:border-primary hover:bg-primary/5 transition-all mb-3 group">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono font-bold text-primary">{order.orderNumber}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{new Date(order.createdAt).toLocaleDateString()} · {order.items?.length} item(s)</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-800">Rs. {order.total?.toLocaleString()}</p>
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-primary ml-auto mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {step === 2 && selectedOrder && (
              <div>
                <button onClick={() => { setStep(1); setSelectedItems([]); }} className="text-sm text-gray-400 hover:text-primary mb-4 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg> Back
                </button>
                <p className="text-sm font-semibold text-gray-700 mb-3">Select items to return:</p>
                <div className="space-y-3 mb-5">
                  {selectedOrder.items?.map((item, i) => {
                    const selected = selectedItems.find(s => s.product === item.product?._id);
                    return (
                      <label key={i} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selected ? 'border-primary bg-primary/5' : 'border-gray-100 hover:border-gray-200'}`}>
                        <input type="checkbox" checked={!!selected} onChange={() => toggleItem(item)} className="accent-primary w-4 h-4" />
                        <img src={item.image || 'https://via.placeholder.com/50'} alt={item.name} className="w-10 h-10 rounded-lg object-cover" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                          <p className="text-xs text-gray-400">Qty: {item.quantity} · Rs. {item.price?.toLocaleString()}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="form-label">Reason for Return *</label>
                    <select value={form.reason} onChange={e => setForm(p => ({...p, reason: e.target.value}))} className="form-input">
                      <option value="">Select a reason...</option>
                      {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Additional Details</label>
                    <textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} rows={3} className="form-input resize-none" placeholder="Describe the issue in detail..." />
                  </div>
                  <button onClick={handleSubmit} disabled={submitting || selectedItems.length === 0 || !form.reason} className="btn-primary w-full py-3">
                    {submitting ? 'Submitting...' : 'Submit Return Request'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* My Returns */}
        <div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">My Return Requests</h2>
            {myReturns.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-6">No return requests yet</p>
            ) : myReturns.map(ret => (
              <div key={ret._id} className="border-b border-gray-50 pb-3 mb-3 last:border-0 last:mb-0">
                <p className="text-xs font-mono text-primary">{ret.order?.orderNumber}</p>
                <p className="text-xs text-gray-500 mt-0.5">{ret.reason}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className={`badge text-xs ${STATUS_COLORS[ret.status] || ''} capitalize`}>{ret.status}</span>
                  <span className="text-xs text-gray-400">{new Date(ret.createdAt).toLocaleDateString()}</span>
                </div>
                {ret.adminNote && <p className="text-xs text-gray-500 mt-1 bg-gray-50 rounded p-2">{ret.adminNote}</p>}
              </div>
            ))}
          </div>

          {/* Policy */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mt-4">
            <h3 className="font-semibold text-blue-800 text-sm mb-2">Return Policy</h3>
            <ul className="text-xs text-blue-600 space-y-1">
              <li>✓ 7 days from delivery date</li>
              <li>✓ Item must be in original condition</li>
              <li>✓ Original packaging preferred</li>
              <li>✓ Refund within 5-7 business days</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
