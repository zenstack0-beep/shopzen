import React, { useLayoutEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { SeasonalProvider } from './context/SeasonalContext';
import { ThemeProvider } from './context/ThemeContext';
import { AnimationProvider } from './context/AnimationContext';
import { ScrollProgressBar, FloatingShapes } from './components/Cinematic';
import AnalyticsBootstrap from './hooks/useAnalytics';

// Customer Pages
import Home from './pages/customer/Home';
import Shop from './pages/customer/Shop';
import CategoryPage from './pages/customer/CategoryPage';
import BrandPage from './pages/customer/BrandPage';
import ProductDetail from './pages/customer/ProductDetail';
import Cart from './pages/customer/Cart';
import Checkout from './pages/customer/Checkout';
import { OrderSuccess, OrderTracking } from './pages/customer/OrderSuccess';
import { Login, Register } from './pages/customer/Login';
import ForgotPassword from './pages/customer/ForgotPassword';
import Account from './pages/customer/Account';
import MyOrders from './pages/customer/MyOrders';
import Wishlist from './pages/customer/Wishlist';
import GiftCards from './pages/customer/GiftCards';
import Returns from './pages/customer/Returns';
import BusinessPage from './pages/customer/BusinessPage';
import CampaignPage from './pages/customer/CampaignPage';
import CustomerLayout from './pages/customer/CustomerLayout';

// Admin Pages
import Dashboard from './pages/admin/Dashboard';
import AdminProducts from './pages/admin/Products';
import AdminOrders from './pages/admin/Orders';
import AdminOrderDetail from './pages/admin/OrderDetail';
import { AdminCategories, AdminCustomers, AdminCoupons } from './pages/admin/Categories';
import { AdminBanners, AdminReviews } from './pages/admin/Banners';
import AdminSettings from './pages/admin/Settings';
import AdminReturns from './pages/admin/Returns';
import AdminGiftCards from './pages/admin/GiftCards';
import AdminSeasonal from './pages/admin/Seasonal';
import AdminSubscribers from './pages/admin/Subscribers';
import AdminSEO from './pages/admin/SEO';
import AnimationSettings from './pages/admin/AnimationSettings';
import ThemeBuilder from './pages/admin/ThemeBuilder';
import LayoutEditor from './pages/admin/LayoutEditor';
import AdminLayout from './pages/admin/AdminLayout';
import SocialMediaSettings from './pages/admin/SocialMedia';
import AutomationRules from './pages/admin/AutomationRules';
import AdminDeals from './pages/admin/Deals';

// Scrolls to top on every route change.
function ScrollToTop() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const forceTop = () => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.body.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    forceTop();

    const raf1 = requestAnimationFrame(() => {
      forceTop();
      const raf2 = requestAnimationFrame(() => {
        forceTop();
        document.documentElement.style.scrollBehavior = '';
        document.body.style.scrollBehavior = '';
      });
      return () => cancelAnimationFrame(raf2);
    });

    return () => cancelAnimationFrame(raf1);
  }, [pathname]);

  return null;
}

const AdminRoute = ({ children }) => {
  const { user, isAdmin } = useAuth();
  if (!user) return <Navigate to="/login"/>;
  if (!isAdmin) return <Navigate to="/"/>;
  return children;
};

const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
};

const toastStyle = {
  fontFamily: 'var(--font-body)', fontSize: '14px',
  borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
  padding: '12px 16px',
};

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <ThemeProvider>
          <SeasonalProvider>
            <AnimationProvider>
              <BrowserRouter>
                <ScrollToTop/>
                <AnalyticsBootstrap />
                <Toaster position="bottom-right" toastOptions={{ duration: 3000, style: toastStyle, success: { iconTheme: { primary: 'var(--color-primary)', secondary: '#fff' } } }}/>
                <ScrollProgressBar/>
                <FloatingShapes/>
                <Routes>
                  <Route element={<CustomerLayout/>}>
                    <Route path="/" element={<Home/>}/>
                    <Route path="/shop" element={<Shop/>}/>
                    {/* Legacy /shop/:category param still works */}
                    <Route path="/shop/:category" element={<Shop/>}/>
                    {/* SEO-friendly category URLs */}
                    <Route path="/category/:slug" element={<CategoryPage/>}/>
                    {/* SEO-friendly brand landing pages */}
                    <Route path="/brand/:slug" element={<BrandPage/>}/>
                    <Route path="/product/:slug" element={<ProductDetail/>}/>
                    <Route path="/cart" element={<Cart/>}/>
                    <Route path="/checkout" element={<Checkout/>}/>
                    <Route path="/order-success/:id" element={<OrderSuccess/>}/>
                    <Route path="/track-order/:id" element={<OrderTracking/>}/>
                    <Route path="/wishlist" element={<Wishlist/>}/>
                    <Route path="/gift-cards" element={<GiftCards/>}/>
                    <Route path="/returns" element={<ProtectedRoute><Returns/></ProtectedRoute>}/>
                    <Route path="/account" element={<ProtectedRoute><Account/></ProtectedRoute>}/>
                    <Route path="/my-orders" element={<ProtectedRoute><MyOrders/></ProtectedRoute>}/>
                    <Route path="/page/:slug" element={<BusinessPage/>}/>
                    <Route path="/campaign/:slug" element={<CampaignPage/>}/>
                  </Route>
                  <Route path="/login" element={<Login/>}/>
                  <Route path="/register" element={<Register/>}/>
                  <Route path="/forgot-password" element={<ForgotPassword/>}/>
                  <Route path="/admin" element={<AdminRoute><AdminLayout/></AdminRoute>}>
                    <Route index element={<Dashboard/>}/>
                    <Route path="products"     element={<AdminProducts/>}/>
                    <Route path="orders"       element={<AdminOrders/>}/>
                    <Route path="orders/:id"   element={<AdminOrderDetail/>}/>
                    <Route path="categories"   element={<AdminCategories/>}/>
                    <Route path="customers"    element={<AdminCustomers/>}/>
                    <Route path="coupons"      element={<AdminCoupons/>}/>
                    <Route path="banners"      element={<AdminBanners/>}/>
                    <Route path="seasonal"     element={<AdminSeasonal/>}/>
                    <Route path="reviews"      element={<AdminReviews/>}/>
                    <Route path="returns"      element={<AdminReturns/>}/>
                    <Route path="gift-cards"   element={<AdminGiftCards/>}/>
                    <Route path="subscribers"  element={<AdminSubscribers/>}/>
                    <Route path="seo"          element={<AdminSEO/>}/>
                    <Route path="settings"     element={<AdminSettings/>}/>
                    <Route path="layout"       element={<LayoutEditor/>}/>
                    <Route path="animations"   element={<AnimationSettings/>}/>
                    <Route path="theme-builder" element={<ThemeBuilder/>}/>
                    <Route path="social-media" element={<SocialMediaSettings/>}/>
                    <Route path="automation"   element={<AutomationRules/>}/>
                    <Route path="deals"        element={<AdminDeals/>}/>
                  </Route>
                </Routes>
              </BrowserRouter>
            </AnimationProvider>
          </SeasonalProvider>
        </ThemeProvider>
      </CartProvider>
    </AuthProvider>
  );
}