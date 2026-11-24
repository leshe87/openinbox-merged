import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Fingerprint,
  MailSearch,
  Newspaper,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { del, get, patch, post, put } from '../../lib/api';
import { useIsAdmin, useSession } from '../../lib/session';
import { useAction, useDebounced, useInvalidate } from '../../lib/hooks';
import { fullDate, timeAgo } from '../../lib/format';
import { AI_CATEGORIES, AI_PLATFORM_CATEGORIES } from '../../../shared/constants';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput, Select, Switch, Textarea } from '../../components/ui/form';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, PageSpinner, StatusPill } from '../../components/ui/misc';
import { ConfirmDialog, Dialog } from '../../components/ui/overlay';

// AI section: digital identities, mail analysis, daily digests, security center,
// assistant chat and (admin-only) AI settings. Data comes from /api/ai/*.

export interface AiStatus {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  workersAiBound: boolean;
}

export interface AiSettings {
  aiEnabled: 'off' | 'on';
  aiProvider: 'workers' | 'deepseek' | 'custom';
  aiModel: string;
  aiBaseUrl: string;
  hasApiKey: boolean;
}

export interface AnalysisItem {
  id: number;
  mailbox_id: number;
  message_id: number;
  category: string;
  summary: string;
  key_info: Record<string, unknown>;
  platform_name: string;
  platform_domain: string;
  platform_category: string;
  identity_id: number | null;
  is_new_identity: number;
  confidence: number;
  created_at: number;
  subject: string;
  from_addr: string;
  delivered_to: string | null;
}

export interface Identity {
  id: number;
  name: string;
  platform_name: string;
  platform_domain: string;
  category: string;
  status: number;
  identity_email: string;
  purpose: string;
  remark: string;
  last_active_at: number | null;
  created_at: number;
}

export interface Digest {
  id: number;
  digest_date: string;
  content: string;
  important_count: number;
  email_ids: string;
  created_at: number;
}

export interface SecurityEvent {
  id: number;
  type: string;
  risk_level: number;
  title: string;
  description: string;
  suggestion: string;
  status: number;
  created_at: number;
  subject: string;
  from_addr: string;
}

export interface SecurityStats {
  total: number;
  unprocessed: number;
  highRisk: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  register: 'ai.category.register',
  verify: 'ai.category.verify',
  security: 'ai.category.security',
  bill: 'ai.category.bill',
  update: 'ai.category.update',
  marketing: 'ai.category.marketing',
  social: 'ai.category.social',
};

const PLATFORM_CATEGORY_LABELS: Record<string, string> = {
  dev: 'ai.platformCategory.dev',
  ai: 'ai.platformCategory.ai',
  saas: 'ai.platformCategory.saas',
  social: 'ai.platformCategory.social',
  cloud: 'ai.platformCategory.cloud',
  web3: 'ai.platformCategory.web3',
  finance: 'ai.platformCategory.finance',
  shop: 'ai.platformCategory.shop',
  news: 'ai.platformCategory.news',
  other: 'ai.platformCategory.other',
};

const IDENTITY_STATUS = ['ai.identityStatus.active', 'ai.identityStatus.disabled', 'ai.identityStatus.longUnused'] as const;
const SECURITY_TYPE_LABELS: Record<string, string> = {
  password_change: 'ai.securityType.passwordChange',
  abnormal_login: 'ai.securityType.abnormalLogin',
  data_breach: 'ai.securityType.dataBreach',
};
const SECURITY_STATUS_LABELS = ['ai.securityStatus.unprocessed', 'ai.securityStatus.confirmed', 'ai.securityStatus.ignored', 'ai.securityStatus.resolved'] as const;

function categoryLabel(v: string, t: (key: string) => string): string {
  const key = CATEGORY_LABELS[v];
  return key ? t(key) : v;
}

function platformCategoryLabel(v: string, t: (key: string) => string): string {
  const key = PLATFORM_CATEGORY_LABELS[v];
  return key ? t(key) : v;
}

function riskTone(level: number): 'danger' | 'warning' | 'neutral' {
  return level === 2 ? 'danger' : level === 1 ? 'warning' : 'neutral';
}

function riskLabel(level: number, t: (key: string) => string): string {
  return level === 2 ? t('ai.risk.high') : level === 1 ? t('ai.risk.medium') : t('ai.risk.low');
}

function useAiStatus() {
  return useQuery({ queryKey: ['ai', 'status'], queryFn: () => get<AiStatus>('/ai/status'), staleTime: 60_000 });
}

const row = 'flex items-start gap-3 border-b border-border px-5 py-3.5 text-[13px] last:border-b-0';

// --- Layout -----------------------------------------------------------------------------------

const items = [
  { to: '/ai/identities', label: 'ai.nav.identities', Icon: Fingerprint },
  { to: '/ai/analysis', label: 'ai.nav.analysis', Icon: MailSearch },
  { to: '/ai/digests', label: 'ai.nav.digests', Icon: Newspaper },
  { to: '/ai/security', label: 'ai.nav.security', Icon: ShieldAlert },
  { to: '/ai/assistant', label: 'ai.nav.assistant', Icon: Bot },
  { to: '/ai/settings', label: 'ai.nav.settings', Icon: Settings, admin: true },
];

function AiLayout() {
  const t = useT();
  const { data: session } = useSession();
  const isAdmin = useIsAdmin();
  const status = useAiStatus();
  const s = status.data;
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-bg md:w-[232px] md:border-r md:border-b-0">
        <nav className="scroll-thin flex gap-px overflow-x-auto p-2 md:flex-col md:px-2.5 md:py-3.5">
          <div className="hidden h-[26px] items-center gap-2 px-2.5 text-[11.5px] font-medium text-faint md:flex">
            <Sparkles className="h-3.5 w-3.5" />
            AI
          </div>
          {items
            .filter((i) => !i.admin || isAdmin)
            .map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex h-8 shrink-0 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors',
                    isActive ? 'bg-primary-soft font-semibold text-primary-text [&>svg]:text-primary-text' : 'text-muted hover:bg-surface-2 hover:text-fg [&>svg]:text-faint',
                  )
                }
              >
                <Icon className="h-[15px] w-[15px]" />
                <span className="flex-1">{t(label)}</span>
              </NavLink>
            ))}
        </nav>
        <div className="mx-2.5 mt-auto mb-3.5 hidden flex-col gap-0.5 rounded-[10px] border border-border bg-surface p-2.5 text-xs text-muted md:flex">
          {s ? (
            <>
              <span className="flex items-center gap-1.5 font-medium text-fg">
                <span className={cn('h-[7px] w-[7px] rounded-full', s.enabled ? 'bg-success' : 'bg-faint')} />
                {s.enabled ? t('ai.status.on', { provider: s.provider }) : t('ai.status.off')}
              </span>
              <span className="truncate">
                {s.model} {s.hasApiKey ? t('ai.status.apiKeySet') : t('ai.status.noApiKey')}
                {s.provider === 'workers' && (s.workersAiBound ? t('ai.status.workersBound') : t('ai.status.workersNotBound'))}
              </span>
            </>
          ) : (
            <span>OpenInbox {session?.version}</span>
          )}
        </div>
      </aside>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-4 pt-6 pb-12 sm:px-8 lg:px-12 lg:pt-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default function AiRoutes() {
  return (
    <Routes>
      <Route element={<AiLayout />}>
        <Route index element={<Navigate to="/ai/identities" replace />} />
        <Route path="identities" element={<IdentitiesPage />} />
        <Route path="analysis" element={<AnalysisPage />} />
        <Route path="digests" element={<DigestsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="settings" element={<AiSettingsPage />} />
        <Route path="*" element={<Navigate to="/ai" replace />} />
      </Route>
    </Routes>
  );
}

// --- Identities -------------------------------------------------------------------------------

interface IdentityForm {
  name: string;
  platformName: string;
  platformDomain: string;
  category: string;
  identityEmail: string;
  purpose: string;
  remark: string;
  status: number;
}

const emptyIdentityForm: IdentityForm = { name: '', platformName: '', platformDomain: '', category: 'other', identityEmail: '', purpose: '', remark: '', status: 0 };

function identityFormBody(f: IdentityForm) {
  return {
    name: f.name,
    platformName: f.platformName,
    platformDomain: f.platformDomain,
    category: f.category,
    identityEmail: f.identityEmail,
    purpose: f.purpose,
    remark: f.remark,
  };
}

export function IdentitiesPage() {
  const t = useT();
  const [category, setCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q);
  const [editing, setEditing] = useState<{ id: number | null; form: IdentityForm } | null>(null);
  const [deleting, setDeleting] = useState<Identity | null>(null);
  const { run, busy } = useAction();
  const invalidate = useInvalidate();

  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (statusFilter) params.set('status', statusFilter);
  if (debouncedQ) params.set('q', debouncedQ);
  const query = params.toString();
  const list = useQuery({ queryKey: ['ai', 'identities', category, statusFilter, debouncedQ], queryFn: () => get<Identity[]>(`/ai/identities${query ? `?${query}` : ''}`) });
  const stats = useQuery({ queryKey: ['ai', 'identities', 'stats'], queryFn: () => get<{ category: string; total: number }[]>('/ai/identities/stats') });

  const refresh = () => invalidate(['ai', 'identities']);
  const save = () => {
    if (!editing) return;
    const { id, form } = editing;
    run(
      'save',
      async () => {
        if (id === null) await post('/ai/identities', identityFormBody(form));
        else await put(`/ai/identities/${id}`, { ...identityFormBody(form), status: form.status });
        setEditing(null);
        await refresh();
      },
      id === null ? t('ai.identities.addedToast') : t('ai.identities.savedToast'),
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('ai.identities.title')}
        description={t('ai.identities.description')}
        actions={
          <Button variant="primary" icon={<Plus className="h-[15px] w-[15px]" />} onClick={() => setEditing({ id: null, form: emptyIdentityForm })}>
            {t('ai.identities.add')}
          </Button>
        }
      />
      {stats.data && stats.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.data.map((s) => (
            <button key={s.category} type="button" onClick={() => setCategory(category === s.category ? '' : s.category)} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', category === s.category ? 'border-primary bg-primary-soft text-primary-text' : 'border-border bg-surface text-muted hover:text-fg')}>
              {platformCategoryLabel(s.category, t)} · {s.total}
            </button>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3.5">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ai.identities.searchPlaceholder')} className="max-w-xs" aria-label={t('ai.identities.searchAria')} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label={t('ai.filterByCategory')}>
            <option value="">{t('ai.filter.allCategories')}</option>
            {AI_PLATFORM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {platformCategoryLabel(c, t)}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto" aria-label={t('ai.filterByStatus')}>
            <option value="">{t('ai.filter.allStatuses')}</option>
            {IDENTITY_STATUS.map((label, i) => (
              <option key={label} value={i}>
                {t(label)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <PageSpinner />
        ) : !list.data?.length ? (
          <EmptyState icon={<Fingerprint />} title={t('ai.identities.emptyTitle')}>
            {t('ai.identities.emptyBody')}
          </EmptyState>
        ) : (
          list.data.map((d) => (
            <div key={d.id} className={row}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{d.name}</span>
                  <Badge tone="primary">{platformCategoryLabel(d.category, t)}</Badge>
                  <StatusPill tone={d.status === 0 ? 'success' : d.status === 1 ? 'neutral' : 'warning'}>{IDENTITY_STATUS[d.status] ? t(IDENTITY_STATUS[d.status]) : d.status}</StatusPill>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {d.platform_name || t('ai.identities.unknownPlatform')}
                  {d.platform_domain ? ` · ${d.platform_domain}` : ''}
                  {d.identity_email ? ` · ${d.identity_email}` : ''}
                </div>
                {d.purpose && <div className="mt-1 text-[12.5px] text-muted text-pretty">{d.purpose}</div>}
                {d.remark && <div className="mt-0.5 text-xs text-faint text-pretty">{d.remark}</div>}
                <div className="mt-1 text-xs text-faint">
                  {t('ai.identities.lastActive', { time: d.last_active_at ? timeAgo(d.last_active_at) : t('ai.identities.never'), added: timeAgo(d.created_at) })}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="xs"
                  onClick={() =>
                    run('status', () => put(`/ai/identities/${d.id}`, { status: d.status === 0 ? 1 : 0 }).then(() => refresh()), d.status === 0 ? t('ai.identities.disabledToast') : t('ai.identities.enabledToast'))
                  }
                >
                  {d.status === 0 ? t('ai.disable') : t('ai.enable')}
                </Button>
                <Button
                  size="xs"
                  onClick={() =>
                    setEditing({
                      id: d.id,
                      form: { name: d.name, platformName: d.platform_name, platformDomain: d.platform_domain, category: d.category, identityEmail: d.identity_email, purpose: d.purpose, remark: d.remark, status: d.status },
                    })
                  }
                >
                  {t('ai.edit')}
                </Button>
                <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleting(d)}>
                  {t('ai.delete')}
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>

      {editing && (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={editing.id === null ? t('ai.identities.add') : t('ai.identities.editTitle')}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>{t('ai.cancel')}</Button>
              <Button variant="primary" loading={busy === 'save'} onClick={save} disabled={!editing.form.name.trim()}>
                {editing.id === null ? t('ai.identities.add') : t('ai.saveChanges')}
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Field label={t('ai.field.name')}>
              <Input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} placeholder="GitHub" autoFocus />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('ai.field.platform')}>
                <Input value={editing.form.platformName} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, platformName: e.target.value } })} placeholder="GitHub" />
              </Field>
              <Field label={t('ai.field.platformDomain')}>
                <Input value={editing.form.platformDomain} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, platformDomain: e.target.value } })} placeholder="github.com" />
              </Field>
              <Field label={t('ai.field.category')}>
                <Select value={editing.form.category} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, category: e.target.value } })}>
                  {AI_PLATFORM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {platformCategoryLabel(c, t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ai.field.identityEmail')}>
                <Input type="email" value={editing.form.identityEmail} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, identityEmail: e.target.value } })} placeholder="me@example.com" />
              </Field>
            </div>
            <Field label={t('ai.field.purpose')}>
              <Input value={editing.form.purpose} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, purpose: e.target.value } })} placeholder={t('ai.field.purposePlaceholder')} />
            </Field>
            <Field label={t('ai.field.remark')}>
              <Textarea value={editing.form.remark} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, remark: e.target.value } })} placeholder={t('ai.field.remarkPlaceholder')} />
            </Field>
            {editing.id !== null && (
              <Field label={t('ai.field.status')}>
                <Select value={editing.form.status} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, status: Number(e.target.value) } })}>
                  {IDENTITY_STATUS.map((label, i) => (
                    <option key={label} value={i}>
                      {t(label)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Dialog>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('ai.identities.deleteTitle')}
        confirmLabel={t('ai.delete')}
        danger
        loading={busy === 'delete'}
        onConfirm={() => {
          if (!deleting) return;
          run('delete', () => del(`/ai/identities/${deleting.id}`).then(() => refresh()), t('ai.identities.deletedToast')).then(() => setDeleting(null));
        }}
      >
        {deleting ? t('ai.identities.deleteBody', { name: deleting.name }) : ''}
      </ConfirmDialog>
    </div>
  );
}

// --- Analysis ----------------------------------------------------------------------------------

export function AnalysisPage() {
  const t = useT();
  const [category, setCategory] = useState('');
  const [confirming, setConfirming] = useState<AnalysisItem | null>(null);
  const [confirmForm, setConfirmForm] = useState({ name: '', category: 'other', purpose: '', remark: '' });
  const { run, busy } = useAction();
  const invalidate = useInvalidate();

  const list = useQuery({ queryKey: ['ai', 'analysis', category], queryFn: () => get<AnalysisItem[]>(`/ai/analysis?${new URLSearchParams({ ...(category ? { category } : {}), limit: '20' }).toString()}`) });
  const stats = useQuery({ queryKey: ['ai', 'analysis', 'stats'], queryFn: () => get<{ category: string; total: number }[]>('/ai/analysis/stats') });
  const newOnes = useQuery({ queryKey: ['ai', 'analysis', 'new'], queryFn: () => get<AnalysisItem[]>('/ai/analysis/new') });

  const openConfirm = (a: AnalysisItem) => {
    setConfirming(a);
    setConfirmForm({ name: a.platform_name || a.subject, category: AI_PLATFORM_CATEGORIES.includes(a.platform_category as (typeof AI_PLATFORM_CATEGORIES)[number]) ? a.platform_category : 'other', purpose: '', remark: '' });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('ai.analysis.title')}
        description={t('ai.analysis.description')}
        actions={
          <Button
            variant="primary"
            icon={<RefreshCw className="h-[15px] w-[15px]" />}
            loading={busy === 'batch'}
            onClick={() =>
              run(
                'batch',
                async () => {
                  const r = await post<{ analyzed: number }>('/ai/analysis/batch');
                  await invalidate(['ai', 'analysis']);
                  return r;
                },
                t('ai.analysis.batchFinishedToast'),
              )
            }
          >
            {t('ai.analysis.batchAnalyze')}
          </Button>
        }
      />
      {stats.data && stats.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.data.map((s) => (
            <button key={s.category} type="button" onClick={() => setCategory(category === s.category ? '' : s.category)} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', category === s.category ? 'border-primary bg-primary-soft text-primary-text' : 'border-border bg-surface text-muted hover:text-fg')}>
              {categoryLabel(s.category, t)} · {s.total}
            </button>
          ))}
        </div>
      )}

      {newOnes.data && newOnes.data.length > 0 && (
        <Card>
          <CardHeader icon={<Fingerprint />} title={t('ai.analysis.newIdentitiesTitle')} description={t('ai.analysis.newIdentitiesDesc')} />
          {newOnes.data.map((a) => (
            <div key={a.id} className={row}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{a.platform_name || a.subject}</span>
                  {a.platform_domain && <span className="text-xs text-muted">{a.platform_domain}</span>}
                  <Badge tone="primary">{platformCategoryLabel(a.platform_category, t)}</Badge>
                  <Badge tone="neutral">{t('ai.analysis.percentSure', { percent: Math.round(a.confidence * 100) })}</Badge>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {a.from_addr} · {a.subject}
                </div>
                {a.summary && <div className="mt-1 text-[12.5px] text-muted text-pretty">{a.summary}</div>}
              </div>
              <Button size="xs" variant="primary" onClick={() => openConfirm(a)}>
                {t('ai.confirm')}
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3.5">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label={t('ai.filterByCategory')}>
            <option value="">{t('ai.filter.allCategories')}</option>
            {AI_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c, t)}
              </option>
            ))}
          </Select>
          <Button size="xs" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => list.refetch()}>
            {t('ai.refresh')}
          </Button>
        </div>
        {list.isLoading ? (
          <PageSpinner />
        ) : !list.data?.length ? (
          <EmptyState icon={<MailSearch />} title={t('ai.analysis.emptyTitle')}>
            {t('ai.analysis.emptyBody')}
          </EmptyState>
        ) : (
          list.data.map((a) => <AnalysisRow key={a.id} a={a} />)
        )}
      </Card>

      {confirming && (
        <Dialog
          open
          onClose={() => setConfirming(null)}
          title={t('ai.analysis.confirmTitle')}
          description={`${confirming.platform_name || confirming.subject}${confirming.platform_domain ? ` · ${confirming.platform_domain}` : ''}`}
          footer={
            <>
              <Button onClick={() => setConfirming(null)}>{t('ai.cancel')}</Button>
              <Button
                variant="primary"
                loading={busy === 'confirm'}
                disabled={!confirmForm.name.trim()}
                onClick={() =>
                  run('confirm', () =>
                    post<{ identityId: number }>(`/ai/analysis/${confirming.id}/confirm`, confirmForm).then(async (r) => {
                      setConfirming(null);
                      await invalidate(['ai', 'analysis'], ['ai', 'identities']);
                      return r;
                    }),
                  )
                }
              >
                {t('ai.analysis.confirmIdentity')}
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Field label={t('ai.field.name')}>
              <Input value={confirmForm.name} onChange={(e) => setConfirmForm({ ...confirmForm, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t('ai.field.category')}>
              <Select value={confirmForm.category} onChange={(e) => setConfirmForm({ ...confirmForm, category: e.target.value })}>
                {AI_PLATFORM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {platformCategoryLabel(c, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('ai.field.purpose')}>
              <Input value={confirmForm.purpose} onChange={(e) => setConfirmForm({ ...confirmForm, purpose: e.target.value })} placeholder={t('ai.field.purposePlaceholder')} />
            </Field>
            <Field label={t('ai.field.remark')}>
              <Textarea value={confirmForm.remark} onChange={(e) => setConfirmForm({ ...confirmForm, remark: e.target.value })} placeholder={t('ai.field.remarkPlaceholder')} />
            </Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AnalysisRow({ a }: { a: AnalysisItem }) {
  const t = useT();
  const keyInfo = Object.entries(a.key_info ?? {}).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  return (
    <div className={row}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg">{a.subject || t('ai.analysis.noSubject')}</span>
          <Badge tone={a.category === 'security' ? 'danger' : 'primary'}>{categoryLabel(a.category, t)}</Badge>
          {a.is_new_identity === 1 && <Badge tone="warning">{t('ai.analysis.newIdentityBadge')}</Badge>}
          <span className="text-xs text-faint">{t('ai.analysis.percentSure', { percent: Math.round(a.confidence * 100) })}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {a.from_addr}
          {a.delivered_to ? ` → ${a.delivered_to}` : ''}
          {a.platform_name ? ` · ${a.platform_name}` : ''}
          {a.platform_domain ? ` (${a.platform_domain})` : ''}
        </div>
        {a.summary && <div className="mt-1 text-[12.5px] text-muted text-pretty">{a.summary}</div>}
        {keyInfo.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-faint">
            {keyInfo.map(([k, v]) => (
              <span key={k}>
                {k.replace(/_/g, ' ')}: <span className="text-muted">{String(v)}</span>
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 text-xs text-faint">{fullDate(a.created_at)}</div>
      </div>
    </div>
  );
}

// --- Digests -----------------------------------------------------------------------------------

export function DigestsPage() {
  const t = useT();
  const { run, busy } = useAction();
  const invalidate = useInvalidate();
  const list = useQuery({ queryKey: ['ai', 'digests'], queryFn: () => get<Digest[]>('/ai/digests?limit=20') });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('ai.digests.title')}
        description={t('ai.digests.description')}
        actions={
          <Button
            variant="primary"
            icon={<Newspaper className="h-[15px] w-[15px]" />}
            loading={busy === 'generate'}
            onClick={() =>
              run(
                'generate',
                async () => {
                  const r = await post<Digest | { generated: false }>(`/ai/digests/generate?date=${today}`);
                  await invalidate(['ai', 'digests']);
                  if ('generated' in r && r.generated === false) throw new Error(t('ai.digests.noDigestError'));
                  return r;
                },
                t('ai.digests.generatedToast'),
              )
            }
          >
            {t('ai.digests.generateToday')}
          </Button>
        }
      />
      {list.isLoading ? (
        <PageSpinner />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<Newspaper />} title={t('ai.digests.emptyTitle')}>
            {t('ai.digests.emptyBody')}
          </EmptyState>
        </Card>
      ) : (
        list.data.map((d) => (
          <Card key={d.id}>
            <CardHeader
              icon={<Newspaper />}
              title={d.digest_date}
              description={t('ai.digests.importantCount', { n: d.important_count, s: d.important_count === 1 ? '' : 's', time: timeAgo(d.created_at) })}
            />
            <div className="px-5 py-4 text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg/90">{d.content}</div>
          </Card>
        ))
      )}
    </div>
  );
}

// --- Security ----------------------------------------------------------------------------------

export function SecurityPage() {
  const t = useT();
  const [riskLevel, setRiskLevel] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { run, busy } = useAction();
  const invalidate = useInvalidate();

  const params = new URLSearchParams();
  if (riskLevel) params.set('riskLevel', riskLevel);
  if (statusFilter) params.set('status', statusFilter);
  params.set('limit', '20');
  const list = useQuery({ queryKey: ['ai', 'security', riskLevel, statusFilter], queryFn: () => get<SecurityEvent[]>(`/ai/security?${params.toString()}`) });
  const stats = useQuery({ queryKey: ['ai', 'security', 'stats'], queryFn: () => get<SecurityStats>('/ai/security/stats') });

  const setStatus = (id: number, status: number) =>
    run('status', () => put(`/ai/security/${id}/status`, { status }).then(() => invalidate(['ai', 'security'])), t('ai.security.statusUpdatedToast'));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('ai.security.title')} description={t('ai.security.description')} />
      {stats.data && (
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['ai.security.totalEvents', stats.data.total, 'neutral'],
              ['ai.security.unprocessed', stats.data.unprocessed, stats.data.unprocessed > 0 ? 'warning' : 'success'],
              ['ai.security.highRiskUnprocessed', stats.data.highRisk, stats.data.highRisk > 0 ? 'danger' : 'success'],
            ] as const
          ).map(([label, value, tone]) => (
            <Card key={label} className="px-4 py-3.5">
              <div className="text-[12.5px] text-muted">{t(label)}</div>
              <div className={cn('mt-1 text-2xl leading-tight font-semibold tabular-nums', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : '')}>{value}</div>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3.5">
          <Select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className="w-auto" aria-label={t('ai.filterByRisk')}>
            <option value="">{t('ai.filter.allRiskLevels')}</option>
            <option value="2">{t('ai.risk.high')}</option>
            <option value="1">{t('ai.risk.medium')}</option>
            <option value="0">{t('ai.risk.low')}</option>
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto" aria-label={t('ai.filterByStatus')}>
            <option value="">{t('ai.filter.allStatuses')}</option>
            {SECURITY_STATUS_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {t(label)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <PageSpinner />
        ) : !list.data?.length ? (
          <EmptyState icon={<ShieldAlert />} title={t('ai.security.emptyTitle')}>
            {t('ai.security.emptyBody')}
          </EmptyState>
        ) : (
          list.data.map((ev) => (
            <div key={ev.id} className={row}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{ev.title}</span>
                  <Badge tone={riskTone(ev.risk_level)}>{riskLabel(ev.risk_level, t)}</Badge>
                  <Badge tone="neutral">{SECURITY_TYPE_LABELS[ev.type] ? t(SECURITY_TYPE_LABELS[ev.type]) : ev.type}</Badge>
                  <StatusPill tone={ev.status === 0 ? 'warning' : ev.status === 3 ? 'success' : 'neutral'}>{SECURITY_STATUS_LABELS[ev.status] ? t(SECURITY_STATUS_LABELS[ev.status]) : ev.status}</StatusPill>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {ev.from_addr} · {ev.subject}
                </div>
                {ev.description && <div className="mt-1 text-[12.5px] text-muted text-pretty">{ev.description}</div>}
                {ev.suggestion && <div className="mt-1 text-[12.5px] text-pretty text-fg/80">{ev.suggestion}</div>}
                <div className="mt-1 text-xs text-faint">{fullDate(ev.created_at)}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {ev.status === 0 && (
                  <>
                    <Button size="xs" loading={busy === 'status'} onClick={() => setStatus(ev.id, 1)}>
                      {t('ai.confirm')}
                    </Button>
                    <Button size="xs" loading={busy === 'status'} onClick={() => setStatus(ev.id, 2)}>
                      {t('ai.ignore')}
                    </Button>
                  </>
                )}
                {ev.status !== 3 && (
                  <Button size="xs" variant="primary" loading={busy === 'status'} onClick={() => setStatus(ev.id, 3)}>
                    {t('ai.resolve')}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

// --- Assistant ---------------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  fallback?: boolean;
}

export function AssistantPage() {
  const t = useT();
  const status = useAiStatus();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const { run } = useAction();

  const send = (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setSending(true);
    run('chat', () =>
      post<{ content: string; provider: string; fallback: boolean }>('/ai/chat', { message }).then((r) => {
        setMessages((m) => [...m, { role: 'assistant', content: r.content, provider: r.provider, fallback: r.fallback }]);
        return r;
      }),
    ).finally(() => setSending(false));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('ai.assistant.title')} description={t('ai.assistant.description')} />
      {status.data && !status.data.enabled && <Alert tone="warning" title={t('ai.assistant.aiOffTitle')}>{t('ai.assistant.aiOffBody')}</Alert>}
      <Card className="flex min-h-[420px] flex-col">
        <div className="flex flex-1 flex-col gap-3 px-5 py-4">
          {messages.length === 0 ? (
            <EmptyState icon={<Bot />} title={t('ai.assistant.emptyTitle')}>
              {t('ai.assistant.emptyBody')}
            </EmptyState>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn('max-w-[85%] rounded-[10px] px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap', m.role === 'user' ? 'self-end bg-primary text-primary-fg' : 'self-start border border-border bg-surface-2 text-fg')}>
                {m.content}
                {m.role === 'assistant' && m.provider && (
                  <div className="mt-1.5 text-[11.5px] text-faint">
                    {m.provider}
                    {m.fallback ? t('ai.assistant.fallbackProvider') : ''}
                  </div>
                )}
              </div>
            ))
          )}
          {sending && <div className="self-start text-[13px] text-muted">{t('ai.assistant.thinking')}</div>}
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-border px-5 py-3.5">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('ai.assistant.inputPlaceholder')} aria-label={t('ai.assistant.inputAria')} disabled={status.data && !status.data.enabled} />
          <Button type="submit" variant="primary" icon={<Send className="h-[15px] w-[15px]" />} loading={sending} disabled={!input.trim()}>
            {t('ai.send')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

// --- Settings (admin only) ---------------------------------------------------------------------

export function AiSettingsPage() {
  const t = useT();
  const isAdmin = useIsAdmin();
  const q = useQuery({ queryKey: ['ai', 'settings'], queryFn: () => get<AiSettings>('/ai/settings'), enabled: isAdmin });
  const [s, setS] = useState<AiSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const { run, busy } = useAction();
  const invalidate = useInvalidate();

  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);

  if (!isAdmin) return <Navigate to="/ai" replace />;
  if (!s) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('ai.settings.title')} description={t('ai.settings.description')} />
      <Card>
        <CardHeader icon={<Settings />} title="AI" description={t('ai.settings.cardDesc')} />
        <div className="grid gap-x-6 gap-y-[18px] px-5 pt-[18px] pb-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-fg">{t('ai.settings.enableAi')}</div>
              <div className="text-xs text-muted">{t('ai.settings.enableAiDesc')}</div>
            </div>
            <Switch checked={s.aiEnabled === 'on'} onChange={(v) => setS({ ...s, aiEnabled: v ? 'on' : 'off' })} label={t('ai.settings.enableAi')} />
          </div>
          <Field label={t('ai.settings.provider')} hint={s.aiProvider === 'workers' ? t('ai.settings.providerHintWorkers') : t('ai.settings.providerHintOther')}>
            <Select value={s.aiProvider} onChange={(e) => setS({ ...s, aiProvider: e.target.value as AiSettings['aiProvider'] })}>
              <option value="workers">Workers AI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="custom">{t('ai.settings.providerCustom')}</option>
            </Select>
          </Field>
          <Field label={t('ai.settings.model')} hint={s.aiProvider === 'workers' ? t('ai.settings.modelHintWorkers') : t('ai.settings.modelHintOther')}>
            <Input value={s.aiModel} onChange={(e) => setS({ ...s, aiModel: e.target.value })} placeholder="deepseek-chat" />
          </Field>
          <Field label={t('ai.settings.apiBaseUrl')} hint={t('ai.settings.apiBaseUrlHint')}>
            <Input value={s.aiBaseUrl} onChange={(e) => setS({ ...s, aiBaseUrl: e.target.value })} placeholder="https://api.deepseek.com" />
          </Field>
          <Field label={t('ai.settings.apiKey')} hint={s.hasApiKey ? t('ai.settings.apiKeyHintStored') : t('ai.settings.apiKeyHintNone')}>
            <PasswordInput value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={s.hasApiKey ? t('ai.settings.apiKeyPlaceholderStored') : 'sk-…'} autoComplete="off" />
          </Field>
        </div>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'save'}
            onClick={() =>
              run(
                'save',
                async () => {
                  await patch('/ai/settings', { aiEnabled: s.aiEnabled, aiProvider: s.aiProvider, aiModel: s.aiModel, aiBaseUrl: s.aiBaseUrl, ...(apiKey ? { aiApiKey: apiKey } : {}) });
                  setApiKey('');
                  await invalidate(['ai', 'settings'], ['ai', 'status']);
                },
                t('ai.settings.savedToast'),
              )
            }
          >
            {t('ai.saveChanges')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
