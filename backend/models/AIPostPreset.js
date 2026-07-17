const mongoose = require('mongoose');

const aiPostPresetSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: Number, required: true, default: () => Date.now() },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

aiPostPresetSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.AIPostPreset || mongoose.model('AIPostPreset', aiPostPresetSchema);
