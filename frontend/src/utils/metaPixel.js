/**
 * metaPixel.js — ShopZen Meta Pixel Event Helper
 * Pixel ID: 1764180684568490
 *
 * Usage:
 *   import { pixelViewContent, pixelAddToCart, pixelInitiateCheckout, pixelPurchase } from '../utils/metaPixel';
 *
 * The base fbq('init') + PageView fires from public/index.html.
 * All standard events are fired from React code via these helpers.
 */

const PIXEL_ID = '1764180684568490';
const CURRENCY = 'LKR';

/** Guard: returns true only if fbq is loaded and ready */
function ready() {
  if (typeof window === 'undefined') return false;
  if (!window.fbq) {
    console.warn('[MetaPixel] fbq not loaded yet — event skipped');
    return false;
  }
  return true;
}

// ─── ViewContent ──────────────────────────────────────────────────────────────
/**
 * Fire ViewContent when a product detail page finishes loading.
 * @param {object} product  — product document from the API
 */
export function pixelViewContent(product) {
  if (!ready() || !product) return;
  const value = product.salePrice || product.price || 0;
  const params = {
    content_ids: [String(product._id)],
    content_name: product.name || '',
    content_type: 'product',
    value: Number(value),
    currency: CURRENCY,
  };
  window.fbq('track', 'ViewContent', params);
  console.log('META EVENT FIRED: ViewContent', params);
}

// ─── AddToCart ────────────────────────────────────────────────────────────────
/**
 * Fire AddToCart when a product is added to the cart.
 * @param {object} product   — product document (must have _id, name, price/salePrice)
 * @param {number} quantity  — quantity added
 */
export function pixelAddToCart(product, quantity = 1) {
  if (!ready() || !product) return;
  const unitPrice = product.salePrice || product.price || 0;
  const params = {
    content_ids: [String(product._id)],
    content_name: product.name || '',
    content_type: 'product',
    value: Number((unitPrice * quantity).toFixed(2)),
    currency: CURRENCY,
    num_items: quantity,
  };
  window.fbq('track', 'AddToCart', params);
  console.log('META EVENT FIRED: AddToCart', params);
}

// ─── InitiateCheckout ─────────────────────────────────────────────────────────
/**
 * Fire InitiateCheckout when the user lands on / begins the checkout flow.
 * @param {Array}  cartItems  — array of cart items: { _id, name, price, quantity }
 * @param {number} total      — cart grand total (after discounts)
 */
export function pixelInitiateCheckout(cartItems = [], total = 0) {
  if (!ready()) return;
  const params = {
    content_ids: cartItems.map(i => String(i._id || i.productId)).filter(Boolean),
    content_type: 'product',
    value: Number(Number(total).toFixed(2)),
    currency: CURRENCY,
    num_items: cartItems.reduce((sum, i) => sum + (i.quantity || 1), 0),
  };
  window.fbq('track', 'InitiateCheckout', params);
  console.log('META EVENT FIRED: InitiateCheckout', params);
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
/**
 * Fire Purchase ONLY after backend confirms the order.
 * Call this once — the caller (OrderSuccess) must guard against duplicates
 * with a useRef flag so it doesn't re-fire on page refresh.
 *
 * @param {object} order  — order document from /api/orders/:id
 */
export function pixelPurchase(order) {
  if (!ready() || !order) return;

  // Guard: skip failed payments
  if (order.paymentStatus === 'failed') {
    console.log('META EVENT SKIPPED: Purchase (payment failed)');
    return;
  }

  const items = order.items || [];
  const params = {
    content_ids: items.map(i => String(i.product?._id || i.productId)).filter(Boolean),
    content_type: 'product',
    value: Number(Number(order.total || 0).toFixed(2)),
    currency: CURRENCY,
    num_items: items.reduce((sum, i) => sum + (i.quantity || 1), 0),
  };

  window.fbq('track', 'Purchase', params);
  console.log('META EVENT FIRED: Purchase', params);
}

// ─── PageView (SPA route change) ──────────────────────────────────────────────
/**
 * Fire an additional PageView for React Router SPA navigation.
 * The initial PageView is already fired in index.html.
 * Call this in a top-level route-change effect if needed.
 */
export function pixelPageView() {
  if (!ready()) return;
  window.fbq('track', 'PageView');
  console.log('META EVENT FIRED: PageView (SPA route change)');
}
