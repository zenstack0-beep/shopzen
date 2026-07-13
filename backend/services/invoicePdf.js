'use strict';

const PDFDocument = require('pdfkit');

const clean = value => String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
const money = value => `Rs. ${Number(value || 0).toLocaleString('en-LK')}`;
const address = data => [data?.street, data?.city, data?.country].map(clean).filter(Boolean).join(', ');

async function loadLogo(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= 5 * 1024 * 1024 ? buffer : null;
  } catch { return null; }
}

async function buildInvoicePdf(order, settings = {}) {
  const logo = await loadLogo(settings.logoUrl);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Invoice – ${clean(order.orderNumber)}`, Author: settings.storeName || 'ShopZen' } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = 595.28; const green = settings.primaryColor || '#15803d'; const navy = '#111c35'; const muted = '#64748b';
    const storeName = settings.storeName || 'ShopZen';

    // Same branded header used by the existing Bill button.
    doc.rect(28, 28, 539, 142).fill(green);
    if (logo) {
      try { doc.image(logo, 58, 58, { fit: [205, 76], align: 'left', valign: 'center' }); }
      catch { doc.fillColor('#fff').font('Helvetica-Bold').fontSize(25).text(storeName, 58, 76); }
    } else doc.fillColor('#fff').font('Helvetica-Bold').fontSize(25).text(storeName, 58, 76);
    doc.fillColor('#d1fae5').font('Helvetica').fontSize(9).text(settings.storeTagline || 'Premium Online Store', 58, 136);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(29).text('INVOICE', 385, 70, { width: 150, align: 'right' });
    doc.fontSize(9).text(`# ${clean(order.orderNumber)}`, 360, 104, { width: 175, align: 'right' });
    doc.fillColor('#d1fae5').font('Helvetica').fontSize(8).text(`${new Date(order.createdAt || Date.now()).toLocaleDateString('en-LK', { month:'long', day:'numeric', year:'numeric' })}  ${new Date(order.createdAt || Date.now()).toLocaleTimeString('en-LK', { hour:'2-digit', minute:'2-digit' })}`, 360, 119, { width:175, align:'right' });

    const billing = order.billing || {}; const shipping = order.shipping || billing;
    const infoTop = 170; const colW = 180;
    const info = [
      ['BILLED TO', `${clean(billing.firstName)} ${clean(billing.lastName)}`, [billing.email, billing.phone, address(billing)]],
      ['SHIPPED TO', `${clean(shipping.firstName || billing.firstName)} ${clean(shipping.lastName || billing.lastName)}`, [shipping.phone, address(shipping)]],
      ['FROM', storeName, [settings.storeEmail, settings.storePhone, settings.storeAddress]],
    ];
    info.forEach((entry, i) => {
      const x = 28 + i * colW;
      if (i) doc.moveTo(x, infoTop).lineTo(x, 322).strokeColor('#cbd5e1').lineWidth(0.7).stroke();
      doc.fillColor(green).font('Helvetica-Bold').fontSize(8).text(entry[0], x + 20, 187, { width: colW - 35 });
      doc.fillColor(navy).fontSize(11).text(entry[1], x + 20, 210, { width: colW - 35 });
      doc.fillColor(muted).font('Helvetica').fontSize(8).text(entry[2].map(clean).filter(Boolean).join('\n'), x + 20, 232, { width: colW - 35, lineGap: 5 });
    });
    doc.moveTo(28, 322).lineTo(567, 322).strokeColor('#cbd5e1').stroke();

    let y = 356;
    const header = () => {
      doc.fillColor(green).font('Helvetica-Bold').fontSize(7.5).text('DESCRIPTION', 58, y, { width: 300 });
      doc.text('QTY', 370, y, { width: 35, align:'center' }); doc.text('UNIT\nPRICE', 410, y - 3, { width:55, align:'right' }); doc.text('AMOUNT', 480, y, { width:58, align:'right' });
      y += 25; doc.moveTo(52, y - 7).lineTo(543, y - 7).strokeColor(green).lineWidth(1.5).stroke();
    };
    header();
    for (const item of order.items || []) {
      if (y > 610) { doc.addPage({ margin:0 }); y=55; header(); }
      const qty=Number(item.quantity||1); const amount=Number(item.subtotal ?? Number(item.price||0)*qty);
      const product = item.product && typeof item.product === 'object' ? item.product : {};
      const liveProductPrice = Number(product.salePrice) > 0 && Number(product.salePrice) < Number(product.price)
        ? Number(product.salePrice) : Number(product.price || 0);
      const displayedUnitPrice = item.isFree
        ? (Number(item.originalPrice) > 0 ? Number(item.originalPrice) : liveProductPrice)
        : Number(item.price || 0);
      doc.fillColor(navy).font('Helvetica-Bold').fontSize(8).text(`${clean(item.name)}${item.isFree ? '  [FREE GIFT]' : ''}`, 58, y, { width:295 });
      if (item.sku) doc.fillColor(muted).font('Helvetica').fontSize(7).text(`SKU: ${clean(item.sku)}`,58,y+13,{width:295});
      // A free gift keeps its normal unit value for transparency, while the
      // charged line amount is zero. The description already labels it FREE.
      doc.fillColor(navy).font('Helvetica').fontSize(8)
        .text(String(qty),370,y,{width:35,align:'center'})
        .text(money(displayedUnitPrice),410,y,{width:55,align:'right'})
        .font('Helvetica-Bold').fillColor(item.isFree ? green : navy)
        .text(money(item.isFree ? 0 : amount),480,y,{width:58,align:'right'});
      y += Math.max(35, doc.heightOfString(clean(item.name),{width:295})+19); doc.moveTo(52,y-7).lineTo(543,y-7).strokeColor('#e2e8f0').lineWidth(.6).stroke();
    }

    y += 12; const boxX=318; const boxW=225;
    const coupon=Number(order.couponDiscount||order.discount||0); const gift=Number(order.giftCardDeduction||order.giftCardDiscount||0);
    const rows=3+(coupon>0?1:0)+(gift>0?1:0); const boxH=rows*25+22;
    doc.roundedRect(boxX,y,boxW,boxH,8).fillAndStroke('#f8fafc','#cbd5e1'); let ry=y+17;
    const row=(label,value,color=muted,bold=false)=>{doc.fillColor(color).font(bold?'Helvetica-Bold':'Helvetica').fontSize(bold?12:8.5).text(label,boxX+16,ry,{width:95}).text(value,boxX+115,ry,{width:92,align:'right'});ry+=25;};
    row('Subtotal',money(order.subtotal)); if(coupon>0)row(`Coupon${order.couponCode?` (${clean(order.couponCode)})`:''}`,`-${money(coupon)}`,green); if(gift>0)row('Gift Card',`-${money(gift)}`,'#7c3aed'); row('Shipping',money(order.shippingCost));
    doc.moveTo(boxX+16,ry-6).lineTo(boxX+207,ry-6).strokeColor(green).lineWidth(1.3).stroke(); row('Total',money(order.total),navy,true);

    let payY=y+boxH+20; if(payY>705){doc.addPage({margin:0});payY=70;}
    doc.roundedRect(52,payY,491,52,9).fillAndStroke('#f8fafc','#cbd5e1');
    const paymentLabel=order.paymentMethod==='bank_transfer'?'Bank Transfer':order.paymentMethod==='cod'?'Cash on Delivery':clean(order.paymentMethod).replace(/_/g,' ');
    doc.fillColor('#94a3b8').font('Helvetica-Bold').fontSize(7).text('PAYMENT METHOD',68,payY+13).fillColor(navy).fontSize(9).text(paymentLabel,68,payY+28);
    const paid=order.paymentStatus==='paid'; doc.roundedRect(484,payY+17,44,18,9).fill(paid?'#dcfce7':'#fef3c7'); doc.fillColor(paid?'#16a34a':'#d97706').fontSize(7).text((order.paymentStatus||'pending').toUpperCase(),484,payY+23,{width:44,align:'center'});

    const footerY=payY+69; doc.rect(28,footerY,539,88).fill(navy);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text('Thank You for Your Order!',58,footerY+31);
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(7).text('We appreciate your business & hope to see you again.',58,footerY+48);
    doc.fontSize(7).text([settings.storeEmail,settings.storePhone,settings.storeAddress].map(clean).filter(Boolean).join('\n'),390,footerY+25,{width:145,align:'right',lineGap:4});
    doc.end();
  });
}

module.exports={buildInvoicePdf};
