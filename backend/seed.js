const mongoose = require('mongoose');
require('dotenv').config();

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
  console.log('✅ Connected');

  const User = require('./models/User');
  const { Category, Settings, Coupon, PaymentGateway, DeliveryService, BusinessPage } = require('./models/index');

  // Admin
  const existingAdmin = await User.findOne({ email: 'admin@shopzen.lk' });
  if (!existingAdmin) {
    await User.create({ firstName:'Admin', lastName:'User', username:'admin', email:'admin@shopzen.lk', password:'Admin@123456', role:'admin', phone:'+94 11 000 0000' });
    console.log('✅ Admin: admin@shopzen.lk / Admin@123456');
  }

  // Categories
  for (const cat of [
    { name:'Electronics', slug:'electronics', description:'Phones, laptops, gadgets' },
    { name:'Household', slug:'household', description:'Home essentials' },
    { name:'Appliances', slug:'appliances', description:'Kitchen & home appliances' },
    { name:'Accessories', slug:'accessories', description:'Bags, cases, accessories' },
    { name:'Audio', slug:'audio', description:'Headphones, speakers' },
    { name:'Smart Home', slug:'smart-home', description:'Smart devices' },
  ]) {
    await Category.findOneAndUpdate({ slug: cat.slug }, cat, { upsert: true });
  }
  console.log('✅ Categories');

  // Welcome coupon
  await Coupon.findOneAndUpdate({ code: 'WELCOME10' }, {
    code: 'WELCOME10', description: '10% off your first order!',
    type: 'percentage', value: 10, maxDiscount: 500,
    isNewUserOnly: true, isActive: true,
    validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  }, { upsert: true });
  console.log('✅ Welcome coupon WELCOME10');

  // Default Settings
  const defaults = {
    // ── Store Identity ──
    storeName: 'ShopZen', storeTagline: 'Premium Online Store',
    storeEmail: 'support@shopzen.lk', storePhone: '+94 11 000 0000',
    storeAddress: 'Colombo, Sri Lanka',
    currency: 'LKR', currencySymbol: 'Rs.',

    // ── Payment ──
    standardDelivery: 600, freeDeliveryThreshold: 5000,
    codEnabled: true, bankTransferEnabled: true,
    bankName: 'Bank of Ceylon', bankAccountName: 'ShopZen Pvt Ltd',
    bankAccountNumber: '0123456789', bankBranch: 'Colombo 03',

    // ── Appearance ──
    theme: 'default', primaryColor: '#b5451b', fontStyle: 'default',
    logoUrl: '', faviconUrl: '', customCSS: '',

    // ── Features ──
    enableNewsletter: true, enableWishlist: true, enableReviews: true,
    enableGiftCards: true, enableReturns: true,
    reviewsRequireApproval: true, allowGuestCheckout: true,
    maintenanceMode: false,

    // ── Business ──
    businessType: 'ecommerce', lowStockAlert: 5,
    maxReturnDays: 7, taxEnabled: false, taxRate: 0, taxLabel: 'VAT',

    // ── Hero Section ──
    heroStats: JSON.stringify([
      { number: '50K+', label: 'Products' },
      { number: '200K+', label: 'Happy Customers' },
      { number: '4.9★', label: 'Average Rating' },
    ]),
    heroBrowseAllLabel: 'Browse All',
    heroShowStats: true,

    // ── Trust Bar (fully customizable) ──
    trustBadges: JSON.stringify([
      { icon: '🚀', title: 'Fast Delivery',   subtitle: 'Free over Rs. 5,000',      enabled: true },
      { icon: '🔒', title: 'Secure Checkout', subtitle: 'SSL encrypted payments',   enabled: true },
      { icon: '🔄', title: '7-Day Returns',   subtitle: 'Hassle-free process',      enabled: true },
      { icon: '🌟', title: 'Premium Quality', subtitle: 'Hand-curated selection',   enabled: true },
      { icon: '💬', title: '24/7 Support',    subtitle: 'We are always here',       enabled: true },
    ]),

    // ── Section Labels ──
    sectionFeaturedTitle: 'Featured Products',
    sectionFeaturedSubtitle: 'Hand-picked by our team',
    sectionSaleTitle: '🔥 Flash Deals',
    sectionSaleSubtitle: 'Limited time discounts',
    sectionNewTitle: '✨ New Arrivals',
    sectionNewSubtitle: 'Just landed in our store',
    sectionCatTitle: 'Browse Categories',
    sectionCatSubtitle: 'Find exactly what you need',

    // ── Newsletter ──
    newsletterTitle: 'Be the First to Know',
    newsletterSubtitle: 'Exclusive deals and new arrivals in your inbox.',
    newsletterCta: 'Subscribe',
    newsletterDisclaimer: 'No spam. Unsubscribe any time.',
    newsletterBadgeLabel: 'Newsletter',

    // ── Social ──
    facebookUrl: '', instagramUrl: '', twitterUrl: '',
    whatsappNumber: '', youtubeUrl: '', linkedinUrl: '',

    // ── SEO ──
    metaTitle: '', metaDescription: '',
    googleAnalytics: '', facebookPixel: '', googleSearchConsole: '',
    customHeaderCode: '', customFooterCode: '',
    siteUrl: '',

    // ── Advanced ──
    orderNotificationEmail: '', autoConfirmOrders: false,
    termsUrl: '', privacyUrl: '',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true });
  }
  console.log('✅ Settings');

  // Payment Gateways
  const gateways = [
    { gateway: 'payhere', displayName: 'PayHere', description: 'Sri Lanka\'s leading payment gateway', logo: 'https://www.payhere.lk/downloads/images/payhere_short_logo.png', isEnabled: false, isLive: false, supportedCurrencies: ['LKR','USD'], config: { merchantId: '', merchantSecret: '', appId: '', appSecret: '' } },
    { gateway: 'stripe', displayName: 'Stripe', description: 'Global payments with cards', logo: 'https://upload.wikimedia.org/wikipedia/commons/b/ba/Stripe_Logo%2C_revised_2016.svg', isEnabled: false, isLive: false, supportedCurrencies: ['USD','EUR','GBP','AUD'], config: { publicKey: '', secretKey: '', webhookSecret: '' } },
    { gateway: 'paypal', displayName: 'PayPal', description: 'PayPal checkout', logo: 'https://upload.wikimedia.org/wikipedia/commons/b/b5/PayPal.svg', isEnabled: false, isLive: false, supportedCurrencies: ['USD','EUR','GBP'], config: { clientId: '', clientSecret: '' } },
  ];
  for (const gw of gateways) {
    await PaymentGateway.findOneAndUpdate({ gateway: gw.gateway }, gw, { upsert: true });
  }
  console.log('✅ Payment gateways');

  // Delivery Services
  const deliveryServices = [
    { name: 'Standard Delivery', code: 'standard', isEnabled: true, description: 'Standard island-wide delivery', estimatedDays: '3-5 business days', trackingUrl: '', rates: [{ name: 'Standard', price: 600, freeAbove: 5000, estimatedDays: '3-5 days' }] },
    { name: 'Express Delivery', code: 'express', isEnabled: true, description: 'Fast same/next day delivery', estimatedDays: '1-2 business days', trackingUrl: '', rates: [{ name: 'Express', price: 1200, freeAbove: 10000, estimatedDays: '1-2 days' }] },
    { name: 'Pronto Delivery', code: 'pronto', isEnabled: false, description: 'Pronto courier service', estimatedDays: '1-3 days', trackingUrl: 'https://pronto.lk/track/{trackingNumber}', rates: [{ name: 'Standard', price: 600, freeAbove: 0, estimatedDays: '1-3 days' }] },
    { name: 'Kapruka', code: 'kapruka', isEnabled: false, description: 'Kapruka island-wide delivery', estimatedDays: '2-5 days', trackingUrl: '', rates: [{ name: 'Standard', price: 450, freeAbove: 0, estimatedDays: '2-5 days' }] },
    { name: 'Store Pickup', code: 'pickup', isEnabled: true, description: 'Pick up from our store', estimatedDays: 'Same day', trackingUrl: '', rates: [{ name: 'Free Pickup', price: 0, freeAbove: 0, estimatedDays: 'Same day' }] },
  ];
  for (const svc of deliveryServices) {
    await DeliveryService.findOneAndUpdate({ code: svc.code }, svc, { upsert: true });
  }
  console.log('✅ Delivery services');

  // Business Pages
  const pages = [
    { slug: 'about', title: 'About Us', content: '<h2>About Us</h2><p>Welcome to our store. We provide quality products at competitive prices.</p>', showInFooter: true, sortOrder: 1 },
    { slug: 'contact', title: 'Contact Us', content: '<h2>Contact Us</h2><p>Email us at support@shopzen.lk or call +94 11 000 0000</p>', showInFooter: true, sortOrder: 2 },
    { slug: 'terms', title: 'Terms & Conditions', content: '<h2>Terms & Conditions</h2><p>By using our website you agree to our terms and conditions.</p>', showInFooter: true, sortOrder: 3 },
    { slug: 'privacy', title: 'Privacy Policy', content: '<h2>Privacy Policy</h2><p>We respect your privacy and protect your personal data.</p>', showInFooter: true, sortOrder: 4 },
    { slug: 'returns', title: 'Returns Policy', content: '<h2>Returns Policy</h2><p>We offer a 7-day return policy on all products.</p>', showInFooter: true, sortOrder: 5 },
    { slug: 'faq', title: 'FAQ', content: '<h2>Frequently Asked Questions</h2><p>Find answers to common questions here.</p>', showInFooter: true, sortOrder: 6 },
  ];
  for (const page of pages) {
    await BusinessPage.findOneAndUpdate({ slug: page.slug }, { ...page, updatedAt: Date.now() }, { upsert: true });
  }
  console.log('✅ Business pages');

  console.log('\n🎉 Seed complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 Admin: admin@shopzen.lk / Admin@123456');
  console.log('🎟️  Coupon: WELCOME10 (10% off new users)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await mongoose.disconnect();
  process.exit(0);
}
seed().catch(err => { console.error('❌', err.message); process.exit(1); });
