import { useState } from 'react';
import { ArrowRight, CalendarClock, Plus, Search } from 'lucide-react';
import { sourceLabels, statusLabels, type AppState, type Inquiry } from '../../shared/domain';
import { displayDate, localDate } from '../api';
import { EmptyState, PageHeading, StatusBadge } from '../components';

export function Inquiries({ data }: { data: AppState }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const items = data.inquiries.filter(item => (status === 'all' || item.status === status) && `${item.customer} ${item.code} ${item.contact} ${item.items.map(row => `${row.description} ${row.model}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeading eyebrow="INQUIRIES" title="询盘管理" description="从一条需求开始，让每个采购意向都有下一步。"><a className="button primary" href="#new"><Plus size={18} />新建询盘</a></PageHeading><section className="card"><div className="toolbar"><div className="filter-tabs"><button className={`filter-tab${status === 'all' ? ' active' : ''}`} onClick={() => setStatus('all')}>全部 <span>{data.inquiries.length}</span></button>{Object.entries(statusLabels).map(([key, label]) => <button key={key} className={`filter-tab${status === key ? ' active' : ''}`} onClick={() => setStatus(key)}>{label}</button>)}</div><label className="search-field"><Search size={17} /><input aria-label="搜索询盘" placeholder="搜索客户、型号或询盘编号" value={query} onChange={event => setQuery(event.target.value)} /></label></div>{items.length === 0 ? <EmptyState title={data.inquiries.length ? '没有符合条件的询盘' : '还没有询盘'}><p>{data.inquiries.length ? '试试其他关键词或筛选条件。' : '把客户发来的邮件或聊天内容粘贴进来。'}</p><a href="#new" className="button secondary"><Plus size={16} />录入询盘</a></EmptyState> : <div className="table-wrap"><table className="data-table"><thead><tr><th>客户 / 编号</th><th>采购需求</th><th>来源</th><th>状态</th><th>下次跟进</th><th>创建时间</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><a href={`#inquiry/${item.id}`} className="customer-cell"><span className="customer-avatar">{item.customer.slice(0, 1)}</span><span><strong>{item.customer}</strong><small>{item.code}</small></span></a></td><td><span className="truncate">{item.items[0]?.description || '待整理'}</span><small>{item.items.length} 项需求</small></td><td>{sourceLabels[item.source]}</td><td><StatusBadge status={item.status} /></td><td><span className={item.nextFollowUp && item.nextFollowUp < localDate() && !['won', 'lost'].includes(item.status) ? 'text-amber' : ''}>{displayDate(item.nextFollowUp)}</span></td><td>{displayDate(item.createdAt)}</td><td><a className="icon-button" aria-label={`打开${item.customer}`} href={`#inquiry/${item.id}`}><ArrowRight size={17} /></a></td></tr>)}</tbody></table></div>}</section></>;
}

export function FollowUps({ data }: { data: AppState }) {
  const active = data.inquiries.filter(item => item.status !== 'won' && item.status !== 'lost');
  const groups: { title: string; note: string; items: Inquiry[]; color: string }[] = [
    { title: '已逾期', note: '优先联系，重新确认下一步', items: active.filter(item => item.nextFollowUp && item.nextFollowUp < localDate()), color: 'amber' },
    { title: '今天', note: '今天要推进的客户', items: active.filter(item => item.nextFollowUp === localDate()), color: 'green' },
    { title: '接下来', note: '已经安排的后续沟通', items: active.filter(item => item.nextFollowUp && item.nextFollowUp > localDate()).sort((a, b) => a.nextFollowUp!.localeCompare(b.nextFollowUp!)), color: 'blue' },
    { title: '未安排', note: '为这些询盘设置下一次跟进', items: active.filter(item => !item.nextFollowUp), color: 'gray' },
  ];
  return <><PageHeading eyebrow="FOLLOW-UP PLAN" title="每一笔生意，都有人跟进。" description="按日期推进沟通，成交和丢单的询盘会自动移出待办。" /><div className="followup-grid">{groups.map(group => <section className="card" key={group.title}><div className="card-header"><div><div className="section-title"><CalendarClock size={18} /><h2>{group.title}</h2><span className={`badge ${group.color}`}>{group.items.length}</span></div><p className="muted">{group.note}</p></div></div>{group.items.length === 0 ? <div className="compact-empty">暂无待办</div> : <div className="followup-list">{group.items.map(item => <a key={item.id} className="followup-card" href={`#inquiry/${item.id}`}><div className="followup-top"><strong>{item.customer}</strong><StatusBadge status={item.status} /></div><p>{item.items[0]?.description || '需求待整理'}</p><div className="followup-bottom"><span>{displayDate(item.nextFollowUp)}</span><span>记录跟进 <ArrowRight size={14} /></span></div></a>)}</div>}</section>)}</div></>;
}
