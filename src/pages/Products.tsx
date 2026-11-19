import { useRef, useState } from 'react';
import { Download, Package, Pencil, Plus, Search, Upload } from 'lucide-react';
import type { AppState, Product, ProductImportPreview, ProductImportResult } from '../../shared/domain';
import { formatMoney, parseMoney } from '../../shared/quote';
import { api, useTask } from '../api';
import { EmptyState, Feedback, Modal, PageHeading } from '../components';

export function Products({ data, refresh }: { data: AppState; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [importing, setImporting] = useState<{ csv: string; filename: string; preview: ProductImportPreview } | null>(null);
  const [imported, setImported] = useState<ProductImportResult | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const task = useTask();
  const products = data.products.filter(item => `${item.sku} ${item.name} ${item.specification}`.toLowerCase().includes(query.toLowerCase()));
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(['\uFEFFsku,name,specification,unit,price\nBRG-6204,深沟球轴承,6204-2RS 20×47×14mm,件,19.90\n'], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '商品导入模板.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return <><PageHeading eyebrow="PRODUCT CATALOG" title="商品目录" description="维护统一的商品、规格和参考价格，报价时直接选用。"><button className="button secondary" onClick={downloadTemplate}><Download size={17} />下载模板</button><button className="button secondary" disabled={task.busy} onClick={() => uploadRef.current!.click()}><Upload size={17} />{task.busy ? '预览中…' : '导入 / 批量调价'}</button><button className="button primary" onClick={() => setEditing('new')}><Plus size={18} />新增商品</button></PageHeading>
    <input type="file" ref={uploadRef} accept=".csv,text/csv" hidden aria-label="选择商品 CSV" onChange={event => { const file = event.target.files?.[0]; if (!file) return; setImported(null); void task.run(async () => { const csv = await file.text(); const preview = await api<ProductImportPreview>('/products/import/preview', { csv }); setImporting({ csv, filename: file.name, preview }); }); event.target.value = ''; }} />
    <Feedback error={task.error} success={imported ? `导入完成：新增 ${imported.added} 件，调价 ${imported.updated} 件，未变化 ${imported.unchanged} 件。` : ''} />
    <div className="notice"><Package size={18} /><span>价格单位为人民币；历史报价会保留当时的价格，不受商品调价影响。导入模板中的示例行请先替换为你的商品。</span></div>
    <section className="card"><div className="toolbar"><div className="section-title"><h2>全部商品</h2><span className="count-pill">{data.products.length}</span></div><label className="search-field"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索 SKU、名称或规格" aria-label="搜索商品" /></label></div>{products.length === 0 ? <EmptyState title={data.products.length ? '未找到商品' : '建立你的第一份商品目录'}><p>支持逐个添加，或使用 CSV 模板一次导入。</p><button className="button secondary" onClick={() => setEditing('new')}><Plus size={16} />添加商品</button></EmptyState> : <div className="table-wrap"><table className="data-table"><thead><tr><th>商品名称</th><th>SKU / 型号</th><th>规格</th><th>单位</th><th className="align-right">参考单价</th><th /></tr></thead><tbody>{products.map(item => <tr key={item.id}><td><strong>{item.name}</strong></td><td><code className="sku-code">{item.sku}</code></td><td>{item.specification || '—'}</td><td>{item.unit}</td><td className="align-right number-cell">{formatMoney(item.priceCents)}</td><td><button className="icon-button" aria-label={`编辑${item.name}`} onClick={() => setEditing(item)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>}</section>
    {editing && <ProductEditor key={editing === 'new' ? 'new' : editing.id} product={editing === 'new' ? undefined : editing} close={() => setEditing(null)} refresh={refresh} />}
    {importing && <ProductImportDialog {...importing} close={() => setImporting(null)} refresh={refresh} onImported={result => { setImported(result); setImporting(null); }} />}
  </>;
}

function ProductImportDialog({ csv, filename, preview: initialPreview, close, refresh, onImported }: {
  csv: string; filename: string; preview: ProductImportPreview; close: () => void;
  refresh: () => Promise<void>; onImported: (result: ProductImportResult) => void;
}) {
  const [preview, setPreview] = useState(initialPreview);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const task = useTask();
  const counts = {
    new: preview.rows.filter(row => row.status === 'new').length,
    update: preview.rows.filter(row => row.status === 'update').length,
    unchanged: preview.rows.filter(row => row.status === 'unchanged').length,
    error: preview.rows.filter(row => row.status === 'error').length,
  };
  const labels = { new: '新增', update: '调价', unchanged: '未变化', error: '错误' };
  return <Modal title="确认商品导入与调价" onClose={close} busy={task.busy} wide>
    <div className="modal-body">
      <Feedback error={task.error} />
      <p className="helper-text" style={{ overflowWrap: 'anywhere' }}>{filename} · 共 {preview.rows.length} 行</p>
      <div className="notice"><Package size={18} /><span>已有 SKU 只更新参考单价，名称、规格和单位沿用商品目录。新 SKU 将新增商品。历史报价保持不变。</span></div>
      <div className="toolbar"><div className="heading-actions">
        <span className="badge green">新增 {counts.new}</span><span className="badge amber">调价 {counts.update}</span>
        <span className="badge">未变化 {counts.unchanged}</span><span className="badge">错误 {counts.error}</span>
      </div>{counts.error > 0 && <label className="helper-text"><input type="checkbox" checked={errorsOnly} onChange={event => setErrorsOnly(event.target.checked)} /> 只看错误行</label>}</div>
      {counts.error > 0 && <p className="error-banner" role="alert">请修正 CSV 中的错误后重新上传；本批次尚未写入任何商品。</p>}
      <div className="table-wrap" style={{ maxHeight: '48vh', overflowY: 'auto' }}>
        <table className="data-table"><thead><tr><th>行</th><th>SKU / 商品</th><th>状态</th><th className="align-right">原价</th><th className="align-right">新价</th><th>说明</th></tr></thead>
          <tbody>{preview.rows.filter(row => !errorsOnly || row.status === 'error').map(row => <tr key={row.line}>
            <td>{row.line}</td><td><code className="sku-code">{row.sku || '未填写 SKU'}</code><small>{row.name}</small></td>
            <td><span className={`badge ${row.status === 'new' ? 'green' : row.status === 'update' ? 'amber' : ''}`}>{labels[row.status]}</span></td>
            <td className="align-right number-cell">{row.status === 'error' || row.oldPriceCents === null ? '—' : formatMoney(row.oldPriceCents)}</td>
            <td className="align-right number-cell">{row.status === 'error' ? '—' : formatMoney(row.priceCents)}</td>
            <td>{row.status === 'error' ? row.message : `${row.specification || '无规格'} · ${row.unit}`}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <div className="form-actions">
      <button type="button" className="button secondary" disabled={task.busy} onClick={close}>取消</button>
      <button type="button" className="button secondary" disabled={task.busy} onClick={() => void task.run(async () => { setPreview(await api<ProductImportPreview>('/products/import/preview', { csv })); })}>重新预览</button>
      <button type="button" className="button primary" disabled={task.busy || counts.error > 0 || counts.new + counts.update === 0} onClick={() => void task.run(async () => {
        const result = await api<ProductImportResult>('/products/import', { csv, fingerprint: preview.fingerprint });
        await refresh();
        onImported(result);
      })}>{task.busy ? '处理中…' : `确认新增 ${counts.new} 件 / 调价 ${counts.update} 件`}</button>
    </div>
  </Modal>;
}

function ProductEditor({ product, close, refresh }: { product?: Product; close: () => void; refresh: () => Promise<void> }) {
  const [form, setForm] = useState({ sku: product?.sku ?? '', name: product?.name ?? '', specification: product?.specification ?? '', unit: product?.unit ?? '件', price: product ? (product.priceCents / 100).toFixed(2) : '' });
  const task = useTask();
  return <Modal title={product ? '编辑商品' : '新增商品'} onClose={close} busy={task.busy}><form onSubmit={event => { event.preventDefault(); void task.run(async () => { await api(product ? `/products/${product.id}` : '/products', { sku: form.sku, name: form.name, specification: form.specification, unit: form.unit, priceCents: parseMoney(form.price) }, product ? 'PUT' : 'POST'); await refresh(); close(); }); }}><div className="modal-body"><Feedback error={task.error} /><div className="form-grid"><label className="field">商品名称<input required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：深沟球轴承" autoFocus /></label><label className="field">SKU / 型号<input required maxLength={80} value={form.sku} onChange={event => setForm({ ...form, sku: event.target.value })} placeholder="例如：BRG-6204" /></label><label className="field full-width">规格<input maxLength={500} value={form.specification} onChange={event => setForm({ ...form, specification: event.target.value })} placeholder="例如：6204-2RS 20×47×14mm" /></label><label className="field">单位<input required maxLength={20} value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })} placeholder="件" /></label><label className="field">参考单价（元）<input required type="number" min="0" max="1000000" step="0.01" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} placeholder="0.00" /></label></div></div><div className="form-actions"><button type="button" className="button secondary" onClick={close} disabled={task.busy}>取消</button><button className="button primary" disabled={task.busy}>{task.busy ? '保存中…' : '保存商品'}</button></div></form></Modal>;
}
