/**
 * discountEngine.test.js — ShopZen
 *
 * ─── PLACEMENT (REQUIRED) ────────────────────────────────────────────────────
 * Save this file to:
 *   frontend/src/utils/discountEngine.test.js
 *
 * ─── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   cd frontend
 *   npx react-scripts test --watchAll=false
 *
 * ─── KEY RULE CHANGE ─────────────────────────────────────────────────────────
 * Gift Card is a PAYMENT METHOD, not a discount.
 * Coupon + Gift Card CAN stack.
 * Pricing order: Product Discount → Coupon → + Delivery → Gift Card → Total
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  effectivePrice,
  lineItemTotal,
  computeSubtotal,
  resolveDeliveryFee,
  resolveBenefit,
  computeTotals,
  computeCartTotals,
} from './discountEngine';

// ─────────────────────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const mkCoupon   = (discount) => ({ discount });
const mkGiftCard = (balance)  => ({ balance });
const mkDelivery = (price, freeAbove = 0, zoneRates = []) => ({
  rates: [{ price, freeAbove }],
  zoneRates,
});
const DEFAULT_SETTINGS = { standardDelivery: 600, freeDeliveryThreshold: 5000 };

// ─────────────────────────────────────────────────────────────────────────────
// 1. ITEM-LEVEL PRICING
// ─────────────────────────────────────────────────────────────────────────────

describe('effectivePrice()', () => {
  test('returns price when no salePrice', () => {
    expect(effectivePrice({ price: 1000 })).toBe(1000);
  });
  test('returns price when salePrice is null', () => {
    expect(effectivePrice({ price: 1000, salePrice: null })).toBe(1000);
  });
  test('returns price when salePrice is 0', () => {
    expect(effectivePrice({ price: 1000, salePrice: 0 })).toBe(1000);
  });
  test('returns salePrice when strictly lower than price', () => {
    expect(effectivePrice({ price: 1000, salePrice: 750 })).toBe(750);
  });
  test('returns price when salePrice equals price', () => {
    expect(effectivePrice({ price: 1000, salePrice: 1000 })).toBe(1000);
  });
  test('returns price when salePrice is higher (bad data)', () => {
    expect(effectivePrice({ price: 1000, salePrice: 1200 })).toBe(1000);
  });
  test('extreme sale — salePrice of Rs. 1', () => {
    expect(effectivePrice({ price: 5000, salePrice: 1 })).toBe(1);
  });
});

describe('lineItemTotal()', () => {
  test('price × quantity at full price', () => {
    expect(lineItemTotal({ price: 500, quantity: 3 })).toBe(1500);
  });
  test('uses salePrice when lower', () => {
    expect(lineItemTotal({ price: 1000, salePrice: 800, quantity: 2 })).toBe(1600);
  });
  test('single unit', () => {
    expect(lineItemTotal({ price: 2500, quantity: 1 })).toBe(2500);
  });
  test('large quantity stays accurate', () => {
    expect(lineItemTotal({ price: 99, quantity: 1000 })).toBe(99000);
  });
});

describe('computeSubtotal()', () => {
  test('sums a single item', () => {
    expect(computeSubtotal([{ price: 1500, quantity: 2 }])).toBe(3000);
  });
  test('sums multiple mixed items correctly', () => {
    const items = [
      { price: 1000, quantity: 1 },
      { price: 500, salePrice: 400, quantity: 3 },
      { price: 2000, quantity: 2 },
    ];
    expect(computeSubtotal(items)).toBe(6200);
  });
  test('empty cart returns 0', () => {
    expect(computeSubtotal([])).toBe(0);
  });
  test('mixes discounted and non-discounted items', () => {
    const items = [
      { price: 3000, salePrice: 2000, quantity: 1 },
      { price: 1000, quantity: 2 },
    ];
    expect(computeSubtotal(items)).toBe(4000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DELIVERY FEE
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveDeliveryFee()', () => {
  test('standard delivery when no service selected', () => {
    expect(resolveDeliveryFee(null, '', 1000, DEFAULT_SETTINGS)).toBe(600);
  });
  test('free when subtotal meets threshold', () => {
    expect(resolveDeliveryFee(null, '', 5000, DEFAULT_SETTINGS)).toBe(0);
  });
  test('one rupee below threshold still charges', () => {
    expect(resolveDeliveryFee(null, '', 4999, DEFAULT_SETTINGS)).toBe(600);
  });
  test('uses rate from a delivery service', () => {
    expect(resolveDeliveryFee(mkDelivery(350), 'colombo', 1000, DEFAULT_SETTINGS)).toBe(350);
  });
  test('service freeAbove threshold — free when met', () => {
    const svc = mkDelivery(350, 3000);
    expect(resolveDeliveryFee(svc, '', 3000, DEFAULT_SETTINGS)).toBe(0);
    expect(resolveDeliveryFee(svc, '', 2999, DEFAULT_SETTINGS)).toBe(350);
  });
  test('defaults to Rs. 600 when settings is empty', () => {
    expect(resolveDeliveryFee(null, '', 1000, {})).toBe(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PRICING ORDER: Product Discount → Coupon → Delivery → Gift Card → Total
// ─────────────────────────────────────────────────────────────────────────────

describe('Pricing order — coupon first, then gift card as payment', () => {
  test('coupon reduces subtotal; gift card covers remainder after delivery', () => {
    // subtotal: 3000, coupon: 500 → 2500 + 600 delivery = 3100 remaining
    // gift card: 1000 → pays 1000 → total = 2100
    const t = computeTotals({ subtotal: 3000, deliveryFee: 600, couponData: mkCoupon(500), giftCardData: mkGiftCard(1000) });
    expect(t.couponDiscount).toBe(500);
    expect(t.giftCardDeduction).toBe(1000);
    expect(t.total).toBe(2100); // 3000 - 500 + 600 - 1000
    expect(t.benefitType).toBe('both');
  });

  test('coupon alone — no gift card', () => {
    const t = computeTotals({ subtotal: 3000, deliveryFee: 600, couponData: mkCoupon(500), giftCardData: null });
    expect(t.couponDiscount).toBe(500);
    expect(t.giftCardDeduction).toBe(0);
    expect(t.total).toBe(3100); // 3000 - 500 + 600
    expect(t.benefitType).toBe('coupon');
  });

  test('gift card alone — no coupon', () => {
    const t = computeTotals({ subtotal: 3000, deliveryFee: 600, couponData: null, giftCardData: mkGiftCard(1000) });
    expect(t.couponDiscount).toBe(0);
    expect(t.giftCardDeduction).toBe(1000);
    expect(t.total).toBe(2600); // 3000 + 600 - 1000
    expect(t.benefitType).toBe('giftcard');
  });

  test('no benefit — no coupon, no gift card', () => {
    const t = computeTotals({ subtotal: 3000, deliveryFee: 600, couponData: null, giftCardData: null });
    expect(t.couponDiscount).toBe(0);
    expect(t.giftCardDeduction).toBe(0);
    expect(t.total).toBe(3600);
    expect(t.benefitType).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. COUPON + GIFT CARD STACKING (NEW BEHAVIOR)
// ─────────────────────────────────────────────────────────────────────────────

describe('Coupon + Gift Card stacking', () => {
  test('both applied — coupon off subtotal, gift card off remaining', () => {
    // subtotal 5000, coupon 1000 → 4000 + 0 delivery = 4000 remaining
    // gift card 2000 → covers 2000 → total 2000
    const t = computeTotals({ subtotal: 5000, deliveryFee: 0, couponData: mkCoupon(1000), giftCardData: mkGiftCard(2000) });
    expect(t.couponDiscount).toBe(1000);
    expect(t.giftCardDeduction).toBe(2000);
    expect(t.total).toBe(2000);
    expect(t.benefitType).toBe('both');
  });

  test('coupon + gift card together zero out the order', () => {
    // subtotal 2000, coupon 500 → 1500 + 300 delivery = 1800
    // gift card 1800 → covers all → total 0
    const t = computeTotals({ subtotal: 2000, deliveryFee: 300, couponData: mkCoupon(500), giftCardData: mkGiftCard(1800) });
    expect(t.couponDiscount).toBe(500);
    expect(t.giftCardDeduction).toBe(1800);
    expect(t.total).toBe(0);
  });

  test('gift card capped at remaining total after coupon + delivery', () => {
    // subtotal 3000, coupon 1000 → 2000 + 600 = 2600 remaining
    // gift card 5000 → capped at 2600 → total 0
    const t = computeTotals({ subtotal: 3000, deliveryFee: 600, couponData: mkCoupon(1000), giftCardData: mkGiftCard(5000) });
    expect(t.couponDiscount).toBe(1000);
    expect(t.giftCardDeduction).toBe(2600);
    expect(t.total).toBe(0);
  });

  test('large coupon fully covered by itself — gift card pays nothing extra needed', () => {
    // coupon wipes out subtotal → remaining is delivery only
    // subtotal 1000, coupon 1000 → 0 + 600 delivery = 600 remaining
    // gift card 300 → covers 300 → total 300
    const t = computeTotals({ subtotal: 1000, deliveryFee: 600, couponData: mkCoupon(1000), giftCardData: mkGiftCard(300) });
    expect(t.couponDiscount).toBe(1000);
    expect(t.giftCardDeduction).toBe(300);
    expect(t.total).toBe(300); // 0 + 600 - 300
  });

  test('discount field equals couponDiscount + giftCardDeduction', () => {
    const t = computeTotals({ subtotal: 4000, deliveryFee: 0, couponData: mkCoupon(400), giftCardData: mkGiftCard(600) });
    expect(t.discount).toBe(t.couponDiscount + t.giftCardDeduction);
    expect(t.discount).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GIFT CARD AS PAYMENT METHOD
// ─────────────────────────────────────────────────────────────────────────────

describe('Gift card as payment — covers subtotal + delivery', () => {
  test('gift card covers full order (subtotal + delivery)', () => {
    const t = computeTotals({ subtotal: 2000, deliveryFee: 600, couponData: null, giftCardData: mkGiftCard(5000) });
    expect(t.total).toBe(0);
    expect(t.giftCardDeduction).toBe(2600);
    expect(t.benefitType).toBe('giftcard');
  });

  test('partial gift card — some balance remains to pay', () => {
    const t = computeTotals({ subtotal: 2000, deliveryFee: 600, couponData: null, giftCardData: mkGiftCard(800) });
    expect(t.giftCardDeduction).toBe(800);
    expect(t.total).toBe(1800); // 2600 - 800
  });

  test('gift card of exactly subtotal + delivery zeroes the order', () => {
    const t = computeTotals({ subtotal: 1500, deliveryFee: 300, couponData: null, giftCardData: mkGiftCard(1800) });
    expect(t.total).toBe(0);
    expect(t.giftCardDeduction).toBe(1800);
  });

  test('zero-balance gift card = no deduction', () => {
    const t = computeTotals({ subtotal: 1000, deliveryFee: 600, couponData: null, giftCardData: mkGiftCard(0) });
    expect(t.benefitType).toBe('none');
    expect(t.total).toBe(1600);
    expect(t.giftCardDeduction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. COUPON CAP — never exceeds subtotal
// ─────────────────────────────────────────────────────────────────────────────

describe('Coupon discount cap', () => {
  test('coupon larger than subtotal is capped at subtotal', () => {
    // coupon 9999 on subtotal 500 → capped at 500; then delivery 0 → total 0
    const t = computeTotals({ subtotal: 500, deliveryFee: 0, couponData: mkCoupon(9999), giftCardData: null });
    expect(t.couponDiscount).toBe(500);
    expect(t.total).toBe(0);
  });

  test('coupon exactly equal to subtotal — total is just delivery', () => {
    const t = computeTotals({ subtotal: 1000, deliveryFee: 400, couponData: mkCoupon(1000), giftCardData: null });
    expect(t.couponDiscount).toBe(1000);
    expect(t.total).toBe(400); // just delivery
  });

  test('30% coupon capped at maxDiscount Rs.1000 on Rs.5000 cart', () => {
    const cappedDiscount = Math.min(Math.round((5000 * 30) / 100), 1000);
    const t = computeTotals({ subtotal: 5000, deliveryFee: 0, couponData: mkCoupon(cappedDiscount), giftCardData: null });
    expect(t.couponDiscount).toBe(1000);
    expect(t.total).toBe(4000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RESOLVEBENEFIT FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveBenefit()', () => {
  test('both coupon and gift card return type=both', () => {
    const r = resolveBenefit(mkCoupon(500), mkGiftCard(1000), 3000, 600);
    expect(r.type).toBe('both');
    expect(r.couponDiscount).toBe(500);
    expect(r.giftCardDeduction).toBe(Math.min(1000, 3000 - 500 + 600)); // 1000 ≤ 3100
    expect(r.giftCardDeduction).toBe(1000);
  });

  test('gift card capped at remaining total after coupon', () => {
    // subtotal 1000, coupon 800 → 200 + 600 delivery = 800 remaining
    // gift card 5000 capped at 800
    const r = resolveBenefit(mkCoupon(800), mkGiftCard(5000), 1000, 600);
    expect(r.couponDiscount).toBe(800);
    expect(r.giftCardDeduction).toBe(800);
  });

  test('coupon only → type=coupon, giftCardDeduction=0', () => {
    const r = resolveBenefit(mkCoupon(500), null, 3000, 600);
    expect(r.type).toBe('coupon');
    expect(r.couponDiscount).toBe(500);
    expect(r.giftCardDeduction).toBe(0);
  });

  test('gift card only → type=giftcard, couponDiscount=0', () => {
    const r = resolveBenefit(null, mkGiftCard(1000), 3000, 600);
    expect(r.type).toBe('giftcard');
    expect(r.couponDiscount).toBe(0);
    expect(r.giftCardDeduction).toBe(1000);
  });

  test('no benefits → type=none', () => {
    const r = resolveBenefit(null, null, 3000, 600);
    expect(r.type).toBe('none');
    expect(r.couponDiscount).toBe(0);
    expect(r.giftCardDeduction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. COMPUTE CART TOTALS
// ─────────────────────────────────────────────────────────────────────────────

describe('computeCartTotals()', () => {
  test('gift card covers subtotal + delivery', () => {
    const t = computeCartTotals(
      [{ price: 2000, quantity: 1 }],
      null, '', DEFAULT_SETTINGS,
      null, mkGiftCard(3000)
    );
    expect(t.total).toBe(0);
    expect(t.giftCardDeduction).toBe(2600); // 2000 + 600
  });

  test('coupon + gift card stacking via computeCartTotals', () => {
    const t = computeCartTotals(
      [{ price: 3000, quantity: 1 }],
      null, '', DEFAULT_SETTINGS,
      mkCoupon(500), mkGiftCard(1000)
    );
    // 3000 - 500 = 2500 + 600 = 3100; gift card 1000 → total 2100
    expect(t.couponDiscount).toBe(500);
    expect(t.giftCardDeduction).toBe(1000);
    expect(t.total).toBe(2100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. DISCOUNT RULES — excludeSaleItems & profit protection
// ─────────────────────────────────────────────────────────────────────────────

describe('Discount rules — excludeSaleItems', () => {
  test('no coupon when couponData is null (excluded server-side)', () => {
    const t = computeTotals({ subtotal: 3000, deliveryFee: 0, couponData: null, giftCardData: null });
    expect(t.benefitType).toBe('none');
    expect(t.couponDiscount).toBe(0);
  });

  test('coupon applies normally when cart has no sale items', () => {
    const t = computeTotals({ subtotal: 3000, deliveryFee: 0, couponData: mkCoupon(300), giftCardData: null });
    expect(t.benefitType).toBe('coupon');
    expect(t.couponDiscount).toBe(300);
    expect(t.total).toBe(2700);
  });

  test('gift card still works when coupon was blocked by excludeSaleItems', () => {
    const t = computeTotals({ subtotal: 2000, deliveryFee: 600, couponData: null, giftCardData: mkGiftCard(500) });
    expect(t.benefitType).toBe('giftcard');
    expect(t.giftCardDeduction).toBe(500);
    expect(t.total).toBe(2100);
  });

  test('coupon blocked but gift card still applies as payment', () => {
    // couponData null (server rejected), gift card present
    const t = computeTotals({ subtotal: 4000, deliveryFee: 0, couponData: null, giftCardData: mkGiftCard(1000) });
    expect(t.couponDiscount).toBe(0);
    expect(t.giftCardDeduction).toBe(1000);
    expect(t.total).toBe(3000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. PROFIT PROTECTION (server-computed discount applied correctly)
// ─────────────────────────────────────────────────────────────────────────────

describe('Profit margin protection (pre-computed discount from server)', () => {
  test('server-capped discount applied correctly', () => {
    const t = computeTotals({ subtotal: 1000, deliveryFee: 0, couponData: mkCoupon(200), giftCardData: null });
    expect(t.couponDiscount).toBe(200);
    expect(t.total).toBe(800);
  });

  test('profit-capped coupon + gift card stacking', () => {
    // coupon capped to 300; gift card 500 covers rest
    // subtotal 3000 - 300 + 600 delivery = 3300 remaining; gift card 500 → total 2800
    const t = computeTotals({ subtotal: 3000, deliveryFee: 600, couponData: mkCoupon(300), giftCardData: mkGiftCard(500) });
    expect(t.couponDiscount).toBe(300);
    expect(t.giftCardDeduction).toBe(500);
    expect(t.total).toBe(2800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ONLY HIGHEST PRODUCT DISCOUNT APPLIES (effectivePrice)
// ─────────────────────────────────────────────────────────────────────────────

describe('Only highest product discount applies (effectivePrice)', () => {
  test('salePrice wins over regular price — never adds both', () => {
    const item = { price: 2000, salePrice: 1500, quantity: 1 };
    expect(lineItemTotal(item)).toBe(1500);
  });

  test('cart with mixed sale/full-price items uses correct per-item price', () => {
    const items = [
      { price: 3000, salePrice: 2000, quantity: 1 },
      { price: 1500, quantity: 2 },
      { price: 500, salePrice: 450, quantity: 3 },
    ];
    expect(computeSubtotal(items)).toBe(6350); // 2000 + 3000 + 1350
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. COMBINED SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

describe('Combined real-world scenarios', () => {
  test('seasonal BLACK50 coupon 50% off + gift card covers delivery', () => {
    // Rs. 4000 cart, 50% coupon = 2000 off → 2000 + 600 delivery = 2600
    // gift card 600 → covers delivery → total 2000
    const t = computeTotals({ subtotal: 4000, deliveryFee: 600, couponData: mkCoupon(2000), giftCardData: mkGiftCard(600) });
    expect(t.couponDiscount).toBe(2000);
    expect(t.giftCardDeduction).toBe(600);
    expect(t.total).toBe(2000);
    expect(t.benefitType).toBe('both');
  });

  test('NEWYEAR20 coupon 300 + gift card 3000 zeroes the order', () => {
    // subtotal 3000 - 300 = 2700 + 600 delivery = 3300; gift card 3000 covers 3000 → total 300
    const t = computeTotals({ subtotal: 3000, deliveryFee: 600, couponData: mkCoupon(300), giftCardData: mkGiftCard(3000) });
    expect(t.couponDiscount).toBe(300);
    expect(t.giftCardDeduction).toBe(3000);
    expect(t.total).toBe(300); // 3300 - 3000
  });

  test('free delivery + coupon + large gift card — zeroes order', () => {
    const t = computeTotals({ subtotal: 6000, deliveryFee: 0, couponData: mkCoupon(800), giftCardData: mkGiftCard(10000) });
    expect(t.couponDiscount).toBe(800);
    expect(t.giftCardDeduction).toBe(5200);
    expect(t.total).toBe(0);
  });

  test('edge case — zero price items with coupon and gift card', () => {
    expect(effectivePrice({ price: 0 })).toBe(0);
    expect(lineItemTotal({ price: 0, quantity: 5 })).toBe(0);
    const t = computeTotals({ subtotal: 0, deliveryFee: 600, couponData: mkCoupon(0), giftCardData: mkGiftCard(600) });
    expect(t.giftCardDeduction).toBe(600);
    expect(t.total).toBe(0);
  });
});