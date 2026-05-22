import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import API from '../../utils/api';
import toast from 'react-hot-toast';

const DESIGNS = [
  { id:'default', emoji:'🎁', label:'Classic Gift', bg:'linear-gradient(135deg,#b5451b,#f0a500)' },
  { id:'birthday', emoji:'🎂', label:'Birthday', bg:'linear-gradient(135deg,#7c3aed,#a78bfa)' },
  { id:'christmas', emoji:'🎄', label:'Christmas', bg:'linear-gradient(135deg,#15803d,#84cc16)' },
  { id:'anniversary', emoji:'💝', label:'Anniversary', bg:'linear-gradient(135deg,#be185d,#fb7185)' },
  { id:'thankyou', emoji:'💙', label:'Thank You', bg:'linear-gradient(135deg,#0369a1,#06b6d4)' },
];

const AMOUNTS = [500, 1000, 2000, 5000, 10000];

const GiftCardPreview = ({ design, amount, recipientName, message, sym }) => {
  const d = DESIGNS.find(x => x.id === design) || DESIGNS[0];
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: d.bg, maxWidth: 340, margin: '0 auto' }}>
      <div className="p-6 text-center text-white">
        <div className="text-5xl mb-2">{d.emoji}</div>
        <p className="font-bold text-xl mb-1" style={{ fontFamily: 'var(--font-display)' }}>{d.label}</p>
        {recipientName && <p className="text-white/80 text-sm">For {recipientName}</p>}
      </div>
      <div className="bg-white/15 backdrop-blur-sm p-5 text-white">
        <div className="text-center mb-4">
          <p className="text-3xl font-black">{sym} {(amount || 0).toLocaleString()}</p>
          <p className="text-white/70 text-xs mt-1">Gift Card Value</p>
        </div>
        {message && (
          <div className="bg-white/10 rounded-xl p-3 mb-4">
            <p className="text-sm text-white/90 italic text-center">"{message}"</p>
          </div>
        )}
        <div className="bg-white/20 rounded-xl p-3 text-center">
          <p className="text-xs text-white/60 mb-1">Gift Card Code</p>
          <p className="font-mono font-bold text-base tracking-widest">GC-XXXX-XXXX-XXXX</p>
        </div>
      </div>
    </div>
  );
};

export default function GiftCards() {
  const { user } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();
  const sym = settings?.currencySymbol || 'Rs.';

  const [tab, setTab] = useState('buy');
  const [myCards, setMyCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkCode, setCheckCode] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [step, setStep] = useState(1); // 1=amount, 2=recipient, 3=confirm

  const [form, setForm] = useState({
    amount: 1000, customAmount: '',
    recipientName: '', recipientEmail: '', recipientPhone: '', message: '',
    design: 'default', paymentMethod: 'bank_transfer'
  });

  useEffect(() => {
    if (user && tab === 'mine') {
      API.get('/gift-cards/my-cards').then(r => setMyCards(r.data)).catch(() => {});
    }
  }, [user, tab]);

  const handlePurchase = async () => {
    if (!form.recipientEmail && !form.recipientPhone) { toast.error('Enter recipient email or phone'); return; }
    const amount = form.customAmount ? Number(form.customAmount) : form.amount;
    if (!amount || amount < 100) { toast.error('Minimum gift card value is Rs. 100'); return; }

    setLoading(true);
    try {
      await API.post('/gift-cards/purchase', {
        amount,
        recipientName: form.recipientName,
        recipientEmail: form.recipientEmail,
        recipientPhone: form.recipientPhone,
        message: form.message,
        design: form.design,
        paymentMethod: form.paymentMethod
      });
      toast.success('Gift card order placed! 🎁');
      setStep(4); // success
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  const checkBalance = async () => {
    if (!checkCode.trim()) return;
    try {
      const { data } = await API.get(`/gift-cards/balance/${checkCode.toUpperCase()}`);
      setCheckResult(data);
    } catch (err) { setCheckResult({ error: err.response?.data?.message || 'Not found' }); }
  };

  const amount = form.customAmount ? Number(form.customAmount) : form.amount;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8" style={{ background: 'var(--body-bg)' }}>
      {/* Hero */}
      <div className="rounded-3xl p-8 sm:p-12 text-center mb-8 overflow-hidden relative" style={{ background: 'var(--hero-gradient)' }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-5 right-10 w-40 h-40 rounded-full blur-3xl" style={{ background: 'var(--color-accent)' }}/>
          <div className="absolute bottom-5 left-10 w-32 h-32 rounded-full blur-2xl" style={{ background: 'var(--color-primary)' }}/>
        </div>
        <div className="relative z-10">
          <div className="text-5xl mb-3">🎁</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>Gift Cards</h1>
          <p className="text-white/80 text-sm sm:text-base max-w-md mx-auto">The perfect gift for any occasion. Give someone the joy of choice.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-8">
        {[['buy','🎁 Buy a Gift Card'],['check','🔍 Check Balance'],['mine','💳 My Cards']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${tab===id?'bg-white shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* BUY TAB */}
      {tab === 'buy' && (
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Form */}
          <div className="space-y-5">
            {/* Step 1: Amount & Design */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--color-primary)' }}>1</span>
                Choose Amount
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
                {AMOUNTS.map(a => (
                  <button key={a} onClick={() => setForm(p => ({ ...p, amount: a, customAmount: '' }))}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${!form.customAmount && form.amount === a ? 'border-primary text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}
                    style={!form.customAmount && form.amount === a ? { background: 'var(--theme-gradient)', borderColor: 'var(--color-primary)' } : {}}>
                    {a >= 1000 ? `${a/1000}K` : a}
                  </button>
                ))}
              </div>
              <input type="number" value={form.customAmount} onChange={e => setForm(p => ({ ...p, customAmount: e.target.value }))}
                className="form-input text-sm" placeholder={`Custom amount (min. ${sym} 100)`}/>
              <p className="text-xs text-gray-400 mt-1">Total: <strong>{sym} {amount.toLocaleString()}</strong></p>
            </div>

            {/* Step 2: Design */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--color-primary)' }}>2</span>
                Choose Design
              </h3>
              <div className="grid grid-cols-5 gap-2">
                {DESIGNS.map(d => (
                  <button key={d.id} onClick={() => setForm(p => ({ ...p, design: d.id }))}
                    className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 border-2 transition-all ${form.design === d.id ? 'border-primary shadow-lg scale-105' : 'border-gray-100 hover:border-gray-200'}`}
                    style={{ background: d.bg }}>
                    <span className="text-xl">{d.emoji}</span>
                    <span className="text-white text-[10px] font-semibold">{d.label.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Recipient */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--color-primary)' }}>3</span>
                Recipient Details
              </h3>
              <div className="space-y-3">
                <div><label className="form-label">Recipient Name</label>
                  <input value={form.recipientName} onChange={e => setForm(p => ({ ...p, recipientName: e.target.value }))} className="form-input" placeholder="Their name"/></div>
                <div><label className="form-label">Email Address</label>
                  <input type="email" value={form.recipientEmail} onChange={e => setForm(p => ({ ...p, recipientEmail: e.target.value }))} className="form-input" placeholder="recipient@email.com"/></div>
                <div><label className="form-label">Phone (optional)</label>
                  <input type="tel" value={form.recipientPhone} onChange={e => setForm(p => ({ ...p, recipientPhone: e.target.value }))} className="form-input" placeholder="+94 7X XXX XXXX"/></div>
                <div><label className="form-label">Personal Message</label>
                  <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} rows={3} className="form-input resize-none" placeholder="Write a heartfelt message..."/></div>
              </div>
            </div>

            {/* Step 4: Payment */}
            <div className="rounded-2xl border border-gray-100 p-5" style={{ background: 'var(--card-bg)' }}>
              <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--color-primary)' }}>4</span>
                Payment
              </h3>
              <div className="space-y-2">
                {[['bank_transfer','🏦','Bank Transfer'],['cod','💵','Cash on Delivery']].map(([val,icon,label]) => (
                  <label key={val} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${form.paymentMethod===val?'border-primary bg-primary/5':'border-gray-200'}`}
                    style={form.paymentMethod===val?{borderColor:'var(--color-primary)'}:{}}>
                    <input type="radio" name="gcpayment" value={val} checked={form.paymentMethod===val} onChange={()=>setForm(p=>({...p,paymentMethod:val}))} style={{accentColor:'var(--color-primary)'}}/>
                    <span>{icon}</span><span className="font-semibold text-sm text-gray-800">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {step === 4 ? (
              <div className="rounded-2xl bg-green-50 border border-green-200 p-6 text-center">
                <div className="text-4xl mb-2">🎉</div>
                <h3 className="font-bold text-green-800 mb-1">Gift Card Order Placed!</h3>
                <p className="text-sm text-green-700 mb-4">Your gift card will be activated after payment confirmation and sent to {form.recipientEmail || form.recipientPhone}.</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => { setStep(1); setForm({ amount:1000,customAmount:'',recipientName:'',recipientEmail:'',recipientPhone:'',message:'',design:'default',paymentMethod:'bank_transfer' }); }} className="btn-outline text-sm">Buy Another</button>
                  <Link to="/account" className="btn-primary text-sm">My Orders</Link>
                </div>
              </div>
            ) : (
              <button onClick={user ? handlePurchase : () => navigate('/login?redirect=/gift-cards')} disabled={loading}
                className="btn-primary w-full py-4 text-base">
                {loading ? 'Processing...' : user ? `Send Gift Card — ${sym} ${amount.toLocaleString()}` : 'Sign in to Purchase →'}
              </button>
            )}
          </div>

          {/* Preview */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <h3 className="font-semibold text-gray-700 mb-4 text-center text-sm">Preview</h3>
              <GiftCardPreview design={form.design} amount={amount} recipientName={form.recipientName} message={form.message} sym={sym}/>
              <div className="mt-5 bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-700">
                <p className="font-semibold mb-1">How it works:</p>
                <ol className="space-y-1 list-decimal list-inside">
                  <li>Complete payment</li>
                  <li>We activate the gift card</li>
                  <li>Recipient gets an email with the code</li>
                  <li>They use the code at checkout</li>
                  <li>Balance carries over if not fully used</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHECK BALANCE TAB */}
      {tab === 'check' && (
        <div className="max-w-md mx-auto">
          <div className="rounded-2xl border border-gray-100 p-6" style={{ background: 'var(--card-bg)' }}>
            <h3 className="font-bold text-gray-900 mb-4 text-center">Check Gift Card Balance</h3>
            <div className="flex gap-2 mb-4">
              <input value={checkCode} onChange={e => setCheckCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && checkBalance()}
                className="form-input font-mono uppercase flex-1" placeholder="GC-XXXX-XXXX-XXXX"/>
              <button onClick={checkBalance} className="btn-primary text-sm px-4 flex-shrink-0">Check</button>
            </div>
            {checkResult && (
              checkResult.error ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                  <p className="text-red-600 font-medium text-sm">❌ {checkResult.error}</p>
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden">
                  <div className="p-5 text-white text-center" style={{ background: 'var(--theme-gradient)' }}>
                    <p className="font-mono text-lg font-bold mb-1">{checkResult.code}</p>
                    <p className="text-3xl font-black">{sym} {checkResult.balance?.toLocaleString()}</p>
                    <p className="text-white/70 text-xs mt-1">Remaining Balance</p>
                  </div>
                  <div className="bg-gray-50 p-4 text-sm space-y-2">
                    <div className="flex justify-between"><span className="text-gray-500">Initial Value</span><span className="font-semibold">{sym} {checkResult.initialValue?.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Used</span><span className="font-semibold">{sym} {(checkResult.initialValue - checkResult.balance)?.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Status</span><span className={`font-semibold ${checkResult.isActive ? 'text-green-600' : 'text-amber-600'}`}>{checkResult.isActive ? '✓ Active' : '⏳ Inactive'}</span></div>
                    {checkResult.expiresAt && <div className="flex justify-between"><span className="text-gray-500">Expires</span><span className="font-semibold">{new Date(checkResult.expiresAt).toLocaleDateString()}</span></div>}
                  </div>
                  {checkResult.balance > 0 && checkResult.isActive && (
                    <div className="p-3 bg-green-50 text-center">
                      <Link to="/shop" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>Use it now → Shop</Link>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* MY CARDS TAB */}
      {tab === 'mine' && (
        <div>
          {!user ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-3">🔒</div>
              <p className="text-gray-500 mb-4">Sign in to see your gift cards</p>
              <Link to="/login?redirect=/gift-cards" className="btn-primary">Sign In</Link>
            </div>
          ) : myCards.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-3 float">🎁</div>
              <p className="text-gray-500 mb-4">You haven't purchased any gift cards yet</p>
              <button onClick={() => setTab('buy')} className="btn-primary">Buy a Gift Card</button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {myCards.map(card => {
                const d = DESIGNS.find(x => x.id === card.design) || DESIGNS[0];
                return (
                  <div key={card._id} className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                    <div className="p-4 text-white" style={{ background: d.bg }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl">{d.emoji}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${card.isActive ? 'bg-green-500' : 'bg-white/20'}`}>
                          {card.isActive ? 'Active' : card.paymentStatus === 'pending' ? 'Pending' : 'Inactive'}
                        </span>
                      </div>
                      <p className="font-mono text-sm font-bold tracking-wider">{card.code}</p>
                    </div>
                    <div className="p-4 bg-white">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-gray-500">Balance</span>
                        <span className="font-bold text-gray-900">{sym} {card.balance?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between mb-3">
                        <span className="text-sm text-gray-500">For</span>
                        <span className="text-sm text-gray-700">{card.recipientName || card.recipientEmail || '—'}</span>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${(card.balance/card.initialValue)*100}%`, background: 'var(--theme-gradient)' }}/>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{sym} {card.balance?.toLocaleString()} of {sym} {card.initialValue?.toLocaleString()} remaining</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
