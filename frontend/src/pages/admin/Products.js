import React, { useEffect, useState, useCallback, useRef } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';
import ImageUpload from '../../components/ImageUpload';

const VARIANT_TYPES = [
  { value:'size',     label:'Size',          icon:'📏', defaultValues:['XS','S','M','L','XL','XXL'] },
  { value:'color',    label:'Color',         icon:'🎨', defaultValues:['Red','Blue','Green','Black','White','Yellow'] },
  { value:'material', label:'Material',      icon:'🧵', defaultValues:['Cotton','Polyester','Silk','Leather','Wool'] },
  { value:'style',    label:'Style',         icon:'✨', defaultValues:['Classic','Modern','Vintage','Slim Fit','Regular Fit'] },
  { value:'storage',  label:'Storage',       icon:'💾', defaultValues:['64GB','128GB','256GB','512GB','1TB'] },
  { value:'weight',   label:'Weight',        icon:'⚖️', defaultValues:['Light','Medium','Heavy'] },
  { value:'flavor',   label:'Flavor',        icon:'🍫', defaultValues:['Chocolate','Vanilla','Strawberry','Mint'] },
  { value:'button',   label:'Custom Option', icon:'🔘', defaultValues:[] },
];

const DRAFT_KEY = 'shopzen_product_draft';

const emptyProduct = {
  name:'', description:'', shortDescription:'', price:'', salePrice:'',
  costPrice:'', sku:'', category:'', brand:'', stock:'5', lowStockThreshold:5,
  weight:'', thumbnail:'', images:[],
  tags:'', isFeatured:false, isActive:true, isOnSale:false,
  specifications:[], variants:[]
};

/* ── Modal ── */
const Modal = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide?'max-w-4xl':'max-w-2xl'} max-h-[92vh] overflow-y-auto`} onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
        <h2 className="font-display font-bold text-xl text-gray-900">{title}</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">✕</button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

/* ── Rich Text Editor ── */
function RichEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const lastVal   = useRef(null);

  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastVal.current) {
      lastVal.current = value;
      editorRef.current.innerHTML = value || '';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const fire = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastVal.current = html;
    onChange(html);
  };

  const exec = (cmd, val = null) => { editorRef.current?.focus(); document.execCommand(cmd, false, val); fire(); };

  const insertTable = () => {
    const rows = parseInt(window.prompt('Rows?', '3')) || 3;
    const cols = parseInt(window.prompt('Columns?', '3')) || 3;
    let html = '<table border="1" style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += r === 0
          ? '<th style="border:1px solid #ddd;padding:6px 10px;background:#f3f4f6;font-weight:600">&nbsp;</th>'
          : '<td style="border:1px solid #ddd;padding:6px 10px">&nbsp;</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    fire();
  };

  const TB = ({ title: t, icon, onClick }) => (
    <button type="button" title={t} onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded text-xs font-bold hover:bg-gray-100 text-gray-700 transition-colors">
      {icon}
    </button>
  );
  const Div = () => <div className="w-px h-5 bg-gray-200 mx-0.5 self-center" />;

  return (
    <div className="border border-gray-300 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 p-2 bg-gray-50 border-b border-gray-200">
        <select onChange={e=>{exec('formatBlock',e.target.value);e.target.value='';}} defaultValue=""
          className="text-xs border border-gray-200 rounded px-1 py-0.5 mr-1 bg-white">
          <option value="" disabled>Heading</option>
          <option value="h1">H1</option><option value="h2">H2</option>
          <option value="h3">H3</option><option value="h4">H4</option>
          <option value="p">Normal</option>
        </select>
        <TB title="Bold"           icon="B"    onClick={()=>exec('bold')} />
        <TB title="Italic"         icon={<em>I</em>} onClick={()=>exec('italic')} />
        <TB title="Underline"      icon={<u>U</u>}   onClick={()=>exec('underline')} />
        <TB title="Strikethrough"  icon={<s>S</s>}   onClick={()=>exec('strikeThrough')} />
        <Div/>
        <TB title="Align Left"     icon="⬅"   onClick={()=>exec('justifyLeft')} />
        <TB title="Align Center"   icon="☰"   onClick={()=>exec('justifyCenter')} />
        <TB title="Align Right"    icon="➡"   onClick={()=>exec('justifyRight')} />
        <Div/>
        <TB title="Bullet List"    icon="•≡"  onClick={()=>exec('insertUnorderedList')} />
        <TB title="Numbered List"  icon="1≡"  onClick={()=>exec('insertOrderedList')} />
        <TB title="Indent"         icon="→"   onClick={()=>exec('indent')} />
        <TB title="Outdent"        icon="←"   onClick={()=>exec('outdent')} />
        <Div/>
        <TB title="Insert Table"   icon="⊞"   onClick={insertTable} />
        <TB title="Insert Link"    icon="🔗"  onClick={()=>{const u=window.prompt('URL:','https://');if(u)exec('createLink',u);}} />
        <TB title="Remove Link"    icon="✂"   onClick={()=>exec('unlink')} />
        <TB title="Horiz. Rule"    icon="—"   onClick={()=>exec('insertHorizontalRule')} />
        <TB title="Clear Format"   icon="✕"   onClick={()=>exec('removeFormat')} />
        <select onChange={e=>{exec('fontSize',e.target.value);e.target.value='';}} defaultValue=""
          className="text-xs border border-gray-200 rounded px-1 py-0.5 ml-1 bg-white">
          <option value="" disabled>Size</option>
          {[1,2,3,4,5,6,7].map(s=><option key={s} value={s}>{['8','10','12','14','18','24','36'][s-1]}px</option>)}
        </select>
        <label title="Text Color" className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 cursor-pointer">
          <span className="text-xs font-bold text-gray-700">A</span>
          <input type="color" className="w-0 h-0 opacity-0 absolute" onChange={e=>exec('foreColor',e.target.value)} />
        </label>
        <label title="Highlight" className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 cursor-pointer">
          <span className="text-xs font-bold" style={{background:'#fef08a',padding:'1px 2px'}}>H</span>
          <input type="color" className="w-0 h-0 opacity-0 absolute" onChange={e=>exec('hiliteColor',e.target.value)} />
        </label>
      </div>
      <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={fire}
        className="min-h-[180px] p-3 text-sm text-gray-800 outline-none overflow-y-auto"
        style={{maxHeight:'340px',lineHeight:'1.7'}} />
    </div>
  );
}

/* ── Specifications Panel ── */
function SpecsPanel({ specs, onChange }) {
  const [specKey,    setSpecKey]   = useState('');
  const [specVal,    setSpecVal]   = useState('');
  const [pasteText,  setPasteText] = useState('');
  const [showPaste,  setShowPaste] = useState(false);

  // Use a ref so parseAndAdd always reads the LATEST specs, never stale
  const specsRef = useRef(specs);
  useEffect(() => { specsRef.current = specs; }, [specs]);

  const addOne = () => {
    if (!specKey.trim() || !specVal.trim()) { toast.error('Enter both name and value'); return; }
    onChange([...specsRef.current, { key: specKey.trim(), value: specVal.trim() }]);
    setSpecKey(''); setSpecVal('');
  };

  const parseAndAdd = () => {
    if (!pasteText.trim()) { toast.error('Nothing to paste'); return; }
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = [];
    lines.forEach(line => {
      let key = '', value = '';
      const ci = line.indexOf(':');
      const pi = line.indexOf('|');
      const di = line.search(/\s-\s/);
      const ti = line.indexOf('\t');
      if      (ci > 0) { key = line.slice(0,ci).trim();  value = line.slice(ci+1).trim(); }
      else if (pi > 0) { key = line.slice(0,pi).trim();  value = line.slice(pi+1).trim(); }
      else if (di > 0) { key = line.slice(0,di).trim();  value = line.slice(di).replace(/^[\s-]+/,'').trim(); }
      else if (ti > 0) { key = line.slice(0,ti).trim();  value = line.slice(ti+1).trim(); }
      if (key && value) parsed.push({ key, value });
    });
    if (parsed.length === 0) { toast.error('Could not parse. Use format: Name: Value'); return; }
    onChange([...specsRef.current, ...parsed]);
    setPasteText(''); setShowPaste(false);
    toast.success(`Added ${parsed.length} spec${parsed.length>1?'s':''}`);
  };

  const remove   = i => onChange(specsRef.current.filter((_,si)=>si!==i));
  const moveUp   = i => { if(i===0)return; const s=[...specsRef.current];[s[i-1],s[i]]=[s[i],s[i-1]];onChange(s); };
  const moveDown = i => { if(i===specs.length-1)return; const s=[...specsRef.current];[s[i],s[i+1]]=[s[i+1],s[i]];onChange(s); };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Add technical specifications shown on the product page.</p>
      <div className="flex gap-2">
        <input value={specKey} onChange={e=>setSpecKey(e.target.value)}
          onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();document.getElementById('spec-val')?.focus();}}}
          className="form-input text-sm flex-1" placeholder="Spec name (e.g. Battery)"/>
        <input id="spec-val" value={specVal} onChange={e=>setSpecVal(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')addOne();}}
          className="form-input text-sm flex-1" placeholder="Value (e.g. 4000mAh)"/>
        <button onClick={addOne} className="btn-primary text-sm px-4 flex-shrink-0">+ Add</button>
      </div>
      <div>
        <button onClick={()=>setShowPaste(p=>!p)} className="text-xs text-blue-600 hover:underline">
          📋 {showPaste?'Hide':'Paste a full list instead'}
        </button>
        {showPaste && (
          <div className="mt-2 space-y-2">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Paste specs below — one per line:</p>
              <p className="font-mono">Battery: 4000mAh &nbsp;·&nbsp; Display | 6.5 inch &nbsp;·&nbsp; RAM - 8GB</p>
            </div>
            <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)}
              className="form-input text-sm resize-none" rows={6}
              placeholder={"Battery: 4000mAh\nDisplay: 6.5 inch AMOLED\nRAM: 8GB\nStorage: 256GB"}/>
            <div className="flex gap-2">
              <button onClick={parseAndAdd} className="btn-primary text-sm">✓ Parse & Add All</button>
              <button onClick={()=>{setPasteText('');setShowPaste(false);}} className="btn-outline text-sm">Cancel</button>
            </div>
          </div>
        )}
      </div>
      {specs.length > 0 ? (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {specs.map((spec,i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <button onClick={()=>moveUp(i)} className="text-gray-300 hover:text-gray-500 text-xs leading-none">▲</button>
                <button onClick={()=>moveDown(i)} className="text-gray-300 hover:text-gray-500 text-xs leading-none">▼</button>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-700">{spec.key}</span>
                <span className="text-gray-300 mx-2">·</span>
                <span className="text-sm text-gray-600">{spec.value}</span>
              </div>
              <button onClick={()=>remove(i)} className="text-red-300 hover:text-red-500 text-sm">✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4 border-2 border-dashed border-gray-200 rounded-xl">
          No specifications yet.
        </p>
      )}
    </div>
  );
}

/* ── Draft Banner ── */
function DraftBanner({ savedAt, onRestore, onDiscard }) {
  if (!savedAt) return null;
  return (
    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
      <div className="flex items-center gap-2">
        <span>💾</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">Draft saved</p>
          <p className="text-xs text-amber-600">{savedAt}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onRestore} className="text-xs font-semibold text-amber-700 underline">Restore</button>
        <button onClick={onDiscard} className="text-xs text-gray-400">Discard</button>
      </div>
    </div>
  );
}

/* ── Main Component ── */
export default function AdminProducts() {
  const [products, setProducts]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null);
  const [form, setForm]           = useState(emptyProduct);
  const [saving, setSaving]       = useState(false);
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [activeTab, setActiveTab] = useState('basic');
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [hasDraft, setHasDraft]   = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('');

  // formRef always mirrors form state — handleSave reads this to avoid stale closures
  const formRef       = useRef(emptyProduct);
  const autoSaveTimer = useRef(null);
  const isEditMode    = useRef(false);

  // AI autofill state
  const [aiFillingBrand, setAiFillingBrand]     = useState(false);
  const [aiFillingShort, setAiFillingShort]     = useState(false);
  const [tagSuggestions, setTagSuggestions]     = useState([]);
  const [loadingTags, setLoadingTags]           = useState(false);
  const aiNameTimer = useRef(null);

  // setForm wrapper that keeps formRef in sync
  const updateForm = useCallback((updater) => {
    setForm(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      formRef.current = next;
      return next;
    });
  }, []);

  /* ── AI Autofill helpers (calls own backend → Anthropic) ── */
  const autofillFromName = async (name) => {
    if (!name || name.length < 3) return;
    setAiFillingBrand(true);
    setAiFillingShort(true);
    try {
      const { data } = await API.post('/ai/autofill', { name });
      updateForm(p => ({
        ...p,
        brand:            (!p.brand            && data.brand)            ? data.brand            : p.brand,
        shortDescription: (!p.shortDescription && data.shortDescription) ? data.shortDescription : p.shortDescription,
      }));
    } catch (err) {
      console.error('[AI autofill]', err?.response?.data?.message || err.message);
    } finally {
      setAiFillingBrand(false);
      setAiFillingShort(false);
    }
  };

  const fetchTagSuggestions = async (name, category, brand) => {
    if (!name || name.length < 3) return;
    setLoadingTags(true);
    setTagSuggestions([]);
    try {
      const { data } = await API.post('/ai/tags', { name, category, brand });
      if (Array.isArray(data.tags)) setTagSuggestions(data.tags.slice(0, 10));
    } catch (err) {
      console.error('[AI tags]', err?.response?.data?.message || err.message);
      toast.error('Could not fetch tag suggestions');
    } finally {
      setLoadingTags(false);
    }
  };

  const handleNameChange = (name) => {
    updateForm(p => ({ ...p, name }));
    clearTimeout(aiNameTimer.current);
    aiNameTimer.current = setTimeout(() => {
      autofillFromName(name);
    }, 900);
  };

  const toggleTag = (tag) => {
    updateForm(p => {
      const existing = p.tags ? p.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
      const idx = existing.indexOf(tag);
      const updated = idx >= 0 ? existing.filter(t => t !== tag) : [...existing, tag];
      return { ...p, tags: updated.join(", ") };
    });
  };


  /* ── Fetch products ── */
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get(`/products/admin/all?search=${search}&page=${page}&limit=15`);
      setProducts(data.products); setTotalPages(data.pages);
    } catch {} finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { API.get('/categories').then(r=>setCategories(r.data)).catch(()=>{}); }, []);

  /* ── Check draft on mount ── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setHasDraft(true);
        setDraftSavedAt(d.savedAt ? new Date(d.savedAt).toLocaleString() : 'Unknown');
      }
    } catch {}
  }, []);

  /* ── Auto-save (add mode only) ── */
  const saveDraft = useCallback((data) => {
    if (isEditMode.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
      setDraftSavedAt(new Date().toLocaleString());
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus(''), 2000);
    } catch {}
  }, []);

  useEffect(() => {
    if (!modal || modal === 'edit') return;
    setAutoSaveStatus('saving');
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveDraft(formRef.current), 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [form, modal, saveDraft]);

  /* ── Open Add ── */
  const openAdd = useCallback(() => {
    isEditMode.current = false;
    formRef.current = { ...emptyProduct };
    setForm({ ...emptyProduct });
    setModal('add');
    setActiveTab('basic');
  }, []);

  /* ── Restore draft ── */
  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      // eslint-disable-next-line no-unused-vars
      const { savedAt, ...data } = JSON.parse(raw);
      const restored = { ...emptyProduct, ...data };
      formRef.current = restored;
      setForm(restored);
      setHasDraft(false);
      toast.success('Draft restored!');
      isEditMode.current = false;
      setModal('add');
      setActiveTab('basic');
    } catch { toast.error('Could not restore draft'); }
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false); setDraftSavedAt(null);
    toast.success('Draft discarded');
  };

  /* ── Open Edit ── */
  const openEdit = (p) => {
    isEditMode.current = true;
    const ef = {
      ...emptyProduct, ...p,
      category: p.category?._id || p.category,
      tags: Array.isArray(p.tags) ? p.tags.join(', ') : '',
      price:             p.price        != null ? String(p.price)             : '',
      salePrice:         p.salePrice    != null ? String(p.salePrice)         : '',
      costPrice:         p.costPrice    != null ? String(p.costPrice)         : '',
      stock:             p.stock        != null ? String(p.stock)             : '',
      weight:            p.weight       != null ? String(p.weight)            : '',
      lowStockThreshold: p.lowStockThreshold != null ? String(p.lowStockThreshold) : '5',
      specifications: p.specifications || [], variants: p.variants || []
    };
    formRef.current = ef;
    setForm(ef);
    setModal('edit'); setActiveTab('basic');
  };
  

  const closeModal = () => { setModal(null); setTagSuggestions([]); };

  /* ── Save ── */
  const handleSave = async () => {
    const f = formRef.current;
    if (!f.name || !f.price || !f.category || !f.description) {
      toast.error('Fill required fields: name, price, category, description'); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...f,
        tags: f.tags ? f.tags.split(",").map(t=>t.trim()).filter(Boolean) : [],
        price:             Number(f.price),
        salePrice:         f.salePrice  ? Number(f.salePrice)  : undefined,
        costPrice:         f.costPrice  ? Number(f.costPrice)  : undefined,
        stock:             Number(f.stock) || 0,
        weight:            f.weight ? Number(f.weight) : undefined,
        lowStockThreshold: f.lowStockThreshold ? Number(f.lowStockThreshold) : 5,
        specifications: f.specifications || [],
      };
      if (modal === 'edit' && f._id) {
        await API.put(`/products/${f._id}`, payload);
        toast.success('Product updated!');
      } else {
        await API.post('/products', payload);
        toast.success('Product created!');
        localStorage.removeItem(DRAFT_KEY);
        setHasDraft(false); setDraftSavedAt(null);
      }
      setModal(null); fetchProducts();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (id, current) => {
    try {
      await API.put(`/products/${id}`, { isActive: !current });
      setProducts(p => p.map(x => x._id===id ? {...x,isActive:!current} : x));
    } catch { toast.error('Failed'); }
  };

  /* ── Publish to Social Media ── */
  const [publishModal, setPublishModal] = useState(null); // { product }
  const [publishPlatforms, setPublishPlatforms] = useState([]);
  const [publishMsg, setPublishMsg] = useState('');
  const [publishing, setPublishing] = useState(false);

  const PLATFORMS = [
    { id:'facebook',  label:'Facebook',  icon:'📘' },
    { id:'instagram', label:'Instagram', icon:'📸' },
    { id:'tiktok',    label:'TikTok',    icon:'🎵' },
    { id:'whatsapp',  label:'WhatsApp',  icon:'💬' },
    { id:'telegram',  label:'Telegram',  icon:'✈️' },
  ];

  const openPublishModal = (product) => {
    setPublishModal({ product });
    setPublishPlatforms([]);
    setPublishMsg('');
  };

  const togglePlatform = (id) =>
    setPublishPlatforms(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]);

  const handlePublish = async () => {
    if (!publishPlatforms.length) { toast.error('Select at least one platform'); return; }
    setPublishing(true);
    try {
      const { data } = await API.post(`/products/${publishModal.product._id}/publish`, {
        platforms: publishPlatforms,
        customMsg: publishMsg,
      });
      const ok  = data.logs.filter(l => l.status === 'success');
      const bad = data.logs.filter(l => l.status !== 'success');
      if (ok.length)  toast.success(`✅ Published to ${ok.map(l=>l.platform).join(', ')}`);
      if (bad.length) toast.error(`❌ Failed: ${bad.map(l=>`${l.platform} (${l.message})`).join(', ')}`);
      if (ok.length) setPublishModal(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const deleteProduct = async (id) => {
    if (!window.confirm('Are you sure you want to permanently delete this product? This cannot be undone.')) return;
    try {
      await API.delete(`/products/${id}`);
      toast.success('Product deleted');
      fetchProducts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete product');
    }
  };

  /* ── Variant helpers — all use updateForm ── */
  const addVariant       = () => updateForm(p=>({...p,variants:[...(p.variants||[]),{name:'',type:'button',required:true,values:[]}]}));
  const removeVariant    = i  => updateForm(p=>({...p,variants:p.variants.filter((_,vi)=>vi!==i)}));
  const updateVariant    = (i,k,v) => updateForm(p=>({...p,variants:p.variants.map((vt,vi)=>vi===i?{...vt,[k]:v}:vt)}));
  const addVariantValue  = vi => updateForm(p=>({...p,variants:p.variants.map((v,i)=>i===vi?{...v,values:[...v.values,{label:'',value:'',priceModifier:0,isAvailable:true}]}:v)}));
  const removeVariantValue = (vi,vvi) => updateForm(p=>({...p,variants:p.variants.map((v,i)=>i===vi?{...v,values:v.values.filter((_,j)=>j!==vvi)}:v)}));
  const updateVariantValue = (vi,vvi,k,val) => updateForm(p=>({...p,variants:p.variants.map((v,i)=>i===vi?{...v,values:v.values.map((vv,j)=>j===vvi?{...vv,[k]:val}:vv)}:v)}));
  const applyPreset = (vi,type) => {
    const preset = VARIANT_TYPES.find(t=>t.value===type);
    if (!preset) return;
    const newVals = preset.defaultValues.map(v=>({label:v,value:v.toLowerCase().replace(/\s/g,'-'),priceModifier:0,isAvailable:true}));
    updateForm(p=>({...p,variants:p.variants.map((v,i)=>i===vi?{...v,name:preset.label,type,values:newVals}:v)}));
  };

  const TABS = [
    {id:'basic',    label:'📝 Basic Info'},
    {id:'images',   label:'🖼️ Images'},
    {id:'variants', label:'🎨 Variants'},
    {id:'specs',    label:'📋 Specs'},
    {id:'seo',      label:'⚙️ Settings'},
  ];

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-gray-900">Products</h2>
          <p className="text-sm text-gray-500">Manage your product catalog</p>
        </div>
        <div className="flex items-center gap-2">
          {hasDraft && (
            <button onClick={restoreDraft}
              className="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-100 flex items-center gap-1.5">
              💾 Resume Draft
            </button>
          )}
          <button onClick={openAdd} className="btn-primary text-sm">+ Add Product</button>
        </div>
      </div>

      {hasDraft && !modal && (
        <DraftBanner savedAt={draftSavedAt} onRestore={restoreDraft} onDiscard={discardDraft} />
      )}

      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
        <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search products..." className="form-input text-sm"/>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading...</div>
        ) : products.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No products found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Variants</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {products.map(p => (
                  <tr key={p._id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <img src={p.thumbnail||'https://via.placeholder.com/40'} alt={p.name} className="w-10 h-10 rounded-lg object-cover bg-gray-50 flex-shrink-0"/>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-gray-800 truncate max-w-xs">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.category?.name}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <p className="font-semibold text-sm">Rs. {p.price?.toLocaleString()}</p>
                      {p.salePrice && <p className="text-xs text-green-600">Sale: Rs. {p.salePrice.toLocaleString()}</p>}
                    </td>
                    <td><span className={`badge text-xs ${p.stock===0?'badge-hot':p.stock<=p.lowStockThreshold?'badge-sale':'badge-new'}`}>{p.stock===0?'Out':p.stock}</span></td>
                    <td>
                      <span className={`badge text-xs ${p.isActive?'badge-new':'bg-gray-100 text-gray-500'}`}>{p.isActive?'Active':'Hidden'}</span>
                      {p.isFeatured && <span className="badge badge-featured text-xs ml-1">Featured</span>}
                    </td>
                    <td>
                      {p.variants?.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {p.variants.slice(0,2).map((v,i)=><span key={i} className="badge badge-featured text-xs">{v.name}</span>)}
                          {p.variants.length > 2 && <span className="text-xs text-gray-400">+{p.variants.length-2}</span>}
                        </div>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={()=>openEdit(p)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors" title="Edit">✏️</button>
                        <button onClick={()=>openPublishModal(p)} className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-purple-600 transition-colors" title="Publish to Social Media">📢</button>
                        <button onClick={()=>toggleActive(p._id,p.isActive)} className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors" title={p.isActive?'Hide':'Show'}>{p.isActive?'🙈':'👁'}</button>
                        <button onClick={()=>deleteProduct(p._id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Delete">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-4 border-t">
            {Array.from({length:totalPages},(_,i)=>i+1).map(p=>(
              <button key={p} onClick={()=>setPage(p)}
                className={`w-8 h-8 rounded-lg text-sm font-medium ${page===p?'text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                style={page===p?{background:'var(--color-primary)'}:{}}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Publish to Social Media Modal ── */}
      {publishModal && (
        <Modal title={`📢 Publish: ${publishModal.product.name}`} onClose={()=>setPublishModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Choose platforms to publish this product to:</p>

            <div className="grid grid-cols-2 gap-2">
              {PLATFORMS.map(pl => (
                <button
                  key={pl.id}
                  onClick={()=>togglePlatform(pl.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    publishPlatforms.includes(pl.id)
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className="text-base">{pl.icon}</span>
                  {pl.label}
                  {publishPlatforms.includes(pl.id) && <span className="ml-auto">✅</span>}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Custom Message <span className="font-normal text-gray-400">(optional — overrides template)</span></label>
              <textarea
                value={publishMsg}
                onChange={e=>setPublishMsg(e.target.value)}
                rows={3}
                placeholder="Leave blank to use your saved post template..."
                className="form-input text-sm w-full resize-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={()=>setPublishModal(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button
                onClick={handlePublish}
                disabled={publishing || !publishPlatforms.length}
                className="flex-1 text-sm px-4 py-2 rounded-xl font-semibold text-white transition-all disabled:opacity-50"
                style={{background:'var(--color-primary)'}}
              >
                {publishing ? '⏳ Publishing...' : `📢 Publish to ${publishPlatforms.length || 0} Platform${publishPlatforms.length!==1?'s':''}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={modal==='edit'?`Edit: ${form.name}`:'Add New Product'} onClose={closeModal} wide>
          {modal==='add' && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-400">
                {autoSaveStatus==='saving' && '💾 Auto-saving...'}
                {autoSaveStatus==='saved'  && '✅ Draft saved'}
                {!autoSaveStatus && draftSavedAt && `Last saved: ${draftSavedAt}`}
              </span>
            </div>
          )}

          <div className="flex gap-1 bg-gray-50 p-1 rounded-xl mb-5 overflow-x-auto">
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${activeTab===t.id?'bg-white shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* BASIC */}
          {activeTab==='basic' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="form-label">Product Name *</label>
                  <input value={form.name} onChange={e=>handleNameChange(e.target.value)} className="form-input" placeholder="Enter product name"/>
                </div>
                <div>
                  <label className="form-label">Category *</label>
                  <select value={form.category} onChange={e=>updateForm(p=>({...p,category:e.target.value}))} className="form-input">
                    <option value="">Select category</option>
                    {categories.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{display:'flex',alignItems:'center',gap:6}}>
                    Brand
                    {aiFillingBrand && <span style={{fontSize:11,color:'var(--color-primary)',fontWeight:600,display:'flex',alignItems:'center',gap:3}}><span style={{display:'inline-block',width:10,height:10,border:'2px solid var(--color-primary)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}></span>AI filling…</span>}
                  </label>
                  <input value={form.brand} onChange={e=>updateForm(p=>({...p,brand:e.target.value}))} className="form-input" placeholder="Brand name"/>
                </div>
                <div><label className="form-label">Regular Price (Rs.) *</label><input type="number" min="0" value={form.price} onChange={e=>updateForm(p=>({...p,price:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">Sale Price (Rs.)</label><input type="number" min="0" value={form.salePrice} onChange={e=>updateForm(p=>({...p,salePrice:e.target.value}))} className="form-input" placeholder="Leave empty if not on sale"/></div>
                <div><label className="form-label">Cost Price (Rs.)</label><input type="number" min="0" value={form.costPrice} onChange={e=>updateForm(p=>({...p,costPrice:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">SKU</label><input value={form.sku} onChange={e=>updateForm(p=>({...p,sku:e.target.value}))} className="form-input" placeholder="Unique product code"/></div>
                <div>
                  <label className="form-label">Stock Quantity</label>
                  <input type="number" min="0" value={form.stock} onChange={e=>updateForm(p=>({...p,stock:e.target.value}))} className="form-input"/>
                </div>
                <div><label className="form-label">Low Stock Alert</label><input type="number" min="0" value={form.lowStockThreshold} onChange={e=>updateForm(p=>({...p,lowStockThreshold:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">Weight (g)</label><input type="number" min="0" value={form.weight} onChange={e=>updateForm(p=>({...p,weight:e.target.value}))} className="form-input"/></div>
                <div className="sm:col-span-2">
                  <label className="form-label" style={{display:'flex',alignItems:'center',gap:6}}>
                    Short Description
                    {aiFillingShort && <span style={{fontSize:11,color:'var(--color-primary)',fontWeight:600,display:'flex',alignItems:'center',gap:3}}><span style={{display:'inline-block',width:10,height:10,border:'2px solid var(--color-primary)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}></span>AI filling…</span>}
                  </label>
                  <input value={form.shortDescription} onChange={e=>updateForm(p=>({...p,shortDescription:e.target.value}))} className="form-input" placeholder="Brief product summary"/>
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label">Full Description *</label>
                  <RichEditor value={form.description} onChange={val=>updateForm(p=>({...p,description:val}))} />
                </div>
                <div className="sm:col-span-2">
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                    <label className="form-label" style={{margin:0}}>Tags (comma separated)</label>
                    <button type="button"
                      onClick={()=>fetchTagSuggestions(form.name, categories.find(c=>c._id===form.category)?.name, form.brand)}
                      disabled={!form.name || loadingTags}
                      style={{fontSize:11,padding:'3px 10px',borderRadius:20,border:'1.5px solid var(--color-primary)',color:'var(--color-primary)',background:'transparent',cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:5,opacity:(!form.name||loadingTags)?0.5:1}}>
                      {loadingTags
                        ? <><span style={{display:'inline-block',width:9,height:9,border:'2px solid var(--color-primary)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}></span>Suggesting…</>
                        : <>✨ Suggest Tags</>}
                    </button>
                  </div>
                  <input value={form.tags} onChange={e=>updateForm(p=>({...p,tags:e.target.value}))} className="form-input" placeholder="electronics, gadget, trending"/>
                  {tagSuggestions.length > 0 && (
                    <div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:6}}>
                      {tagSuggestions.map(tag => {
                        const active = form.tags.split(',').map(t=>t.trim()).includes(tag);
                        return (
                          <button key={tag} type="button" onClick={()=>toggleTag(tag)}
                            style={{fontSize:12,padding:'3px 10px',borderRadius:20,border:'1.5px solid',borderColor:active?'var(--color-primary)':'#d1d5db',background:active?'var(--color-primary)':'#f9fafb',color:active?'#fff':'#374151',cursor:'pointer',fontWeight:500,transition:'all 0.15s'}}>
                            {active ? '✓ ' : ''}{tag}
                          </button>
                        );
                      })}
                      <button type="button" onClick={()=>setTagSuggestions([])}
                        style={{fontSize:11,padding:'3px 8px',borderRadius:20,border:'1.5px solid #e5e7eb',background:'transparent',color:'#9ca3af',cursor:'pointer'}}>
                        ✕ clear
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 pt-2">
                {[['isFeatured','⭐ Featured'],['isActive','✅ Active'],['isOnSale','🔥 On Sale']].map(([k,label])=>(
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form[k]} onChange={e=>updateForm(p=>({...p,[k]:e.target.checked}))} style={{accentColor:'var(--color-primary)'}} className="w-4 h-4"/>
                    <span className="text-sm font-medium text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* IMAGES */}
          {activeTab==='images' && (
            <div className="space-y-5">
              <ImageUpload label="Thumbnail (Main Image)" hint="First image customers see" value={form.thumbnail} onChange={url=>updateForm(p=>({...p,thumbnail:url}))}/>
              <ImageUpload label="Additional Images" hint="Upload multiple product images" value={Array.isArray(form.images)?form.images:[]} onChange={urls=>updateForm(p=>({...p,images:urls}))} multiple/>
            </div>
          )}

          {/* VARIANTS */}
          {activeTab==='variants' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-700">
                💡 Add variants like <strong>Size</strong>, <strong>Color</strong> etc.
              </div>
              {(form.variants||[]).map((variant,vi)=>(
                <div key={vi} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-gray-800 text-sm">Variant {vi+1}: {variant.name||'Unnamed'}</h4>
                    <button onClick={()=>removeVariant(vi)} className="text-red-400 hover:text-red-600 text-sm">✕ Remove</button>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="form-label text-xs">Variant Name *</label>
                      <input value={variant.name} onChange={e=>updateVariant(vi,'name',e.target.value)} className="form-input text-sm" placeholder="e.g. Size, Color"/>
                    </div>
                    <div>
                      <label className="form-label text-xs">Type</label>
                      <select value={variant.type} onChange={e=>updateVariant(vi,'type',e.target.value)} className="form-input text-sm">
                        {VARIANT_TYPES.map(t=><option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-1.5 cursor-pointer mb-2">
                        <input type="checkbox" checked={variant.required} onChange={e=>updateVariant(vi,'required',e.target.checked)} style={{accentColor:'var(--color-primary)'}} className="w-3.5 h-3.5"/>
                        <span className="text-xs text-gray-600">Required</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {VARIANT_TYPES.filter(t=>t.defaultValues.length>0).map(t=>(
                      <button key={t.value} type="button" onClick={()=>applyPreset(vi,t.value)}
                        className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
                        {t.icon} {t.label} preset
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-1 text-xs font-semibold text-gray-400 px-1">
                      <span className="col-span-3">Label</span><span className="col-span-3">Value</span>
                      <span className="col-span-3">Price +/-</span><span className="col-span-2">Available</span>
                      <span className="col-span-1"></span>
                    </div>
                    {(variant.values||[]).map((val,vvi)=>(
                      <div key={vvi} className="grid grid-cols-12 gap-1 items-center">
                        <input value={val.label} onChange={e=>updateVariantValue(vi,vvi,'label',e.target.value)} className="form-input text-xs py-1.5 col-span-3" placeholder="Large"/>
                        <input value={val.value} onChange={e=>updateVariantValue(vi,vvi,'value',e.target.value)} className="form-input text-xs py-1.5 col-span-3" placeholder="L"/>
                        <input type="number" value={val.priceModifier} onChange={e=>updateVariantValue(vi,vvi,'priceModifier',Number(e.target.value))} className="form-input text-xs py-1.5 col-span-3" placeholder="0"/>
                        <div className="col-span-2 flex justify-center">
                          <input type="checkbox" checked={val.isAvailable!==false} onChange={e=>updateVariantValue(vi,vvi,'isAvailable',e.target.checked)} style={{accentColor:'var(--color-primary)'}} className="w-4 h-4"/>
                        </div>
                        <button onClick={()=>removeVariantValue(vi,vvi)} className="col-span-1 text-red-400 hover:text-red-600 text-xs text-center">✕</button>
                      </div>
                    ))}
                    <button onClick={()=>addVariantValue(vi)} className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-500 w-full">
                      + Add Option
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={addVariant} className="btn-outline w-full text-sm">+ Add Variant (Size / Color / etc.)</button>
            </div>
          )}

          {/* SPECS */}
          {activeTab==='specs' && (
            <SpecsPanel
              specs={form.specifications || []}
              onChange={newSpecs => updateForm(p => ({ ...p, specifications: newSpecs }))}
            />
          )}

          {/* SETTINGS */}
          {activeTab==='seo' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className="form-label">Weight (grams)</label><input type="number" value={form.weight} onChange={e=>updateForm(p=>({...p,weight:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">Low Stock Alert</label><input type="number" value={form.lowStockThreshold} onChange={e=>updateForm(p=>({...p,lowStockThreshold:Number(e.target.value)}))} className="form-input"/></div>
              </div>
              <div className="flex flex-wrap gap-4">
                {[['isFeatured','⭐ Featured'],['isActive','✅ Active'],['isOnSale','🔥 On Sale']].map(([k,label])=>(
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form[k]} onChange={e=>updateForm(p=>({...p,[k]:e.target.checked}))} style={{accentColor:'var(--color-primary)'}} className="w-4 h-4"/>
                    <span className="text-sm font-medium text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 mt-6 pt-5 border-t border-gray-100 sticky bottom-0 bg-white">
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving...' : modal==='edit' ? 'Save Changes' : 'Create Product'}
            </button>
            <button onClick={closeModal} className="btn-outline px-6">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}