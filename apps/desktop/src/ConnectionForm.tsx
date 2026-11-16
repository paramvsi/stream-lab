import { AppError, ErrorBanner, present } from '@sl/errors';
import {
  headerProblem,
  isSecretHeader,
  normBasePath,
  secretKey,
  STEPS,
  testConnection,
  type FlinkHttp,
  type StepId,
  type StepResult,
  type TestOutcome,
  splitSecrets,
  validateConnection,
  type Connection,
  type ConnectionField,
} from '@sl/flink';
import { Button, Field, FieldMessage, Input, Select } from '@sl/ui';
import { Activity } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { TestSteps } from './TestSteps';
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
  // Token command and client certificates (mTLS) are v1 (TRACEABILITY C-04; D59): the model keeps them.
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
  /** C02 advanced settings. */
  basePath: string;
  headers: { name: string; value: string; secret: boolean }[];
  proxy: string;
  proxyUser: string;
  proxySecret: string;
  gwSame: boolean;
  gwAuth: 'none' | 'basic' | 'bearer';
  gwUser: string;
  gwSecret: string;
}
type FieldKey = ConnectionField | 'env' | 'secret' | 'gwSecret';
/** The catalog actions a test outcome can carry that this form carries out (the rest need screens not built). */
const TEST_ACTIONS: ReadonlySet<string> = new Set([
  'Retry',
  'Save as read-only',
  'Save anyway',
  'Edit',
  'Edit address',
  'Raise timeout',
  'Edit base path',
]);

const toConnection = (d: Draft, id: string, kind: Connection['kind']): Connection => ({
  id,
  name: d.name.trim(),
  url: d.url.trim(),
  kind,
  env: d.env || 'none',
  ...(d.color ? { color: d.color } : {}),
  readOnly: d.readOnly,
  basePath: normBasePath(d.basePath),
  auth:
    d.auth === 'basic'
      ? { type: 'basic', user: d.user.trim() }
      : d.auth === 'token-command'
        ? { type: 'token-command', command: d.command.trim() }
        : d.auth === 'mtls'
          ? { type: 'mtls', cert: d.cert.trim(), key: d.key.trim() }
          : { type: d.auth },
  headers: d.headers.map((h) => ({ name: h.name.trim(), value: h.value, secret: h.secret })),
  transport: d.proxy.trim()
    ? { type: 'proxy', url: d.proxy.trim(), ...(d.proxyUser.trim() ? { user: d.proxyUser.trim() } : {}) }
    : { type: 'direct' },
  timeoutMs: d.timeoutMs,
  pollMs: d.pollMs,
  ...(d.gateway.trim()
    ? {
        gateway: {
          url: d.gateway.trim(),
          sameLogin: d.gwSame,
          ...(d.gwSame
            ? {}
            : { auth: d.gwAuth === 'basic' ? { type: 'basic', user: d.gwUser.trim() } : { type: d.gwAuth } }),
        },
      }
    : {}),
});

/** Every field's problem: the model's own rules (CONN-02) plus the ones about fields not in the model. */
function problems(d: Draft, c: Connection, taken: string[]): Partial<Record<FieldKey, AppError>> {
  const out: Partial<Record<FieldKey, AppError>> = { ...validateConnection(c, taken) };
  if (!d.env) out.env = new AppError('CONN-REQUIRED', { field: 'Environment' });
  if (d.auth === 'basic' && !d.secret.trim())
    out.secret = new AppError('CONN-REQUIRED', { field: 'Password' });
  if (d.auth === 'bearer' && !d.secret.trim()) out.secret = new AppError('CONN-REQUIRED', { field: 'Token' });
  if (d.gateway.trim() && !d.gwSame && d.gwAuth !== 'none' && !d.gwSecret.trim())
    out.gwSecret = new AppError('CONN-REQUIRED', {
      field: d.gwAuth === 'basic' ? 'SQL Gateway password' : 'SQL Gateway token',
    });
  // A keychain header with no value would claim a secret that does not exist.
  const empty = d.headers.find((h) => h.name.trim() && isSecretHeader(h) && !h.value.trim());
  if (!out.headers && empty)
    out.headers = new AppError('CONN-REQUIRED', { field: `The value of header "${empty.name.trim()}"` });
  // The SQL Gateway user missing: said by its own name under that field (the model says "login").
  if (out.gatewayLogin && !d.gwSame && d.gwAuth === 'basic' && !d.gwUser.trim())
    out.gatewayLogin = new AppError('CONN-REQUIRED', { field: 'SQL Gateway user' });
  return out;
}

/** Which header row (and which of its inputs) the headers error is about. */
function badHeader(d: Draft, c: Connection): { i: number; part: 'name' | 'value' } | undefined {
  const p = headerProblem(c.headers);
  if (p) return { i: p.index, part: 'name' };
  const i = d.headers.findIndex((h) => h.name.trim() && isSecretHeader(h) && !h.value.trim());
  return i >= 0 ? { i, part: 'value' } : undefined;
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
  test,
}: {
  kind: Connection['kind'];
  taken: string[];
  onCancel: () => void;
  onSave: (r: { connection: Connection; secrets: { key: string; value: string }[] }) => void;
  /** How to reach a cluster before it is saved (the secret is the one typed here). None: Test says why. */
  test?: (c: Connection, secret: string, more: { gateway: string; proxy: string }) => FlinkHttp;
}) {
  useEffect(() => {
    document.title = 'New connection · Stream Lab';
  }, []);
  const h1 = useScreenHeading();
  const colorName = useId();
  const headersErr = useId();
  const keychainNote = useId();
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
    basePath: '',
    headers: [],
    proxy: '',
    proxyUser: '',
    proxySecret: '',
    gwSame: true,
    gwAuth: 'none',
    gwUser: '',
    gwSecret: '',
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
  const [results, setResults] = useState<Partial<Record<StepId, StepResult>> | null>(null);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current++; // unmounted: a test still running reports to no one
    },
    [],
  );
  /** Any change makes a finished test say nothing about what is on screen: it is cleared. */
  const changed = () => {
    run.current++;
    setResults(null);
    setOutcome(null);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    changed();
    setD((x) => ({ ...x, [k]: v }));
  };
  // A new login method starts with an empty secret: a password typed for one is never sent as the other's token.
  const setAuth = (a: AuthType) => {
    changed();
    setD((x) => ({ ...x, auth: a, secret: '' }));
  };
  const testing = results !== null && outcome === null;
  /** What must be right before a test is sent: the addresses (no login inside them) and the login itself. */
  const testBlocked = (
    [
      'url',
      'gateway',
      'user',
      'secret',
      'command',
      'cert',
      'key',
      'proxy',
      'headers',
      'gatewayLogin',
      'gwSecret',
      'basePath',
    ] as const
  ).some((f) => all[f]);
  const startTest = async () => {
    if (!test || testBlocked) return;
    const mine = ++run.current;
    setResults({});
    setOutcome(null);
    try {
      const steps = testConnection(
        test(c, d.secret, {
          gateway: c.gateway && !c.gateway.sameLogin ? d.gwSecret : '',
          proxy: c.transport.type === 'proxy' ? d.proxySecret : '',
        }),
        {
          name: c.name || 'this cluster',
          url: c.url,
          readOnly: c.readOnly,
          hasGateway: !!c.gateway,
        },
      );
      for (;;) {
        const n = await steps.next();
        if (run.current !== mine) return; // edited or left while it ran: never pulled again
        if (n.done) return setOutcome(n.value);
        setResults((r) => ({ ...r, [n.value.id]: n.value }));
      }
    } catch (e) {
      // Not a transport failure the test knows (a broken transport, a bug): still said, in catalog words.
      if (run.current !== mine) return;
      const host = (() => {
        try {
          return new URL(c.url).hostname;
        } catch {
          return c.url;
        }
      })();
      const error =
        e instanceof AppError ? e : new AppError('CONN-IO', { host, reason: 'the test could not run' }, e);
      // The check that was running failed (named, as boards D02f/C04 do); the ones after it never ran.
      setResults((r) => {
        // Only once a check has run: a test that could not start names no check (it was not a lookup failure).
        const failedAt = r && Object.keys(r).length ? STEPS.find((x) => !r[x.id])?.id : undefined;
        return Object.fromEntries(
          STEPS.map((x) => [
            x.id,
            r?.[x.id] ??
              (x.id === failedAt ? { id: x.id, status: 'fail', error } : { id: x.id, status: 'skip' }),
          ]),
        );
      });
      setOutcome({ result: 'fail', error });
    }
  };
  const form = useRef<HTMLFormElement>(null);
  /** Focus an element of the form; one inside the closed Advanced settings opens them first (closed: not shown). */
  const reveal = (el: HTMLElement | null | undefined) => {
    const box = el?.closest('details');
    if (box && !box.open) box.open = true;
    el?.focus();
  };
  const focusField = (f: string) => reveal(form.current?.querySelector<HTMLElement>(`[data-field="${f}"]`));
  const onTestAction = (label: string) => {
    if (label === 'Save as read-only') {
      // The switch shows it too, so the choice stays if Save has to wait for a field to be fixed.
      setD((x) => ({ ...x, readOnly: true }));
      save({ readOnly: true });
      // The result described the form before Read-only: it is cleared (if Save waits for a field, the switch
      // keeps the choice; "Save anyway" from the old result can no longer save it read-only).
      changed();
    } else if (label === 'Save anyway') save();
    else if (label === 'Retry') {
      void startTest();
      // The banner (and its button) goes while the test runs: focus stays on the form's Test button.
      requestAnimationFrame(() => focusField('test'));
    } else if (label === 'Edit') focusField(outcome?.result === 'partial' ? 'gateway' : 'url');
    else if (label === 'Edit address') focusField('url');
    else if (label === 'Raise timeout') focusField('timeout');
    else if (label === 'Edit base path') focusField('basePath');
  };
  const blur = (f: FieldKey) => () => setTouched((t) => new Set(t).add(f));
  const count = Object.keys(all).length;
  const bad = all.headers && shown('headers') ? badHeader(d, c) : undefined;
  const isBad = (i: number, part: 'name' | 'value') => bad?.i === i && bad.part === part;
  const save = (over?: Partial<Draft>) => {
    const conn = over ? toConnection({ ...d, ...over }, id, kind) : c;
    setSubmitted(true);
    if (count) {
      // Straight to the first field to fix (the summary is said once; pressing Save again says it again here).
      requestAnimationFrame(() => reveal(form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')));
      return;
    }
    const { connection, secrets } = splitSecrets(conn);
    const key = secretKey(id, 'login');
    onSave({
      connection,
      secrets: [
        ...secrets,
        ...(d.secret && (d.auth === 'basic' || d.auth === 'bearer') ? [{ key, value: d.secret }] : []),
        // The SQL Gateway's own login and the proxy's password: keychain entries of their own.
        ...(connection.gateway && !connection.gateway.sameLogin && d.gwAuth !== 'none' && d.gwSecret
          ? [{ key: secretKey(id, 'gateway'), value: d.gwSecret }]
          : []),
        ...(connection.transport.type === 'proxy' && d.proxySecret
          ? [{ key: secretKey(id, 'proxy'), value: d.proxySecret }]
          : []),
      ],
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
        ref={form}
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
                  name={colorName}
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
            data-field="url"
            onChange={(e) => set('url', e.target.value)}
            onBlur={blur('url')}
          />
        </Field>
        <Field label="SQL Gateway URL (optional)" error={msg('gateway')}>
          <Input
            mono
            value={d.gateway}
            placeholder="https://host:8083"
            data-field="gateway"
            onChange={(e) => set('gateway', e.target.value)}
            onBlur={blur('gateway')}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Login method">
            <Select value={d.auth} onChange={(e) => setAuth(e.target.value as AuthType)}>
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
            <Select
              data-field="timeout"
              value={d.timeoutMs}
              onChange={(e) => set('timeoutMs', Number(e.target.value))}
            >
              {[5000, 10000, 30000, 60000].map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000} seconds
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <details className="rounded-lg border border-line">
          <summary className="sl-focus cursor-pointer px-4 py-3 text-[14px] font-semibold">
            Advanced settings
          </summary>
          <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
            <Field
              label="Base path"
              help="For gateways and YARN proxies. Every call goes to the address, then the base path."
              error={msg('basePath')}
            >
              <Input
                mono
                data-field="basePath"
                value={d.basePath}
                placeholder="/flink/payments"
                onChange={(e) => set('basePath', e.target.value)}
                onBlur={blur('basePath')}
              />
            </Field>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 p-0 text-[13px] font-medium">Custom headers</legend>
              {d.headers.map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <Input
                    aria-label={`Header ${i + 1} name`}
                    aria-invalid={isBad(i, 'name') || undefined}
                    aria-describedby={isBad(i, 'name') ? headersErr : undefined}
                    mono
                    value={h.name}
                    placeholder="X-Tenant"
                    onChange={(e) =>
                      set(
                        'headers',
                        d.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    onBlur={blur('headers')}
                  />
                  <Input
                    aria-label={`Header ${i + 1} value`}
                    aria-invalid={isBad(i, 'value') || undefined}
                    aria-describedby={isBad(i, 'value') ? headersErr : undefined}
                    mono
                    type={isSecretHeader(h) ? 'password' : 'text'}
                    autoComplete="off"
                    value={h.value}
                    onChange={(e) =>
                      set(
                        'headers',
                        d.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                      )
                    }
                  />
                  <label className="flex items-center gap-1.5 text-[13px]">
                    <input
                      type="checkbox"
                      className="sl-focus accent-rose-600"
                      aria-label={`Header ${i + 1} in keychain`}
                      checked={isSecretHeader(h)}
                      // A credential name is always kept in the keychain: the box says so and stays reachable
                      // (aria-disabled, not disabled: still focusable, and focus is never pulled away from it).
                      aria-disabled={!h.secret && isSecretHeader(h) ? true : undefined}
                      aria-describedby={!h.secret && isSecretHeader(h) ? `${keychainNote}-${i}` : undefined}
                      onChange={(e) =>
                        !(!h.secret && isSecretHeader(h)) &&
                        set(
                          'headers',
                          d.headers.map((x, j) => (j === i ? { ...x, secret: e.target.checked } : x)),
                        )
                      }
                    />
                    Keychain
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-remove-header
                    aria-label={`Remove header ${i + 1}`}
                    onClick={(e) => {
                      // Focus stays in the list: the row that takes this place, or Add header.
                      const list = e.currentTarget.closest('fieldset');
                      set(
                        'headers',
                        d.headers.filter((_, j) => j !== i),
                      );
                      requestAnimationFrame(() =>
                        (
                          list?.querySelectorAll<HTMLElement>('[data-remove-header]')[i] ??
                          list?.querySelectorAll<HTMLElement>('[data-remove-header]')[i - 1] ??
                          list?.querySelector<HTMLElement>('[data-add-header]')
                        )?.focus(),
                      );
                    }}
                  >
                    Remove
                  </Button>
                  {!h.secret && isSecretHeader(h) && (
                    // Seen as well as heard (the box ignores clicks), on a line of its own so every row's
                    // columns stay the same width.
                    <p id={`${keychainNote}-${i}`} className="col-span-4 m-0 text-[13px] text-muted">
                      {h.name.trim()} is always kept in the keychain.
                    </p>
                  )}
                </div>
              ))}
              {msg('headers') && <FieldMessage id={headersErr}>{msg('headers')}</FieldMessage>}
              <div>
                <Button
                  data-add-header
                  size="sm"
                  type="button"
                  onClick={() => set('headers', [...d.headers, { name: '', value: '', secret: false }])}
                >
                  Add header
                </Button>
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="HTTP proxy (optional)" error={msg('proxy')} className="sm:col-span-3">
                <Input
                  mono
                  value={d.proxy}
                  placeholder="http://proxy:3128"
                  onChange={(e) => set('proxy', e.target.value)}
                  onBlur={blur('proxy')}
                />
              </Field>
              {d.proxy.trim() && (
                <>
                  <Field label="Proxy user (optional)">
                    <Input
                      autoComplete="off"
                      value={d.proxyUser}
                      onChange={(e) => set('proxyUser', e.target.value)}
                    />
                  </Field>
                  <Field label="Proxy password (optional)" help="Kept in your keychain.">
                    <Input
                      type="password"
                      autoComplete="off"
                      value={d.proxySecret}
                      onChange={(e) => set('proxySecret', e.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>
            {d.gateway.trim() && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="SQL Gateway login">
                  <Select
                    value={d.gwSame ? 'same' : d.gwAuth}
                    onChange={(e) => {
                      const v = e.target.value;
                      changed();
                      setD((x) =>
                        v === 'same'
                          ? { ...x, gwSame: true, gwSecret: '' }
                          : { ...x, gwSame: false, gwAuth: v as Draft['gwAuth'], gwSecret: '' },
                      );
                    }}
                  >
                    <option value="same">Same as REST</option>
                    <option value="none">None</option>
                    <option value="basic">User and password</option>
                    <option value="bearer">Bearer token</option>
                  </Select>
                </Field>
                {!d.gwSame && d.gwAuth === 'basic' && (
                  <Field label="SQL Gateway user" required error={msg('gatewayLogin')}>
                    <Input
                      autoComplete="off"
                      value={d.gwUser}
                      onChange={(e) => set('gwUser', e.target.value)}
                      onBlur={blur('gatewayLogin')}
                    />
                  </Field>
                )}
                {!d.gwSame && d.gwAuth !== 'none' && (
                  <Field
                    label={d.gwAuth === 'basic' ? 'SQL Gateway password' : 'SQL Gateway token'}
                    required
                    help="Kept in your keychain."
                    error={msg('gwSecret')}
                  >
                    <Input
                      type="password"
                      autoComplete="off"
                      value={d.gwSecret}
                      onChange={(e) => set('gwSecret', e.target.value)}
                      onBlur={blur('gwSecret')}
                    />
                  </Field>
                )}
              </div>
            )}
          </div>
        </details>
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
        {results && (
          <TestSteps
            results={results}
            running={testing}
            outcome={outcome}
            onAction={onTestAction}
            handles={TEST_ACTIONS}
          />
        )}
        {submitted && count > 0 && <ErrorBanner error={new AppError('CONN-FORM-INVALID', { n: count })} />}
        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            data-field="test"
            icon={<Activity size={16} aria-hidden="true" />}
            {...(!test
              ? { disabledReason: 'Testing needs the desktop transport, which is not built yet.' }
              : testBlocked
                ? { disabledReason: 'Fix the address and login fields first.' }
                : testing
                  ? { disabledReason: 'Testing now.' }
                  : {})}
            onClick={() => void startTest()}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </main>
  );
}
