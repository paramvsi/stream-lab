import { AlertTriangle } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldCtx {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}
const Ctx = createContext<FieldCtx | null>(null);

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  /** Already-presented message (see @sl/errors FieldError for catalog codes). */
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** Label + control + help/error. The control (Input/Select/Textarea) picks up id and aria wiring. */
export function Field({ label, help, error, required, children, className = '' }: FieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, helpId].filter(Boolean).join(' ') || undefined;
  return (
    <Ctx.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
          {required && <span className="sr-only"> (required)</span>}
        </label>
        {children}
        {error && <FieldMessage id={errId}>{error}</FieldMessage>}
        {help && !error && (
          <p id={helpId} className="m-0 text-[13px] text-muted">
            {help}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

/** The red line under a field (board D02c). Never colour alone: icon + words. */
export function FieldMessage({ id, children }: { id?: string | undefined; children: ReactNode }) {
  return (
    <p id={id} className="m-0 flex items-center gap-1.5 text-[13px] text-danger-600">
      <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
      {children}
    </p>
  );
}

/** For custom controls (e.g. a code editor) inside a Field: its id, error/help ids and invalid state. */
export const useFieldContext = () => useContext(Ctx);

function useField(props: { id?: string | undefined; 'aria-describedby'?: string | undefined }) {
  const f = useContext(Ctx);
  return {
    id: props.id ?? f?.id,
    'aria-describedby': props['aria-describedby'] ?? f?.describedBy,
    'aria-invalid': f?.invalid || undefined,
    invalid: f?.invalid ?? false,
  };
}

// Board D02: min-height 40, 1 px line-strong border (danger-600 when invalid), radius 8, pad 0 12.
const BOX =
  'sl-focus w-full min-h-10 rounded-md border bg-surface px-3 text-[14px] text-ink placeholder:text-line-strong disabled:bg-subtle disabled:text-line-strong';
const border = (invalid: boolean) => (invalid ? 'border-danger-600' : 'border-line-strong');

/** text, number, file, email, url… Combobox = native `list` + <datalist> (ponytail: until a board needs more). */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className = '', mono, ...rest }, ref) {
    const { invalid, ...a } = useField(rest);
    return (
      <input
        ref={ref}
        {...rest}
        {...a}
        className={`${BOX} ${border(invalid)} ${mono ? 'font-mono' : ''} file:mr-3 file:border-0 file:bg-transparent file:font-semibold file:text-ink ${className}`}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', ...rest },
  ref,
) {
  const { invalid, ...a } = useField(rest);
  return <select ref={ref} {...rest} {...a} className={`${BOX} ${border(invalid)} ${className}`} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...rest }, ref) {
    const { invalid, ...a } = useField(rest);
    return <textarea ref={ref} {...rest} {...a} className={`${BOX} ${border(invalid)} py-2 ${className}`} />;
  },
);
