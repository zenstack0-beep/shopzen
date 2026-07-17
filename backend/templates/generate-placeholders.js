/**
 * One-off script to generate placeholder 1080x1080 template background PNGs
 * so the Template Mode engine has something real to render against.
 *
 * These are intentionally simple — swap them out by dropping replacement
 * PNGs (same filenames, same 1080x1080 canvas) into templates/assets/,
 * matching the "background" field in each templates/configs/*.json.
 *
 * Run: node templates/generate-placeholders.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ASSETS_DIR = path.join(__dirname, 'assets');
const CONFIGS_DIR = path.join(__dirname, 'configs');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });

const W = 1080, H = 1080;

/* ── 1. Sale Burst — bold orange/red radial burst ── */
const saleBurstSvg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#ff6b35"/>
      <stop offset="55%" stop-color="#e8401f"/>
      <stop offset="100%" stop-color="#a8200d"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g opacity="0.12" stroke="#ffffff" stroke-width="3">
    ${Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2;
      const x2 = W / 2 + Math.cos(angle) * 900;
      const y2 = H / 2 + Math.sin(angle) * 900;
      return `<line x1="${W / 2}" y1="${H / 2}" x2="${x2}" y2="${y2}"/>`;
    }).join('\n    ')}
  </g>
  <rect x="0" y="860" width="${W}" height="${H - 860}" fill="#000000" opacity="0.22"/>
</svg>`;

/* ── 2. Minimal Studio — clean light grey/white backdrop ── */
const minimalStudioSvg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fafafa"/>
      <stop offset="70%" stop-color="#f1f1f3"/>
      <stop offset="100%" stop-color="#e8e8eb"/>
    </linearGradient>
    <radialGradient id="spot" cx="50%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#spot)"/>
  <ellipse cx="${W / 2}" cy="700" rx="380" ry="40" fill="#000000" opacity="0.06"/>
</svg>`;

/* ── 3. Bold Banner — diagonal colour-blocked split ── */
const boldBannerSvg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="left" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2d2d5a"/>
      <stop offset="100%" stop-color="#1a1a2e"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#ffd600"/>
  <polygon points="0,0 720,0 480,${H} 0,${H}" fill="url(#left)"/>
  <circle cx="900" cy="180" r="220" fill="#ffffff" opacity="0.08"/>
  <circle cx="950" cy="850" r="160" fill="#1a1a2e" opacity="0.06"/>
</svg>`;

/* ── Extended professional catalog — 21 additional retail themes ── */
const EXTENDED_THEMES = [
  ['midnight-neon','Midnight Neon','Electric cyan on deep navy','#07111f','#142f4f','#31e8ff','#ffffff','#a8c4d8','right'],
  ['emerald-luxe','Emerald Luxe','Rich emerald with champagne highlights','#052e2b','#0d5d50','#f6d58d','#ffffff','#b8ddd3','left'],
  ['ocean-tech','Ocean Tech','Clean blue technology launch style','#071f3d','#0b63a7','#45caff','#ffffff','#b9daf4','center'],
  ['rose-elegance','Rose Elegance','Soft premium rose retail presentation','#fff0f4','#e9b2c2','#9f345b','#2d1720','#704352','right-light'],
  ['amber-flash','Amber Flash','High-energy amber deal campaign','#311500','#a84600','#ffcc33','#ffffff','#ffd7a3','left'],
  ['violet-future','Violet Future','Futuristic violet product spotlight','#140a2f','#51258d','#d36cff','#ffffff','#d2b9f4','center'],
  ['cyan-circuit','Cyan Circuit','Modern connected-device campaign','#031f25','#087985','#43f2df','#ffffff','#a9ddd8','right'],
  ['graphite-premium','Graphite Premium','Minimal graphite luxury showcase','#121316','#343840','#f0f2f5','#ffffff','#b8bec8','left'],
  ['coral-energy','Coral Energy','Warm energetic lifestyle promotion','#351019','#c94055','#ffd0a8','#ffffff','#ffd2d8','center'],
  ['sapphire-deal','Sapphire Deal','Confident sapphire sales presentation','#071b45','#174da0','#ffdc61','#ffffff','#bed0f5','right'],
  ['lime-motion','Lime Motion','Sporty black and lime campaign','#11150c','#35451d','#b8f04a','#ffffff','#d2e6a7','left'],
  ['burgundy-luxe','Burgundy Luxe','Deep burgundy premium offer style','#2d0713','#731b35','#f1bd75','#ffffff','#e7b8c6','center'],
  ['arctic-clean','Arctic Clean','Bright minimal product-first layout','#f6fbff','#dcecf5','#14759c','#102431','#4f7184','right-light'],
  ['sunset-glow','Sunset Glow','Orange-to-magenta launch energy','#37102e','#cf3c57','#ffcb57','#ffffff','#ffd2dc','left'],
  ['teal-modern','Teal Modern','Balanced teal contemporary retail','#062b32','#11717a','#7cf0d7','#ffffff','#b9e3df','center'],
  ['magenta-pop','Magenta Pop','Bold social-first product promotion','#31072a','#a41673','#ff8fd8','#ffffff','#f2bde2','right'],
  ['copper-elite','Copper Elite','Warm copper luxury technology look','#21100a','#6b3824','#e9a66f','#ffffff','#dfc2b2','left'],
  ['indigo-pulse','Indigo Pulse','Strong indigo campaign with bright accents','#0d123b','#303f9f','#8ee7ff','#ffffff','#c6ccf2','center'],
  ['mint-fresh','Mint Fresh','Fresh light lifestyle retail theme','#effcf7','#b9ead7','#087b65','#12352d','#4d776d','right-light'],
  ['red-velocity','Red Velocity','Fast high-impact limited deal style','#260607','#9d151a','#ffcf4a','#ffffff','#f3b5b7','left'],
  ['black-gold','Black Gold','Classic luxury black and gold campaign','#080808','#282015','#dcb85c','#ffffff','#d6c9a9','center'],
];

const ADVANCED_THEMES = [
  {id:'aurora-commerce-pro',label:'Aurora Commerce Pro',description:'Premium aurora product launch',bg1:'#071426',bg2:'#24306f',accent:'#54e7ff',accent2:'#a66cff',text:'#ffffff',muted:'#b9d8ef',panel:'#142b49',layout:'right'},
  {id:'obsidian-luxury-pro',label:'Obsidian Luxury Pro',description:'Black and gold luxury campaign',bg1:'#070707',bg2:'#292014',accent:'#e9c66f',accent2:'#8e6a28',text:'#ffffff',muted:'#d7c9a5',panel:'#211d17',layout:'center'},
  {id:'editorial-pearl-pro',label:'Editorial Pearl Pro',description:'Bright premium editorial catalogue',bg1:'#f9fbff',bg2:'#dce9f2',accent:'#116f92',accent2:'#71c8d9',text:'#102530',muted:'#55717f',panel:'#eaf3f7',layout:'left',light:true},
  {id:'velocity-conversion-pro',label:'Velocity Conversion Pro',description:'High-conversion red campaign',bg1:'#27080c',bg2:'#8e1525',accent:'#ffce4a',accent2:'#ff654f',text:'#ffffff',muted:'#f2bec4',panel:'#54111c',layout:'right'},
  {id:'emerald-glass-pro',label:'Emerald Glass Pro',description:'Emerald glass premium showcase',bg1:'#032822',bg2:'#0d6855',accent:'#f0d083',accent2:'#60e3bd',text:'#ffffff',muted:'#b9ddd3',panel:'#0b483d',layout:'left'},
  {id:'royal-tech-pro',label:'Royal Tech Pro',description:'Royal blue technology presentation',bg1:'#080f35',bg2:'#243b8f',accent:'#78e7ff',accent2:'#7d74ff',text:'#ffffff',muted:'#c4d3f4',panel:'#17275f',layout:'center'},
  {id:'sunset-social-pro',label:'Sunset Social Pro',description:'Bold sunset social commerce',bg1:'#3b1238',bg2:'#d14759',accent:'#ffd268',accent2:'#ff7e8e',text:'#ffffff',muted:'#ffd4dc',panel:'#7e2749',layout:'right'},
  {id:'minimal-catalogue-pro',label:'Minimal Catalogue Pro',description:'Clean high-end product catalogue',bg1:'#ffffff',bg2:'#eceff3',accent:'#202733',accent2:'#7f8fa5',text:'#151b25',muted:'#647184',panel:'#f5f6f8',layout:'left',light:true},
  {id:'neon-product-lab-pro',label:'Neon Product Lab Pro',description:'Futuristic neon product laboratory',bg1:'#040b18',bg2:'#102a3e',accent:'#25f1d1',accent2:'#a552ff',text:'#ffffff',muted:'#addbd5',panel:'#0c2130',layout:'center'},
  {id:'champagne-signature-pro',label:'Champagne Signature Pro',description:'Warm champagne premium retail',bg1:'#fffaf1',bg2:'#e8d1b0',accent:'#82582d',accent2:'#d4a663',text:'#2c2118',muted:'#765f49',panel:'#f6e9d6',layout:'right',light:true},
  {id:'ocean-conversion-pro',label:'Ocean Conversion Pro',description:'Modern ocean retail conversion',bg1:'#031e35',bg2:'#087ea0',accent:'#7cebdc',accent2:'#56b9ff',text:'#ffffff',muted:'#b8dce9',panel:'#07516c',layout:'left'},
  {id:'midnight-spotlight-pro',label:'Midnight Spotlight Pro',description:'Cinematic midnight product spotlight',bg1:'#090b13',bg2:'#24283a',accent:'#f4d06f',accent2:'#7e8dff',text:'#ffffff',muted:'#c3c8d7',panel:'#1a1d29',layout:'center'},
];

function advancedStage(theme) {
  if (theme.layout === 'left') return {x:35,y:210,w:535,h:610,cx:302,cy:800};
  if (theme.layout === 'center') return {x:175,y:250,w:730,h:485,cx:540,cy:710};
  return {x:510,y:210,w:535,h:610,cx:777,cy:800};
}

function advancedBackground(theme,index) {
  const s=advancedStage(theme);
  const featureCards=theme.layout==='center'
    ? [70,315,560,805].map(x=>`<rect x="${x}" y="755" width="205" height="68" rx="22" fill="${theme.panel}" stroke="${theme.accent}" stroke-opacity=".18"/>`).join('')
    : [450,525,600,675].map(y=>`<rect x="${theme.layout==='left'?610:55}" y="${y}" width="410" height="58" rx="18" fill="${theme.panel}" stroke="${theme.accent}" stroke-opacity=".16"/>`).join('');
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="adv-bg-${index}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${theme.bg1}"/><stop offset="1" stop-color="${theme.bg2}"/></linearGradient>
    <radialGradient id="adv-a-${index}" cx="78%" cy="24%" r="62%"><stop stop-color="${theme.accent}" stop-opacity=".27"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="adv-b-${index}" cx="15%" cy="82%" r="58%"><stop stop-color="${theme.accent2}" stop-opacity=".22"/><stop offset="1" stop-color="${theme.accent2}" stop-opacity="0"/></radialGradient>
    <linearGradient id="adv-stage-${index}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${theme.light?'#ffffff':theme.accent}" stop-opacity="${theme.light?'.58':'.13'}"/><stop offset="1" stop-color="${theme.panel}" stop-opacity="${theme.light?'.78':'.68'}"/></linearGradient>
    <filter id="adv-shadow-${index}" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="28" stdDeviation="34" flood-color="#000" flood-opacity="${theme.light?'.15':'.42'}"/></filter>
    <pattern id="adv-grid-${index}" width="72" height="72" patternUnits="userSpaceOnUse"><path d="M72 0H0V72" fill="none" stroke="${theme.text}" stroke-opacity=".026"/></pattern>
  </defs>
  <rect width="1080" height="1080" fill="url(#adv-bg-${index})"/>
  <rect width="1080" height="1080" fill="url(#adv-a-${index})"/><rect width="1080" height="1080" fill="url(#adv-b-${index})"/><rect width="1080" height="1080" fill="url(#adv-grid-${index})"/>
  <circle cx="${index%2?930:120}" cy="${index%2?120:900}" r="220" fill="none" stroke="${theme.accent}" stroke-opacity=".13" stroke-width="2"/><circle cx="${index%2?930:120}" cy="${index%2?120:900}" r="155" fill="none" stroke="${theme.accent2}" stroke-opacity=".10" stroke-width="2"/>
  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="64" fill="url(#adv-stage-${index})" stroke="${theme.light?theme.muted:'#ffffff'}" stroke-opacity=".16" stroke-width="2" filter="url(#adv-shadow-${index})"/>
  <ellipse cx="${s.cx}" cy="${s.cy}" rx="210" ry="28" fill="#000" opacity="${theme.light?'.12':'.30'}"/>
  ${featureCards}
  <rect x="50" y="28" width="68" height="5" rx="2.5" fill="${theme.accent}"/><rect x="126" y="28" width="24" height="5" rx="2.5" fill="${theme.accent2}"/>
  <rect y="1010" width="1080" height="70" fill="${theme.light?'#ffffff':'#030509'}" opacity="${theme.light?'.72':'.48'}"/>
  </svg>`;
}

function advancedConfig(theme,index) {
  const s=advancedStage(theme);
  const pillText=theme.light?'#ffffff':'#071019';
  const fields={
    badge:{x:55,y:50,width:220,height:56,fontSize:20,fontWeight:900,color:pillText,background:theme.accent,borderRadius:28,uppercase:true},
    brand:textField(825,58,200,24,theme.text,'right',1,900),
    productBrand:{x:55,y:382,width:170,height:48,fontSize:17,fontWeight:900,color:pillText,background:theme.accent,borderRadius:24,uppercase:true},
    category:{x:235,y:382,width:190,height:48,fontSize:16,fontWeight:800,color:theme.text,background:theme.panel,borderRadius:24},
    discount:{x:55,y:835,width:205,height:66,fontSize:28,fontWeight:900,color:pillText,background:theme.accent,borderRadius:20,suffix:'% OFF',showIf:'discount > 0'},
    originalPrice:{...textField(55,910,260,24,theme.muted),prefix:'Rs. ',strikethrough:true,format:'number',showIf:'discount > 0 && originalPrice > 0'},
    price:{...textField(55,945,360,49,theme.text,'left',1,900),prefix:'Rs. ',format:'number'},
    cta:{x:720,y:920,width:305,height:76,fontSize:25,fontWeight:900,color:pillText,background:theme.accent,borderRadius:38,uppercase:true},
    website:{...textField(45,1037,420,19,theme.muted,'left',1,800),uppercase:true},
    whatsapp:{...textField(615,1037,420,19,theme.muted,'right',1,800),prefix:'WHATSAPP  '},
  };
  let productImage;
  if(theme.layout==='right'){
    productImage={x:525,y:235,width:500,height:555,fit:'contain',glow:{enabled:true,color:theme.light?theme.muted:'#ffffff',blur:54,opacity:.22},shadow:{enabled:true,blur:36,opacity:theme.light?.28:.42,offsetY:30}};
    Object.assign(fields,{
      name:{...textField(55,135,440,48,theme.text,'left',4,900),autoFit:true,minFontSize:33},description:textField(55,330,410,21,theme.muted,'left',2,500),
      feature1:{...textField(75,463,370,18,theme.text,'left',2,800),prefix:'✓ '},feature2:{...textField(75,538,370,18,theme.text,'left',2,800),prefix:'✓ '},feature3:{...textField(75,613,370,18,theme.text,'left',2,800),prefix:'✓ '},feature4:{...textField(75,688,370,18,theme.text,'left',2,800),prefix:'✓ '},
    });
  }else if(theme.layout==='left'){
    productImage={x:50,y:235,width:500,height:555,fit:'contain',glow:{enabled:true,color:theme.light?theme.muted:'#ffffff',blur:54,opacity:.22},shadow:{enabled:true,blur:36,opacity:theme.light?.28:.42,offsetY:30}};
    Object.assign(fields,{
      name:{...textField(610,135,415,48,theme.text,'left',4,900),autoFit:true,minFontSize:33},description:textField(610,330,400,21,theme.muted,'left',2,500),
      productBrand:{...fields.productBrand,x:610},category:{...fields.category,x:790,width:220},
      feature1:{...textField(630,463,370,18,theme.text,'left',2,800),prefix:'✓ '},feature2:{...textField(630,538,370,18,theme.text,'left',2,800),prefix:'✓ '},feature3:{...textField(630,613,370,18,theme.text,'left',2,800),prefix:'✓ '},feature4:{...textField(630,688,370,18,theme.text,'left',2,800),prefix:'✓ '},
      discount:{...fields.discount,x:610},originalPrice:{...fields.originalPrice,x:610},price:{...fields.price,x:610},cta:{...fields.cta,x:55,width:500},
    });
  }else{
    productImage={x:205,y:270,width:670,height:435,fit:'contain',glow:{enabled:true,color:theme.light?theme.muted:'#ffffff',blur:56,opacity:.22},shadow:{enabled:true,blur:38,opacity:theme.light?.28:.42,offsetY:28}};
    Object.assign(fields,{
      name:{...textField(105,125,870,49,theme.text,'center',3,900),autoFit:true,minFontSize:33},description:textField(220,230,640,20,theme.muted,'center',2,500),
      productBrand:{...fields.productBrand,x:335,y:690},category:{...fields.category,x:515,y:690,width:230},
      feature1:{...textField(82,773,180,16,theme.text,'center',2,800),prefix:'✓ '},feature2:{...textField(327,773,180,16,theme.text,'center',2,800),prefix:'✓ '},feature3:{...textField(572,773,180,16,theme.text,'center',2,800),prefix:'✓ '},feature4:{...textField(817,773,180,16,theme.text,'center',2,800),prefix:'✓ '},
    });
  }
  return {id:theme.id,label:theme.label,description:theme.description,tier:'advanced',priority:200-index,background:`${theme.id}.png`,canvas:{width:W,height:H},thumbnail:`${theme.id}.png`,logo:{x:720,y:30,width:305,height:82,fit:'contain'},logoMark:{x:735,y:30,width:78,height:78,fit:'contain'},productImage,fields};
}

function extendedBackground([id,,description,bg1,bg2,accent,text,muted,layout], index) {
  const light=layout==='right-light';
  const stripe=light?'#ffffff':text;
  const panel = layout === 'left'
    ? { x: 25, y: 215, width: 545, height: 650, cx: 300, cy: 820, rx: 225 }
    : layout === 'center'
      ? { x: 165, y: 300, width: 750, height: 505, cx: 540, cy: 790, rx: 285 }
      : { x: 430, y: 215, width: 610, height: 650, cx: 735, cy: 820, rx: 245 };
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
      <radialGradient id="halo-${id}" cx="68%" cy="44%" r="52%"><stop stop-color="${accent}" stop-opacity=".28"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
      <pattern id="grid-${id}" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="${stripe}" stroke-opacity=".025" stroke-width="1"/></pattern>
      <filter id="panel-shadow-${id}" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#000000" flood-opacity="${light?'.10':'.24'}"/></filter>
    </defs>
    <rect width="1080" height="1080" fill="url(#bg-${id})"/>
    <rect width="1080" height="1080" fill="url(#halo-${id})"/>
    <rect width="1080" height="1080" fill="url(#grid-${id})"/>
    <circle cx="${870-(index%3)*55}" cy="${190+(index%4)*35}" r="270" fill="none" stroke="${accent}" stroke-opacity=".11" stroke-width="3"/>
    <path d="M-80 ${875-(index%3)*55} L1160 ${705+(index%4)*40}" stroke="${accent}" stroke-opacity=".075" stroke-width="105"/>
    <rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" rx="58"
      fill="${light?muted:'#ffffff'}" fill-opacity="${light?'.095':'.055'}" stroke="${light?muted:'#ffffff'}" stroke-opacity="${light?'.16':'.10'}" stroke-width="2" filter="url(#panel-shadow-${id})"/>
    <ellipse cx="${panel.cx}" cy="${panel.cy}" rx="${panel.rx}" ry="34" fill="#000000" opacity="${light?'.10':'.24'}"/>
    <rect x="55" y="26" width="56" height="4" rx="2" fill="${accent}"/>
    <rect y="1015" width="1080" height="65" fill="${light?'#ffffff':'#05070a'}" fill-opacity="${light?'.58':'.38'}"/>
  </svg>`;
}

function textField(x,y,width,fontSize,color,align='left',maxLines=1,weight=700) {
  return {x,y,width,fontSize,fontWeight:weight,fontFamily:'Arial, sans-serif',color,align,maxLines,lineHeight:1.08};
}

function buildExtendedConfig(theme) {
  const [id,label,description,,,accent,text,muted,layout]=theme;
  const light=layout==='right-light';
  const buttonText=light?'#ffffff':'#101318';
  const common={
    badge:{x:55,y:50,width:220,height:56,fontSize:20,fontWeight:900,color:buttonText,background:accent,borderRadius:28,uppercase:true},
    brand:textField(825,57,200,24,text,'right',1,900),
    discount:{x:55,y:715,width:210,height:70,fontSize:30,fontWeight:900,color:buttonText,background:accent,borderRadius:20,suffix:'% OFF',showIf:'discount > 0'},
    originalPrice:{...textField(55,805,300,25,muted),prefix:'Rs. ',strikethrough:true,format:'number',showIf:'discount > 0 && originalPrice > 0'},
    price:{...textField(55,845,360,50,text,'left',1,900),prefix:'Rs. ',format:'number'},
    cta:{x:55,y:930,width:300,height:70,fontSize:24,fontWeight:900,color:buttonText,background:accent,borderRadius:35,uppercase:true},
    website:textField(45,1038,450,20,muted,'left',1,700),
    whatsapp:textField(585,1038,450,20,muted,'right',1,700),
  };
  common.website.uppercase=true;
  common.whatsapp.prefix='WHATSAPP  ';

  let productImage;
  if(layout==='left'){
    productImage={x:30,y:235,width:535,height:610,fit:'contain',glow:{enabled:true,color:'#ffffff',blur:50,opacity:.20},shadow:{enabled:true,blur:32,opacity:.38,offsetY:28}};
    Object.assign(common,{
      name:{...textField(600,140,425,48,text,'left',4,900),autoFit:true,minFontSize:34},description:textField(600,355,400,22,muted,'left',2,500),
      discount:{...common.discount,x:600,y:695},originalPrice:{...common.originalPrice,x:600,y:795},price:{...common.price,x:600,y:840},cta:{...common.cta,x:600,y:930,width:400},
      feature1:{...textField(600,460,400,19,text,'left',2),prefix:'✓ '},feature2:{...textField(600,535,400,19,text,'left',2),prefix:'✓ '},feature3:{...textField(600,610,400,19,text,'left',2),prefix:'✓ '},
    });
  }else if(layout==='center'){
    productImage={x:190,y:315,width:700,height:465,fit:'contain',glow:{enabled:true,color:'#ffffff',blur:52,opacity:.20},shadow:{enabled:true,blur:34,opacity:.36,offsetY:28}};
    Object.assign(common,{
      name:{...textField(105,130,870,50,text,'center',3,900),autoFit:true,minFontSize:34},description:textField(190,285,700,21,muted,'center',2,500),
      discount:{...common.discount,x:70,y:835},originalPrice:{...common.originalPrice,x:70,y:915},price:{...common.price,x:70,y:950},cta:{...common.cta,x:730,y:930},
      feature1:{...textField(185,800,230,18,text,'center',2),prefix:'✓ '},feature2:{...textField(425,800,230,18,text,'center',2),prefix:'✓ '},feature3:{...textField(665,800,230,18,text,'center',2),prefix:'✓ '},
    });
  }else{
    productImage={x:450,y:245,width:570,height:590,fit:'contain',glow:{enabled:true,color:light?muted:'#ffffff',blur:52,opacity:light?.20:.22},shadow:{enabled:true,blur:34,opacity:light?.28:.40,offsetY:28}};
    Object.assign(common,{
      name:{...textField(55,140,470,48,text,'left',4,900),autoFit:true,minFontSize:34},description:textField(55,360,365,21,muted,'left',2,500),
      feature1:{...textField(55,465,350,19,text,'left',2),prefix:'✓ '},feature2:{...textField(55,540,350,19,text,'left',2),prefix:'✓ '},feature3:{...textField(55,615,350,19,text,'left',2),prefix:'✓ '},
    });
  }
  return {
    id,label,description,background:`${id}.png`,canvas:{width:W,height:H},thumbnail:`${id}.png`,
    logo:{x:720,y:30,width:305,height:82,fit:'contain'},logoMark:{x:735,y:30,width:78,height:78,fit:'contain'},productImage,fields:common,
  };
}

async function build(name, svg) {
  const outPath = path.join(ASSETS_DIR, `${name}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`✓ ${outPath}`);
}

(async () => {
  await build('sale-burst', saleBurstSvg);
  await build('minimal-studio', minimalStudioSvg);
  await build('bold-banner', boldBannerSvg);
  for(let index=0;index<EXTENDED_THEMES.length;index++){
    const theme=EXTENDED_THEMES[index];
    await build(theme[0],extendedBackground(theme,index));
    fs.writeFileSync(path.join(CONFIGS_DIR,`${theme[0]}.json`),`${JSON.stringify(buildExtendedConfig(theme),null,2)}\n`);
  }
  for(let index=0;index<ADVANCED_THEMES.length;index++){
    const theme=ADVANCED_THEMES[index];
    await build(theme.id,advancedBackground(theme,index));
    fs.writeFileSync(path.join(CONFIGS_DIR,`${theme.id}.json`),`${JSON.stringify(advancedConfig(theme,index),null,2)}\n`);
  }
  console.log(`\n${EXTENDED_THEMES.length + ADVANCED_THEMES.length + 3} template backgrounds are ready.`);
})();
