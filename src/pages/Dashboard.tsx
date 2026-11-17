import { ArrowDownToLine, ArrowRight, CalendarClock, CheckCheck, FileText, MessageSquareText, Plus } from 'lucide-react';
import type { AppState } from '../../shared/domain';
import { statusLabels } from '../../shared/domain';
import { selectQuotes } from '../quote-selection';
import { formatMoney } from '../../shared/quote';
import { api, displayDate, localDate, useTask } from '../api';
import { EmptyState, Feedback, PageHeading, StatusBadge } from '../components';

export function Dashboard({ data, refresh }: { data: AppState; refresh: () => Promise<void> }) {
  const task = useTask();
  const active = data.inquiries.filter(item => item.status !== 'won' && item.status !== 'lost');
  const due = active.filter(item => item.nextFollowUp && item.nextFollowUp <= localDate()).sort((a, b) => a.nextFollowUp!.localeCompare(b.nextFollowUp!));
  const pipeline = ['new', 'quoting', 'quoted', 'won'] as const;
  const quotes = selectQuotes(data);
  const stats = [
    { label: '待处理询盘', count: data.inquiries.filter(item => item.status === 'new').length, icon: MessageSquareText, note: '及时响应，不错过新机会', hash: 'inquiries?filter=new', color: 'green' },
    { label: '待发送报价', count: quotes.pending.size, icon: FileText, note: '已保存，等待你确认发送', hash: 'quotes?filter=unsent', color: 'blue' },
    { label: '今日待跟进', count: due.length, icon: CalendarClock, note: `${due.filter(item => item.nextFollowUp! < localDate()).length} 笔已逾期，请优先处理`, hash: 'followups?filter=due', color: 'amber' },
    { label: '累计成交', count: data.inquiries.filter(item => item.status === 'won').length, icon: CheckCheck, note: '每一次跟进都有价值', hash: 'inquiries?filter=won', color: 'purple' },
  ];
  return <>
    <PageHeading eyebrow="YOUR DAILY BRIEF" title="今天，把生意往前推一步。" description="重要的询盘、待办和报价，都在这里。"><a href="#new" className="button primary"><Plus size={18} />新建询盘</a></PageHeading>
    <Feedback error={task.error} />
    <div className="stats-grid">{stats.map(item => <a className={`stat-card ${item.color}`} href={`#${item.hash}`} key={item.label}><div className="stat-top"><span className="stat-label">{item.label}</span><span className={`stat-icon ${item.color}`}><item.icon size={20} /></span></div><div className="stat-number">{item.count}<small>笔</small></div><div className="stat-note">{item.note}<ArrowRight size={14} /></div></a>)}</div>
    {data.inquiries.length === 0 && <section className="welcome-banner"><div><span className="eyebrow">从第一笔询盘开始</span><h2>给你的报价和跟进，一个清晰的起点。</h2><p>先建立商品目录，再录入客户需求。也可以载入一组独立的演示资料，体验完整流程。</p></div><div className="welcome-actions"><a className="button primary" href="#products">建立商品目录 <ArrowRight size={16} /></a>{data.products.length === 0 && <button className="button secondary" disabled={task.busy} onClick={() => void task.run(async () => { await api('/demo', {}); await refresh(); })}><ArrowDownToLine size={16} />{task.busy ? '正在载入…' : '载入演示数据'}</button>}</div></section>}
    <div className="dashboard-grid">
      <section className="card"><div className="card-header"><div className="section-title"><span className="section-icon amber"><CalendarClock size={18} /></span><h2>优先跟进</h2><span className="count-pill">{due.length}</span></div><a className="text-link" href="#followups">全部计划 <ArrowRight size={15} /></a></div>
        {due.length === 0 ? <EmptyState title="今天的跟进已安排妥当"><p>在询盘详情里设置下一次跟进日期，待办会出现在这里。</p></EmptyState> : <div className="task-list">{due.slice(0, 5).map(item => <a className="task-row" href={`#inquiry/${item.id}`} key={item.id}><span className={`task-date${item.nextFollowUp! < localDate() ? ' overdue' : ''}`}><span>{item.nextFollowUp! < localDate() ? '逾期' : '今日'}</span><strong>{item.nextFollowUp!.slice(8)}</strong></span><div className="task-info"><strong>{item.customer}</strong><p>{item.items[0]?.description || item.originalText.slice(0, 40) || '查看采购需求'}{item.items.length > 1 ? ` 等 ${item.items.length} 项需求` : ''}</p></div><StatusBadge status={item.status} /><ArrowRight className="task-arrow" size={16} /></a>)}</div>}
      </section>
      <section className="card"><div className="card-header"><h2>询盘进展</h2><span className="muted">全部询盘</span></div><div className="pipeline-body"><div className="pipeline-total"><strong>{data.inquiries.length}</strong><span>笔询盘 · 每一步都清晰</span></div>{pipeline.map((status, index) => <a href={`#inquiries?filter=${status}`} className="stage-row" key={status}><div className="stage-label"><span><i className={`stage-dot stage-${index}`} />{statusLabels[status]}</span><strong>{data.inquiries.filter(item => item.status === status).length}</strong></div><div className="stage-track"><div className={`stage-fill stage-${index}`} style={{ width: `${data.inquiries.length ? data.inquiries.filter(item => item.status === status).length / data.inquiries.length * 100 : 0}%` }} /></div></a>)}<div className="pipeline-foot">另有 {data.inquiries.filter(item => item.status === 'lost').length} 笔已丢单</div></div></section>
    </div>
    <section className="card recent-card"><div className="card-header"><div className="section-title"><h2>最近的询盘</h2><span className="muted">持续跟进每一次机会</span></div><a href="#inquiries" className="text-link">查看全部 <ArrowRight size={15} /></a></div>{data.inquiries.length === 0 ? <EmptyState title="还没有询盘"><p>录入客户的第一条需求，开始整理报价。</p></EmptyState> : <div className="table-wrap"><table className="data-table"><thead><tr><th>客户 / 询盘</th><th>采购需求</th><th>最新报价</th><th>状态</th><th>下次跟进</th><th /></tr></thead><tbody>{data.inquiries.slice(0, 5).map(item => <tr key={item.id}><td><a href={`#inquiry/${item.id}`} className="customer-cell"><span className="customer-avatar">{item.customer.slice(0, 1)}</span><span><strong>{item.customer}</strong><small>{item.code}</small></span></a></td><td><span className="truncate">{item.items[0]?.description || '待整理需求'}</span><small>{item.items.length} 项采购需求</small></td><td className="number-cell">{quotes.latest.get(item.id) ? formatMoney(quotes.latest.get(item.id)!.totalCents) : '—'}</td><td><StatusBadge status={item.status} /></td><td>{displayDate(item.nextFollowUp)}</td><td><a className="icon-button" aria-label={`查看${item.customer}`} href={`#inquiry/${item.id}`}><ArrowRight size={17} /></a></td></tr>)}</tbody></table></div>}</section>
    <div className="workspace-bottom"><span><span className="online-dot" />工作空间已连接</span><span>本机保存 · 人工确认报价 · 每次跟进有记录</span></div>
  </>;
}



