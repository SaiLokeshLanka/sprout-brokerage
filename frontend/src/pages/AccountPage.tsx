import { FormEvent, useState } from 'react';
import { api, ApiUser, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type Result = { ok: boolean; message: string } | null;

export function AccountPage() {
  const { user, setUser } = useAuth();
  if (!user) return null;
  return (
    <div className="page-single narrow">
      <h1 className="page-title">Profile &amp; KYC</h1>
      <ProfileCard user={user} onSaved={setUser} />
      <KycCard user={user} onVerified={setUser} />
    </div>
  );
}

function ProfileCard({ user, onSaved }: { user: ApiUser; onSaved: (u: ApiUser) => void }) {
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (fullName.trim().length < 2) return setResult({ ok: false, message: 'Full name must be at least 2 characters' });
    if (phone && !/^[6-9]\d{9}$/.test(phone.trim())) {
      return setResult({ ok: false, message: 'Enter a valid 10-digit Indian mobile number' });
    }
    setPending(true);
    try {
      const updated = await api.patch<ApiUser>('/me', { fullName: fullName.trim(), ...(phone ? { phone: phone.trim() } : {}) });
      onSaved(updated);
      setResult({ ok: true, message: 'Profile saved' });
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="card form-card" onSubmit={submit} noValidate data-testid="profile-form">
      <h3>Profile</h3>
      <div className="form-row">
        <label className="field">
          <span>Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="profile-name" />
        </label>
        <label className="field">
          <span>Mobile number</span>
          <input
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit mobile"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            data-testid="profile-phone"
          />
        </label>
      </div>
      <label className="field">
        <span>Email</span>
        <input value={user.email} readOnly data-testid="profile-email" />
      </label>
      {result && (
        <div className={`order-result ${result.ok ? 'ok' : 'err'}`} role="status" data-testid="profile-result">
          {result.message}
        </div>
      )}
      <button type="submit" className="btn-primary inline" disabled={pending} data-testid="profile-save">
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function KycCard({ user, onVerified }: { user: ApiUser; onVerified: (u: ApiUser) => void }) {
  const [pan, setPan] = useState('');
  const [dob, setDob] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const verified = user.kycStatus === 'VERIFIED';

  const latestAllowedDob = new Date();
  latestAllowedDob.setFullYear(latestAllowedDob.getFullYear() - 18);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return setResult({ ok: false, message: 'PAN must look like ABCDE1234F' });
    if (!dob) return setResult({ ok: false, message: 'Enter your date of birth' });
    setPending(true);
    try {
      onVerified(await api.post<ApiUser>('/me/kyc', { pan, dateOfBirth: dob }));
      setResult(null);
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card form-card" data-testid="kyc-card">
      <div className="card-head">
        <h3>KYC verification</h3>
        <span className={`kyc-badge ${verified ? 'verified' : 'pending'}`} data-testid="kyc-status">
          {verified ? 'VERIFIED' : 'PENDING'}
        </span>
      </div>

      {verified ? (
        <div className="kv-grid">
          <div>
            <div className="muted small">PAN</div>
            <div className="strong" data-testid="kyc-pan">{user.panMasked}</div>
          </div>
          <div>
            <div className="muted small">Date of birth</div>
            <div className="strong">{user.dateOfBirth}</div>
          </div>
          <div>
            <div className="muted small">Verified on</div>
            <div className="strong">{user.kycVerifiedAt ? new Date(user.kycVerifiedAt).toLocaleDateString('en-IN') : '—'}</div>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="form-card flush" data-testid="kyc-form">
          <p className="muted small">KYC is required before you can withdraw money. Verification is simulated and instant.</p>
          <div className="form-row">
            <label className="field">
              <span>PAN</span>
              <input
                value={pan}
                maxLength={10}
                placeholder="ABCDE1234F"
                autoCapitalize="characters"
                onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                data-testid="kyc-pan-input"
              />
            </label>
            <label className="field">
              <span>Date of birth</span>
              <input
                type="date"
                value={dob}
                max={latestAllowedDob.toISOString().slice(0, 10)}
                onChange={(e) => setDob(e.target.value)}
                data-testid="kyc-dob-input"
              />
            </label>
          </div>
          {result && (
            <div className="order-result err" role="alert" data-testid="kyc-result">
              {result.message}
            </div>
          )}
          <button type="submit" className="btn-primary inline" disabled={pending} data-testid="kyc-submit">
            {pending ? 'Verifying…' : 'Verify KYC'}
          </button>
        </form>
      )}
    </div>
  );
}
