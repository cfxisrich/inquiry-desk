import { AlertCircle, CheckCircle2, Inbox, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { statusLabels, type Inquiry } from '../shared/domain';

export function StatusBadge({ status }: { status: Inquiry['status'] }) {
  return <span className={`badge status-${status}`}><span className="status-dot" />{statusLabels[status]}</span>;
}

export function Feedback({ error, success }: { error: string; success?: string }) {
  return <>{error && <div className="error-banner" role="alert"><AlertCircle size={17} />{error}</div>}{success && <div className="success-banner" role="status"><CheckCircle2 size={17} />{success}</div>}</>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Inbox size={30} /></div><h3>{title}</h3>{children}</div>;
}

export function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">{description}</p></div><div className="heading-actions">{children}</div></div>;
}

export function Modal({ title, onClose, children, busy = false, wide = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className={`modal${wide ? ' modal-wide' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className="modal-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭" onClick={onClose} disabled={busy}><X /></button></div>{children}</dialog>;
}
