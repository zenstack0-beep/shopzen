import React, { useEffect, useState, useCallback } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';

// ─── Reusable form field ───────────────────────────────────────────────────────
const F = ({ label, hint, children, ...props }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
    {children || <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" {...props} />}
    {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
  </div>
);

// ─── Toggle switch ─────────────────────────────────────────────────────────────
const Toggle = ({ value, onChange, label, hint }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <div>
      <p className="text-sm font-medium text-gray-700">{label}</p>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  </div>
);

// ─── Multi-select dropdown with removable chips ────────────────────────────────
// Renders a <select> that adds the chosen option to `values` on change, plus
// chips below showing current selections (each removable). Used for the
// coupon "Applicable Categories / Subcategories / Brands" pickers — all of
// which are arrays on the Coupon schema.
const MultiSelectChips = ({ label, hint, values, onChange, options, placeholder, getLabel }) => {
  const selected = values || [];
  const available = options.filter(o => !selected.includes(o.value));

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <select
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white disabled:bg-gray-50 disabled:text-gray-400"
        value=""
        disabled={available.length === 0}
        onChange={e => {
          if (!e.target.value) return;
          onChange([...selected, e.target.value]);
        }}
      >
        <option value="">{available.length === 0 ? 'All selected' : (placeholder || 'Select…')}</option>
        {available.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map(v => (
            <span key={v} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 font-medium px-2.5 py-1 rounded-full">
              {getLabel(v)}
              <button
                type="button"
                onClick={() => onChange(selected.filter(s => s !== v))}
                className="text-blue-400 hover:text-blue-700 leading-none"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Empty blank slate ─────────────────────────────────────────────────────────
const EMPTY = {
  code: '', description: '', type: 'percentage', value: '',
  minOrderAmount: 0, maxDiscount: '', usageLimit: '', userLimit: 1,
  validFrom: new Date().toISOString().slice(0, 10),
  validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  isActive: true, isNewUserOnly: false,
  excludeSaleItems: false, maxDiscountPercentOfProfit: 0,
  applicableCategories: [], applicableProducts: [], applicableBrands: [],
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isExpired(d) { return d && new Date(d) < new Date(); }
function isUpcoming(d) { return d && new Date(d) > new Date(); }

export default function AdminCoupons() {
  const [coupons, setCoupons]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [form, setForm]           = useState(null);   // null = list view, object = edit/create
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(null);
  const [filter, setFilter]       = useState('all');  // all | active | expired | inactive
  const [search, setSearch]       = useState('');
  const [categories, setCategories] = useState([]);   // flat list (parents + subcategories)
  const [brandOptions, setBrandOptions] = useState([]); // distinct brand names across products

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get('/coupons');
      setCoupons(data);
    } catch { toast.error('Failed to load coupons'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load categories + brands once, used to populate the Applicability dropdowns
  useEffect(() => {
    API.get('/categories/all').then(r => setCategories(r.data)).catch(() => {});
    API.get('/products/admin/brands').then(r => setBrandOptions(r.data)).catch(() => {});
  }, []);

  // ── Category helpers (top-level vs subcategory, same convention as Products.js) ──
  const parentCategories = categories.filter(c => !c.parent);
  const subCategoriesOf  = (parentId) => categories.filter(c => (c.parent?._id || c.parent) === parentId);
  const categoryById     = (id) => categories.find(c => c._id === id);

  // ── Derived list ──────────────────────────────────────────────────────────
  const filtered = coupons.filter(c => {
    const matchSearch = !search || c.code.includes(search.toUpperCase()) || (c.description || '').toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filter === 'active')   return c.isActive && !isExpired(c.validUntil);
    if (filter === 'expired')  return isExpired(c.validUntil);
    if (filter === 'inactive') return !c.isActive;
    return true;
  });

  // ── Save (create or update) ───────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.code.trim())    return toast.error('Code is required');
    if (!form.value)          return toast.error('Discount value is required');
    if (!form.validUntil)     return toast.error('Expiry date is required');

    setSaving(true);
    try {
      const payload = {
        ...form,
        code:                      form.code.toUpperCase().trim(),
        value:                     Number(form.value),
        minOrderAmount:            Number(form.minOrderAmount) || 0,
        maxDiscount:               form.maxDiscount ? Number(form.maxDiscount) : undefined,
        usageLimit:                form.usageLimit  ? Number(form.usageLimit)  : undefined,
        userLimit:                 Number(form.userLimit) || 1,
        maxDiscountPercentOfProfit:Number(form.maxDiscountPercentOfProfit) || 0,
        applicableCategories:      form.applicableCategories || [],
        applicableProducts:        form.applicableProducts || [],
        applicableBrands:          form.applicableBrands || [],
      };

      if (form._id) {
        await API.put(`/coupons/${form._id}`, payload);
        toast.success('Coupon updated ✓');
      } else {
        await API.post('/coupons', payload);
        toast.success('Coupon created ✓');
      }
      setForm(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm('Delete this coupon? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await API.delete(`/coupons/${id}`);
      toast.success('Deleted');
      load();
    } catch { toast.error('Delete failed'); }
    finally  { setDeleting(null); }
  };

  // ── Toggle active ─────────────────────────────────────────────────────────
  const toggleActive = async (c) => {
    try {
      await API.put(`/coupons/${c._id}`, { ...c, isActive: !c.isActive });
      load();
    } catch { toast.error('Update failed'); }
  };

  // ── Status badge ──────────────────────────────────────────────────────────
  const StatusBadge = ({ c }) => {
    if (!c.isActive)              return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Inactive</span>;
    if (isExpired(c.validUntil))  return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Expired</span>;
    if (isUpcoming(c.validFrom))  return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">Upcoming</span>;
    return                               <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Active</span>;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // FORM VIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (form) return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-700 text-xl">←</button>
        <div>
          <h2 className="font-bold text-xl text-gray-900">{form._id ? 'Edit Coupon' : 'New Coupon'}</h2>
          <p className="text-xs text-gray-400 mt-0.5">All discount rules enforced by the central Discount Engine</p>
        </div>
      </div>

      <div className="space-y-5">

        {/* ── Basic Info ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 text-sm">Basic Info</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <F label="Coupon Code *">
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="SAVE20"
              />
            </F>
            <F label="Status">
              <select
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={form.isActive ? 'active' : 'inactive'}
                onChange={e => setForm(p => ({ ...p, isActive: e.target.value === 'active' }))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </F>
          </div>
          <F label="Description" value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. 20% off sitewide for new customers" />
          <div className="grid sm:grid-cols-2 gap-4">
            <F label="Valid From" type="date" value={form.validFrom?.slice(0,10)} onChange={e => setForm(p => ({ ...p, validFrom: e.target.value }))} />
            <F label="Valid Until *" type="date" value={form.validUntil?.slice(0,10)} onChange={e => setForm(p => ({ ...p, validUntil: e.target.value }))} />
          </div>
        </div>

        {/* ── Discount Value ─────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 text-sm">Discount Value</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <F label="Type">
              <select
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={form.type}
                onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
              >
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount (Rs.)</option>
              </select>
            </F>
            <F
              label={form.type === 'percentage' ? 'Discount (%)' : 'Discount (Rs.)'}
              type="number" min="0"
              value={form.value}
              onChange={e => setForm(p => ({ ...p, value: e.target.value }))}
              placeholder={form.type === 'percentage' ? '20' : '500'}
            />
            {form.type === 'percentage' && (
              <F
                label="Max Discount Cap (Rs.)"
                type="number" min="0"
                value={form.maxDiscount || ''}
                onChange={e => setForm(p => ({ ...p, maxDiscount: e.target.value }))}
                hint="Leave blank for no cap"
                placeholder="1000"
              />
            )}
          </div>
          <F
            label="Minimum Order Amount (Rs.)"
            type="number" min="0"
            value={form.minOrderAmount || 0}
            onChange={e => setForm(p => ({ ...p, minOrderAmount: e.target.value }))}
            hint="Customer must spend at least this amount to use the coupon"
          />
        </div>

        {/* ── Applicability (Category / Subcategory / Brand) ──── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">Applicability</h3>
            <p className="text-xs text-gray-400 mt-0.5">Restrict this coupon to specific categories, subcategories, or brands. Leave all empty to apply sitewide.</p>
          </div>

          <MultiSelectChips
            label="Categories"
            hint="Top-level categories this coupon applies to"
            values={form.applicableCategories}
            onChange={vals => setForm(p => ({ ...p, applicableCategories: vals }))}
            options={parentCategories.map(c => ({ value: c._id, label: c.name }))}
            placeholder="Select a category…"
            getLabel={id => categoryById(id)?.name || 'Unknown'}
          />

          <MultiSelectChips
            label="Subcategories"
            hint={
              form.applicableCategories?.some(id => subCategoriesOf(id).length > 0)
                ? 'Narrow further to specific subcategories within the categories selected above'
                : 'Select a category above to see its subcategories, or pick any subcategory directly'
            }
            values={form.applicableCategories}
            onChange={vals => setForm(p => ({ ...p, applicableCategories: vals }))}
            options={
              (form.applicableCategories?.length
                ? [...new Set(form.applicableCategories.flatMap(id => subCategoriesOf(id)))]
                : categories.filter(c => c.parent)
              ).map(c => ({ value: c._id, label: c.name }))
            }
            placeholder="Select a subcategory…"
            getLabel={id => categoryById(id)?.name || 'Unknown'}
          />

          <MultiSelectChips
            label="Brands"
            hint="Limit this coupon to products from specific brands"
            values={form.applicableBrands}
            onChange={vals => setForm(p => ({ ...p, applicableBrands: vals }))}
            options={brandOptions.map(b => ({ value: b, label: b }))}
            placeholder="Select a brand…"
            getLabel={b => b}
          />
        </div>

        {/* ── Usage Limits ───────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 text-sm">Usage Limits</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <F
              label="Total Usage Limit"
              type="number" min="1"
              value={form.usageLimit || ''}
              onChange={e => setForm(p => ({ ...p, usageLimit: e.target.value }))}
              hint="Max times this coupon can be used across all customers. Leave blank = unlimited."
              placeholder="e.g. 100"
            />
            <F
              label="Uses Per Customer"
              type="number" min="1"
              value={form.userLimit || 1}
              onChange={e => setForm(p => ({ ...p, userLimit: Number(e.target.value) }))}
              hint="Max times one customer (or guest email) can use this coupon"
            />
          </div>
          {form._id && (
            <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm text-blue-700">
              Used <strong>{form.usedCount || 0}</strong> time{(form.usedCount || 0) !== 1 ? 's' : ''} so far
              {form.usageLimit ? ` out of ${form.usageLimit}` : ''}
            </div>
          )}
          <Toggle
            value={form.isNewUserOnly}
            onChange={v => setForm(p => ({ ...p, isNewUserOnly: v }))}
            label="New Customers Only"
            hint="Blocks customers (by account or billing email) who have placed any prior order"
          />
        </div>

        {/* ── Discount Rules (the new section) ──────────────── */}
        <div className="bg-white rounded-2xl border border-blue-100 p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🛡️</span>
            <div>
              <h3 className="font-semibold text-gray-800 text-sm">Discount Rules & Protection</h3>
              <p className="text-xs text-gray-400">Control how this coupon interacts with other discounts and profit margins</p>
            </div>
          </div>

          <Toggle
            value={form.excludeSaleItems}
            onChange={v => setForm(p => ({ ...p, excludeSaleItems: v }))}
            label="Block on Sale Items"
            hint="Prevents this coupon from being used when any item in the cart already has a sale price — stops discount stacking"
          />

          <div className="border-t border-gray-100 pt-4">
            <F
              label="Maximum Discount % of Profit Margin"
              type="number" min="0" max="100"
              value={form.maxDiscountPercentOfProfit || 0}
              onChange={e => setForm(p => ({ ...p, maxDiscountPercentOfProfit: Number(e.target.value) }))}
              hint="Caps the discount so it never eats more than this % of the order's total profit margin (requires costPrice on products). Set 0 to disable."
              placeholder="0"
            />
            {Number(form.maxDiscountPercentOfProfit) > 0 && (
              <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
                ⚠️ Profit protection active — if the calculated discount exceeds {form.maxDiscountPercentOfProfit}% of the order margin, it will be automatically reduced. Requires <strong>Cost Price</strong> to be set on each product.
              </div>
            )}
          </div>
        </div>

        {/* ── Discount Priority Info ─────────────────────────── */}
        <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">ℹ️ How Discount Priority Works</h3>
          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">1</span>
              <span><strong>Only the best benefit applies.</strong> If a customer has both a coupon and a gift card, the Discount Engine automatically picks whichever gives the larger saving. They do not stack.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">2</span>
              <span><strong>Gift cards act as payment, not discount.</strong> They apply after all coupon discounts are calculated and can cover delivery fees too.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">3</span>
              <span><strong>Only the highest product discount applies.</strong> If a product has both a sale price and is in a deal/campaign, only the lowest final price is used — never combined.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">4</span>
              <span><strong>Coupon is revalidated at order creation.</strong> A coupon passing the pre-check does not guarantee it will apply at checkout — usage limits and eligibility are rechecked server-side.</span>
            </div>
          </div>
        </div>

        {/* ── Actions ───────────────────────────────────────── */}
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={() => setForm(null)} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
            {saving && <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {saving ? 'Saving…' : form._id ? '✓ Update Coupon' : '✓ Create Coupon'}
          </button>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // LIST VIEW
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-2xl text-gray-900">Coupons</h2>
          <p className="text-xs text-gray-400 mt-1">All pricing enforced by the central Discount Engine — no stacking, profit-protected</p>
        </div>
        <button onClick={() => setForm({ ...EMPTY })} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
          + New Coupon
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-48"
          placeholder="Search code or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {['all','active','expired','inactive'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors capitalize ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {f}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} coupon{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Discount Engine summary strip */}
      <div className="grid sm:grid-cols-4 gap-3 mb-6">
        {[
          { icon:'🏷️', label:'Highest benefit wins', sub:'Coupon vs gift card — best saves more' },
          { icon:'🚫', label:'No stacking', sub:'Only one customer benefit per order' },
          { icon:'🛡️', label:'Profit protected', sub:'Discount capped by margin if set' },
          { icon:'🔒', label:'Server revalidation', sub:'Coupon rechecked at order creation' },
        ].map(({ icon, label, sub }) => (
          <div key={label} className="bg-blue-50 rounded-xl p-3 border border-blue-100">
            <div className="text-xl mb-1">{icon}</div>
            <p className="text-xs font-semibold text-blue-800">{label}</p>
            <p className="text-xs text-blue-500 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">🏷️</div>
          <p className="font-semibold text-gray-600">No coupons found</p>
          <p className="text-sm mt-1">Create your first coupon to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => (
            <div key={c._id} className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap gap-4 items-start">
              {/* Code + badges */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-mono font-bold text-gray-900 text-base tracking-wide">{c.code}</span>
                  <StatusBadge c={c} />
                  {c.isNewUserOnly    && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">New users</span>}
                  {c.excludeSaleItems && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">No sale items</span>}
                  {c.maxDiscountPercentOfProfit > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">Profit cap {c.maxDiscountPercentOfProfit}%</span>}
                </div>
                {c.description && <p className="text-xs text-gray-500 mb-2">{c.description}</p>}
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>
                    {c.type === 'percentage'
                      ? `${c.value}% off${c.maxDiscount ? ` (max Rs. ${c.maxDiscount.toLocaleString()})` : ''}`
                      : `Rs. ${c.value?.toLocaleString()} off`
                    }
                  </span>
                  {c.minOrderAmount > 0 && <span>Min: Rs. {c.minOrderAmount.toLocaleString()}</span>}
                  <span>Valid until {fmtDate(c.validUntil)}</span>
                  <span>Used: {c.usedCount || 0}{c.usageLimit ? `/${c.usageLimit}` : ''}</span>
                  <span>Per user: {c.userLimit || 1}×</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleActive(c)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${c.isActive ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                >
                  {c.isActive ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => setForm({ ...EMPTY, ...c, validFrom: c.validFrom?.slice(0,10), validUntil: c.validUntil?.slice(0,10) })}
                  className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(c._id)}
                  disabled={deleting === c._id}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 font-medium"
                >
                  {deleting === c._id ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}