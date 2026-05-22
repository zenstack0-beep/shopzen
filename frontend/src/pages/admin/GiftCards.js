import React, { useEffect, useState, useCallback } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';

const DESIGNS = [
  { id:'default',     emoji:'🎁', label:'Classic Gift',  bg:'linear-gradient(135deg,#b5451b,#f0a500)' },
  { id:'birthday',    emoji:'🎂', label:'Birthday',      bg:'linear-gradient(135deg,#7c3aed,#a78bfa)' },
  { id:'christmas',   emoji:'🎄', label:'Christmas',     bg:'linear-gradient(135deg,#15803d,#84cc16)' },
  { id:'anniversary', emoji:'💝', label:'Anniversary',   bg:'linear-gradient(135deg,#be185d,#fb7185)' },
  { id:'thankyou',    emoji:'💙', label:'Thank You',     bg:'linear-gradient(135deg,#0369a1,#06b6d4)' },
];

const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000];

export default function AdminGiftCards() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({
    amount: '',
    design: 'default',
    expiryDays: 365,
    isActive: true,
    adminNote: '',
  });

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get(`/gift-cards/admin/all?status=${filter}`);
      setCards(data.cards || []);
    } catch { toast.error('Failed to load'); } 
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const createCard = async () => {
    if (!form.amount || Number(form.amount) < 1) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    try {
      await API.post('/gift-cards/admin/create', {
        amount: Number(form.amount),
        design: form.design,
        expiryDays: Number(form.expiryDays) || 365,
        isActive: form.isActive,
        adminNote: form.adminNote || 'Admin created',
      });
      toast.success('🎁 Gift card created!');
      setShowCreate(false);
      setForm({ amount: '', design: 'default', expiryDays: 365, isActive: true, adminNote: '' });
      fetchCards();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally { setSaving(false); }
  };

  const activate   = async (id) => { await API.put(`/gift-cards/admin/${id}/activate`);   toast.success('Activated ✅'); fetchCards(); };
  const deactivate = async (id) => { await API.put(`/gift-cards/admin/${id}/deactivate`); toast.success('Disabled'); fetchCards(); };

  const adjustBalance = async (id, cur) => {
    const val = prompt(`Current balance: Rs. ${cur}\nEnter new balance (Rs.):`);
    if (val === null || val === '') return;
    const n = Number(val);
    if (isNaN(n) || n < 0) { toast.error('Invalid amount'); return; }
    await API.put(`/gift-cards/admin/${id}`, { balance: n });
    toast.success('Balance updated!');
    fetchCards();
  };

  const copy = (code) => { navigator.clipboard.writeText(code); toast.success('Copied!'); };

  const d = (id) => DESIGNS.find(x => x.id === id) || DESIGNS[0];

  const stats = {
    total:  cards.length,
    active: cards.filter(c => c.isActive).length,
    pending:cards.filter(c => !c.isActive && c.paymentStatus === 'pending').length,
    value:  cards.filter(c => c.isActive).reduce((s, c) => s + (c.balance || 0), 0),
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-gray-900">Gift Cards</h2>
          <p className="text-sm text-gray-500">Create and manage gift cards for the store</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">+ Create Gift Card</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { icon:'🎁', val: stats.total,   lbl:'Total Cards' },
          { icon:'✅', val: stats.active,  lbl:'Active' },
          { icon:'⏳', val: stats.pending, lbl:'Pending Payment' },
          { icon:'💰', val: `Rs. ${stats.value.toLocaleString()}`, lbl:'Active Balance' },
        ].map(s => (
          <div key={s.lbl} className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <div className="text-2xl mb-1">{s.icon}</div>
            <p className="text-lg font-bold text-gray-900">{s.val}</p>
            <p className="text-xs text-gray-400">{s.lbl}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[['all','All'],['active','Active'],['pending','Pending'],['used','Used']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === v ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            style={filter === v ? { background: 'var(--color-primary)' } : {}}>
            {l}
          </button>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-lg text-gray-900">Create Gift Card</h3>
                <p className="text-xs text-gray-400 mt-0.5">Card will appear on the storefront for customers to purchase</p>
              </div>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 text-gray-500">✕</button>
            </div>

            <div className="space-y-4">
              {/* Amount */}
              <div>
                <label className="form-label">Gift Card Value (Rs.) *</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {QUICK_AMOUNTS.map(a => (
                    <button key={a} type="button"
                      onClick={() => setForm(p => ({ ...p, amount: String(a) }))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all ${String(form.amount) === String(a) ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                      style={String(form.amount) === String(a) ? { background: 'var(--theme-gradient)', borderColor: 'transparent' } : {}}>
                      Rs. {a >= 1000 ? `${a/1000}K` : a}
                    </button>
                  ))}
                </div>
                <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                  className="form-input" placeholder="Or enter custom amount"/>
              </div>

              {/* Design */}
              <div>
                <label className="form-label">Card Design</label>
                <div className="grid grid-cols-5 gap-2 mt-1">
                  {DESIGNS.map(ds => (
                    <button key={ds.id} type="button" onClick={() => setForm(p => ({ ...p, design: ds.id }))}
                      className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 border-2 transition-all ${form.design === ds.id ? 'border-primary scale-105 shadow-lg' : 'border-transparent hover:scale-102'}`}
                      style={{ background: ds.bg, borderColor: form.design === ds.id ? 'white' : 'transparent', boxShadow: form.design === ds.id ? '0 0 0 3px var(--color-primary)' : 'none' }}>
                      <span className="text-xl">{ds.emoji}</span>
                      <span className="text-white text-[9px] font-bold leading-none">{ds.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-xl overflow-hidden" style={{ background: DESIGNS.find(x => x.id === form.design)?.bg || 'linear-gradient(135deg,#b5451b,#f0a500)' }}>
                <div className="p-4 text-white text-center">
                  <div className="text-3xl mb-1">{DESIGNS.find(x => x.id === form.design)?.emoji || '🎁'}</div>
                  <p className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>{DESIGNS.find(x => x.id === form.design)?.label}</p>
                  <p className="text-2xl font-black mt-1">Rs. {form.amount ? Number(form.amount).toLocaleString() : '—'}</p>
                  <p className="text-white/70 text-xs mt-1 font-mono tracking-widest">GC-XXXX-XXXX-XXXX</p>
                </div>
              </div>

              {/* Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Valid for (days)</label>
                  <input type="number" value={form.expiryDays} onChange={e => setForm(p => ({ ...p, expiryDays: e.target.value }))} className="form-input"/>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <div onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
                      className={`w-10 h-5 rounded-full relative cursor-pointer transition-all flex-shrink-0 ${form.isActive ? 'bg-primary' : 'bg-gray-200'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 shadow-sm transition-all ${form.isActive ? 'left-5.5' : 'left-0.5'}`} style={{ left: form.isActive ? 22 : 2 }}/>
                    </div>
                    <span className="text-sm font-medium text-gray-700">Active now</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="form-label">Admin Note (optional)</label>
                <input value={form.adminNote} onChange={e => setForm(p => ({ ...p, adminNote: e.target.value }))}
                  className="form-input text-sm" placeholder="e.g. Holiday promo batch"/>
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
                💡 A unique code like <strong className="font-mono">GC-XXXX-XXXX-XXXX</strong> is auto-generated. Customers visit the Gift Cards page to purchase. Code is activated after payment.
              </div>
            </div>

            <div className="flex gap-3 mt-5 pt-4 border-t border-gray-100">
              <button onClick={createCard} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Creating...' : '🎁 Create Gift Card'}
              </button>
              <button onClick={() => setShowCreate(false)} className="btn-outline px-5">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent', borderWidth: 3 }}/>
          </div>
        ) : cards.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-5xl mb-3">🎁</div>
            <p className="text-gray-500 font-medium mb-1">No gift cards yet</p>
            <p className="text-gray-400 text-sm mb-4">Create gift cards for customers to browse and purchase on the storefront</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">Create First Gift Card</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Design</th>
                  <th>Value / Balance</th>
                  <th>Purchased By</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cards.map(card => {
                  const design = d(card.design);
                  const pct = Math.max(0, Math.round((card.balance / card.initialValue) * 100));
                  return (
                    <tr key={card._id}>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <code className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg"
                            style={{ color: 'var(--color-primary)', background: 'var(--color-primary)18' }}>
                            {card.code}
                          </code>
                          <button onClick={() => copy(card.code)} title="Copy code"
                            className="text-gray-300 hover:text-gray-500 transition-colors text-sm">📋</button>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: design.bg }}>
                            {design.emoji}
                          </div>
                          <span className="text-xs text-gray-500 hidden sm:block">{design.label}</span>
                        </div>
                      </td>
                      <td>
                        <p className="text-sm font-bold text-gray-900">
                          Rs. {card.balance?.toLocaleString()}
                          <span className="text-gray-400 font-normal text-xs ml-1">/ {card.initialValue?.toLocaleString()}</span>
                        </p>
                        <div className="w-24 bg-gray-100 rounded-full h-1 mt-1">
                          <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, background: pct > 50 ? 'var(--color-primary)' : pct > 20 ? '#f59e0b' : '#ef4444' }}/>
                        </div>
                      </td>
                      <td>
                        {card.purchasedBy ? (
                          <div>
                            <p className="text-sm font-medium text-gray-800">{card.purchasedBy.firstName} {card.purchasedBy.lastName}</p>
                            <p className="text-xs text-gray-400">{card.purchasedBy.email}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Not purchased yet</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge text-xs ${card.paymentStatus === 'paid' ? 'badge-new' : card.paymentStatus === 'pending' ? 'badge-sale' : 'badge-hot'}`}>
                          {card.paymentStatus}
                        </span>
                      </td>
                      <td>
                        <span className={`badge text-xs ${card.isActive ? 'badge-new' : 'bg-gray-100 text-gray-500'}`}>
                          {card.isActive ? '✓ Active' : card.paymentStatus === 'pending' ? '⏳ Pending' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-gray-400">{card.expiresAt ? new Date(card.expiresAt).toLocaleDateString() : '—'}</span>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {!card.isActive && (
                            <button onClick={() => activate(card._id)} className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 font-medium whitespace-nowrap">Activate</button>
                          )}
                          {card.isActive && (
                            <button onClick={() => deactivate(card._id)} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 whitespace-nowrap">Disable</button>
                          )}
                          <button onClick={() => adjustBalance(card._id, card.balance)} className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 whitespace-nowrap">Adjust</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
