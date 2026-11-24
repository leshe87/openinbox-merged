import { useState, type FormEvent } from 'react';
import { post, errorText } from '../../lib/api';
import { useRefreshSession } from '../../lib/session';
import { Button } from '../../components/ui/button';
import { Field, PasswordInput } from '../../components/ui/form';
import { Alert } from '../../components/ui/misc';
import { PasswordStrength } from '../../components/PasswordStrength';
import { AuthLayout } from './AuthLayout';
import { useT } from '../../lib/i18n';

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const t = useT();
  const refresh = useRefreshSession();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError(t('auth.passwordsNoMatch'));
    setBusy(true);
    setError('');
    try {
      await post('/account/password', { next });
      await refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.choosePassword')} subtitle={forced ? t('auth.choosePasswordForced') : undefined}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('auth.newPassword')} id="next" hint={t('auth.newPasswordHint')}>
          <PasswordInput id="next" autoComplete="new-password" autoFocus required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <PasswordStrength password={next} />
        <Field label={t('auth.confirmPassword')} id="confirm">
          <PasswordInput id="confirm" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>
          {t('auth.savePassword')}
        </Button>
      </form>
    </AuthLayout>
  );
}
