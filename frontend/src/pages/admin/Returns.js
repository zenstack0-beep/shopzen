import React, { useEffect, useState, useCallback } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_COLORS = { pending:'status-pending', approved:'status-confirmed', rejected:'status-cancelled', received:'status-processing', refunded:'badge-new' };

export default function AdminReturns() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState({ status: '', adminNote: '', refundAmount: '', refundMethod: 'original' });
  const [saving, setSaving] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get(`/returns/admin/all?status=${statusFilter}`);
      setReturns(data.returns);
    } catch {} finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  const openDetail = async (ret) => {
    try {
      const { data } = await API.get(`/returns/admin/${ret._id}`);
      setSelected(data);
      setForm({ status: data.status, adminNote: data.adminNote || '', refundAmount: data.refundAmount || '', refundMethod: data.refundMethod || 'original' });
    } catch {}
  };

  const handleUpdate = async () => {
    setSaving(true);
    try {
      await API.put(`/returns/admin/${selected._id}`, form);
      toast.success('Return updated!');
      setSelected(null);
      fetch();
    } catch { toast.error('Update failed'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="font-display text-xl font-bold text-gray-900">Returns & Refunds</h2><p className="text-sm text-gray-500">Manage customer return requests</p></div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
        <div className="flex gap-2 flex-wrap">
          {['all','pending','approved','rejected','received','refunded'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all border ${statusFilter===s ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? <div className="p-8 text-center text-gray-400">Loading...</div> : returns.length === 0 ? (
          <div className="p-12 text-center"><div className="text-5xl mb-3">📦</div><p className="text-gray-400">No return requests</p></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Request</th><th>Customer</th><th>Order</th><th>Reason</th><th>Items</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {returns.map(ret => (
                <tr key={ret._id}>
                  <td><span className="font-mono text-xs text-primary">#{ret._id.slice(-6).toUpperCase()}</span></td>
                  <td><div><p className="text-sm font-medium">{ret.customer?.firstName} {ret.customer?.lastName}</p><p className="text-xs text-gray-400">{ret.customerEmail}</p></div></td>
                  <td><span className="font-mono text-xs text-gray-600">{ret.order?.orderNumber}</span></td>
                  <td><span className="text-xs text-gray-600 line-clamp-1 max-w-[140px]">{ret.reason}</span></td>
                  <td><span className="text-sm text-gray-600">{ret.items?.length} item(s)</span></td>
                  <td><span className={`badge ${STATUS_COLORS[ret.status]} capitalize text-xs`}>{ret.status}</span></td>
                  <td><span className="text-xs text-gray-400">{new Date(ret.createdAt).toLocaleDateString()}</span></td>
                  <td>
                    <button onClick={() => openDetail(ret)} className="text-xs text-primary hover:underline font-medium">Review →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-display font-bold text-xl text-gray-900">Return Request</h2>
              <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">×</button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Customer</p><p className="font-semibold">{selected.customer?.firstName} {selected.customer?.lastName}</p><p className="text-gray-500">{selected.customer?.email}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Order</p><p className="font-mono font-semibold text-primary">{selected.order?.orderNumber}</p><p className="text-gray-500">Rs. {selected.order?.total?.toLocaleString()}</p></div>
              </div>
              <div><p className="text-xs text-gray-400 mb-1">Reason</p><p className="text-sm font-medium text-gray-800">{selected.reason}</p>{selected.description && <p className="text-sm text-gray-500 mt-1">{selected.description}</p>}</div>
              <div>
                <p className="text-xs text-gray-400 mb-2">Return Items</p>
                <div className="space-y-2">
                  {selected.items?.map((item, i) => (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                      <div className="flex-1"><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-gray-400">Qty: {item.quantity} · {item.condition}</p></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <h3 className="font-semibold text-gray-800">Update Return</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><label className="form-label">Status</label>
                    <select value={form.status} onChange={e => setForm(p => ({...p, status: e.target.value}))} className="form-input">
                      {['pending','approved','rejected','received','refunded'].map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                    </select>
                  </div>
                  <div><label className="form-label">Refund Method</label>
                    <select value={form.refundMethod} onChange={e => setForm(p => ({...p, refundMethod: e.target.value}))} className="form-input">
                      <option value="original">Original Payment Method</option>
                      <option value="store_credit">Store Credit</option>
                      <option value="gift_card">Gift Card</option>
                    </select>
                  </div>
                </div>
                <div><label className="form-label">Refund Amount (Rs.)</label><input type="number" value={form.refundAmount} onChange={e => setForm(p => ({...p, refundAmount: e.target.value}))} className="form-input" placeholder="Enter refund amount" /></div>
                <div><label className="form-label">Admin Note (visible to customer)</label><textarea value={form.adminNote} onChange={e => setForm(p => ({...p, adminNote: e.target.value}))} rows={3} className="form-input resize-none" placeholder="Explain the decision..." /></div>
                <button onClick={handleUpdate} disabled={saving} className="btn-primary w-full">{saving ? 'Saving...' : 'Update Return Request'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
