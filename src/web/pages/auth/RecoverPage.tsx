import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { post, errorText } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput } from '../../components/ui/form';
import { Alert } from '../../components/ui/misc';
import { AuthLayout } from './AuthLayout';
import { useT } from '../../lib/i18n';

// The owner proves control of the deployment with the recovery key, ENCRYPTION_KEY (the app's own inbox can't
// receive a reset link while they're locked out). Other users ask an admin to reset them.
export function RecoverPage() {
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/recover', { email, setupKey: key, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.recoverTitle')} subtitle={t('auth.recoverSub')} footer={<Link to="/login" className="hover:text-fg">{t('auth.backToSignIn')}</Link>}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success" title={t('auth.resetDone')}>{t('auth.resetDoneBody')}</Alert>
          <Button variant="primary" className="w-full justify-center" onClick={() => navigate('/login')}>
            {t('auth.signIn')}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label={t('auth.ownerEmail')} id="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('auth.recoveryKey')} id="key" hint={t('auth.recoveryKeyHint')}>
            <PasswordInput id="key" required value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label={t('auth.newPassword')} id="password">
            <PasswordInput id="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" className="w-full justify-center" loading={busy}>
            {t('auth.resetPassword')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
