import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { zipSync } from 'fflate';
import { CalendarClock, Download, FileUp, Funnel, PenLine, Plus, Tag, Trash, Forward } from 'lucide-react';
import { del, get, patch, post, put, api, errorText } from '../../lib/api';
import { useAction, useInvalidate } from '../../lib/hooks';
import { cleanSignature } from '../../lib/sanitize';
import { cn, downloadBlob } from '../../lib/utils';
import { LABEL_COLORS } from '../../../shared/constants';
import type { Label, Mailbox } from '../../lib/types';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '../../components/ui/form';
import { Alert, Card, CardHeader, EmptyState, PageHeader, PageSpinner } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/overlay';
import { labelChip, labelDot } from '../mail/labels';
import { useT } from '../../lib/i18n';

interface BoxSettings {
  signature: string;
  autoReply: { enabled: boolean; subject: string; body: string; startAt?: number | null; endAt?: number | null } | null;
  forwardTo: string[];
  displayName: string;
  destinations: { address: string; verified: boolean }[];
}

interface Filter {
  id: number;
  name: string;
  conditions: { match?: 'all' | 'any'; from?: string; to?: string; subject?: string; body?: string; hasAttachment?: boolean; isList?: boolean };
  actions: { labelIds?: number[]; folder?: 'inbox' | 'archive' | 'spam' | 'trash'; markRead?: boolean; star?: boolean; forwardTo?: string; neverSpam?: boolean };
  enabled: boolean;
}

export type MailSection = 'signature' | 'auto-reply' | 'forwarding' | 'labels' | 'filters' | 'import-export';

export const MAIL_SECTIONS: { id: MailSection; label: string; description: string }[] = [
  { id: 'signature', label: 'mailbox.signature', description: 'mailbox.signatureDesc' },
  { id: 'auto-reply', label: 'mailbox.autoReply', description: 'mailbox.autoReplyDesc' },
  { id: 'forwarding', label: 'mailbox.forwarding', description: 'mailbox.forwardingDesc' },
  { id: 'labels', label: 'mailbox.labels', description: 'mailbox.labelsDesc' },
  { id: 'filters', label: 'mailbox.filters', description: 'mailbox.filtersDesc' },
  { id: 'import-export', label: 'mailbox.importExport', description: 'mailbox.importExportDesc' },
];

// One mail section for one inbox. The inbox comes from ?inbox= so the choice survives switching
// sections.
export function MailboxSettings({ section }: { section: MailSection }) {
  const t = useT();
  const boxes = useQuery({ queryKey: ['mailboxes'], queryFn: () => get<Mailbox[]>('/mailboxes') });
  const [params, setParams] = useSearchParams();
  const meta = MAIL_SECTIONS.find((s) => s.id === section)!;
  if (boxes.isLoading) return <PageSpinner />;
  if (!boxes.data?.length) return <EmptyState title={t('mailbox.noInboxes')}>{t('mailbox.noInboxesBody')}</EmptyState>;
  const box = boxes.data.find((b) => b.id === Number(params.get('inbox'))) ?? boxes.data[0];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t(meta.label)}
        description={t(meta.description)}
        actions={
          boxes.data.length > 1 && (
            <Select value={box.id} onChange={(e) => setParams({ inbox: e.target.value }, { replace: true })} className="min-w-64" aria-label={t('mailbox.inbox')}>
              {boxes.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.address}
                </option>
              ))}
            </Select>
          )
        }
      />
      {section === 'signature' && <Signature box={box} key={box.id} />}
      {section === 'auto-reply' && <AutoReply box={box} key={box.id} />}
      {section === 'forwarding' && <Forwarding box={box} key={box.id} />}
      {section === 'labels' && <Labels box={box} key={box.id} />}
      {section === 'filters' && <Filters box={box} key={box.id} />}
      {section === 'import-export' && <ImportExport box={box} key={box.id} />}
    </div>
  );
}

function useBoxSettings(box: Mailbox) {
  const q = useQuery({ queryKey: ['box-settings', box.id], queryFn: () => get<BoxSettings>(`/mailboxes/${box.id}/settings`) });
  const [s, setS] = useState<BoxSettings | null>(null);
  const { run, busy } = useAction();
  const invalidate = useInvalidate();
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  const save = (key: string, body: Partial<BoxSettings>, msg: string) =>
    run(key, () => patch(`/mailboxes/${box.id}/settings`, body).then(() => invalidate(['box-settings', box.id], ['mailboxes'])), msg);
  return { s, setS, save, busy };
}

function Signature({ box }: { box: Mailbox }) {
  const t = useT();
  const { s, setS, save, busy } = useBoxSettings(box);
  if (!s) return <PageSpinner />;
  return (
    <Card>
      <CardHeader icon={<PenLine className="h-5 w-5" />} title={t('mailbox.nameAndSignature')} description={box.canSend ? undefined : t('mailbox.readOnly')} />
      <div className="space-y-4 p-5">
        <Field label={t('mailbox.senderName')}>
          <Input value={s.displayName} onChange={(e) => setS({ ...s, displayName: e.target.value })} disabled={!box.canSend} />
        </Field>
        <Field label={t('mailbox.signatureField')} hint={t('mailbox.signatureHint')}>
          <Textarea value={s.signature} onChange={(e) => setS({ ...s, signature: e.target.value })} rows={4} className="font-mono text-[13px]" disabled={!box.canSend} />
        </Field>
        {s.signature && (
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium">{t('mailbox.preview')}</div>
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-[13px]" dangerouslySetInnerHTML={{ __html: cleanSignature(s.signature) }} />
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="primary" disabled={!box.canSend} loading={busy === 'sig'} onClick={() => save('sig', { displayName: s.displayName, signature: cleanSignature(s.signature) }, t('common.saved'))}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AutoReply({ box }: { box: Mailbox }) {
  const t = useT();
  const { s, setS, save, busy } = useBoxSettings(box);
  if (!s) return <PageSpinner />;
  const reply = s.autoReply ?? { enabled: false, subject: '', body: '' };
  const toLocal = (ms?: number | null) => (ms ? new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
  return (
    <Card>
      <CardHeader
        icon={<CalendarClock className="h-5 w-5" />}
        title={t('mailbox.sendAutoReply')}
        description={reply.enabled ? t('mailbox.onSaveApply') : t('mailbox.off')}
        action={<Switch checked={reply.enabled} onChange={(v) => setS({ ...s, autoReply: { ...reply, enabled: v } })} disabled={!box.canSend} label={t('mailbox.autoReplyLabel')} />}
      />
      <div className="space-y-4 p-5">
        <Field label={t('mailbox.subject')} hint={t('mailbox.subjectHint')}>
          <Input value={reply.subject} onChange={(e) => setS({ ...s, autoReply: { ...reply, subject: e.target.value } })} />
        </Field>
        <Field label={t('mailbox.message')}>
          <Textarea value={reply.body} onChange={(e) => setS({ ...s, autoReply: { ...reply, body: e.target.value } })} rows={4} placeholder={t('mailbox.messagePlaceholder')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('mailbox.startOptional')}>
            <Input type="datetime-local" value={toLocal(reply.startAt)} onChange={(e) => setS({ ...s, autoReply: { ...reply, startAt: e.target.value ? new Date(e.target.value).getTime() : null } })} />
          </Field>
          <Field label={t('mailbox.endOptional')}>
            <Input type="datetime-local" value={toLocal(reply.endAt)} onChange={(e) => setS({ ...s, autoReply: { ...reply, endAt: e.target.value ? new Date(e.target.value).getTime() : null } })} />
          </Field>
        </div>
        <p className="text-xs text-muted">{t('mailbox.autoReplyNote')}</p>
        <div className="flex justify-end">
          <Button variant="primary" disabled={!box.canSend} loading={busy === 'auto'} onClick={() => save('auto', { autoReply: { ...reply, body: reply.body } }, reply.enabled ? t('mailbox.autoReplyOn') : t('common.saved'))}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Forwarding({ box }: { box: Mailbox }) {
  const t = useT();
  const { s, setS, save, busy } = useBoxSettings(box);
  if (!s) return <PageSpinner />;
  return (
    <Card>
      <CardHeader icon={<Forward className="h-5 w-5" />} title={t('mailbox.forwardTo')} />
      <div className="space-y-3 p-5">
        {s.destinations.length === 0 ? (
          <Alert tone="neutral">{t('mailbox.noForwarding')}</Alert>
        ) : (
          s.destinations.map((d) => (
            <Checkbox
              key={d.address}
              disabled={!d.verified}
              label={d.address}
              hint={d.verified ? undefined : t('mailbox.waitingVerify')}
              checked={s.forwardTo.includes(d.address)}
              onChange={(v) => setS({ ...s, forwardTo: v ? [...s.forwardTo, d.address] : s.forwardTo.filter((x) => x !== d.address) })}
            />
          ))
        )}
        {s.destinations.length > 0 && (
          <div className="flex justify-end">
            <Button variant="primary" disabled={!box.canSend} loading={busy === 'fwd'} onClick={() => save('fwd', { forwardTo: s.forwardTo }, t('mailbox.forwardingSaved'))}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Labels({ box }: { box: Mailbox }) {
  const t = useT();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('blue');
  const [editing, setEditing] = useState<Label | null>(null);
  const { run } = useAction();
  const invalidate = useInvalidate();
  const refresh = () => invalidate(['mailboxes'], ['threads']);
  return (
    <Card>
      <CardHeader icon={<Tag className="h-5 w-5" />} title={t('mailbox.yourLabels')} description={t('mailbox.labelsHint')} />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          {box.labels.length === 0 && <span className="text-[13px] text-muted">{t('mailbox.noLabels')}</span>}
          {box.labels.map((l) => (
            <button key={l.id} type="button" onClick={() => setEditing(l)} className="label-chip rounded-md px-2.5 py-1 text-xs font-medium" style={labelChip(l.color)}>
              {l.name}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run('add', () => post(`/mailboxes/${box.id}/labels`, { name, color }).then(() => { setName(''); refresh(); }), t('mailbox.labelCreated'));
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mailbox.newLabel')} required className="max-w-56" />
          <ColorPicker value={color} onChange={setColor} />
          <Button type="submit" icon={<Plus className="h-4 w-4" />}>
            {t('common.add')}
          </Button>
        </form>
      </div>
      {editing && (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={t('mailbox.editLabel')}
          size="sm"
          footer={
            <>
              <Button variant="ghost" icon={<Trash className="h-4 w-4" />} onClick={() => run('del', () => del(`/labels/${editing.id}`).then(() => { setEditing(null); refresh(); }), t('mailbox.labelDeleted'))}>
                {t('common.delete')}
              </Button>
              <Button variant="primary" onClick={() => run('save', () => patch(`/labels/${editing.id}`, { name: editing.name, color: editing.color }).then(() => { setEditing(null); refresh(); }), t('common.saved'))}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
          </div>
        </Dialog>
      )}
    </Card>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {LABEL_COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} className={cn('h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-surface', value === c ? 'ring-fg' : 'ring-transparent')} style={labelDot(c)} />
      ))}
    </div>
  );
}

function Filters({ box }: { box: Mailbox }) {
  const t = useT();
  const q = useQuery({ queryKey: ['filters', box.id], queryFn: () => get<Filter[]>(`/mailboxes/${box.id}/filters`) });
  const [editing, setEditing] = useState<Partial<Filter> | null>(null);
  const { run } = useAction();
  const describe = (f: Filter) => {
    const c = f.conditions;
    const conds = [c.from && t('mailbox.descFrom', { v: c.from }), c.to && t('mailbox.descTo', { v: c.to }), c.subject && t('mailbox.descSubject', { v: c.subject }), c.body && t('mailbox.descBody', { v: c.body }), c.hasAttachment && t('mailbox.descHasAttachment'), c.isList && t('mailbox.descIsList')]
      .filter(Boolean)
      .join(c.match === 'any' ? ` ${t('common.or')} ` : ` ${t('common.and')} `);
    const a = f.actions;
    const folderName = (folder: string) => (folder === 'inbox' ? t('palette.inbox') : folder === 'archive' ? t('palette.archive') : folder === 'spam' ? t('palette.spam') : t('palette.trash'));
    const acts = [
      a.labelIds?.length && t('mailbox.descLabel', { names: a.labelIds.map((id) => box.labels.find((l) => l.id === id)?.name).filter(Boolean).join(', ') }),
      a.folder && t('mailbox.descMove', { folder: folderName(a.folder) }),
      a.markRead && t('mailbox.descMarkRead'),
      a.star && t('mailbox.descStar'),
      a.neverSpam && t('mailbox.descNeverSpam'),
      a.forwardTo && t('mailbox.descForward', { addr: a.forwardTo }),
    ]
      .filter(Boolean)
      .join(', ');
    return t('mailbox.descIf', { conds: conds || '…', acts: acts || '…' });
  };
  return (
    <Card>
      <CardHeader icon={<Funnel className="h-5 w-5" />} title={t('mailbox.rules')} action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ conditions: { match: 'all' }, actions: {}, enabled: true, name: '' })}>{t('mailbox.newFilter')}</Button>} />
      <div className="divide-y divide-border">
        {q.data?.length === 0 && <div className="px-5 py-4 text-[13px] text-muted">{t('mailbox.noFilters')}</div>}
        {q.data?.map((f) => (
          <div key={f.id} className="flex items-center gap-3 px-5 py-3">
            <Switch checked={f.enabled} onChange={(v) => run('t', () => put(`/filters/${f.id}`, { ...f, enabled: v }).then(() => q.refetch()))} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{f.name || t('mailbox.unnamedFilter')}</div>
              <div className="truncate text-xs text-muted">{describe(f)}</div>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setEditing(f)}>
              {t('common.edit')}
            </Button>
            <Button size="xs" variant="ghost" icon={<Trash className="h-3.5 w-3.5" />} onClick={() => run('d', () => del(`/filters/${f.id}`).then(() => q.refetch()))} />
          </div>
        ))}
      </div>
      {editing && <FilterDialog box={box} filter={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.refetch(); }} />}
    </Card>
  );
}

function FilterDialog({ box, filter, onClose, onSaved }: { box: Mailbox; filter: Partial<Filter>; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState<Partial<Filter>>(filter);
  const { run, busy } = useAction();
  const c = f.conditions ?? {};
  const a = f.actions ?? {};
  const setC = (patch: Partial<Filter['conditions']>) => setF({ ...f, conditions: { ...c, ...patch } });
  const setA = (patch: Partial<Filter['actions']>) => setF({ ...f, actions: { ...a, ...patch } });
  const save = () => run('save', () => (f.id ? put(`/filters/${f.id}`, f) : post(`/mailboxes/${box.id}/filters`, f)).then(onSaved), t('mailbox.filterSaved'));
  return (
    <Dialog open onClose={onClose} title={f.id ? t('mailbox.editFilter') : t('mailbox.newFilter')} size="lg" footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={!!busy} onClick={save}>{t('mailbox.saveFilter')}</Button></>}>
      <div className="space-y-5">
        <Field label={t('mailbox.filterName')}>
          <Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('mailbox.filterNamePlaceholder')} />
        </Field>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {t('mailbox.whenMatches')}
            <Select value={c.match ?? 'all'} onChange={(e) => setC({ match: e.target.value as 'all' | 'any' })} className="h-8 w-auto">
              <option value="all">{t('mailbox.matchAll')}</option>
              <option value="any">{t('mailbox.matchAny')}</option>
            </Select>
            {t('mailbox.ofThese')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('mailbox.fromContains')}><Input value={c.from ?? ''} onChange={(e) => setC({ from: e.target.value || undefined })} /></Field>
            <Field label={t('mailbox.toContains')}><Input value={c.to ?? ''} onChange={(e) => setC({ to: e.target.value || undefined })} /></Field>
            <Field label={t('mailbox.subjectContains')}><Input value={c.subject ?? ''} onChange={(e) => setC({ subject: e.target.value || undefined })} /></Field>
            <Field label={t('mailbox.bodyContains')}><Input value={c.body ?? ''} onChange={(e) => setC({ body: e.target.value || undefined })} /></Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <Checkbox label={t('mailbox.hasAttachments')} checked={!!c.hasAttachment} onChange={(v) => setC({ hasAttachment: v || undefined })} />
            <Checkbox label={t('mailbox.fromMailingList')} checked={!!c.isList} onChange={(v) => setC({ isList: v || undefined })} />
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="text-[13px] font-medium">{t('mailbox.doThis')}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('mailbox.moveTo')}>
              <Select value={a.folder ?? ''} onChange={(e) => setA({ folder: (e.target.value || undefined) as Filter['actions']['folder'] })}>
                <option value="">{t('mailbox.keepInInbox')}</option>
                <option value="archive">{t('mailbox.archiveSkip')}</option>
                <option value="spam">{t('mailbox.spam')}</option>
                <option value="trash">{t('mailbox.trash')}</option>
              </Select>
            </Field>
            <Field label={t('mailbox.applyLabel')}>
              <Select value={a.labelIds?.[0] ?? ''} onChange={(e) => setA({ labelIds: e.target.value ? [Number(e.target.value)] : undefined })}>
                <option value="">{t('common.none')}</option>
                {box.labels.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <Checkbox label={t('mailbox.markAsRead')} checked={!!a.markRead} onChange={(v) => setA({ markRead: v || undefined })} />
            <Checkbox label={t('mailbox.starIt')} checked={!!a.star} onChange={(v) => setA({ star: v || undefined })} />
            <Checkbox label={t('mailbox.neverSpam')} checked={!!a.neverSpam} onChange={(v) => setA({ neverSpam: v || undefined })} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function ImportExport({ box }: { box: Mailbox }) {
  const t = useT();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const invalidate = useInvalidate();

  const importFiles = async (files: FileList) => {
    setError('');
    let done = 0;
    let dupes = 0;
    for (const file of Array.from(files)) {
      setProgress(t('mailbox.importing', { n: done + 1, total: files.length }));
      try {
        const r = await api<{ status: string }>(`/mailboxes/${box.id}/import`, { raw: file, headers: { 'Content-Type': 'message/rfc822' } });
        if (r.status === 'duplicate') dupes++;
      } catch (e) {
        setError(`${file.name}: ${errorText(e)}`);
      }
      done++;
    }
    setProgress(t('mailbox.imported', { n: done - dupes, s: done - dupes === 1 ? '' : 's' }) + (dupes ? t('mailbox.importedDupes', { dupes }) : ''));
    invalidate(['threads'], ['mailboxes']);
  };

  const exportAll = async () => {
    setError('');
    const files: Record<string, Uint8Array> = {};
    let after = 0;
    let count = 0;
    try {
      for (;;) {
        const page = await get<{ messages: { id: number; subject: string; sent_at: number }[]; next: number | null }>(`/mailboxes/${box.id}/export?after=${after}`);
        for (const m of page.messages) {
          setProgress(t('mailbox.downloading', { n: ++count }));
          const res = await fetch(`/api/messages/${m.id}/raw`, { credentials: 'same-origin' });
          if (!res.ok) continue;
          const date = new Date(m.sent_at).toISOString().slice(0, 10);
          const name = `${date}-${m.id}-${(m.subject || 'message').replace(/[^\w -]+/g, '').trim().slice(0, 50)}.eml`;
          files[name] = new Uint8Array(await res.arrayBuffer());
        }
        if (!page.next) break;
        after = page.next;
      }
      setProgress(t('mailbox.creatingZip'));
      const zip = zipSync(files, { level: 6 });
      downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${box.address}-${new Date().toISOString().slice(0, 10)}.zip`);
      setProgress(t('mailbox.exported', { n: count }));
    } catch (e) {
      setError(errorText(e));
      setProgress(null);
    }
  };

  return (
    <Card>
      <CardHeader icon={<Download className="h-5 w-5" />} title={t('mailbox.emlFiles')} description={t('mailbox.emlDesc')} />
      <div className="space-y-4 p-5">
        {error && <Alert tone="danger">{error}</Alert>}
        {progress && <Alert tone="neutral">{progress}</Alert>}
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-sm font-medium hover:bg-surface-3">
            <FileUp className="h-4 w-4" /> {t('mailbox.importEml')}
            <input type="file" accept=".eml,message/rfc822" multiple hidden onChange={(e) => e.target.files && importFiles(e.target.files)} />
          </label>
          <Button icon={<Download className="h-4 w-4" />} onClick={exportAll}>
            {t('mailbox.exportZip')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('mailbox.exportNote')}</p>
      </div>
    </Card>
  );
}
