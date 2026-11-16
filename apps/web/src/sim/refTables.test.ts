import { BUILTIN_TABLES } from '@sl/engine';
import { describe, expect, it } from 'vitest';
import { allTables, refCtx, useRefTables } from './refTables';

describe('DATA-03 audit: built-in tables win over an imported one of the same name', () => {
  it('allTables and refCtx keep the built-in merchants', () => {
    useRefTables.setState({
      user: {
        merchants: {
          ...BUILTIN_TABLES['merchants']!,
          columns: [{ name: 'x', type: 'string', required: true }],
          rows: [],
        },
      },
    });
    expect(allTables()['merchants']).toBe(BUILTIN_TABLES['merchants']);
    expect(refCtx().refTables['merchants']).toEqual(BUILTIN_TABLES['merchants']!.columns);
  });
});
