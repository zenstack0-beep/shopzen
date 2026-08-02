'use strict';

// Google may only receive discounts that are available to every shopper. A
// coupon is treated as a public product discount only when it is active, not
// new-user-only, has no minimum order, and has not exhausted its usage limit.
// Checkout remains the source of truth for applying the actual coupon.
function publicCouponDiscount(product, coupons = []) {
  const productId = String(product._id || '');
  const categoryId = String(product.category?._id || product.category || '');
  const brand = String(product.brand || '');
  const base = Number(product.salePrice > 0 && product.salePrice < product.price ? product.salePrice : product.price);
  if (!Number.isFinite(base) || base <= 0) return 0;

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
    if (hasScope) {
      const productMatch = products.length && products.includes(productId);
      const categoryMatch = categories.length && categories.includes(categoryId);
      const brandMatch = brands.length && brands.includes(brand);
      const matches = products.length ? productMatch : (categories.length && brands.length ? categoryMatch && brandMatch : categoryMatch || brandMatch);
      if (!matches || (coupon.excludedProducts || []).map(String).includes(productId)) continue;
    }

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
