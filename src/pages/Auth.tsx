import { useState } from 'react';
import { KeyRound, LogOut, MessageSquareText, ShieldCheck } from 'lucide-react';
import type { User } from '../../shared/auth';
import { api, useTask } from '../api';
import { Feedback, PageHeading } from '../components';

export function Auth({ setupRequired, message, onAuthenticated }: {
  setupRequired: boolean; message: string; onAuthenticated: (user: User) => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const task = useTask();

  return <main className="auth-page">
    <section className="auth-intro">
      <div className="auth-brand"><span className="brand-mark"><MessageSquareText /></span><span>询报价工作台</span></div>
      <p className="eyebrow">INQUIRY DESK</p>
      <h1>每一条询盘，<br />都有下一步。</h1>
      <p>整理客户需求，确认商品与价格，<br />让报价和跟进在同一个工作区完成。</p>
      <span className="auth-workspace"><ShieldCheck />团队共享工作区</span>
    </section>
    <section className="card auth-card">
      <div className="card-body">
        <p className="eyebrow">{setupRequired ? 'GET STARTED' : 'WELCOME BACK'}</p>
        <h2>{setupRequired ? '创建管理员账号' : '登录工作台'}</h2>
        <p className="helper-text">{setupRequired ? '首次使用，创建管理员后即可进入工作区并添加同事。已有业务数据会保留。' : '使用管理员为你创建的账号登录。'}</p>
        {message && <div className="notice" role="status">{message}</div>}
        <Feedback error={task.error} />
        <form onSubmit={event => {
          event.preventDefault();
          void task.run(async () => {
            if (setupRequired && password !== confirmation) throw new Error('两次输入的密码不一致');
            onAuthenticated(await api<User>(setupRequired ? '/auth/setup' : '/auth/login', setupRequired
              ? { username, displayName, password } : { username, password }));
          });
        }}>
          <fieldset className="auth-fields" disabled={task.busy}>
            <label className="field">用户名<input name="username" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.\-]+" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)} placeholder="例如：zhangsan" /></label>
            {setupRequired && <><p className="helper-text">3–40 位字母、数字、下划线、点或短横线，不区分大小写。</p><label className="field">显示名称<input name="displayName" required maxLength={80} autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="例如：张经理" /></label></>}
            <label className="field">密码<input name="password" required type="password" minLength={setupRequired ? 8 : undefined} maxLength={128} autoComplete={setupRequired ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={setupRequired ? '8–128 位密码' : '输入密码'} /></label>
            {setupRequired && <label className="field">确认密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
            <button className="button primary auth-submit" disabled={task.busy}>{task.busy ? '正在处理…' : setupRequired ? '创建账号并进入工作台' : '登录'}</button>
          </fieldset>
        </form>
        {!setupRequired && <p className="helper-text auth-help">忘记密码？请联系管理员重置。</p>}
      </div>
    </section>
  </main>;
}

export function Account({ user, onSignedOut }: { user: User; onSignedOut: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const task = useTask();
  return <>
    <PageHeading eyebrow="MY ACCOUNT" title="我的账号" description={`${user.displayName} · ${user.username} · ${user.role === 'admin' ? '管理员' : '普通用户'}`}>
      <button className="button secondary" disabled={task.busy} onClick={() => void task.run(async () => {
        await api('/auth/logout', {});
        onSignedOut('已退出登录。');
      })}><LogOut />退出登录</button>
    </PageHeading>
    <section className="card account-card">
      <div className="card-header"><h2><KeyRound /> 修改密码</h2></div>
      <div className="card-body">
        <Feedback error={task.error} />
        <p className="helper-text">密码修改后，所有设备上的登录都会失效，请使用新密码重新登录。</p>
        <form onSubmit={event => {
          event.preventDefault();
          void task.run(async () => {
            if (password !== confirmation) throw new Error('两次输入的新密码不一致');
            await api('/auth/password', { currentPassword, password });
            onSignedOut('密码已修改，请使用新密码登录。');
          });
        }}>
          <fieldset className="auth-fields" disabled={task.busy}>
            <label className="field">当前密码<input required type="password" maxLength={128} autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
            <label className="field">新密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="8–128 位密码" /></label>
            <label className="field">确认新密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
            <div><button className="button primary" disabled={task.busy}>{task.busy ? '正在保存…' : '修改密码'}</button></div>
          </fieldset>
        </form>
      </div>
    </section>
  </>;
}
