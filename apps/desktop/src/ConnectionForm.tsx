import { AppError, present } from '@sl/errors';
import {
  secretKey,
  splitSecrets,
  validateConnection,
  type Connection,
  type ConnectionField,
} from '@sl/flink';
import { Banner, Button, Field, Input, Select } from '@sl/ui';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useScreenHeading } from './focus';

type Env = Connection['env'];
type Color = NonNullable<Connection['color']>;
type AuthType = Connection['auth']['type'];
const COLORS: { color: Color; label: string; css: string }[] = [
  { color: 'red', label: 'Red', css: 'bg-danger-600' },
  { color: 'orange', label: 'Orange', css: 'bg-orange-500' },
  { color: 'green', label: 'Green', css: 'bg-success-600' },
  { color: 'rose', label: 'Rose', css: 'bg-rose-500' },
  { color: 'grey', label: 'Grey', css: 'bg-muted' },
];
const AUTH: { type: AuthType; label: string }[] = [
  { type: 'none', label: 'None' },
  { type: 'basic', label: 'User and password' },
  { type: 'bearer', label: 'Bearer token' },
  { type: 'token-command', label: 'Token command' },
  { type: 'mtls', label: 'Client certificate (mTLS)' },
];

interface Draft {
  name: string;
  env: Env | '';
  color?: Color;
  url: string;
  gateway: string;
  auth: AuthType;
  user: string;
  /** The password or token: kept in this form only, then handed to the keychain on save. */
  secret: string;
  command: string;
  cert: string;
  key: string;
  pollMs: number;
  timeoutMs: number;
  readOnly: boolean;
}
type FieldKey = ConnectionField | 'env' | 'secret';

const toConnection = (d: Draft, id: string, kind: Connection['kind']): Connection => ({
  id,
  name: d.name.trim(),
  url: d.url.trim(),
  kind,
  env: d.env || 'none',
  ...(d.color ? { color: d.color } : {}),
  readOnly: d.readOnly,
  basePath: '',
  auth:
    d.auth === 'basic'
      ? { type: 'basic', user: d.user }
      : d.auth === 'token-command'
        ? { type: 'token-command', command: d.command }
        : d.auth === 'mtls'
          ? { type: 'mtls', cert: d.cert, key: d.key }
          : { type: d.auth },
  headers: [],
  transport: { type: 'direct' },
  timeoutMs: d.timeoutMs,
  pollMs: d.pollMs,
  ...(d.gateway.trim() ? { gateway: { url: d.gateway.trim(), sameLogin: true } } : {}),
});

/** Every field's problem: the model's own rules (CONN-02) plus the ones about fields not in the model. */
function problems(d: Draft, c: Connection, taken: string[]): Partial<Record<FieldKey, AppError>> {
  const out: Partial<Record<FieldKey, AppError>> = { ...validateConnection(c, taken) };
  if (!d.env) out.env = new AppError('CONN-REQUIRED', { field: 'Environment' });
  if (d.auth === 'basic' && !d.secret) out.secret = new AppError('CONN-REQUIRED', { field: 'Password' });
  if (d.auth === 'bearer' && !d.secret) out.secret = new AppError('CONN-REQUIRED', { field: 'Token' });
  return out;
}

/**
 * CONN-02 / boards D02 (blank) and D02c (validation errors): step 2 of 3, the connection itself. Fields validate on
 * blur and all of them on Save; CONN-FORM-INVALID counts what is left. Secrets (the password or token) never enter
 * the connection: splitSecrets() hands them to the keychain apart. ponytail: no SSH / Kubernetes / certificate
 * tunnels (v1, CONN-12) and no custom headers yet (C02, advanced settings).
 */
export function ConnectionForm({
  kind,
  taken,
  onCancel,
  onSave,
}: {
  kind: Connection['kind'];
  taken: string[];
  onCancel: () => void;
  onSave: (r: { connection: Connection; secrets: { key: string; value: string }[] }) => void;
}) {
  useEffect(() => {
    document.title = 'New connection · Stream Lab';
  }, []);
  const h1 = useScreenHeading();
  const [id] = useState(() => `c_${crypto.randomUUID()}`);
  const [d, setD] = useState<Draft>({
    name: '',
    env: '',
    url: '',
    gateway: '',
    auth: 'none',
    user: '',
    secret: '',
    command: '',
    cert: '',
    key: '',
    pollMs: 5000,
    timeoutMs: 10000,
    readOnly: false,
  });
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const c = toConnection(d, id, kind);
  const all = problems(d, c, taken);
  const shown = (f: FieldKey) => (submitted || touched.has(f) ? all[f] : undefined);
  const msg = (f: FieldKey) => {
    const e = shown(f);
    return e ? present(e).message : undefined;
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const blur = (f: FieldKey) => () => setTouched((t) => new Set(t).add(f));
  const count = Object.keys(all).length;
  const save = () => {
    setSubmitted(true);
    if (count) return;
    const { connection, secrets } = splitSecrets(c);
    const key = secretKey(id, 'login');
    onSave({
      connection,
      secrets:
        d.secret && (d.auth === 'basic' || d.auth === 'bearer')
          ? [...secrets, { key, value: d.secret }]
          : secrets,
    });
  };
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-8">
      <div className="flex flex-col gap-1">
        <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
          New connection
        </h1>
        <p className="m-0 text-[14px] text-muted">Step 2 of 3 · the connection</p>
      </div>
      <form
        noValidate
        className="flex max-w-[640px] flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required error={msg('name')}>
            <Input
              value={d.name}
              placeholder="e.g. payments-prod"
              onChange={(e) => set('name', e.target.value)}
              onBlur={blur('name')}
            />
          </Field>
          <Field label="Environment" required error={msg('env')}>
            <Select
              value={d.env}
              onChange={(e) => set('env', e.target.value as Env | '')}
              onBlur={blur('env')}
            >
              <option value="">Choose</option>
              <option value="prod">Production</option>
              <option value="staging">Staging</option>
              <option value="dev">Development</option>
              <option value="none">No tag</option>
            </Select>
          </Field>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-medium">Colour</legend>
          <div className="flex gap-3">
            {COLORS.map((x) => (
              <label key={x.color} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  className="peer sr-only"
                  checked={d.color === x.color}
                  onChange={() => set('color', x.color)}
                />
                <span className="sr-only">{x.label}</span>
                <span
                  aria-hidden="true"
                  className={`block size-7 rounded-full ${x.css} ring-offset-2 peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-rose-600`}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label="JobManager REST URL"
          required
          help="The address of Flink's web UI and REST API."
          error={msg('url')}
        >
          <Input
            mono
            value={d.url}
            placeholder="https://host:8081"
            onChange={(e) => set('url', e.target.value)}
            onBlur={blur('url')}
          />
        </Field>
        <Field label="SQL Gateway URL (optional)" error={msg('gateway')}>
          <Input
            mono
            value={d.gateway}
            placeholder="https://host:8083"
            onChange={(e) => set('gateway', e.target.value)}
            onBlur={blur('gateway')}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Login method">
            <Select value={d.auth} onChange={(e) => set('auth', e.target.value as AuthType)}>
              {AUTH.map((a) => (
                <option key={a.type} value={a.type}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          {d.auth === 'basic' && (
            <Field label="User" required error={msg('user')}>
              <Input
                value={d.user}
                autoComplete="off"
                onChange={(e) => set('user', e.target.value)}
                onBlur={blur('user')}
              />
            </Field>
          )}
          {(d.auth === 'basic' || d.auth === 'bearer') && (
            <Field
              label={d.auth === 'basic' ? 'Password' : 'Token'}
              required
              help="Kept in your keychain."
              error={msg('secret')}
            >
              <Input
                type="password"
                autoComplete="off"
                value={d.secret}
                onChange={(e) => set('secret', e.target.value)}
                onBlur={blur('secret')}
              />
            </Field>
          )}
          {d.auth === 'token-command' && (
            <Field
              label="Token command"
              required
              help="Prints a token; run again when the cluster says 401."
              error={msg('command')}
            >
              <Input
                mono
                value={d.command}
                onChange={(e) => set('command', e.target.value)}
                onBlur={blur('command')}
              />
            </Field>
          )}
          {d.auth === 'mtls' && (
            <>
              <Field label="Client certificate (PEM file)" required error={msg('cert')}>
                <Input
                  mono
                  value={d.cert}
                  onChange={(e) => set('cert', e.target.value)}
                  onBlur={blur('cert')}
                />
              </Field>
              <Field label="Client key (PEM file)" required error={msg('key')}>
                <Input mono value={d.key} onChange={(e) => set('key', e.target.value)} onBlur={blur('key')} />
              </Field>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Refresh every">
            <Select value={d.pollMs} onChange={(e) => set('pollMs', Number(e.target.value))}>
              {[2000, 5000, 15000, 30000].map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000} seconds
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timeout">
            <Select value={d.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))}>
              {[5000, 10000, 30000, 60000].map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000} seconds
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-lg py-2">
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold">Read-only connection</span>
            <span className="text-[13px] text-muted">
              Hide stop, cancel, rescale and submit for this cluster
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="sl-focus size-5 accent-rose-600"
            checked={d.readOnly}
            onChange={(e) => set('readOnly', e.target.checked)}
          />
        </label>
        {submitted && count > 0 && (
          <Banner severity="error">{present(new AppError('CONN-FORM-INVALID', { n: count })).message}</Banner>
        )}
        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            icon={<Activity size={16} aria-hidden="true" />}
            disabledReason="Testing needs the desktop transport, which is not built yet."
          >
            Test connection
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </main>
  );
}
