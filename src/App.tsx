import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Boxes, CalendarClock, ChevronRight, FileText, LayoutDashboard, MessageSquareText, Plus, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import type { AppState } from '../shared/domain';
import type { SessionState, User } from '../shared/auth';
import { Auth, Account } from './pages/Auth';
import { Users } from './pages/Users';
import { api } from './api';
import { Dashboard } from './pages/Dashboard';
import { Inquiries, FollowUps } from './pages/Inquiries';
import { InquiryDetail } from './pages/InquiryDetail';
import { Products } from './pages/Products';
import { Quotes, QuoteDetail } from './pages/Quotes';

const navigation = [
  { hash: 'dashboard', label: '今日工作台', icon: LayoutDashboard },
  { hash: 'inquiries', label: '询盘管理', icon: MessageSquareText },
  { hash: 'products', label: '商品目录', icon: Boxes },
  { hash: 'quotes', label: '报价记录', icon: FileText },
  { hash: 'followups', label: '跟进计划', icon: CalendarClock },
  { hash: 'users', label: '用户管理', icon: UsersRound },
];

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    void api<SessionState>('/auth/session').then(setSession).catch((error: Error) => setError(error.message));
    const onAuthRequired = () => {
      setSession({ setupRequired: false, user: null });
      setMessage('登录已失效，请重新登录。');
    };
    window.addEventListener('auth-required', onAuthRequired);
    return () => window.removeEventListener('auth-required', onAuthRequired);
  }, []);
  if (error) return <main className="auth-loading"><div className="error-banner" role="alert">无法连接工作台：{error}</div><button className="button secondary" onClick={() => location.reload()}>重新连接</button></main>;
  if (!session) return <main className="auth-loading"><p>正在打开工作空间…</p></main>;
  if (!session.user) return <Auth setupRequired={session.setupRequired} message={message} onAuthenticated={user => { setMessage(''); setSession({ setupRequired: false, user }); }} />;
  return <Workspace key={session.user.id} user={session.user} onSignedOut={message => {
    location.hash = 'dashboard';
    setMessage(message);
    setSession({ setupRequired: false, user: null });
  }} />;
}

function Workspace({ user, onSignedOut }: { user: User; onSignedOut: (message: string) => void }) {
  const [route, setRoute] = useState(location.hash.slice(1) || 'dashboard');
  const routeHash = useRef(location.hash);
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    if ((routeHash.current.slice(1) || 'dashboard') === route) dirty.current = value;
  }, [route]);
  const [data, setData] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const refresh = async () => { setData(await api<AppState>('/state')); };
  useEffect(() => {
    void api<AppState>('/state').then(setData).catch((error: Error) => setError(error.message));
    const onHash = () => {
      if (location.hash === routeHash.current) return;
      if (dirty.current && !window.confirm('询盘中有未保存的修改，确定放弃并离开吗？')) {
        history.replaceState(history.state, '', `${location.pathname}${location.search}${routeHash.current}`);
        return;
      }
      dirty.current = false;
      routeHash.current = location.hash;
      setRoute(location.hash.slice(1) || 'dashboard');
      window.scrollTo(0, 0);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
  const page = route.split('?')[0];
  const filter = new URLSearchParams(route.split('?')[1]).get('filter') ?? 'all';
  const active = page === 'new' || page.startsWith('inquiry/') ? 'inquiries' : page.startsWith('quote/') ? 'quotes' : page;
  const menu = navigation.filter(item => item.hash !== 'users' || user.role === 'admin');
  const title = active === 'account' ? '我的账号' : menu.find(item => item.hash === active)?.label ?? '今日工作台';

  return <div className="app-shell">
    <aside className="sidebar no-print">
      <a href="#dashboard" className="brand" aria-label="询报价工作台"><span className="brand-mark"><MessageSquareText size={23} /></span><span>询报价<small>INQUIRY DESK</small></span></a>
      <div className="sidebar-label">工作空间</div>
      <nav aria-label="主导航">{menu.map(item => <a key={item.hash} href={`#${item.hash}`} aria-label={item.label} title={item.label} className={`nav-item${active === item.hash ? ' active' : ''}`}><item.icon size={19} /><span>{item.label}</span>{item.hash === 'inquiries' && data && data.inquiries.filter(row => row.status === 'new').length > 0 && <span className="nav-count">{data.inquiries.filter(row => row.status === 'new').length}</span>}</a>)}</nav>
      <div className="sidebar-note"><Sparkles size={19} /><strong>把每一条询盘，<br />变成下一次机会。</strong><p>从需求到报价，跟进井井有条。</p><a href="#new">开始一笔新询盘 <ArrowUpRight size={14} /></a></div>
      <div className="sidebar-footer"><span className="workspace-icon">本</span><div><strong>本地工作空间</strong><small><span className="online-dot" /> 数据保存在本机</small></div><ShieldCheck size={18} /></div>
    </aside>
    <main className="main-area">
      <header className="topbar no-print"><div className="breadcrumb">工作空间 <ChevronRight size={14} /><strong>{title}</strong></div><div className="topbar-actions"><span className="header-date">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</span><a href="#new" className="button primary small"><Plus size={16} />新建询盘</a><a href="#account" className="avatar" aria-label="我的账号" title={`${user.displayName} · 我的账号`}>{user.displayName.slice(0, 1)}</a></div></header>
      <div className="content">
        {error && <div className="error-banner" role="alert">连接失败：{error}。请确认本地服务已经启动，然后刷新页面。</div>}
        {!data && !error && <div className="empty-state"><span className="loading-dot" /><p>正在打开工作空间…</p></div>}
        {data && active === 'dashboard' && <Dashboard data={data} refresh={refresh} />}
        {data && page === 'inquiries' && <Inquiries key={route} data={data} initialFilter={filter} />}
        {data && (route === 'new' || route.startsWith('inquiry/')) && <InquiryDetail key={route} data={data} inquiry={data.inquiries.find(item => item.id === route.split('/')[1])} isNew={route === 'new'} refresh={refresh} onDirtyChange={onDirtyChange} />}
        {data && route === 'products' && <Products data={data} refresh={refresh} />}
        {data && page === 'quotes' && <Quotes key={route} data={data} initialFilter={filter} />}
        {data && route.startsWith('quote/') && <QuoteDetail data={data} quote={data.quotes.find(item => item.id === route.split('/')[1])} refresh={refresh} />}
        {data && page === 'followups' && <FollowUps data={data} dueOnly={filter === 'due'} />}
        {page === 'account' && <Account user={user} onSignedOut={onSignedOut} />}
        {page === 'users' && user.role === 'admin' && <Users user={user} />}
        {data && active !== 'account' && !menu.some(item => item.hash === active) && <div className="empty-state"><h2>页面不存在</h2><a className="button primary" href="#dashboard">返回工作台</a></div>}
      </div>
    </main>
  </div>;
}
