import React, { useEffect, useState, useCallback, useRef } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';

/* ─── Countdown (admin preview) ────────────────────────────────────────── */
const CountdownPreview = ({ endsAt, color = '#dc2626' }) => {
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0, expired: false });
  useEffect(() => {
    const calc = () => {
      const diff = new Date(endsAt) - Date.now();
      if (diff <= 0) { setT(p => ({ ...p, expired: true })); return; }
      setT({ d: Math.floor(diff / 86400000), h: Math.floor((diff % 86400000) / 3600000), m: Math.floor((diff % 3600000) / 60000), s: Math.floor((diff % 60000) / 1000), expired: false });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (t.expired) return <span className="text-xs font-bold text-red-500">⚡ Expired</span>;
  const Cell = ({ v, label }) => (
    <div className="text-center">
      <div className="text-white text-xs font-black rounded px-1.5 py-0.5 tabular-nums" style={{ background: color, minWidth: 24 }}>{String(v).padStart(2, '0')}</div>
      <div className="text-gray-400 text-[9px] mt-0.5 uppercase">{label}</div>
    </div>
  );
  return (
    <div className="flex gap-1 items-end">
      {t.d > 0 && <Cell v={t.d} label="d" />}
      <Cell v={t.h} label="h" />
      <Cell v={t.m} label="m" />
      <Cell v={t.s} label="s" />
    </div>
  );
};

/* ─── Status badge ──────────────────────────────────────────────────────── */
const DealStatus = ({ deal }) => {
  const now = new Date();
  if (!deal.isActive) return <span className="badge bg-gray-100 text-gray-500 text-xs">Inactive</span>;
  if (new Date(deal.endsAt) < now) return <span className="badge bg-red-100 text-red-600 text-xs">Expired</span>;
  return <span className="badge bg-green-100 text-green-700 text-xs font-bold">● LIVE</span>;
};

/* ─── Modal ─────────────────────────────────────────────────────────────── */
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
        <h2 className="font-display font-bold text-xl text-gray-900">{title}</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 text-gray-500">✕</button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

/* ─── Product Picker ────────────────────────────────────────────────────── */
function ProductPicker({ selected, onChange }) {
  const [all, setAll] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  const fetch = useCallback(async (q) => {
    setLoading(true);
    try {
      const { data } = await API.get(`/products/admin/all?search=${q}&limit=20`);
      setAll(data.products || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(''); }, [fetch]);

  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetch(v), 350);
  };

  const toggle = (product) => {
    const ids = selected.map(p => (typeof p === 'object' ? p._id : p));
    if (ids.includes(product._id)) {
      onChange(selected.filter(p => (typeof p === 'object' ? p._id : p) !== product._id));
    } else {
      onChange([...selected, product]);
    }
  };

  const isSelected = (id) => selected.some(p => (typeof p === 'object' ? p._id : p) === id);
  const selectedFull = selected.filter(p => typeof p === 'object' && p._id);

  return (
    <div>
      {/* Selected chips */}
      {selectedFull.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {selectedFull.map(p => (
            <div key={p._id} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
              {p.thumbnail && <img src={p.thumbnail} alt="" className="w-5 h-5 rounded object-cover" />}
              <span className="text-xs font-medium text-blue-700 max-w-[120px] truncate">{p.name}</span>
              <button onClick={() => toggle(p)} className="text-blue-400 hover:text-red-500 text-xs leading-none">✕</button>
            </div>
          ))}
        </div>
      )}
      <input
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder="Search products to add…"
        className="form-input text-sm mb-2"
      />
      <div className="max-h-52 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
        {loading && <div className="p-4 text-center text-gray-400 text-sm">Searching…</div>}
        {!loading && all.length === 0 && <div className="p-4 text-center text-gray-400 text-sm">No products found</div>}
        {!loading && all.map(p => {
          const sel = isSelected(p._id);
          return (
            <button
              key={p._id}
              type="button"
              onClick={() => toggle(p)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${sel ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <div className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${sel ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                {sel && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
              </div>
              {p.thumbnail && <img src={p.thumbnail} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0 bg-gray-100" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                <p className="text-xs text-gray-400">Rs. {p.price?.toLocaleString()} {p.salePrice ? `→ Rs. ${p.salePrice.toLocaleString()}` : ''}</p>
              </div>
              {!p.isActive && <span className="text-xs text-red-400 flex-shrink-0">Hidden</span>}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-1">{selectedFull.length} product{selectedFull.length !== 1 ? 's' : ''} selected</p>
    </div>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */
const toLocalInput = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const presetEnd = (type) => {
  const d = new Date();
  if (type === 'today')  { d.setHours(23, 59, 59, 0); }
  if (type === 'weekly') { d.setDate(d.getDate() + (7 - d.getDay())); d.setHours(23, 59, 59, 0); }
  if (type === 'custom') { d.setDate(d.getDate() + 3); }
  return d.toISOString();
};

const TYPE_LABELS = { today: "⚡ Today's Deal", weekly: '📅 Weekly Deal', custom: '🎯 Custom Deal' };
const TYPE_COLORS = { today: '#dc2626', weekly: '#7c3aed', custom: '#0369a1' };

const emptyForm = {
  title: '', subtitle: '', type: 'today',
  products: [], badgeLabel: '', badgeColor: '#dc2626',
  endsAt: presetEnd('today'), isActive: true, sortOrder: 0,
  bgGradient: '', accentColor: '#dc2626',
};

const emptyOffer = () => ({
  title: '', description: '', brands: [], categories: [], products: [],
  minimumAmount: 0, startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  freeProducts: [], freeItemCount: 1, isActive: false, sortOrder: 0,
  popupDelaySeconds: 1,
});

function OfferManager() {
  const [offers, setOffers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyOffer());
  const [saving, setSaving] = useState(false);
  const upd = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const id = value => typeof value === 'object' ? value._id : value;

  const load = useCallback(() => {
    API.get('/offers/admin/all').then(r => setOffers(r.data || [])).catch(() => toast.error('Failed to load offers'));
  }, []);
  useEffect(() => {
    load();
    API.get('/categories/all').then(r => setCategories(r.data || [])).catch(() => {});
    API.get('/products/admin/brands').then(r => setBrands(r.data || [])).catch(() => {});
  }, [load]);

  const edit = offer => {
    setEditing(offer._id);
    setForm({
      ...emptyOffer(), ...offer,
      categories: (offer.categories || []).map(id),
      brands: offer.brands || [], products: offer.products || [], freeProducts: offer.freeProducts || [],
    });
  };
  const save = async () => {
    if (!form.title.trim()) return toast.error('Offer title is required');
    if (!form.brands.length && !form.categories.length && !form.products.length) return toast.error('Select a qualifying brand, category, or product');
    if (!form.freeProducts.length) return toast.error('Select at least one free item');
    if (Number(form.freeItemCount) < 1) return toast.error('Free item count must be at least 1');
    if (new Date(form.endsAt) <= new Date(form.startsAt)) return toast.error('End date must be after start date');
    setSaving(true);
    const payload = {
      ...form, categories: form.categories.map(id), products: form.products.map(id),
      freeProducts: form.freeProducts.map(id), minimumAmount: Number(form.minimumAmount),
      freeItemCount: Number(form.freeItemCount), sortOrder: Number(form.sortOrder),
    };
    try {
      if (editing) await API.put(`/offers/${editing}`, payload); else await API.post('/offers', payload);
      toast.success(editing ? 'Offer updated' : 'Offer created');
      setEditing(null); setForm(emptyOffer()); load();
    } catch (error) { toast.error(error.response?.data?.message || 'Failed to save offer'); }
    finally { setSaving(false); }
  };
  const remove = async offerId => {
    if (!window.confirm('Delete this free-item offer?')) return;
    await API.delete(`/offers/${offerId}`); load();
  };
  const toggleArray = (key, value) => upd(key, form[key].includes(value) ? form[key].filter(v => v !== value) : [...form[key], value]);

  return (
    <section className="mb-10 rounded-2xl border border-purple-100 bg-purple-50/40 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div><h2 className="font-display text-xl font-bold text-gray-900">🎁 Free Item Offers</h2><p className="text-sm text-gray-500">Reward qualifying carts with customer-selected free products.</p></div>
        <button onClick={() => { setEditing(null); setForm(emptyOffer()); }} className="btn-outline text-sm">+ New Offer</button>
      </div>
      <div className="grid xl:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
          <h3 className="font-bold text-gray-800">{editing ? 'Edit Offer' : 'Configure Offer'}</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="form-label">Offer title *</label><input className="form-input" value={form.title} onChange={e => upd('title', e.target.value)} placeholder="Choose a free gift" /></div>
            <div><label className="form-label">Minimum bill amount *</label><input type="number" min="0" className="form-input" value={form.minimumAmount} onChange={e => upd('minimumAmount', e.target.value)} /></div>
          </div>
          <div><label className="form-label">Customer message</label><input className="form-input" value={form.description} onChange={e => upd('description', e.target.value)} placeholder="Spend the required amount and choose your gift" /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="form-label">Starts *</label><input type="datetime-local" className="form-input" value={toLocalInput(form.startsAt)} onChange={e => upd('startsAt', new Date(e.target.value).toISOString())} /></div>
            <div><label className="form-label">Ends *</label><input type="datetime-local" className="form-input" value={toLocalInput(form.endsAt)} onChange={e => upd('endsAt', new Date(e.target.value).toISOString())} /></div>
          </div>
          <div><label className="form-label">Qualifying brands <span className="font-normal text-gray-400">(optional)</span></label><div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">{brands.map(brand => <button type="button" key={brand} onClick={() => toggleArray('brands', brand)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${form.brands.includes(brand) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}>{brand}</button>)}</div></div>
          <div><label className="form-label">Qualifying categories <span className="font-normal text-gray-400">(optional)</span></label><div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">{categories.map(cat => <button type="button" key={cat._id} onClick={() => toggleArray('categories', cat._id)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${form.categories.includes(cat._id) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200'}`}>{cat.name}</button>)}</div></div>
          <div><label className="form-label">Qualifying products <span className="font-normal text-gray-400">(optional)</span></label><ProductPicker selected={form.products} onChange={value => upd('products', value)} /></div>
          <div className="border-t pt-4"><label className="form-label">Free items customer can choose *</label><ProductPicker selected={form.freeProducts} onChange={value => upd('freeProducts', value)} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className="form-label">Number of free items *</label><input type="number" min="1" max="20" className="form-input" value={form.freeItemCount} onChange={e => upd('freeItemCount', e.target.value)} /></div>
            <div><label className="form-label">Popup delay (seconds)</label><input type="number" min="0" max="300" className="form-input" value={form.popupDelaySeconds} onChange={e => upd('popupDelaySeconds', e.target.value)} /><p className="mt-1 text-[11px] text-gray-400">Use 0 to show immediately.</p></div>
            <div><label className="form-label">Priority</label><input type="number" className="form-input" value={form.sortOrder} onChange={e => upd('sortOrder', e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.isActive} onChange={e => upd('isActive', e.target.checked)} /> Publish offer immediately</label>
          <div className="flex gap-2"><button disabled={saving} onClick={save} className="btn-primary flex-1">{saving ? 'Saving…' : editing ? 'Save Offer' : 'Publish Offer'}</button>{editing && <button onClick={() => { setEditing(null); setForm(emptyOffer()); }} className="btn-outline">Cancel</button>}</div>
        </div>
        <div className="space-y-3">
          {offers.length === 0 && <div className="bg-white rounded-2xl p-10 text-center text-gray-400">No free-item offers yet.</div>}
          {offers.map(offer => <div key={offer._id} className="bg-white rounded-2xl border border-gray-100 p-4"><div className="flex justify-between gap-3"><div><div className="flex gap-2 items-center"><h3 className="font-bold text-gray-900">{offer.title}</h3><span className={`text-xs px-2 py-0.5 rounded-full ${offer.isActive && new Date(offer.startsAt) <= new Date() && new Date(offer.endsAt) >= new Date() ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{offer.isActive ? 'Published' : 'Draft'}</span></div><p className="text-sm text-gray-500 mt-1">Bill ≥ Rs. {Number(offer.minimumAmount).toLocaleString()} · Choose {offer.freeItemCount} free · Popup after {offer.popupDelaySeconds ?? 1}s</p><p className="text-xs text-gray-400 mt-1">{new Date(offer.startsAt).toLocaleString()} → {new Date(offer.endsAt).toLocaleString()}</p><div className="flex gap-1 mt-2">{(offer.freeProducts || []).map(p => <span key={p._id} title={`${p.name} — Rs. ${p.salePrice || p.price}`} className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded">{p.name}</span>)}</div></div><div className="flex"><button onClick={() => edit(offer)} className="p-2">✏️</button><button onClick={() => remove(offer._id)} className="p-2">🗑️</button></div></div></div>)}
        </div>
      </div>
    </section>
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */
export default function AdminDeals() {
  const [deals,   setDeals]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // null | 'add' | 'edit'
  const [form,    setForm]    = useState(emptyForm);
  const [saving,  setSaving]  = useState(false);
  const [editId,  setEditId]  = useState(null);

  const upd = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get('/deals/admin/all');
      setDeals(data);
    } catch { toast.error('Failed to load deals'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ ...emptyForm, endsAt: presetEnd('today') });
    setEditId(null);
    setModal('add');
  };

  const openEdit = (deal) => {
    setForm({
      title:       deal.title,
      subtitle:    deal.subtitle || '',
      type:        deal.type,
      products:    deal.products || [],
      badgeLabel:  deal.badgeLabel || '',
      badgeColor:  deal.badgeColor || '#dc2626',
      endsAt:      deal.endsAt,
      isActive:    deal.isActive,
      sortOrder:   deal.sortOrder || 0,
      bgGradient:  deal.bgGradient || '',
      accentColor: deal.accentColor || '#dc2626',
    });
    setEditId(deal._id);
    setModal('edit');
  };

  const handleSave = async () => {
    if (!form.title.trim())       { toast.error('Title is required'); return; }
    if (form.products.length === 0) { toast.error('Add at least one product'); return; }
    if (!form.endsAt)              { toast.error('End time is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        products: form.products.map(p => (typeof p === 'object' ? p._id : p)),
      };
      if (modal === 'edit' && editId) {
        await API.put(`/deals/${editId}`, payload);
        toast.success('Deal updated!');
      } else {
        await API.post('/deals', payload);
        toast.success('Deal created!');
      }
      setModal(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const deleteDeal = async (id) => {
    if (!window.confirm('Delete this deal?')) return;
    try {
      await API.delete(`/deals/${id}`);
      toast.success('Deal deleted');
      load();
    } catch { toast.error('Failed to delete'); }
  };

  const toggleActive = async (deal) => {
    try {
      await API.put(`/deals/${deal._id}`, { isActive: !deal.isActive });
      setDeals(prev => prev.map(d => d._id === deal._id ? { ...d, isActive: !d.isActive } : d));
    } catch { toast.error('Failed'); }
  };

  // When type changes, auto-set end time
  const onTypeChange = (t) => {
    upd('type', t);
    upd('endsAt', presetEnd(t));
    upd('accentColor', TYPE_COLORS[t] || '#dc2626');
    upd('badgeColor',  TYPE_COLORS[t] || '#dc2626');
    if (t === 'today')  upd('title', "Today's Deal");
    if (t === 'weekly') upd('title', 'Weekly Deal');
  };

  /* ── summary counts ── */
  const now = new Date();
  const live    = deals.filter(d => d.isActive && new Date(d.endsAt) > now).length;
  const expired = deals.filter(d => new Date(d.endsAt) <= now).length;

  return (
    <div>
      <OfferManager />
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-gray-900">Deals & Offers</h2>
          <p className="text-sm text-gray-500">Create Today's Deals, Weekly Deals, and custom time-limited offers with live countdowns</p>
        </div>
        <button onClick={openAdd} className="btn-primary text-sm">+ New Deal</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total Deals', value: deals.length, icon: '🏷️', color: 'bg-blue-50 text-blue-700' },
          { label: 'Live Now',    value: live,          icon: '⚡',  color: 'bg-green-50 text-green-700' },
          { label: 'Expired',     value: expired,       icon: '⏰',  color: 'bg-red-50 text-red-600' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.color} flex items-center gap-3`}>
            <span className="text-2xl">{s.icon}</span>
            <div>
              <p className="text-2xl font-black leading-none">{s.value}</p>
              <p className="text-xs font-semibold mt-0.5 opacity-70">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Deal cards */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400">Loading…</div>
      ) : deals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <p className="text-5xl mb-4">🏷️</p>
          <p className="text-lg font-bold text-gray-700 mb-1">No deals yet</p>
          <p className="text-sm text-gray-400 mb-5">Create Today's Deals or Weekly Deals to show on the homepage</p>
          <button onClick={openAdd} className="btn-primary text-sm">+ Create First Deal</button>
        </div>
      ) : (
        <div className="space-y-3">
          {deals.map(deal => {
            const isExpired = new Date(deal.endsAt) <= now;
            const typeColor = TYPE_COLORS[deal.type] || '#dc2626';
            return (
              <div key={deal._id} className={`bg-white rounded-2xl border ${isExpired ? 'border-red-100 opacity-70' : 'border-gray-100'} p-4`}>
                <div className="flex items-start gap-4 flex-wrap">
                  {/* Left: type pill + title */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: typeColor }}>
                        {TYPE_LABELS[deal.type] || deal.type}
                      </span>
                      <DealStatus deal={deal} />
                      {deal.badgeLabel && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: deal.badgeColor || typeColor }}>
                          {deal.badgeLabel}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-gray-900">{deal.title}</h3>
                    {deal.subtitle && <p className="text-sm text-gray-500 mt-0.5">{deal.subtitle}</p>}

                    {/* Product thumbnails */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {(deal.products || []).slice(0, 6).map(p => (
                        p?.thumbnail
                          ? <img key={p._id} src={p.thumbnail} alt={p.name} title={p.name} className="w-8 h-8 rounded-lg object-cover border border-gray-100" />
                          : <div key={p._id || p} className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs">📦</div>
                      ))}
                      {(deal.products || []).length > 6 && (
                        <span className="text-xs text-gray-400">+{deal.products.length - 6} more</span>
                      )}
                      <span className="text-xs text-gray-400 ml-1">{deal.products?.length || 0} products</span>
                    </div>
                  </div>

                  {/* Center: countdown */}
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-xs text-gray-400 mb-1">Ends in</p>
                    {isExpired
                      ? <span className="text-xs font-bold text-red-500">Expired</span>
                      : <CountdownPreview endsAt={deal.endsAt} color={typeColor} />
                    }
                    <p className="text-[10px] text-gray-400 mt-1">{new Date(deal.endsAt).toLocaleDateString()} {new Date(deal.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleActive(deal)} className={`p-2 rounded-xl text-sm transition-colors ${deal.isActive ? 'hover:bg-amber-50 text-amber-500' : 'hover:bg-green-50 text-gray-400'}`} title={deal.isActive ? 'Deactivate' : 'Activate'}>
                      {deal.isActive ? '🙈' : '👁'}
                    </button>
                    <button onClick={() => openEdit(deal)} className="p-2 rounded-xl hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors" title="Edit">✏️</button>
                    <button onClick={() => deleteDeal(deal._id)} className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Delete">🗑️</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {modal && (
        <Modal title={modal === 'edit' ? '✏️ Edit Deal' : '+ New Deal'} onClose={() => setModal(null)}>
          <div className="space-y-5">

            {/* Deal type selector */}
            <div>
              <label className="form-label">Deal Type *</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(TYPE_LABELS).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onTypeChange(k)}
                    className={`py-2.5 px-3 rounded-xl border-2 text-sm font-semibold transition-all ${form.type === k ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'}`}
                    style={form.type === k ? { background: TYPE_COLORS[k] } : {}}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Deal Title *</label>
                <input value={form.title} onChange={e => upd('title', e.target.value)} className="form-input" placeholder="e.g. Today's Best Deals" />
              </div>
              <div>
                <label className="form-label">Subtitle</label>
                <input value={form.subtitle} onChange={e => upd('subtitle', e.target.value)} className="form-input" placeholder="e.g. Hurry! Offer ends at midnight" />
              </div>
            </div>

            {/* End time */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Deal Ends At *</label>
                <input
                  type="datetime-local"
                  value={toLocalInput(form.endsAt)}
                  onChange={e => upd('endsAt', new Date(e.target.value).toISOString())}
                  className="form-input"
                />
                <div className="flex gap-2 mt-1.5">
                  {[
                    { label: 'End of today', fn: () => { const d = new Date(); d.setHours(23,59,59,0); upd('endsAt', d.toISOString()); } },
                    { label: '+3 days',      fn: () => { const d = new Date(); d.setDate(d.getDate()+3); upd('endsAt', d.toISOString()); } },
                    { label: '+7 days',      fn: () => { const d = new Date(); d.setDate(d.getDate()+7); upd('endsAt', d.toISOString()); } },
                  ].map(btn => (
                    <button key={btn.label} type="button" onClick={btn.fn} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">{btn.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">Sort Order</label>
                <input type="number" value={form.sortOrder} onChange={e => upd('sortOrder', Number(e.target.value))} className="form-input" placeholder="0 = first" />
              </div>
            </div>

            {/* Badge */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Badge Label</label>
                <input value={form.badgeLabel} onChange={e => upd('badgeLabel', e.target.value)} className="form-input" placeholder="e.g. 50% OFF, Hot Deal" />
              </div>
              <div>
                <label className="form-label">Badge & Accent Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.accentColor} onChange={e => { upd('accentColor', e.target.value); upd('badgeColor', e.target.value); }} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 flex-shrink-0" />
                  <input value={form.accentColor} onChange={e => { upd('accentColor', e.target.value); upd('badgeColor', e.target.value); }} className="form-input text-sm" placeholder="#dc2626" />
                </div>
              </div>
            </div>

            {/* Products */}
            <div>
              <label className="form-label">Products in this Deal * <span className="font-normal text-gray-400">(select existing products)</span></label>
              <ProductPicker selected={form.products} onChange={v => upd('products', v)} />
            </div>

            {/* Active toggle */}
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-gray-100 hover:bg-gray-50">
              <div className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${form.isActive ? 'bg-green-500' : 'bg-gray-200'}`} onClick={() => upd('isActive', !form.isActive)}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isActive ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Active</p>
                <p className="text-xs text-gray-400">Show this deal on the homepage</p>
              </div>
            </label>

            {/* Save / Cancel */}
            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Create Deal'}
              </button>
              <button onClick={() => setModal(null)} className="btn-outline px-6">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
