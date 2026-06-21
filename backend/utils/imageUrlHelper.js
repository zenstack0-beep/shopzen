/**
 * imageUrlHelper.js - Backend Image URL Normalization
 * Path: backend/utils/imageUrlHelper.js
 * 
 * Features:
 *   ✓ Converts all image paths to absolute URLs
 *   ✓ Handles product images, thumbnails, banners
 *   ✓ CORS-friendly URLs
 *   ✓ CDN support ready
 */

/**
 * Get base URL for API
 * @returns {string} Base URL (e.g., https://example.com)
 */
function getBaseUrl() {
    const url = process.env.FRONTEND_URL || process.env.API_URL || 'http://localhost:3000';
    return url.replace(/\/$/, ''); // Remove trailing slash
  }
  
  /**
   * Normalize single image URL to absolute
   * @param {string} imagePath - Relative or absolute image path
   * @param {string} baseUrl - Optional base URL override
   * @returns {string} Absolute image URL or empty string
   */
  function normalizeImageUrl(imagePath, baseUrl = null) {
    if (!imagePath || typeof imagePath !== 'string') {
      return '';
    }
  
    // Already absolute
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return imagePath;
    }
  
    const base = baseUrl || getBaseUrl();
    const path = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
    
    return `${base}${path}`;
  }
  
  /**
   * Normalize product image URLs
   * @param {Object} product - Product object from MongoDB
   * @returns {Object} Product with normalized image URLs
   */
  function normalizeProductImages(product) {
    if (!product) return product;
  
    const normalized = { ...product };
    const base = getBaseUrl();
  
    // Normalize thumbnail
    if (product.thumbnail) {
      normalized.thumbnail = normalizeImageUrl(product.thumbnail, base);
    }
  
    // Normalize images array
    if (Array.isArray(product.images)) {
      normalized.images = product.images.map(img => normalizeImageUrl(img, base));
    }
  
    // Normalize other image fields
    const imageFields = ['bannerImage', 'pageBannerImage', 'image', 'featured Image'];
    imageFields.forEach(field => {
      if (product[field]) {
        normalized[field] = normalizeImageUrl(product[field], base);
      }
    });
  
    return normalized;
  }
  
  /**
   * Middleware to normalize product images in response
   * Usage: router.get('/products', normalizeImagesMiddleware, ...)
   * 
   * @returns {Function} Express middleware
   */
  function normalizeImagesMiddleware() {
    return (req, res, next) => {
      // Wrap res.json to normalize images
      const originalJson = res.json.bind(res);
      
      res.json = function(data) {
        if (!data) return originalJson(data);
  
        // Handle single product
        if (data._id && data.thumbnail) {
          return originalJson(normalizeProductImages(data));
        }
  
        // Handle array of products
        if (Array.isArray(data)) {
          const normalized = data.map(item => {
            if (item._id && item.thumbnail) {
              return normalizeProductImages(item);
            }
            return item;
          });
          return originalJson(normalized);
        }
  
        // Handle paginated response
        if (data.products && Array.isArray(data.products)) {
          data.products = data.products.map(p => normalizeProductImages(p));
          return originalJson(data);
        }
  
        return originalJson(data);
      };
  
      next();
    };
  }
  
  /**
   * Normalize category/deal images
   * @param {Object} entity - Entity with image field
   * @returns {Object} Normalized entity
   */
  function normalizeEntityImages(entity) {
    if (!entity) return entity;
  
    const normalized = { ...entity };
    const base = getBaseUrl();
  
    const imageFields = ['image', 'thumbnail', 'bannerImage', 'icon', 'logo'];
    imageFields.forEach(field => {
      if (entity[field]) {
        normalized[field] = normalizeImageUrl(entity[field], base);
      }
    });
  
    return normalized;
  }
  
  /**
   * Get optimized image URL with format options
   * @param {string} imagePath - Image path
   * @param {Object} options - Optimization options
   * @returns {string} Optimized image URL
   */
  function getOptimizedImageUrl(imagePath, options = {}) {
    const normalized = normalizeImageUrl(imagePath);
    
    const {
      width,
      height,
      quality = 'high',
      format = 'auto', // 'auto', 'webp', 'jpg', 'png'
    } = options;
  
    // If you're using an image CDN like Cloudinary or imgix, add params here
    // Example for Cloudinary:
    // return normalized.replace('/upload/', `/upload/w_${width},h_${height},q_${quality}/`);
    
    // For now, just return normalized URL
    return normalized;
  }
  
  /**
   * Batch normalize multiple entities
   * @param {Array} entities - Array of entities with image fields
   * @returns {Array} Normalized entities
   */
  function normalizeBatchImages(entities) {
    if (!Array.isArray(entities)) return entities;
    return entities.map(entity => normalizeEntityImages(entity));
  }
  
  module.exports = {
    getBaseUrl,
    normalizeImageUrl,
    normalizeProductImages,
    normalizeEntityImages,
    normalizeImagesMiddleware,
    getOptimizedImageUrl,
    normalizeBatchImages,
  };