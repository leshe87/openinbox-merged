import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { renderSVG } from 'uqr';
import { Bell, Image as ImageIcon, KeyRound, Laptop, Monitor, Moon, RefreshCw, Shield, Sun, Trash } from 'lucide-react';
import { del, get, patch, post, errorText } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { getCustomWallpaper, useWallpaper } from '../../lib/background';
import { useRefreshSession, useUser } from '../../lib/session';
import { useTheme } from '../../lib/theme';
import { LANGUAGES, useLanguage, useT } from '../../lib/i18n';
import { storageGet, storageSet } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput, SegmentedControl, Switch } from '../../components/ui/form';
import { Alert, Badge, Card, CardHeader, CopyButton, PageHeader } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/overlay';
import { PasswordStrength } from '../../components/PasswordStrength';

// Each section is its own page in the settings sidebar.
export function ProfileSettings() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.profileTitle')} description={t('settings.profileDesc')} />
      <Profile />
    </div>
  );
}

export function AppearanceSettings() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.appearanceTitle')} description={t('settings.appearanceDesc')} />
      <Appearance />
      <Background />
    </div>
  );
}

export function SecuritySettings() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.security')} description={t('settings.securityDesc')} />
      <Password />
      <TwoFactor />
    </div>
  );
}

export function DevicesSettings() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.devicesTitle')} description={t('settings.devicesDesc')} />
      <Sessions />
    </div>
  );
}

function Profile() {
  const t = useT();
  const user = useUser();
  const refresh = useRefreshSession();
  const [name, setName] = useState(user?.name ?? '');
  const { run, busy } = useAction();
  return (
    <Card>
      <CardHeader title={t('settings.profileTitle')} />
      <div className="space-y-4 p-5">
        <Field label={t('settings.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('settings.signInEmail')} hint={t('settings.signInEmailHint')}>
          <Input value={user?.email ?? ''} disabled />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" loading={!!busy} onClick={() => run('save', () => patch('/account', { name }).then(refresh), t('common.saved'))}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Appearance() {
  const t = useT();
  const [theme, setTheme] = useTheme();
  const [language, setLanguage] = useLanguage();
  const [notify, setNotify] = useState(storageGet('oi.notify', false));
  const toggleNotify = async (on: boolean) => {
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return;
    }
    setNotify(on);
    storageSet('oi.notify', on);
  };
  return (
    <Card>
      <CardHeader title={t('settings.themeAndNotifications')} />
      <div className="space-y-5 p-5">
        <Field label={t('settings.theme')}>
          <SegmentedControl
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" />{t('menu.light')}</span> },
              { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" />{t('menu.dark')}</span> },
              { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" />{t('menu.system')}</span> },
            ]}
          />
        </Field>
        <Field label={t('settings.language')} hint={t('settings.languageDesc')}>
          <SegmentedControl value={language} onChange={setLanguage} options={LANGUAGES.map(({ value, label }) => ({ value, label }))} />
        </Field>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bell className="h-4 w-4" /> {t('settings.desktopNotifications')}
            </div>
            <div className="text-xs text-muted">{t('settings.desktopNotificationsDesc')}</div>
          </div>
          <Switch checked={notify} onChange={toggleNotify} label={t('settings.desktopNotifications')} />
        </div>
      </div>
    </Card>
  );
}

function Background() {
  const t = useT();
  const { url, source, title, loading, next, setCustom, clearCustom } = useWallpaper();
  const [draft, setDraft] = useState(getCustomWallpaper());
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader icon={<ImageIcon className="h-5 w-5" />} title={t('settings.background')} description={t('settings.backgroundDesc')} />
      <div className="space-y-5 p-5">
        {url ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <img src={url} alt="Current background" className="h-36 w-full object-cover" />
          </div>
        ) : (
          <div className="grid h-36 place-items-center rounded-xl border border-border bg-surface-2 text-[13px] text-muted">
            {loading ? t('settings.loadingPhoto') : t('settings.noPhoto')}
          </div>
        )}
        {title && <p className="-mt-2 text-xs text-muted">{title}</p>}
        <Field label={t('settings.customImageUrl')} hint={t('settings.customImageHint')}>
          <Input value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} placeholder="https://example.com/photo.jpg" inputMode="url" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              setCustom(draft);
              setSaved(true);
            }}
          >
            {t('settings.useThisImage')}
          </Button>
          <Button
            onClick={() => {
              next();
              setSaved(false);
            }}
            disabled={source === 'custom'}
            title={source === 'custom' ? t('settings.clearCustomFirst') : t('settings.shuffleBingTitle')}
          >
            <RefreshCw className="h-3.5 w-3.5" /> {t('settings.shuffleBing')}
          </Button>
          {source === 'custom' && (
            <Button
              onClick={() => {
                clearCustom();
                setDraft('');
                setSaved(false);
              }}
            >
              {t('settings.backToBing')}
            </Button>
          )}
        </div>
        {saved && <p className="text-xs text-success">{t('settings.backgroundSaved')}</p>}
      </div>
    </Card>
  );
}

function Password() {
  const t = useT();
  const user = useUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { run, busy } = useAction();
  return (
    <Card>
      <CardHeader icon={<KeyRound className="h-5 w-5" />} title={t('settings.passwordTitle')} description={t('settings.passwordDesc')} />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (next !== confirm) return;
          run('pw', () => post('/account/password', { current, next }).then(() => { setCurrent(''); setNext(''); setConfirm(''); }), t('settings.passwordChanged'));
        }}
      >
        <Field label={t('settings.currentPassword')}>
          <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required={!user?.mustChangePassword} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.newPassword')}>
            <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={10} />
          </Field>
          <Field label={t('settings.confirm')} error={confirm && next !== confirm ? t('settings.doesNotMatch') : undefined}>
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </Field>
        </div>
        <PasswordStrength password={next} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={!!busy}>
            {t('settings.changePassword')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactor() {
  const t = useT();
  const user = useUser();
  const refresh = useRefreshSession();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disable, setDisable] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { run, busy } = useAction();
  return (
    <Card>
      <CardHeader
        icon={<Shield className="h-5 w-5" />}
        title={t('settings.twoFactorTitle')}
        description={t('settings.twoFactorDesc')}
        action={user?.totpEnabled ? <Badge tone="success">{t('settings.on')}</Badge> : <Badge>{t('settings.off')}</Badge>}
      />
      <div className="p-5">
        {user?.totpEnabled ? (
          <Button variant="outline" onClick={() => setDisable(true)}>
            {t('settings.turnOff')}
          </Button>
        ) : (
          <Button variant="primary" loading={busy === 'start'} onClick={() => run('start', async () => setSetup(await post<{ secret: string; uri: string }>('/account/2fa/setup')))}>
            {t('settings.setUpTwoFactor')}
          </Button>
        )}
      </div>
      <Dialog
        open={!!setup && !codes}
        onClose={() => setSetup(null)}
        title={t('settings.scanApp')}
        footer={
          <Button
            variant="primary"
            loading={busy === 'enable'}
            onClick={() =>
              run('enable', async () => {
                setError('');
                try {
                  const r = await post<{ recoveryCodes: string[] }>('/account/2fa/enable', { code });
                  setCodes(r.recoveryCodes);
                } catch (e) {
                  setError(errorText(e));
                }
              })
            }
          >
            {t('settings.verifyAndTurnOn')}
          </Button>
        }
      >
        {setup && (
          <div className="space-y-4">
            <div className="mx-auto w-48 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: renderSVG(setup.uri, { border: 1 }) }} />
            <div className="text-center text-xs text-muted">
              {t('settings.orEnterKey')} <span className="font-mono text-fg">{setup.secret.match(/.{1,4}/g)?.join(' ')}</span> <CopyButton text={setup.secret} />
            </div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label={t('settings.sixDigitCode')}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" className="text-center font-mono text-lg tracking-widest" autoFocus />
            </Field>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!codes}
        onClose={() => {
          setCodes(null);
          setSetup(null);
          refresh();
        }}
        title={t('settings.saveRecoveryCodes')}
        description={t('settings.recoveryCodesDesc')}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setCodes(null);
              setSetup(null);
              refresh();
            }}
          >
            {t('settings.iSavedThem')}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2 p-4 font-mono text-sm">
          {codes?.map((c) => <span key={c}>{c}</span>)}
        </div>
        <div className="mt-2 flex justify-end">
          <CopyButton text={(codes ?? []).join('\n')} label={t('settings.copyAll')} />
        </div>
      </Dialog>
      <Dialog
        open={disable}
        onClose={() => setDisable(false)}
        title={t('settings.turnOffTwoFactor')}
        size="sm"
        footer={
          <Button variant="danger" loading={busy === 'disable'} onClick={() => run('disable', () => post('/account/2fa/disable', { current: password }).then(() => { setDisable(false); setPassword(''); refresh(); }), t('settings.twoFactorOff'))}>
            {t('settings.turnOff')}
          </Button>
        }
      >
        <Field label={t('settings.yourPassword')}>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </Card>
  );
}

function Sessions() {
  const t = useT();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => get<{ id: string; ip: string | null; userAgent: string | null; createdAt: number; lastSeenAt: number; current: boolean }[]>('/account/sessions') });
  const { run } = useAction();
  const describe = (ua: string | null) => {
    if (!ua) return t('settings.unknownDevice');
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
    return `${browser}${os ? ` on ${os}` : ''}`;
  };
  useEffect(() => undefined, []);
  return (
    <Card>
      <CardHeader
        icon={<Laptop className="h-5 w-5" />}
        title={t('settings.signedInDevices')}
        action={
          (q.data?.length ?? 0) > 1 && (
            <Button size="sm" onClick={() => run('all', () => post('/account/sessions/revoke-others').then(() => q.refetch()), t('settings.signedOutElsewhere'))}>
              {t('settings.signOutOthers')}
            </Button>
          )
        }
      />
      <div className="divide-y divide-border">
        {q.data?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {describe(s.userAgent)} {s.current && <Badge tone="success">{t('settings.thisDevice')}</Badge>}
              </div>
              <div className="text-xs text-muted">
                {s.ip ?? t('settings.unknownIp')} · {t('settings.activeAgo', { time: timeAgo(s.lastSeenAt) })} · {t('settings.signedInAgo', { time: timeAgo(s.createdAt) })}
              </div>
            </div>
            {!s.current && (
              <Button size="xs" variant="ghost" icon={<Trash className="h-3.5 w-3.5" />} onClick={() => run('rm', () => del(`/account/sessions/${s.id}`).then(() => q.refetch()))}>
                {t('settings.signOut')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
