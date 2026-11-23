import { useEffect, useState } from 'react';
import { ArrowLeft, Check, FileText, Plus, Save, Sparkles, Trash2, XCircle } from 'lucide-react';
import { sourceLabels, statusLabels, type AppState, type Extraction, type Inquiry, type InquiryInput, type Product } from '../../shared/domain';
import { formatMoney } from '../../shared/quote';
import { api, ApiError, displayDate, useTask } from '../api';
import { EmptyState, Feedback, Modal, PageHeading, StatusBadge } from '../components';
import { QuoteEditor } from './Quotes';
import { ExtractionPreview } from './ExtractionPreview';

export function InquiryDetail({ data, inquiry, isNew, refresh, onDirtyChange }: {
  data: AppState; inquiry?: Inquiry; isNew: boolean; refresh: () => Promise<void>; onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<InquiryInput>(inquiry ?? {
    customer: '', contact: '', source: 'email', originalText: '', notes: '', status: 'new',
    nextFollowUp: null, items: [], missingFields: [],
  });
  const [baseline, setBaseline] = useState(draft);
  const [revision, setRevision] = useState(inquiry?.revision ?? null);
  const [preview, setPreview] = useState<Extraction | null>(null);
  const [quoteInquiry, setQuoteInquiry] = useState<Inquiry | null>(null);
  const [followNote, setFollowNote] = useState('');
  const [followDate, setFollowDate] = useState(inquiry?.nextFollowUp ?? '');
  const [conflict, setConflict] = useState(false);
  const [serverVersion, setServerVersion] = useState<Inquiry | null>(null);
  const task = useTask();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || followNote !== '' || followDate !== (baseline.nextFollowUp ?? '');
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function save(nextDraft = draft) {
    try {
      const saved = await api<Inquiry>(inquiry ? `/inquiries/${inquiry.id}` : '/inquiries',
        inquiry ? { ...nextDraft, revision } : nextDraft, inquiry ? 'PUT' : 'POST');
      setDraft(saved);
      setBaseline(saved);
      setRevision(saved.revision);
      setConflict(false);
      onDirtyChange(followNote !== '' || followDate !== (saved.nextFollowUp ?? ''));
      return saved;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      throw error;
    }
  }

  if (!isNew && !inquiry) return <EmptyState title="询盘不存在"><a href="#inquiries" className="button secondary">返回询盘列表</a></EmptyState>;
  const canQuote = draft.items.length > 0 && draft.items.every(item => item.productId && item.quantity && item.quantity > 0);
  const quotes = data.quotes.filter(item => item.inquiryId === inquiry?.id).sort((a, b) => b.version - a.version);
  const followUps = data.followUps.filter(item => item.inquiryId === inquiry?.id);

  return <>
    <a href="#inquiries" className="back-link no-print"><ArrowLeft size={16} />返回询盘列表</a>
    <PageHeading eyebrow={inquiry?.code ?? 'NEW INQUIRY'} title={isNew ? '录入一条新询盘' : draft.customer}
      description={isNew ? '保留原始需求，整理商品，然后开始报价。' : `${sourceLabels[inquiry!.source]}询盘 · 创建于 ${displayDate(inquiry!.createdAt)} · ${draft.items.length} 项采购需求`}>
      {inquiry && <StatusBadge status={draft.status} />}
      {dirty && <span className="badge amber">有未保存修改</span>}
      <button type="submit" form="inquiry-form" className="button secondary" disabled={task.busy}><Save size={17} />{task.busy ? '处理中…' : '保存询盘'}</button>
      {inquiry && <button className="button primary" disabled={task.busy || !canQuote} title={canQuote ? '确认商品后生成报价' : '先为每项需求确认商品和数量'}
        onClick={() => void task.run(async () => { const saved = await save(); await refresh(); setQuoteInquiry(saved); })}><FileText size={17} />生成报价</button>}
    </PageHeading>
    <Feedback error={task.error} success={task.success} />
    {conflict && inquiry && <div className="notice amber" role="status"><span>这条询盘已被更新。本地修改仍保留，请先查看服务器版本并核对内容。</span>
      <button type="button" className="button secondary small" disabled={task.busy}
        onClick={() => void task.run(async () => { setServerVersion(await api<Inquiry>(`/inquiries/${inquiry.id}`)); })}>查看服务器版本</button>
    </div>}
    <form id="inquiry-form" onSubmit={event => { event.preventDefault(); void task.run(async () => {
      const saved = await save(); await refresh(); if (isNew) location.hash = `inquiry/${saved.id}`;
    }, '询盘已保存'); }}>
      <fieldset disabled={task.busy || quoteInquiry !== null} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="detail-grid">
          <div className="detail-source">
            <section className="card"><div className="card-header"><h2>客户信息</h2><span className="muted">用于报价单</span></div><div className="card-body"><div className="form-grid">
              <label className="field full-width">客户 / 公司名称 <span className="required">*</span><input required maxLength={200} value={draft.customer} onChange={event => setDraft({ ...draft, customer: event.target.value })} placeholder="例如：宁波恒远设备有限公司" /></label>
              <label className="field full-width">联系人及联系方式<input maxLength={300} value={draft.contact} onChange={event => setDraft({ ...draft, contact: event.target.value })} placeholder="姓名、电话或邮箱" /></label>
              <label className="field">询盘来源<select value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value as InquiryInput['source'] })}>{Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="field">当前状态<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as InquiryInput['status'] })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="field full-width">下次跟进日期<input type="date" value={draft.nextFollowUp ?? ''} onChange={event => { setDraft({ ...draft, nextFollowUp: event.target.value || null }); setFollowDate(event.target.value); }} /></label>
            </div></div></section>
            <section className="card source-panel"><div className="card-header"><h2>原始询盘</h2><span className="badge">保留原文</span></div><div className="card-body">
              <label className="field"><span className="muted">粘贴邮件、聊天记录或电话摘要</span><textarea className="source-text" rows={12} maxLength={30000} value={draft.originalText} onChange={event => setDraft({ ...draft, originalText: event.target.value })} placeholder={'您好，需要一批 6204-2RS 轴承，数量 200 件。\n请提供含税报价及交货时间。\n联系人：张先生'} /></label>
              <div className="ai-action"><button type="button" className="button ai-button" disabled={!inquiry || !data.settings.aiConfigured || !draft.originalText.trim() || !draft.customer.trim()}
                onClick={() => void task.run(async () => { const saved = await save(); await refresh(); setPreview(await api<Extraction>(`/inquiries/${saved.id}/extract`, {})); })}>
                <Sparkles size={17} />{task.busy ? '处理中…' : 'AI 提取采购需求'}</button>
                <p className="helper-text">{!data.settings.aiConfigured ? '尚未配置 AI，可直接在右侧手工录入需求。' : !inquiry ? '先保存询盘，再使用 AI 提取。' : '点击会先保存询盘，再将原文发送到已配置模型。结果先预览，采纳后追加到现有需求，已匹配商品保持不变。'}</p>
              </div>
            </div></section>
          </div>
          <div className="detail-main">
            <section className="card"><div className="card-header"><div className="section-title"><h2>采购需求</h2><span className="count-pill">{draft.items.length}</span></div>
              <button type="button" className="button ghost small" onClick={() => setDraft({ ...draft, items: [...draft.items, { description: '', model: '', specification: '', quantity: null, unit: '件', productId: null }] })} disabled={draft.items.length >= 100}><Plus size={16} />添加需求</button>
            </div><div className="card-body">
              {draft.missingFields.length > 0 && <section className="stack" aria-label="待确认信息"><h3>待确认信息</h3>
                {draft.missingFields.map((field, index) => <div className="notice amber" key={field}><span style={{ overflowWrap: 'anywhere', flex: 1 }}>{field}</span>
                  <button type="button" className="button secondary small" aria-label={`标记待确认项${index + 1}已解决`}
                    onClick={() => setDraft({ ...draft, missingFields: draft.missingFields.filter((_, fieldIndex) => fieldIndex !== index) })}><Check size={15} />已解决</button>
                </div>)}<p className="helper-text">确认信息后标记已解决；保存询盘后，下次打开仍会保留未解决项。</p>
              </section>}
              <p className="helper-text">逐项确认型号、规格和数量，再选择目录商品。AI 不会自动确定最终商品或价格。</p>
              {draft.items.length === 0 && <EmptyState title="整理客户想买什么"><p>添加需求行，或保存后使用 AI 从原文提取。</p><button type="button" className="button secondary" onClick={() => setDraft({ ...draft, items: [{ description: '', model: '', specification: '', quantity: null, unit: '件', productId: null }] })}><Plus size={16} />手工添加需求</button></EmptyState>}
              {draft.items.map((item, index) => <Requirement key={index} item={item} index={index} products={data.products} onChange={updated => setDraft({ ...draft, items: draft.items.map((row, rowIndex) => rowIndex === index ? updated : row) })} onRemove={() => setDraft({ ...draft, items: draft.items.filter((_, rowIndex) => rowIndex !== index) })} />)}
              {draft.items.length > 0 && <div className={`match-summary ${canQuote ? 'complete' : ''}`}><Check size={16} /><span>{draft.items.filter(item => item.productId && item.quantity).length} / {draft.items.length} 项已确认商品和数量{canQuote ? '，可以生成报价' : '，完成后即可生成报价'}</span></div>}
              <label className="field notes-field">内部备注<textarea rows={3} maxLength={3000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="交期要求、沟通背景等，仅内部使用" /></label>
            </div></section>
            {quotes.length > 0 && <section className="card"><div className="card-header"><h2>报价版本</h2><span className="muted">历史内容不会被覆盖</span></div><div className="quote-history">{quotes.map(quote => <a key={quote.id} href={`#quote/${quote.id}`} className="quote-history-row"><FileText size={18} /><div><strong>{quote.code} <span className="badge">V{quote.version}</span></strong><small>{displayDate(quote.createdAt)} · {quote.sentAt ? '已标记发送' : '待发送'}</small></div><strong>{formatMoney(quote.totalCents)}</strong></a>)}</div></section>}
          </div>
        </div>
      </fieldset>
    </form>
    {inquiry && <section className="card followup-section"><div className="card-header"><h2>沟通与跟进</h2><div className="heading-actions">
      <button className="button secondary small" disabled={task.busy || draft.status === 'won'} onClick={() => void task.run(async () => { await save({ ...draft, status: 'won' }); await refresh(); }, '已标记成交，询盘已移出跟进待办')}><Check size={16} />标记成交</button>
      <button className="button ghost small" disabled={task.busy || draft.status === 'lost'} onClick={() => void task.run(async () => { await save({ ...draft, status: 'lost' }); await refresh(); }, '已标记丢单，询盘已移出跟进待办')}><XCircle size={16} />标记丢单</button>
    </div></div><div className="card-body grid-two">
      <form onSubmit={event => { event.preventDefault(); void task.run(async () => {
        const saved = await save();
        try {
          await api('/followups', { inquiryId: inquiry.id, revision: saved.revision, note: followNote, nextFollowUp: followDate || null });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) setConflict(true);
          throw error;
        }
        setFollowNote('');
        const latest = await api<Inquiry>(`/inquiries/${inquiry.id}`);
        setDraft(latest); setBaseline(latest); setRevision(latest.revision); setFollowDate(latest.nextFollowUp ?? '');
        onDirtyChange(false);
        await refresh();
      }, '跟进记录已保存'); }}>
        <fieldset disabled={task.busy || quoteInquiry !== null} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label className="field">本次沟通记录<textarea required maxLength={3000} rows={4} value={followNote} onChange={event => setFollowNote(event.target.value)} placeholder="例如：客户已收到报价，正在确认采购数量，约定下周一回复。" /></label>
          <div className="followup-form-bottom"><label className="field">下次跟进<input type="date" value={followDate} onChange={event => setFollowDate(event.target.value)} /></label><button className="button primary"><Plus size={16} />记录跟进</button></div>
          <p className="helper-text">日期形成应用内待办，不会自动发送消息。</p>
        </fieldset>
      </form>
      <div className="timeline">{followUps.length === 0 ? <div className="compact-empty">还没有沟通记录，记录第一次跟进。</div> : followUps.map(item => <div className="timeline-item" key={item.id}><span className="timeline-dot" /><div><small>{new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small><p>{item.note}</p><span className="muted">下次跟进：{displayDate(item.nextFollowUp)}</span></div></div>)}</div>
    </div></section>}
    {preview && <ExtractionPreview result={preview} existingItems={draft.items.length} existingMissing={draft.missingFields} close={() => setPreview(null)}
      onApply={(items, missingFields) => { setDraft({ ...draft, items: [...draft.items, ...items.map(item => ({ ...item, productId: null }))], missingFields }); setPreview(null); onDirtyChange(true); }} />}
    {serverVersion && inquiry && <Modal title="服务器版本对照" wide busy={task.busy} onClose={() => setServerVersion(null)}>
      <div className="modal-body"><p className="notice">查看不会修改本地草稿。载入最新版本会放弃本地未保存的询盘和跟进内容。</p>
        <div className="grid-two"><section><h3>本地编辑内容</h3><InquirySummary value={draft} />{followNote && <p style={{ whiteSpace: 'pre-wrap' }}>未保存跟进：{followNote}</p>}</section>
          <section><h3>服务器版本 · {serverVersion.revision}</h3><InquirySummary value={serverVersion} /></section></div>
      </div>
      <div className="form-actions"><button className="button secondary" disabled={task.busy} onClick={() => setServerVersion(null)}>继续保留本地修改</button>
        <button className="button primary" disabled={task.busy} onClick={() => void task.run(async () => {
          const latest = await api<Inquiry>(`/inquiries/${inquiry.id}`);
          setDraft(latest); setBaseline(latest); setRevision(latest.revision); setFollowDate(latest.nextFollowUp ?? '');
          setFollowNote(''); setConflict(false); setServerVersion(null); setPreview(null); onDirtyChange(false);
          await refresh();
        }, '已放弃本地修改并载入最新版本')}>放弃本地修改，载入最新版本</button>
      </div>
    </Modal>}
    {quoteInquiry && <QuoteEditor inquiry={quoteInquiry} data={data} refresh={async () => {
      const latest = await api<Inquiry>(`/inquiries/${quoteInquiry.id}`);
      const nextDate = followDate === (baseline.nextFollowUp ?? '') ? latest.nextFollowUp ?? '' : followDate;
      setDraft(latest); setBaseline(latest); setRevision(latest.revision); setFollowDate(nextDate);
      onDirtyChange(followNote !== '' || nextDate !== (latest.nextFollowUp ?? ''));
      await refresh();
    }} close={() => setQuoteInquiry(null)} />}
  </>;
}

function InquirySummary({ value }: { value: InquiryInput }) {
  return <div className="stack" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
    <p>客户：{value.customer}<br />联系方式：{value.contact || '未填写'}<br />来源：{sourceLabels[value.source]}<br />状态：{statusLabels[value.status]}<br />下次跟进：{displayDate(value.nextFollowUp)}</p>
    <div><strong>原始询盘</strong><p>{value.originalText || '未填写'}</p></div>
    <div><strong>内部备注</strong><p>{value.notes || '未填写'}</p></div>
    <div><strong>采购需求（{value.items.length} 项）</strong>{value.items.map((item, index) => <p key={index}>{index + 1}. {item.description} · {item.model} · {item.specification}<br />{item.quantity ?? '待确认数量'} {item.unit} · {item.productId ? '已匹配商品' : '未匹配商品'}</p>)}</div>
    <div><strong>待确认信息</strong>{value.missingFields.length === 0 ? <p>无</p> : value.missingFields.map(field => <p key={field}>{field}</p>)}</div>
  </div>;
}

function Requirement({ item, index, products, onChange, onRemove }: { item: InquiryInput['items'][number]; index: number; products: Product[]; onChange: (item: InquiryInput['items'][number]) => void; onRemove: () => void }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const model = item.model.trim().toLowerCase();
  const selected = products.find(product => product.id === item.productId);
  const suggestions = model ? products.filter(product => `${product.sku} ${product.specification}`.toLowerCase().includes(model))
    .sort((a, b) => Number(b.sku.toLowerCase() === model || b.specification.toLowerCase() === model)
      - Number(a.sku.toLowerCase() === model || a.specification.toLowerCase() === model)).slice(0, 3) : [];
  const matches = query ? products.filter(product => `${product.sku} ${product.name} ${product.specification}`.toLowerCase().includes(query)) : suggestions;
  const candidates = matches.slice(0, 20);
  return <article className="requirement-card"><div className="requirement-header"><strong><span className="item-index">{String(index + 1).padStart(2, '0')}</span>需求明细</strong><button type="button" className="icon-button" onClick={onRemove} aria-label={`移除需求${index + 1}`}><Trash2 size={16} /></button></div><div className="requirement-grid"><label className="field full-width">商品描述 <span className="required">*</span><input required maxLength={500} value={item.description} onChange={event => onChange({ ...item, description: event.target.value })} placeholder="客户需要的商品" /></label><label className="field">型号<input maxLength={120} value={item.model} onChange={event => onChange({ ...item, model: event.target.value })} placeholder="例如：6204-2RS" /></label><label className="field">规格<input maxLength={500} value={item.specification} onChange={event => onChange({ ...item, specification: event.target.value })} placeholder="尺寸、材质等" /></label><label className="field">数量<input type="number" min="1" max="1000000" step="1" value={item.quantity ?? ''} onChange={event => onChange({ ...item, quantity: event.target.value === '' ? null : Number(event.target.value) })} placeholder="待确认" /></label><label className="field">单位<input maxLength={20} value={item.unit} onChange={event => onChange({ ...item, unit: event.target.value })} placeholder="件" /></label></div><div className={`match-box${selected ? ' matched' : ''}`}><div className="match-heading"><strong>{selected ? '已选择目录商品' : '从商品目录匹配'}</strong><span className="muted">请人工核对规格和单位</span></div>{suggestions.length > 0 && !selected && <div className="suggestion-list"><span className="helper-text">型号候选：</span>{suggestions.map(product => <button type="button" key={product.id} className="suggestion" onClick={() => onChange({ ...item, productId: product.id })}>{product.sku} · {formatMoney(product.priceCents)}</button>)}</div>}<div className="match-controls"><input aria-label={`搜索需求${index + 1}的商品`} placeholder="搜索目录名称、SKU 或规格" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label={`选择需求${index + 1}的商品`} value={item.productId ?? ''} onChange={event => onChange({ ...item, productId: event.target.value || null })}><option value="">请选择商品</option>{selected && !candidates.includes(selected) && <option value={selected.id}>{selected.sku} · {selected.name}</option>}{candidates.map(product => <option key={product.id} value={product.id}>{product.sku} · {product.name} · {product.specification}</option>)}</select></div>{matches.length > 20 && <p className="helper-text">仅显示前 20 项，请输入更具体的名称、SKU 或规格。</p>}{!query && products.length > 0 && <p className="helper-text">输入关键词搜索目录；未输入时仅展示型号候选和已选商品。</p>}{query && matches.length === 0 && <p className="helper-text">没有匹配商品，请调整搜索关键词。</p>}{selected && <div className="matched-info"><Check size={15} /><span>{selected.name} · {selected.specification || selected.sku}</span><strong>{formatMoney(selected.priceCents)} / {selected.unit}</strong></div>}{products.length === 0 && <p className="helper-text">请先在商品目录添加商品，再返回匹配。</p>}</div></article>;
}

