'use strict';

// Google may only receive discounts that are available to every shopper. A
// coupon is treated as a public product discount only when it is active, not
// new-user-only, has no minimum order, and has not exhausted its usage limit.
// Checkout remains the source of truth for applying the actual coupon.
function publicCouponDiscount(product, coupons = []) {
  const productId = String(product._id || '');
  const hasDirectSale = Number(product.salePrice) > 0 && Number(product.salePrice) < Number(product.price);
  const base = Number(hasDirectSale ? product.salePrice : product.price);
  if (!Number.isFinite(base) || base <= 0) return 0;
  // A manual product sale is already the merchant-approved final price. Never
  // stack a coupon on top of it for product cards, SEO, or installments.
  if (hasDirectSale) return 0;

  let best = 0;
  for (const coupon of coupons) {
    const now = Date.now();
    if (!coupon.isActive || coupon.isNewUserOnly || (coupon.validFrom && new Date(coupon.validFrom).getTime() > now) || (coupon.validUntil && new Date(coupon.validUntil).getTime() < now)) continue;
    if (Number(coupon.minOrderAmount || 0) > base || (coupon.usageLimit && Number(coupon.usedCount || 0) >= coupon.usageLimit)) continue;
    if (coupon.excludeSaleItems && base < Number(product.price)) continue;

    const products = (coupon.applicableProducts || []).map(String);
    const categories = (coupon.applicableCategories || []).map(String);
    const brands = (coupon.applicableBrands || []).map(String);
    // A general/site-wide coupon requires cart/customer context and must not
    // be published as a permanent product discount. Only an explicitly scoped
    // product/category/brand coupon can change the product-card quote.
    const hasScope = products.length || categories.length || brands.length;
    if (!hasScope) continue;
    // Product-card pricing cannot know cart context for category/brand
    // coupons. Only an explicit product assignment is safe to publish.
    if (!products.length || !products.includes(productId) || (coupon.excludedProducts || []).map(String).includes(productId)) continue;

    const discount = coupon.type === 'percentage'
      ? Math.min(base * Number(coupon.value || 0) / 100, Number(coupon.maxDiscount || Infinity))
      : Math.min(base, Number(coupon.value || 0));
    best = Math.max(best, Math.round(discount * 100) / 100);
  }
  return Math.min(best, Math.max(0, base - 0.01));
}

function publicGooglePrice(product, coupons = []) {
  const base = Number(product.salePrice > 0 && product.salePrice < product.price ? product.salePrice : product.price);
  const discount = publicCouponDiscount(product, coupons);
  return { price: base, publicSalePrice: discount > 0 ? base - discount : null };
}

module.exports = { publicCouponDiscount, publicGooglePrice };
