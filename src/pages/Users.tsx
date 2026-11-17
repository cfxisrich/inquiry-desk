import { useEffect, useState } from 'react';
import { Plus, UsersRound } from 'lucide-react';
import type { User } from '../../shared/auth';
import { api, displayDate, useTask } from '../api';
import { Feedback, Modal, PageHeading } from '../components';

export function Users({ user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const task = useTask();
  useEffect(() => {
    void api<User[]>('/users').then(setUsers).catch((error: Error) => setLoadError(error.message)).finally(() => setLoading(false));
  }, []);
  return <>
    <PageHeading eyebrow="TEAM MEMBERS" title="用户管理" description="管理员管理账号，团队成员共享商品、询盘、报价和跟进记录。">
      <button className="button primary" disabled={task.busy} onClick={() => setCreating(true)}><Plus />创建账号</button>
    </PageHeading>
    <Feedback error={task.error || loadError} success={task.success} />
    <section className="card">
      <div className="card-header"><div className="section-title"><UsersRound /><h2>工作区成员</h2><span className="count-pill">{users.length}</span></div></div>
      {loading ? <div className="compact-empty">正在加载用户…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>角色</th><th>账号状态</th><th>创建日期</th><th>操作</th></tr></thead><tbody>
        {users.map(member => <tr key={member.id}>
          <td><strong>{member.displayName}{member.id === user.id ? '（我）' : ''}</strong><small>{member.username}</small></td>
          <td>{member.role === 'admin' ? '管理员' : '普通用户'}</td>
          <td><span className={`badge ${member.enabled ? 'green' : 'amber'}`}>{member.enabled ? '已启用' : '已停用'}</span></td>
          <td>{displayDate(member.createdAt)}</td>
          <td><div className="user-actions">{member.id === user.id ? <a className="text-link" href="#account">修改我的密码</a> : <>
            <button className="button secondary small" disabled={task.busy} onClick={() => setResetting(member)}>重置密码</button>
            <button className={`button small ${member.enabled ? 'danger' : 'secondary'}`} disabled={task.busy} onClick={() => void task.run(async () => {
              const updated = await api<User>(`/users/${member.id}`, { enabled: !member.enabled }, 'PATCH');
              setUsers(current => current.map(item => item.id === updated.id ? updated : item));
            }, member.enabled ? '账号已停用，已有登录已失效。' : '账号已启用，可以重新登录。')}>{member.enabled ? '停用' : '启用'}</button>
          </>}</div></td>
        </tr>)}
      </tbody></table></div>}
    </section>
    {creating && <CreateUser close={() => setCreating(false)} onCreated={created => { setUsers(current => [created, ...current]); setCreating(false); }} />}
    {resetting && <ResetPassword user={resetting} close={() => setResetting(null)} />}
  </>;
}

function CreateUser({ close, onCreated }: { close: () => void; onCreated: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>('member');
  const task = useTask();
  return <Modal title="创建账号" onClose={close} busy={task.busy}>
    <form onSubmit={event => { event.preventDefault(); void task.run(async () => { onCreated(await api<User>('/users', { username, displayName, password, role })); }); }}>
      <div className="modal-body">
        <Feedback error={task.error} />
        <fieldset className="auth-fields" disabled={task.busy}>
          <label className="field">用户名<input required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.\-]+" autoComplete="off" autoCapitalize="none" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)} /></label>
          <p className="helper-text">3–40 位字母、数字、下划线、点或短横线，不区分大小写。</p>
          <label className="field">显示名称<input required maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
          <label className="field">初始密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="8–128 位密码" /></label>
          <label className="field">角色<select value={role} onChange={event => setRole(event.target.value as User['role'])}><option value="member">普通用户</option><option value="admin">管理员</option></select></label>
          <p className="helper-text">普通用户可使用全部业务功能；管理员还可以创建、停用账号和重置密码。</p>
        </fieldset>
      </div>
      <div className="form-actions"><button type="button" className="button secondary" onClick={close} disabled={task.busy}>取消</button><button className="button primary" disabled={task.busy}>{task.busy ? '正在创建…' : '创建账号'}</button></div>
    </form>
  </Modal>;
}

function ResetPassword({ user, close }: { user: User; close: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const task = useTask();
  return <Modal title={`重置 ${user.displayName} 的密码`} onClose={close} busy={task.busy}>
    <form onSubmit={event => {
      event.preventDefault();
      void task.run(async () => {
        if (password !== confirmation) throw new Error('两次输入的密码不一致');
        await api(`/users/${user.id}/password`, { password });
        setPassword('');
        setConfirmation('');
      }, '密码已重置，该用户的所有登录已失效。');
    }}>
      <div className="modal-body"><Feedback error={task.error} success={task.success} /><p className="helper-text">账号：{user.username}。重置后需使用新密码重新登录。</p>
        <fieldset className="auth-fields" disabled={task.busy}>
          <label className="field">新密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="8–128 位密码" /></label>
          <label className="field">确认新密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        </fieldset>
      </div>
      <div className="form-actions"><button type="button" className="button secondary" onClick={close} disabled={task.busy}>关闭</button><button className="button primary" disabled={task.busy}>{task.busy ? '正在重置…' : '重置密码'}</button></div>
    </form>
  </Modal>;
}
