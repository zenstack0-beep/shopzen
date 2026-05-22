import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import toast from 'react-hot-toast';

const Logo = ({ settings }) => (
  <Link to="/" className="inline-flex items-center gap-2 mb-6">
    {settings?.logoUrl ? (
      <img src={settings.logoUrl} alt={settings?.storeName||'Store'} className="h-10 object-contain"/>
    ) : (
      <>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: 'var(--theme-gradient)' }}>
          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
        </div>
        <span className="font-bold text-2xl text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>{settings?.storeName || 'ShopZen'}</span>
      </>
    )}
  </Link>
);

const Spinner = () => (
  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

export function Login() {
  const { login } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      toast.success(`Welcome back, ${user.firstName}! 👋`);
      navigate(user.role === 'admin' ? '/admin' : '/');
    } catch (err) { toast.error(err.response?.data?.message || 'Invalid email or password'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: 'var(--body-bg)' }}>
      <div className="w-full max-w-md fade-in">
        <div className="text-center mb-8">
          <Logo settings={settings}/>
          <h1 className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>Welcome back</h1>
          <p className="text-gray-500 mt-1 text-sm">Sign in to continue shopping</p>
        </div>
        <div className="rounded-2xl border border-gray-100 shadow-xl p-8" style={{ background: 'var(--card-bg)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email Address</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))} required className="form-input" placeholder="you@example.com" autoFocus/>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="form-label mb-0">Password</label>
                <Link to="/forgot-password" className="text-xs font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>Forgot password?</Link>
              </div>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => setForm(p => ({...p, password: e.target.value}))} required className="form-input pr-10" placeholder="••••••••"/>
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
              {loading ? <><Spinner/>Signing in...</> : 'Sign In →'}
            </button>
          </form>
          <div className="relative my-5"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"/></div><div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-gray-400" style={{ background: 'var(--card-bg)' }}>or</span></div></div>
          <p className="text-center text-sm text-gray-500">
            Don't have an account? <Link to="/register" className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>Create one free</Link>
          </p>
        </div>
        <p className="text-center mt-4"><Link to="/" className="text-sm text-gray-400 hover:opacity-75">← Back to store</Link></p>
      </div>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName:'', lastName:'', username:'', email:'', password:'', phone:'' });
  const [loading, setLoading] = useState(false);
  const [newUserCoupon, setNewUserCoupon] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      const res = await register(form);
      if (res?.data?.newUserCoupon) setNewUserCoupon(res.data.newUserCoupon);
      else { toast.success('Account created! Welcome 🎉'); navigate('/'); }
    } catch (err) { toast.error(err.response?.data?.message || 'Registration failed'); }
    finally { setLoading(false); }
  };

  if (newUserCoupon) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--body-bg)' }}>
      <div className="rounded-2xl border border-gray-100 shadow-xl p-8 max-w-md w-full text-center bounce-in" style={{ background: 'var(--card-bg)' }}>
        <div className="text-6xl mb-4 bounce-in">🎉</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2" style={{ fontFamily: 'var(--font-display)' }}>Welcome to {settings?.storeName || 'ShopZen'}!</h2>
        <p className="text-gray-500 mb-6">Here's an exclusive gift for your first order:</p>
        <div className="rounded-2xl p-6 text-white mb-6" style={{ background: 'var(--theme-gradient)' }}>
          <p className="text-sm text-white/80 mb-1">Your Welcome Coupon</p>
          <p className="font-mono text-3xl font-bold tracking-widest">{newUserCoupon.code}</p>
          <p className="text-white/90 mt-2 text-sm">{newUserCoupon.description || `${newUserCoupon.value}${newUserCoupon.type==='percentage'?'%':` ${settings?.currencySymbol||'Rs.'}`} off your first order`}</p>
        </div>
        <button onClick={() => navigate('/shop')} className="btn-primary w-full">Start Shopping →</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: 'var(--body-bg)' }}>
      <div className="w-full max-w-md fade-in">
        <div className="text-center mb-8">
          <Logo settings={settings}/>
          <h1 className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>Create Account</h1>
          <p className="text-gray-500 mt-1 text-sm">Join thousands of happy customers</p>
        </div>
        <div className="rounded-2xl border border-gray-100 shadow-xl p-8" style={{ background: 'var(--card-bg)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="form-label">First Name *</label><input value={form.firstName} onChange={e => setForm(p => ({...p, firstName: e.target.value}))} required className="form-input" placeholder="John"/></div>
              <div><label className="form-label">Last Name *</label><input value={form.lastName} onChange={e => setForm(p => ({...p, lastName: e.target.value}))} required className="form-input" placeholder="Doe"/></div>
            </div>
            <div><label className="form-label">Username *</label><input value={form.username} onChange={e => setForm(p => ({...p, username: e.target.value}))} required className="form-input" placeholder="johndoe123"/></div>
            <div><label className="form-label">Email *</label><input type="email" value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))} required className="form-input"/></div>
            <div><label className="form-label">Phone</label><input type="tel" value={form.phone} onChange={e => setForm(p => ({...p, phone: e.target.value}))} className="form-input" placeholder="+94 7X XXX XXXX"/></div>
            <div><label className="form-label">Password * (min. 6 chars)</label><input type="password" value={form.password} onChange={e => setForm(p => ({...p, password: e.target.value}))} required minLength={6} className="form-input"/></div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
              {loading ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Creating...</> : 'Create Account 🎉'}
            </button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account? <Link to="/login" className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
