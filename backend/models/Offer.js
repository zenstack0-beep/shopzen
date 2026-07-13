const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  brands: [{ type: String, trim: true }],
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  minimumAmount: { type: Number, required: true, min: 0 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  freeProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  freeItemCount: { type: Number, required: true, min: 1, max: 20 },
  popupDelaySeconds: { type: Number, default: 1, min: 0, max: 300 },
  isActive: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

offerSchema.path('endsAt').validate(function(value) {
  return !this.startsAt || value > this.startsAt;
}, 'End date must be after start date');

module.exports = mongoose.model('Offer', offerSchema);
