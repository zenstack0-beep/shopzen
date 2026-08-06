import React, { useEffect, useState } from 'react';
import API from '../utils/api';

let plansRequest;
const providerMeta = { payzy: { label: 'Payzy', mark: '🟣' }, koko: { label: 'Koko', mark: '🔵' } };
export default function InstallmentPlans({ amount, productId, className = '', compact = false }) {
  const [plans, setPlans] = useState([]);
  const [quotedAmount, setQuotedAmount] = useState(null);
  const [quotedPlans, setQuotedPlans] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(Boolean(productId));
  useEffect(() => {
    if (productId) {
      setQuotedAmount(null);
      setQuotedPlans(null);
      setQuoteLoading(true);
      API.get(`/payments/installment-quote/${productId}`, { cache: false })
        .then(r => {
          setQuotedAmount(Number(r.data?.amount) || null);
          setQuotedPlans(Array.isArray(r.data?.plans) ? r.data.plans : []);
        })
        .catch(() => { setQuotedAmount(null); setQuotedPlans(null); })
        .finally(() => setQuoteLoading(false));
    }
    if (!plansRequest) plansRequest = API.get('/payments/gateways', { cache: false }).then(r => (r.data || []).flatMap(g => g.installmentPlans || [])).catch(() => []);
    plansRequest.then(setPlans);
  }, [productId]);
  const calculationAmount = quotedAmount || amount;
  if (productId && quoteLoading) return <div className={`${compact ? 'mt-1' : 'mt-2'} text-xs text-gray-400`}>Installment available</div>;
  const displayPlans = [...(quotedPlans || []), ...plans].filter((plan, index, all) => {
    const key = `${plan.provider || 'installment'}-${plan.months}-${plan.interestRate || 0}-${plan.name || ''}`;
    return all.findIndex(p => `${p.provider || 'installment'}-${p.months}-${p.interestRate || 0}-${p.name || ''}` === key) === index;
  });
  if (!calculationAmount || !displayPlans.length) return null;
  return <div className={`${compact ? 'mt-1 space-y-0.5' : 'mt-2 space-y-1'} ${className}`}>
    {displayPlans.slice(0, 6).map((plan, i) => { const provider = providerMeta[plan.provider] || { label: plan.provider || 'Installment', mark: '💳' }; const months = Math.max(1, Number(plan.months) || 1); const monthly = plan.monthlyAmount != null ? Number(plan.monthlyAmount) : Math.round((Number(calculationAmount) * (1 + Number(plan.interestRate || 0) / 100) / months) * 100) / 100; return <div key={`${plan.provider}-${plan.months}-${i}`} className="flex items-center gap-1.5 text-xs text-gray-500">{plan.providerLogo ? <img src={plan.providerLogo} alt={provider.label} className="h-4 w-auto object-contain" onError={e => { e.currentTarget.style.display='none'; }} /> : <span aria-hidden="true">{provider.mark}</span>}<span><strong>{months} × {monthly.toFixed(2)}</strong> with {provider.label}</span></div>; })}
  </div>;
}
