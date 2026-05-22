import React, { useEffect, useState } from 'react';
import useSEO from '../../hooks/useSEO';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import API from '../../utils/api';
import toast from 'react-hot-toast';

const statusColors = { pending:'status-pending', confirmed:'status-confirmed', processing:'status-processing', shipped:'status-shipped', out_for_delivery:'status-out_for_delivery', delivered:'status-delivered', cancelled:'status-cancelled' };

export default function Account() {
  const { user, updateUser } = useAuth();
  useSEO({ title: 'Account', noindex: true });
  const { settings } = useTheme();
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState({ firstName: user?.firstName||'', lastName: user?.lastName||'', phone: '' });
  const [passwords, setPasswords] = useState({ currentPassword:'', newPassword:'', confirm:'' });
  const [saving, setSaving] = useState(false);
  const sym = settings?.currencySymbol || 'Rs.';
  const primary = 'var(--color-primary)';

  useEffect(() => {
    API.get('/orders/my-orders').then(r => setOrders(r.data)).finally(() => setLoading(false));
    API.get('/auth/me').then(r => setProfile(p => ({ ...p, firstName: r.data.firstName, lastName: r.data.lastName, phone: r.data.phone||'' })));
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const { data } = await API.put('/auth/profile', profile);
      updateUser(data);
      toast.success('Profile updated!');
    } catch { toast.error('Update failed'); }
    finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (passwords.newPassword !== passwords.confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      await API.put('/auth/change-password', { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      toast.success('Password changed!');
      setPasswords({ currentPassword:'', newPassword:'', confirm:'' });
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8" style={{ background: 'var(--body-bg)' }}>
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg" style={{ background: 'var(--theme-gradient)' }}>
          {user?.firstName?.[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>{user?.firstName} {user?.lastName}</h1>
          <p className="text-gray-500 text-sm">{user?.email}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-8 overflow-x-auto">
        {[['orders','My Orders'],['profile','Profile'],['security','Security']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-all ${tab === id ? '' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            style={tab === id ? { borderColor: primary, color: primary } : {}}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <div>
          {loading ? <div className="text-center py-10 text-gray-400">Loading orders...</div>
          : orders.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3 float">📦</div>
              <p className="text-gray-500">No orders yet. <Link to="/shop" className="font-semibold hover:underline" style={{ color: primary }}>Start shopping!</Link></p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map(order => (
                <div key={order._id} className="rounded-2xl border border-gray-100 p-5 hover-lift" style={{ background: 'var(--card-bg)' }}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-mono text-sm font-bold" style={{ color: primary }}>{order.orderNumber}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(order.createdAt).toLocaleDateString()}</p>
                    </div>
                    <span className={`badge ${statusColors[order.orderStatus]||''} capitalize`}>{order.orderStatus?.replace(/_/g,' ')}</span>
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {order.items?.slice(0,3).map((item,i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-2 py-1">
                        <img src={item.image||'https://via.placeholder.com/30'} alt="" className="w-5 h-5 rounded object-cover"/>
                        {item.name} ×{item.quantity}
                      </div>
                    ))}
                    {order.items?.length > 3 && <span className="text-xs text-gray-400 self-center">+{order.items.length-3} more</span>}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                    <p className="font-bold text-gray-900">{sym} {order.total?.toLocaleString()}</p>
                    <Link to={`/track-order/${order._id}`} className="text-sm font-semibold hover:underline" style={{ color: primary }}>Track Order →</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'profile' && (
        <div className="max-w-lg">
          <div className="rounded-2xl border border-gray-100 p-6 space-y-4" style={{ background: 'var(--card-bg)' }}>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="form-label">First Name</label><input value={profile.firstName} onChange={e => setProfile(p => ({...p, firstName: e.target.value}))} className="form-input"/></div>
              <div><label className="form-label">Last Name</label><input value={profile.lastName} onChange={e => setProfile(p => ({...p, lastName: e.target.value}))} className="form-input"/></div>
            </div>
            <div><label className="form-label">Phone</label><input type="tel" value={profile.phone} onChange={e => setProfile(p => ({...p, phone: e.target.value}))} className="form-input"/></div>
            <div><label className="form-label">Email</label><input value={user?.email} disabled className="form-input bg-gray-50 text-gray-500"/></div>
            <button onClick={saveProfile} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="max-w-lg">
          <div className="rounded-2xl border border-gray-100 p-6 space-y-4" style={{ background: 'var(--card-bg)' }}>
            <div><label className="form-label">Current Password</label><input type="password" value={passwords.currentPassword} onChange={e => setPasswords(p => ({...p, currentPassword: e.target.value}))} className="form-input"/></div>
            <div><label className="form-label">New Password</label><input type="password" value={passwords.newPassword} onChange={e => setPasswords(p => ({...p, newPassword: e.target.value}))} className="form-input"/></div>
            <div><label className="form-label">Confirm New Password</label><input type="password" value={passwords.confirm} onChange={e => setPasswords(p => ({...p, confirm: e.target.value}))} className="form-input"/></div>
            <button onClick={changePassword} disabled={saving} className="btn-primary">{saving ? 'Changing...' : 'Change Password'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
