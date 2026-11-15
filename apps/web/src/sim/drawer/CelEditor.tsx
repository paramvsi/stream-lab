import { autocompletion, completionStatus, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { Annotation, Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { AppError, present } from '@sl/errors';
import type { Issue, Schema } from '@sl/graph';
import { Button, useFieldContext } from '@sl/ui';
import { Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** CEL tokens for highlighting (NODE-03). */
const cel = StreamLanguage.define<null>({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/"(?:[^"\\]|\\.)*"?/) || stream.match(/'(?:[^'\\]|\\.)*'?/)) return 'string';
    if (stream.match(/\d+(\.\d+)?([eE][+-]?\d+)?u?/)) return 'number';
    if (stream.match(/\b(true|false|null|in)\b/)) return 'keyword';
    if (stream.match(/[A-Za-z_]\w*(?=\s*\()/)) return 'function';
    if (stream.match(/[A-Za-z_]\w*/)) return 'variableName';
    if (stream.match(/&&|\|\||==|!=|<=|>=|[-+*/%<>!?:]/)) return 'operator';
    stream.next();
    return null;
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.string, color: 'var(--sl-node-category-transform-accent)' },
  { tag: tags.number, color: 'var(--sl-node-category-sources-accent)' },
  { tag: tags.keyword, color: 'var(--sl-color-rose-700)', fontWeight: '600' },
  { tag: tags.function(tags.variableName), color: 'var(--sl-node-category-enrich-accent)' },
  { tag: tags.variableName, color: 'var(--sl-color-ink)' },
  { tag: tags.operator, color: 'var(--sl-color-muted)' },
]);

/** Marks a change that came from outside (undo/redo, row shift): not typing, so not reported back. */
const External = Annotation.define<boolean>();

const FUNCTIONS = [
  'size',
  'has',
  'matches',
  'startsWith',
  'endsWith',
  'contains',
  'timestamp',
  'duration',
  'int',
  'double',
  'string',
];

const theme = EditorView.theme({
  '&': {
    border: '1px solid var(--sl-color-line-strong)',
    borderRadius: 'var(--sl-radius-md)',
    background: 'var(--sl-color-surface)',
    fontSize: '14px',
  },
  '&.cm-focused': {
    outline: 'none',
    boxShadow: '0 0 0 2px var(--sl-color-surface), 0 0 0 4px var(--sl-color-rose-600)',
  },
  '.cm-content': { fontFamily: 'var(--sl-font-mono)', padding: '9px 10px', minHeight: '22px' },
  '.cm-line': { padding: '0' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'wavy underline var(--sl-color-danger-600)',
    textUnderlineOffset: '3px',
  },
  '.cm-tooltip': {
    border: '1px solid var(--sl-color-line)',
    borderRadius: 'var(--sl-radius-md)',
    background: 'var(--sl-color-surface)',
    boxShadow: 'var(--sl-shadow-pop)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: 'var(--sl-color-rose-50)',
    color: 'var(--sl-color-ink)',
  },
});

/**
 * CEL expression editor (NODE-03, board WX01): highlighting, autocomplete of input fields, the validation
 * issue as an inline squiggle, and its quick fix (also as a visible button, reachable by keyboard).
 */
export function CelEditor({
  id,
  label,
  value,
  schema,
  issue,
  onLive,
  onFocus,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  schema: Schema;
  issue?: Issue | undefined;
  onLive: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // The Field's id, so its <label for> and error wiring reach the editor (audit2 5).
  const field = useFieldContext();
  const contentId = field?.id ?? id;
  const [aria] = useState(() => new Compartment());
  const view = useRef<EditorView | null>(null);
  // Latest callbacks/schema for the editor's extensions (created once).
  const live = useRef({ onLive, onFocus, onBlur, schema });
  useEffect(() => {
    live.current = { onLive, onFocus, onBlur, schema };
  });

  useEffect(() => {
    const complete = (ctx: CompletionContext) => {
      const w = ctx.matchBefore(/[A-Za-z_]\w*/);
      if (!w && !ctx.explicit) return null;
      return {
        from: w?.from ?? ctx.pos,
        options: [
          ...live.current.schema.map((f) => ({ label: f.name, type: 'variable', detail: f.type })),
          ...FUNCTIONS.map((f) => ({ label: f, type: 'function', apply: `${f}(` })),
        ],
      };
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          cel,
          syntaxHighlighting(highlight),
          // Esc with the completion list open closes only the list: keep it from reaching the drawer. Highest
          // precedence and before autocompletion(), whose own Esc binding closes the list first.
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (e, v) => {
                if (e.key === 'Escape' && completionStatus(v.state) === 'active') e.stopPropagation();
                return false;
              },
            }),
          ),
          autocompletion({ override: [complete], activateOnTyping: true }),
          placeholder('e.g. amount > 1000.0 && currency == "AED"'),
          theme,
          aria.of([]),
          EditorView.contentAttributes.of({ 'aria-label': label, id: contentId, 'aria-multiline': 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External)))
              live.current.onLive(u.state.doc.toString());
            if (u.focusChanged) (u.view.hasFocus ? live.current.onFocus : live.current.onBlur)();
          }),
          // Enter does not add a line (Tab still leaves the field). Only typing is blocked: an expression that
          // already has lines (import, share link) stays editable, and pasted lines are kept (audit2 6).
          EditorState.transactionFilter.of((tr) =>
            tr.newDoc.lines > tr.startState.doc.lines &&
            tr.isUserEvent('input') &&
            !tr.isUserEvent('input.paste')
              ? []
              : tr,
          ),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // The editor is created once per field; value changes from outside are synced below.
  }, [contentId, label]); // eslint-disable-line react-hooks/exhaustive-deps

  // External value changes (undo/redo, quick fix) sync into the editor.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
        annotations: [External.of(true), Transaction.addToHistory.of(false)],
      });
  }, [value]);

  // Error wiring for screen readers (the squiggle alone is visual).
  const describedBy = field?.describedBy;
  const invalid = field?.invalid ?? Boolean(issue);
  useEffect(() => {
    view.current?.dispatch({
      effects: aria.reconfigure(
        EditorView.contentAttributes.of({
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          ...(invalid ? { 'aria-invalid': 'true' } : {}),
        }),
      ),
    });
  }, [aria, describedBy, invalid]);

  // Validation issue → inline squiggle.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const len = v.state.doc.length;
    const diags: Diagnostic[] = issue
      ? [
          {
            from: Math.min(issue.from ?? 0, len),
            to: Math.min(Math.max(issue.to ?? len, (issue.from ?? 0) + 1), len),
            severity: 'error',
            message: present(new AppError(issue.code, issue.params)).message,
          },
        ]
      : [];
    v.dispatch(setDiagnostics(v.state, diags));
  }, [issue, value]);

  const fix = issue?.fix;
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={host} />
      {fix && (
        <Button
          size="sm"
          className="w-fit"
          icon={<Wand2 size={14} aria-hidden="true" />}
          onClick={() => {
            const v = view.current!;
            const from = issue?.from ?? 0;
            const to = issue?.to ?? from;
            const next = value.slice(0, from) + fix + value.slice(to);
            onFocus();
            onLive(next);
            onBlur();
            v.focus();
          }}
        >
          Use “{fix}”
        </Button>
      )}
    </div>
  );
}
