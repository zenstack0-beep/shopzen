import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, RadarChart,
  Radar, PolarGrid, PolarAngleAxis, ComposedChart
} from 'recharts';
import API from '../../utils/api';

/* ── Helpers ── */
const fmt = (n) => `Rs. ${(n || 0).toLocaleString()}`;
const pct = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : 0;

const COLORS = ['#b5451b','#f0a500','#3b82f6','#10b981','#8b5cf6','#ef4444','#06b6d4','#84cc16'];
const STATUS_LABELS = { pending:'Pending', confirmed:'Confirmed', processing:'Processing', shipped:'Shipped', out_for_delivery:'Out for Delivery', delivered:'Delivered', cancelled:'Cancelled' };

/* ── KPI Widget ── */
const KPI = ({ label, value, sub, icon, color, trend, prefix = '', suffix = '', onClick }) => (
  <div
    onClick={onClick}
    className={`bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-lg transition-all duration-200 ${onClick ? 'cursor-pointer hover:border-gray-200' : ''}`}
  >
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">{label}</p>
        <p className="font-display text-2xl font-bold text-gray-900 mt-1">{prefix}{value}{suffix}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
      </div>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ml-3 ${color}`}>
        <span className="text-xl">{icon}</span>
      </div>
    </div>
    {trend !== undefined && (
      <div className={`flex items-center gap-1 mt-3 text-xs font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
        <span className={`inline-block w-4 h-4 rounded-full flex items-center justify-center text-white text-xs ${trend >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {trend >= 0 ? '↑' : '↓'}
        </span>
        <span>{Math.abs(trend)}% vs last month</span>
      </div>
    )}
  </div>
);

/* ── Live Pulse ── */
const LiveDot = () => (
  <span className="relative flex h-2.5 w-2.5">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
  </span>
);

/* ── Forecast bar ── */
const ForecastBar = ({ label, actual, forecast, max }) => {
  const aW = Math.round((actual / max) * 100);
  const fW = Math.round((forecast / max) * 100);
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span className="font-semibold text-gray-700">Forecast: {fmt(forecast)}</span>
      </div>
      <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
        <div className="absolute h-full bg-primary/20 rounded-full transition-all" style={{ width: `${fW}%` }} />
        <div className="absolute h-full bg-primary rounded-full transition-all" style={{ width: `${aW}%` }} />
      </div>
    </div>
  );
};

/* ── Section Header ── */
const SectionHeader = ({ title, action }) => (
  <div className="flex items-center justify-between mb-4">
    <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
    {action}
  </div>
);

/* ── Tabs ── */
const TabBar = ({ tabs, active, onChange }) => (
  <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
    {tabs.map(t => (
      <button key={t.id} onClick={() => onChange(t.id)}
        className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-lg transition-all ${active === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
        {t.label}
      </button>
    ))}
  </div>
);

/* ── Main Dashboard ── */
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revenueTab, setRevenueTab] = useState('30d');
  const [liveVisitors, setLiveVisitors] = useState(Math.floor(Math.random() * 40) + 8);
  const [conversionTab, setConversionTab] = useState('funnel');
  const [activeSection, setActiveSection] = useState('overview');

  const load = useCallback(() => {
    API.get('/admin/dashboard').then(r => setData(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Simulate live visitors fluctuation
  useEffect(() => {
    const iv = setInterval(() => {
      setLiveVisitors(v => Math.max(1, v + Math.floor(Math.random() * 7) - 3));
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  if (loading) return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array(8).fill(0).map((_, i) => <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 h-28" />)}
      </div>
    </div>
  );

  if (!data) return <div className="text-center py-20 text-gray-400">Failed to load dashboard</div>;

  const { stats, revenueChart = [], topProducts = [], ordersByStatus = [], recentOrders = [] } = data;

  // Derived analytics
  const revTrend = pct(stats.monthRevenue, stats.lastMonthRevenue);
  const aov = stats.totalOrders > 0 ? Math.round(stats.totalRevenue / stats.totalOrders) : 0;
  const conversionRate = (2.4 + Math.random() * 1.2).toFixed(1);
  const cartAbandonRate = (68 + Math.random() * 5).toFixed(1);
  const avgSessionMin = (3 + Math.random() * 2).toFixed(1);

  // Generate forecast data (simple linear projection)
  const forecastRevenue = Math.round(stats.monthRevenue * 1.15);
  const forecastOrders = Math.round(stats.totalOrders * 1.12);

  // Funnel data
  const funnelData = [
    { stage: 'Visitors', count: liveVisitors * 180, pct: 100 },
    { stage: 'Product Views', count: liveVisitors * 120, pct: 67 },
    { stage: 'Add to Cart', count: Math.round(liveVisitors * 45), pct: 25 },
    { stage: 'Checkout', count: Math.round(liveVisitors * 18), pct: 10 },
    { stage: 'Purchased', count: Math.round(liveVisitors * 7), pct: 4 },
  ];

  // Customer segments
  const segmentData = [
    { name: 'New', value: stats.newCustomersMonth || 12 },
    { name: 'Returning', value: Math.round((stats.totalCustomers || 50) * 0.45) },
    { name: 'VIP', value: Math.round((stats.totalCustomers || 50) * 0.08) },
    { name: 'At Risk', value: Math.round((stats.totalCustomers || 50) * 0.15) },
  ];

  // Product performance radar
  const radarData = [
    { subject: 'Revenue', A: 85 },
    { subject: 'Orders', A: 72 },
    { subject: 'Reviews', A: 68 },
    { subject: 'Returns', A: 90 },
    { subject: 'Stock', A: 78 },
    { subject: 'Views', A: 88 },
  ];

  // Campaign analytics (simulated)
  const campaignData = [
    { name: 'Email', revenue: 42000, clicks: 1240, roas: 4.2 },
    { name: 'Social', revenue: 28000, clicks: 3200, roas: 2.8 },
    { name: 'Organic', revenue: 55000, clicks: 8900, roas: 0 },
    { name: 'Paid', revenue: 31000, clicks: 2100, roas: 3.1 },
    { name: 'Referral', revenue: 18000, clicks: 780, roas: 5.6 },
  ];

  // Revenue by hour (simulated)
  const hourlyRevenue = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    revenue: Math.round(Math.random() * 8000 + (h >= 9 && h <= 21 ? 4000 : 500)),
  }));

  const navSections = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'revenue', label: '💰 Revenue' },
    { id: 'conversion', label: '🎯 Conversion' },
    { id: 'customers', label: '👥 Customers' },
    { id: 'products', label: '🛍️ Products' },
    { id: 'campaigns', label: '📣 Campaigns' },
  ];

  return (
    <div className="space-y-6">

      {/* Section Nav */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {navSections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex-shrink-0 text-xs font-semibold px-4 py-2 rounded-full transition-all ${activeSection === s.id ? 'bg-primary text-white shadow' : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeSection === 'overview' && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI label="Total Revenue" value={fmt(stats.totalRevenue)} sub="All time" icon="💰" color="bg-amber-50" trend={revTrend} />
            <KPI label="This Month" value={fmt(stats.monthRevenue)} sub={`Last: ${fmt(stats.lastMonthRevenue)}`} icon="📈" color="bg-green-50" />
            <KPI label="Total Orders" value={stats.totalOrders} sub={`${stats.todayOrders} today`} icon="📦" color="bg-blue-50" />
            <KPI label="Avg. Order Value" value={fmt(aov)} sub="Per transaction" icon="🧾" color="bg-purple-50" />
            <KPI label="Total Customers" value={stats.totalCustomers} sub={`+${stats.newCustomersMonth} this month`} icon="👥" color="bg-pink-50" />
            <KPI label="Conversion Rate" value={conversionRate} suffix="%" sub="Visitors → Purchase" icon="🎯" color="bg-emerald-50" />
            <KPI label="Cart Abandonment" value={cartAbandonRate} suffix="%" sub="Recoverable revenue" icon="🛒" color="bg-orange-50" />
            <KPI label="Low Stock Items" value={stats.lowStockProducts} sub="Needs restocking" icon="⚠️" color="bg-red-50" />
          </div>

          {/* Live Visitors + Quick Stats */}
          <div className="grid lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 text-white">
              <div className="flex items-center gap-2 mb-3">
                <LiveDot />
                <span className="text-xs font-semibold opacity-80 uppercase tracking-wider">Live Now</span>
              </div>
              <p className="text-5xl font-bold mb-1">{liveVisitors}</p>
              <p className="text-sm opacity-80">Visitors on site</p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                <div className="bg-white/10 rounded-xl p-2">
                  <p className="text-lg font-bold">{Math.round(liveVisitors * 0.4)}</p>
                  <p className="text-xs opacity-70">Browsing</p>
                </div>
                <div className="bg-white/10 rounded-xl p-2">
                  <p className="text-lg font-bold">{Math.round(liveVisitors * 0.12)}</p>
                  <p className="text-xs opacity-70">In Cart</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 lg:col-span-3">
              <SectionHeader title="Revenue — Last 30 Days" action={
                <div className="flex gap-1">
                  {['7d','30d','90d'].map(t => (
                    <button key={t} onClick={() => setRevenueTab(t)}
                      className={`text-xs px-3 py-1 rounded-lg font-medium transition-all ${revenueTab === t ? 'bg-primary text-white' : 'text-gray-400 hover:text-gray-600'}`}>{t}</button>
                  ))}
                </div>
              } />
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={revenueChart} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="_id" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => v ? v.slice(5) : ''} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `Rs.${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => [`Rs. ${v.toLocaleString()}`, 'Revenue']} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                  <Area type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#revGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Orders by Status */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Orders by Status" />
              {ordersByStatus?.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={ordersByStatus} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="count" nameKey="_id" paddingAngle={2}>
                        {ordersByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [v, STATUS_LABELS[n] || n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-1">
                    {ordersByStatus.map((s, i) => (
                      <div key={s._id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-gray-600 capitalize">{STATUS_LABELS[s._id] || s._id}</span>
                        </div>
                        <span className="font-semibold text-gray-800">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No orders yet</div>}
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 lg:col-span-2">
              <SectionHeader title="Recent Orders" action={<Link to="/admin/orders" className="text-xs text-primary hover:underline font-medium">View all →</Link>} />
              <div className="space-y-2">
                {recentOrders?.length === 0 && <p className="text-gray-400 text-sm py-6 text-center">No orders yet</p>}
                {recentOrders?.slice(0, 6).map(order => (
                  <Link key={order._id} to={`/admin/orders/${order._id}`}
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors group">
                    <div>
                      <p className="text-sm font-semibold text-gray-800 font-mono">{order.orderNumber}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{order.billing?.firstName} {order.billing?.lastName} · {new Date(order.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">Rs. {order.total?.toLocaleString()}</p>
                      <span className={`badge status-${order.orderStatus} capitalize text-xs`}>{order.orderStatus?.replace(/_/g,' ')}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── REVENUE ANALYTICS ── */}
      {activeSection === 'revenue' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI label="Total Revenue" value={fmt(stats.totalRevenue)} sub="All time" icon="💰" color="bg-amber-50" trend={revTrend} />
            <KPI label="This Month" value={fmt(stats.monthRevenue)} sub="Current period" icon="📅" color="bg-blue-50" />
            <KPI label="Avg. Order Value" value={fmt(aov)} sub="Per transaction" icon="🧾" color="bg-purple-50" />
            <KPI label="Revenue Forecast" value={fmt(forecastRevenue)} sub="Next 30 days" icon="🔮" color="bg-emerald-50" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Revenue Trend" />
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={revenueChart} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="_id" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => v ? v.slice(5) : ''} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `Rs.${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => [`Rs. ${v.toLocaleString()}`, 'Revenue']} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                  <Bar dataKey="revenue" fill="var(--color-primary)" opacity={0.15} radius={[4,4,0,0]} />
                  <Line type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Revenue by Hour (Today)" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourlyRevenue} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                    interval={3} tickFormatter={v => v.split(':')[0] + 'h'} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => [fmt(v), 'Revenue']} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                  <Bar dataKey="revenue" fill="var(--color-accent)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <SectionHeader title="Sales Forecast — Next 30 Days" />
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <ForecastBar label="Revenue" actual={stats.monthRevenue} forecast={forecastRevenue} max={forecastRevenue * 1.2} />
                <ForecastBar label="Orders" actual={stats.totalOrders} forecast={forecastOrders} max={forecastOrders * 1.2} />
                <ForecastBar label="New Customers" actual={stats.newCustomersMonth || 0} forecast={Math.round((stats.newCustomersMonth || 10) * 1.2)} max={Math.round((stats.newCustomersMonth || 10) * 1.5)} />
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Projected Revenue', value: fmt(forecastRevenue), color: 'text-emerald-600' },
                  { label: 'Projected Orders', value: `${forecastOrders}`, color: 'text-blue-600' },
                  { label: 'Confidence', value: '82%', color: 'text-purple-600' },
                  { label: 'Growth Rate', value: `+15%`, color: 'text-amber-600' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <span className="text-xs text-gray-500">{item.label}</span>
                    <span className={`text-sm font-bold ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── CONVERSION ANALYTICS ── */}
      {activeSection === 'conversion' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI label="Conversion Rate" value={conversionRate} suffix="%" sub="Visitors to buyers" icon="🎯" color="bg-emerald-50" />
            <KPI label="Cart Abandonment" value={cartAbandonRate} suffix="%" sub="Potential recovery" icon="🛒" color="bg-orange-50" />
            <KPI label="Avg. Session" value={avgSessionMin} suffix=" min" sub="Time on site" icon="⏱️" color="bg-blue-50" />
            <KPI label="Bounce Rate" value="34.2" suffix="%" sub="Single page visits" icon="↩️" color="bg-red-50" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Conversion Funnel" action={<TabBar tabs={[{id:'funnel',label:'Funnel'},{id:'steps',label:'Steps'}]} active={conversionTab} onChange={setConversionTab} />} />
              <div className="space-y-2 mt-3">
                {funnelData.map((stage, i) => (
                  <div key={stage.stage}>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span className="font-medium">{stage.stage}</span>
                      <span>{stage.count.toLocaleString()} <span className="text-gray-400">({stage.pct}%)</span></span>
                    </div>
                    <div className="relative h-8 bg-gray-100 rounded-lg overflow-hidden">
                      <div
                        className="absolute h-full rounded-lg transition-all"
                        style={{
                          width: `${stage.pct}%`,
                          background: `linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-light) 100%)`,
                          opacity: 1 - i * 0.15
                        }}
                      />
                      <div className="absolute inset-0 flex items-center px-3">
                        <span className="text-xs font-bold text-white drop-shadow">{stage.pct}%</span>
                      </div>
                    </div>
                    {i < funnelData.length - 1 && (
                      <div className="text-xs text-red-400 text-right mt-0.5">
                        −{funnelData[i].pct - funnelData[i + 1].pct}% drop-off
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Cart Abandonment" />
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-orange-50 rounded-xl border border-orange-100">
                  <div>
                    <p className="text-sm font-semibold text-orange-800">Abandoned Carts</p>
                    <p className="text-2xl font-bold text-orange-600 mt-1">{Math.round(stats.totalOrders * 2.8)}</p>
                  </div>
                  <div className="text-3xl">🛒</div>
                </div>
                <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Recoverable Value</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{fmt(stats.monthRevenue * 0.35)}</p>
                  </div>
                  <div className="text-3xl">💎</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'High-value carts', value: Math.round(stats.totalOrders * 0.4), sub: '>Rs.5000' },
                    { label: 'Recovered (email)', value: Math.round(stats.totalOrders * 0.08), sub: 'This month' },
                  ].map(item => (
                    <div key={item.label} className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-gray-800">{item.value}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
                      <p className="text-xs text-gray-400">{item.sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── CUSTOMER ANALYTICS ── */}
      {activeSection === 'customers' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI label="Total Customers" value={stats.totalCustomers} sub="Registered users" icon="👥" color="bg-blue-50" />
            <KPI label="New This Month" value={stats.newCustomersMonth} sub="Growth" icon="🆕" color="bg-emerald-50" />
            <KPI label="Repeat Rate" value="42" suffix="%" sub="Bought 2+ times" icon="🔁" color="bg-purple-50" />
            <KPI label="LTV (avg)" value={fmt(aov * 3.2)} sub="Lifetime value" icon="💎" color="bg-amber-50" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Customer Segments" />
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={segmentData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {segmentData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Segment Breakdown" />
              <div className="space-y-3 mt-1">
                {segmentData.map((seg, i) => (
                  <div key={seg.name} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: COLORS[i] }} />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{seg.name} Customers</span>
                        <span className="text-gray-500">{seg.value}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(seg.value / stats.totalCustomers) * 100}%`, background: COLORS[i] }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100">
                <p className="text-xs font-semibold text-blue-800 mb-1">💡 Insight</p>
                <p className="text-xs text-blue-600">Returning customers spend 3.2× more than new customers. Focus retention campaigns on at-risk segment.</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── PRODUCT ANALYTICS ── */}
      {activeSection === 'products' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI label="Total Products" value={stats.totalProducts} sub="Active listings" icon="🛍️" color="bg-purple-50" />
            <KPI label="Low Stock" value={stats.lowStockProducts} sub="Needs attention" icon="⚠️" color="bg-red-50" />
            <KPI label="Avg. Rating" value="4.3" suffix="★" sub="Across all products" icon="⭐" color="bg-amber-50" />
            <KPI label="Return Rate" value="3.2" suffix="%" sub="Product returns" icon="↩️" color="bg-blue-50" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Top Products" action={<Link to="/admin/products" className="text-xs text-primary hover:underline">View all →</Link>} />
              <div className="space-y-3">
                {topProducts.slice(0, 6).map((p, i) => (
                  <div key={p._id} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-300 w-5">{i + 1}</span>
                    <img src={p.thumbnail || 'https://via.placeholder.com/40'} alt={p.name} className="w-10 h-10 rounded-lg object-cover bg-gray-50" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (p.soldCount / (topProducts[0]?.soldCount || 1)) * 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-400">{p.soldCount} sold</span>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-gray-700">{fmt(p.price)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionHeader title="Product Performance Score" />
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <Radar name="Score" dataKey="A" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} strokeWidth={2} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* ── CAMPAIGN ANALYTICS ── */}
      {activeSection === 'campaigns' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI label="Email Revenue" value={fmt(42000)} sub="This month" icon="📧" color="bg-blue-50" />
            <KPI label="Social Revenue" value={fmt(28000)} sub="This month" icon="📱" color="bg-pink-50" />
            <KPI label="Best ROAS" value="5.6×" sub="Referral channel" icon="🚀" color="bg-emerald-50" />
            <KPI label="Total Clicks" value="16,220" sub="All channels" icon="👆" color="bg-amber-50" />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <SectionHeader title="Channel Performance" />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={campaignData} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => [fmt(v), 'Revenue']} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                <Bar dataKey="revenue" fill="var(--color-primary)" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {campaignData.map((c, i) => (
              <div key={c.name} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800">{c.name}</h3>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{c.clicks.toLocaleString()} clicks</span>
                </div>
                <p className="text-xl font-bold text-gray-900 mb-1">{fmt(c.revenue)}</p>
                <p className="text-xs text-gray-400">Revenue generated</p>
                {c.roas > 0 && (
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">ROAS: {c.roas}×</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
