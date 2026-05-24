import React, { useEffect, useState, useCallback, useRef } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';
import ImageUpload from '../../components/ImageUpload';

/* ─────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────── */
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
  costPrice:'', sku:'', category:'', brand:'', stock:'', lowStockThreshold:5,
  weight:'', thumbnail:'', images:[],
  tags:'', isFeatured:false, isActive:true, isOnSale:false,
  specifications:[], variants:[]
};

/* ─────────────────────────────────────────────
   MODAL WRAPPER
───────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────
   RICH TEXT EDITOR
   A lightweight contentEditable editor with
   a full Word-style toolbar (no external deps)
───────────────────────────────────────────── */
function RichEditor({ value, onChange }) {
  const editorRef = useRef(null);

  // Track the value we initialised the editor with.
  // Only overwrite innerHTML when value changes from OUTSIDE (e.g. opening a
  // different product to edit), never as a feedback loop from our own typing.
  const lastExternalValue = useRef(null);
  useEffect(() => {
    if (!editorRef.current) return;
    // Only sync if the value changed externally (not from our own onInput)
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value;
      editorRef.current.innerHTML = value || '';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    fireChange();
  };

  const fireChange = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      lastExternalValue.current = html; // mark as internal so useEffect won't overwrite
      onChange(html);
    }
  };

  const insertTable = () => {
    const rows = parseInt(window.prompt('Rows?', '3')) || 3;
    const cols = parseInt(window.prompt('Columns?', '3')) || 3;
    let html = '<table border="1" style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += r === 0
          ? `<th style="border:1px solid #ddd;padding:6px 10px;background:#f3f4f6;font-weight:600">&nbsp;</th>`
          : `<td style="border:1px solid #ddd;padding:6px 10px">&nbsp;</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    fireChange();
  };

  const insertLink = () => {
    const url = window.prompt('URL:', 'https://');
    if (url) exec('createLink', url);
  };

  const setHeading = (tag) => {
    exec('formatBlock', tag);
  };

  const TB = ({ title, icon, onClick, isActive }) => (
    <button
      type="button" title={title} onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${isActive ? 'bg-gray-800 text-white' : 'hover:bg-gray-100 text-gray-700'}`}>
      {icon}
    </button>
  );

  const Div = () => <div className="w-px h-5 bg-gray-200 mx-0.5 self-center" />;

  return (
    <div className="border border-gray-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-offset-0" style={{'--tw-ring-color':'var(--color-primary)'}}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-2 bg-gray-50 border-b border-gray-200">
        {/* Headings */}
        <select onChange={e => { setHeading(e.target.value); e.target.value = ''; }} defaultValue=""
          className="text-xs border border-gray-200 rounded px-1 py-0.5 mr-1 bg-white">
          <option value="" disabled>Heading</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="h4">H4</option>
          <option value="p">Normal</option>
        </select>

        <TB title="Bold"      icon="B"  onClick={() => exec('bold')} />
        <TB title="Italic"    icon={<em>I</em>} onClick={() => exec('italic')} />
        <TB title="Underline" icon={<u>U</u>}   onClick={() => exec('underline')} />
        <TB title="Strikethrough" icon={<s>S</s>} onClick={() => exec('strikeThrough')} />
        <Div/>
        <TB title="Align Left"   icon="⬅" onClick={() => exec('justifyLeft')} />
        <TB title="Align Center" icon="☰" onClick={() => exec('justifyCenter')} />
        <TB title="Align Right"  icon="➡" onClick={() => exec('justifyRight')} />
        <Div/>
        <TB title="Bullet List"  icon="•≡" onClick={() => exec('insertUnorderedList')} />
        <TB title="Numbered List" icon="1≡" onClick={() => exec('insertOrderedList')} />
        <TB title="Indent"       icon="→" onClick={() => exec('indent')} />
        <TB title="Outdent"      icon="←" onClick={() => exec('outdent')} />
        <Div/>
        <TB title="Insert Table" icon="⊞" onClick={insertTable} />
        <TB title="Insert Link"  icon="🔗" onClick={insertLink} />
        <TB title="Remove Link"  icon="🔗̶" onClick={() => exec('unlink')} />
        <Div/>
        <TB title="Horizontal Rule" icon="—" onClick={() => exec('insertHorizontalRule')} />
        <TB title="Clear Formatting" icon="✕" onClick={() => exec('removeFormat')} />

        {/* Font size */}
        <select onChange={e => { exec('fontSize', e.target.value); e.target.value = ''; }} defaultValue=""
          className="text-xs border border-gray-200 rounded px-1 py-0.5 ml-1 bg-white">
          <option value="" disabled>Size</option>
          {[1,2,3,4,5,6,7].map(s => <option key={s} value={s}>{['8','10','12','14','18','24','36'][s-1]}px</option>)}
        </select>

        {/* Text color */}
        <label title="Text Color" className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 cursor-pointer">
          <span className="text-xs font-bold text-gray-700">A</span>
          <input type="color" className="w-0 h-0 opacity-0 absolute" onChange={e => exec('foreColor', e.target.value)} />
        </label>

        {/* Highlight */}
        <label title="Highlight" className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 cursor-pointer">
          <span className="text-xs font-bold" style={{background:'#fef08a',padding:'1px 2px'}}>H</span>
          <input type="color" className="w-0 h-0 opacity-0 absolute" onChange={e => exec('hiliteColor', e.target.value)} />
        </label>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={fireChange}
        className="min-h-[180px] p-3 text-sm text-gray-800 outline-none overflow-y-auto"
        style={{ maxHeight: '340px', lineHeight: '1.7' }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────
   SPECIFICATIONS PANEL
   • Add one by one
   • Paste full list (auto-parse)
   • Reorder / delete
───────────────────────────────────────────── */
function SpecsPanel({ specs, onChange }) {
  const [specKey, setSpecKey]   = useState('');
  const [specVal, setSpecVal]   = useState('');
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  const addOne = () => {
    if (!specKey.trim() || !specVal.trim()) { toast.error('Enter both name and value'); return; }
    onChange([...specs, { key: specKey.trim(), value: specVal.trim() }]);
    setSpecKey(''); setSpecVal('');
  };

  const parseAndAdd = () => {
    if (!pasteText.trim()) { toast.error('Nothing to parse'); return; }
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = [];
    lines.forEach(line => {
      let key = '', value = '';
      const colonIdx = line.indexOf(':');
      const pipeIdx  = line.indexOf('|');
      const dashIdx  = line.search(/\s[-]\s/);
      const tabIdx   = line.indexOf('\t');
      if (colonIdx > 0) {
        key   = line.slice(0, colonIdx).trim();
        value = line.slice(colonIdx + 1).trim();
      } else if (pipeIdx > 0) {
        key   = line.slice(0, pipeIdx).trim();
        value = line.slice(pipeIdx + 1).trim();
      } else if (dashIdx > 0) {
        key   = line.slice(0, dashIdx).trim();
        value = line.slice(dashIdx).replace(/^[\s-]+/, '').trim();
      } else if (tabIdx > 0) {
        key   = line.slice(0, tabIdx).trim();
        value = line.slice(tabIdx + 1).trim();
      }
      if (key && value) parsed.push({ key, value });
    });
    if (parsed.length === 0) {
      toast.error('Could not parse. Use format: Name: Value (one per line)');
      return;
    }
    onChange([...specs, ...parsed]);
    setPasteText('');
    setShowPaste(false);
    toast.success(`Added ${parsed.length} specification${parsed.length > 1 ? 's' : ''}`);
  };

  const remove = (i) => onChange(specs.filter((_, si) => si !== i));

  const moveUp = (i) => {
    if (i === 0) return;
    const s = [...specs]; [s[i-1], s[i]] = [s[i], s[i-1]]; onChange(s);
  };

  const moveDown = (i) => {
    if (i === specs.length - 1) return;
    const s = [...specs]; [s[i], s[i+1]] = [s[i+1], s[i]]; onChange(s);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Add technical specifications shown on the product page.</p>

      {/* Add one by one */}
      <div className="flex gap-2">
        <input value={specKey} onChange={e=>setSpecKey(e.target.value)}
          onKeyDown={e => { if (e.key==='Tab') { e.preventDefault(); document.getElementById('spec-val-input')?.focus(); } }}
          className="form-input text-sm flex-1" placeholder="Spec name (e.g. Battery)"/>
        <input id="spec-val-input" value={specVal} onChange={e=>setSpecVal(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter') addOne(); }}
          className="form-input text-sm flex-1" placeholder="Value (e.g. 4000mAh)"/>
        <button onClick={addOne} className="btn-primary text-sm px-4 flex-shrink-0">+ Add</button>
      </div>

      {/* Paste bulk list */}
      <div>
        <button onClick={() => setShowPaste(p=>!p)}
          className="text-xs text-blue-600 hover:underline flex items-center gap-1">
          📋 {showPaste ? 'Hide' : 'Paste a full list instead'}
        </button>
        {showPaste && (
          <div className="mt-2 space-y-2">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Paste your specification list below. Supported formats:</p>
              <p className="font-mono">Battery: 4000mAh</p>
              <p className="font-mono">Display - 6.5 inch AMOLED</p>
              <p className="font-mono">RAM | 8GB</p>
              <p>One specification per line. All formats auto-detected.</p>
            </div>
            <textarea
              value={pasteText} onChange={e=>setPasteText(e.target.value)}
              className="form-input text-sm resize-none" rows={6}
              placeholder={"Battery: 4000mAh\nDisplay: 6.5 inch AMOLED\nRAM: 8GB\nStorage: 256GB\nCamera: 108MP"}/>
            <div className="flex gap-2">
              <button onClick={parseAndAdd} className="btn-primary text-sm">✓ Parse & Add All</button>
              <button onClick={() => { setPasteText(''); setShowPaste(false); }} className="btn-outline text-sm">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Spec list */}
      {specs.length > 0 ? (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {specs.map((spec, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveUp(i)} className="text-gray-300 hover:text-gray-500 text-xs leading-none">▲</button>
                <button onClick={() => moveDown(i)} className="text-gray-300 hover:text-gray-500 text-xs leading-none">▼</button>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-700">{spec.key}</span>
                <span className="text-gray-300 mx-2">·</span>
                <span className="text-sm text-gray-600">{spec.value}</span>
              </div>
              <button onClick={() => remove(i)} className="text-red-300 hover:text-red-500 text-sm flex-shrink-0">✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4 border-2 border-dashed border-gray-200 rounded-xl">
          No specifications yet. Add them above.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   DRAFT BANNER
───────────────────────────────────────────── */
function DraftBanner({ savedAt, onRestore, onDiscard }) {
  if (!savedAt) return null;
  return (
    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
      <div className="flex items-center gap-2">
        <span className="text-base">💾</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">Draft saved</p>
          <p className="text-xs text-amber-600">{savedAt}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onRestore} className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline">Restore</button>
        <button onClick={onDiscard} className="text-xs text-gray-400 hover:text-gray-600">Discard</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */
export default function AdminProducts() {
  const [products, setProducts]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(emptyProduct);
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [activeTab, setActiveTab]   = useState('basic');
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [hasDraft, setHasDraft]     = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState(''); // 'saving' | 'saved' | ''
  const autoSaveTimer = useRef(null);
  const isEditMode = useRef(false);

  /* ── Fetch ── */
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get(`/products/admin/all?search=${search}&page=${page}&limit=15`);
      setProducts(data.products); setTotalPages(data.pages);
    } catch {} finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { API.get('/categories').then(r => setCategories(r.data)).catch(()=>{}); }, []);

  /* ── Check for existing draft on mount ── */
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

  /* ── Auto-save draft (only for Add mode, not Edit) ── */
  const saveDraft = useCallback((formData) => {
    if (isEditMode.current) return; // never overwrite draft in edit mode
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...formData, savedAt: new Date().toISOString() }));
      setDraftSavedAt(new Date().toLocaleString());
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus(''), 2000);
    } catch {}
  }, []);

  /* ── Debounced auto-save on form change ── */
  useEffect(() => {
    if (!modal || modal === 'edit') return;
    setAutoSaveStatus('saving');
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveDraft(form), 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [form, modal, saveDraft]);

  /* ── Open Add ── */
  const openAdd = () => {
    isEditMode.current = false;
    setForm(emptyProduct);
    setModal('add');
    setActiveTab('basic');
  };

  /* ── Restore draft ── */
  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const { savedAt, ...data } = JSON.parse(raw);
      setForm({ ...emptyProduct, ...data });
      setHasDraft(false);
      toast.success('Draft restored!');
      openAdd();
    } catch { toast.error('Could not restore draft'); }
  };

  /* ── Discard draft ── */
  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
    setDraftSavedAt(null);
    toast.success('Draft discarded');
  };

  /* ── Open Edit (never saves draft) ── */
  const openEdit = (p) => {
    isEditMode.current = true;
    setForm({ ...emptyProduct, ...p, category: p.category?._id || p.category, tags: Array.isArray(p.tags) ? p.tags.join(', ') : '', salePrice: p.salePrice||'', costPrice: p.costPrice||'', specifications: p.specifications||[], variants: p.variants||[] });
    setModal('edit'); setActiveTab('basic');
  };

  /* ── Close modal ── */
  const closeModal = () => {
    setModal(null);
    // In add mode, draft is already saved by auto-save
  };

  /* ── Save / Create ── */
  const handleSave = async () => {
    if (!form.name || !form.price || !form.category || !form.description) {
      toast.error('Fill required fields (name, price, category, description)'); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: form.tags ? form.tags.split(',').map(t=>t.trim()).filter(Boolean) : [],
        price: Number(form.price),
        salePrice:  form.salePrice  ? Number(form.salePrice)  : undefined,
        costPrice:  form.costPrice  ? Number(form.costPrice)  : undefined,
        stock: Number(form.stock) || 0,
      };
      if (modal === 'edit' && form._id) {
        await API.put(`/products/${form._id}`, payload);
        toast.success('Product updated!');
      } else {
        await API.post('/products', payload);
        toast.success('Product created!');
        // Clear draft after successful create
        localStorage.removeItem(DRAFT_KEY);
        setHasDraft(false);
        setDraftSavedAt(null);
      }
      setModal(null); fetchProducts();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (id, current) => {
    try {
      await API.put(`/products/${id}`, { isActive: !current });
      setProducts(p => p.map(x => x._id === id ? { ...x, isActive: !current } : x));
    } catch { toast.error('Failed'); }
  };

  const deleteProduct = async (id) => {
    if (!window.confirm('Delete this product?')) return;
    await API.delete(`/products/${id}`);
    fetchProducts();
    toast.success('Deleted');
  };

  /* ── Variant helpers ── */
  const addVariant       = () => setForm(p => ({ ...p, variants: [...(p.variants||[]), { name:'', type:'button', required:true, values:[] }] }));
  const removeVariant    = (i) => setForm(p => ({ ...p, variants: p.variants.filter((_,vi)=>vi!==i) }));
  const updateVariant    = (i, key, val) => setForm(p => ({ ...p, variants: p.variants.map((v,vi)=>vi===i?{...v,[key]:val}:v) }));
  const addVariantValue  = (vi) => setForm(p => ({ ...p, variants: p.variants.map((v,i)=>i===vi?{...v,values:[...v.values,{label:'',value:'',priceModifier:0,isAvailable:true}]}:v) }));
  const removeVariantValue = (vi, vvi) => setForm(p => ({ ...p, variants: p.variants.map((v,i)=>i===vi?{...v,values:v.values.filter((_,j)=>j!==vvi)}:v) }));
  const updateVariantValue = (vi, vvi, key, val) => setForm(p => ({ ...p, variants: p.variants.map((v,i)=>i===vi?{...v,values:v.values.map((vv,j)=>j===vvi?{...vv,[key]:val}:vv)}:v) }));
  const applyPreset = (vi, type) => {
    const preset = VARIANT_TYPES.find(t => t.value === type);
    if (!preset) return;
    const newValues = preset.defaultValues.map(v => ({ label:v, value:v.toLowerCase().replace(/\s/g,'-'), priceModifier:0, isAvailable:true }));
    setForm(p => ({ ...p, variants: p.variants.map((v,i)=>i===vi?{...v,name:preset.label,type,values:newValues}:v) }));
  };

  const TABS = [
    { id:'basic',    label:'📝 Basic Info' },
    { id:'images',   label:'🖼️ Images' },
    { id:'variants', label:'🎨 Variants' },
    { id:'specs',    label:'📋 Specs' },
    { id:'seo',      label:'⚙️ Settings' },
  ];

  return (
    <div>
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

      {/* Draft restore banner (outside modal) */}
      {hasDraft && !modal && (
        <DraftBanner savedAt={draftSavedAt} onRestore={restoreDraft} onDiscard={discardDraft} />
      )}

      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
        <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search products..." className="form-input text-sm"/>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? <div className="p-10 text-center text-gray-400">Loading...</div> : products.length === 0 ? <div className="p-10 text-center text-gray-400">No products found</div> : (
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
                    <td>
                      <span className={`badge text-xs ${p.stock===0?'badge-hot':p.stock<=p.lowStockThreshold?'badge-sale':'badge-new'}`}>{p.stock===0?'Out':p.stock}</span>
                    </td>
                    <td>
                      <span className={`badge text-xs ${p.isActive?'badge-new':'bg-gray-100 text-gray-500'}`}>{p.isActive?'Active':'Hidden'}</span>
                      {p.isFeatured && <span className="badge badge-featured text-xs ml-1">Featured</span>}
                    </td>
                    <td>
                      {p.variants?.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {p.variants.slice(0,2).map((v,i) => <span key={i} className="badge badge-featured text-xs">{v.name}</span>)}
                          {p.variants.length > 2 && <span className="text-xs text-gray-400">+{p.variants.length-2}</span>}
                        </div>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={()=>openEdit(p)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors">✏️</button>
                        <button onClick={()=>toggleActive(p._id,p.isActive)} className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors">{p.isActive?'🙈':'👁'}</button>
                        <button onClick={()=>deleteProduct(p._id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">🗑️</button>
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
            {Array.from({length:totalPages},(_,i)=>i+1).map(p => (
              <button key={p} onClick={()=>setPage(p)}
                className={`w-8 h-8 rounded-lg text-sm font-medium ${page===p?'text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                style={page===p?{background:'var(--color-primary)'}:{}}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modal && (
        <Modal title={modal==='edit'?`Edit: ${form.name}`:'Add New Product'} onClose={closeModal} wide>

          {/* Auto-save status (Add mode only) */}
          {modal === 'add' && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-400">
                {autoSaveStatus === 'saving' && '💾 Auto-saving...'}
                {autoSaveStatus === 'saved'  && '✅ Draft saved'}
                {!autoSaveStatus && draftSavedAt && `Last saved: ${draftSavedAt}`}
              </span>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-50 p-1 rounded-xl mb-5 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${activeTab===t.id?'bg-white shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── BASIC INFO ── */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="form-label">Product Name *</label>
                  <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} className="form-input" placeholder="Enter product name"/>
                </div>
                <div>
                  <label className="form-label">Category *</label>
                  <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))} className="form-input">
                    <option value="">Select category</option>
                    {categories.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="form-label">Brand</label><input value={form.brand} onChange={e=>setForm(p=>({...p,brand:e.target.value}))} className="form-input" placeholder="Brand name"/></div>
                <div><label className="form-label">Regular Price (Rs.) *</label><input type="number" min="0" value={form.price} onChange={e=>setForm(p=>({...p,price:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">Sale Price (Rs.)</label><input type="number" min="0" value={form.salePrice} onChange={e=>setForm(p=>({...p,salePrice:e.target.value}))} className="form-input" placeholder="Leave empty if not on sale"/></div>
                <div><label className="form-label">Cost Price (Rs.)</label><input type="number" min="0" value={form.costPrice} onChange={e=>setForm(p=>({...p,costPrice:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">SKU</label><input value={form.sku} onChange={e=>setForm(p=>({...p,sku:e.target.value}))} className="form-input" placeholder="Unique product code"/></div>
                <div><label className="form-label">Stock Quantity</label><input type="number" min="0" value={form.stock} onChange={e=>setForm(p=>({...p,stock:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">Low Stock Alert</label><input type="number" min="0" value={form.lowStockThreshold} onChange={e=>setForm(p=>({...p,lowStockThreshold:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">Weight (g)</label><input type="number" min="0" value={form.weight} onChange={e=>setForm(p=>({...p,weight:e.target.value}))} className="form-input"/></div>
                <div className="sm:col-span-2">
                  <label className="form-label">Short Description</label>
                  <input value={form.shortDescription} onChange={e=>setForm(p=>({...p,shortDescription:e.target.value}))} className="form-input" placeholder="Brief product summary"/>
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label">Full Description *</label>
                  <RichEditor value={form.description} onChange={val => setForm(p=>({...p, description: val}))} />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label">Tags (comma separated)</label>
                  <input value={form.tags} onChange={e=>setForm(p=>({...p,tags:e.target.value}))} className="form-input" placeholder="electronics, gadget, trending"/>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 pt-2">
                {[['isFeatured','⭐ Featured'],['isActive','✅ Active'],['isOnSale','🔥 On Sale']].map(([key,label])=>(
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.checked}))} style={{accentColor:'var(--color-primary)'}} className="w-4 h-4"/>
                    <span className="text-sm font-medium text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── IMAGES ── */}
          {activeTab === 'images' && (
            <div className="space-y-5">
              <ImageUpload label="Thumbnail (Main Image)" hint="First image customers see — JPG, PNG, WebP up to 5MB" value={form.thumbnail} onChange={url=>setForm(p=>({...p,thumbnail:url}))}/>
              <ImageUpload label="Additional Images" hint="Upload multiple product images — customers can browse them" value={Array.isArray(form.images)?form.images:[]} onChange={urls=>setForm(p=>({...p,images:urls}))} multiple/>
            </div>
          )}

          {/* ── VARIANTS ── */}
          {activeTab === 'variants' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-700">
                💡 Add variants like <strong>Size</strong>, <strong>Color</strong>, <strong>Material</strong> etc. Customers will see these options on the product page.
              </div>
              {(form.variants||[]).map((variant, vi) => (
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
                    <div className="flex items-end gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer mb-2">
                        <input type="checkbox" checked={variant.required} onChange={e=>updateVariant(vi,'required',e.target.checked)} style={{accentColor:'var(--color-primary)'}} className="w-3.5 h-3.5"/>
                        <span className="text-xs text-gray-600">Required</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {VARIANT_TYPES.filter(t=>t.defaultValues.length>0).map(t=>(
                      <button key={t.value} type="button" onClick={()=>applyPreset(vi,t.value)}
                        className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
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
                    {(variant.values||[]).map((val, vvi) => (
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
                    <button onClick={()=>addVariantValue(vi)} className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-primary hover:text-primary transition-colors w-full">
                      + Add Option
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={addVariant} className="btn-outline w-full text-sm">+ Add Variant (Size / Color / etc.)</button>
              {form.variants?.length === 0 && (
                <p className="text-xs text-gray-400 text-center">No variants added. Product will have a simple Add to Cart button.</p>
              )}
            </div>
          )}

          {/* ── SPECS ── */}
          {activeTab === 'specs' && (
            <SpecsPanel
              specs={form.specifications || []}
              onChange={newSpecs => setForm(p => ({ ...p, specifications: newSpecs }))}
            />
          )}

          {/* ── SETTINGS ── */}
          {activeTab === 'seo' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className="form-label">Weight (grams)</label><input type="number" value={form.weight} onChange={e=>setForm(p=>({...p,weight:e.target.value}))} className="form-input"/></div>
                <div><label className="form-label">Low Stock Alert</label><input type="number" value={form.lowStockThreshold} onChange={e=>setForm(p=>({...p,lowStockThreshold:Number(e.target.value)}))} className="form-input"/></div>
              </div>
              <div className="flex flex-wrap gap-4">
                {[['isFeatured','⭐ Featured product'],['isActive','✅ Active / Visible'],['isOnSale','🔥 Mark as On Sale']].map(([key,label])=>(
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.checked}))} style={{accentColor:'var(--color-primary)'}} className="w-4 h-4"/>
                    <span className="text-sm font-medium text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Footer ── */}
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