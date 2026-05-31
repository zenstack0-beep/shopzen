const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName:  { type: String, required: true },
  lastName:   { type: String, default: '' },        // ← was required, Google accounts may have none
  username:   { type: String, required: true, unique: true },
  email:      { type: String, required: true, unique: true },
  password:   { type: String, required: true },
  phone:      { type: String },
  role:       { type: String, enum: ['customer', 'admin'], default: 'customer' },
  isActive:   { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  googleId:   { type: String, default: null },      // ← added: stores Google sub ID
  addresses: [{
    label:     String,
    country:   String,
    street:    String,
    city:      String,
    isDefault: { type: Boolean, default: false }
  }],
  wishlist:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  avatar:    { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);