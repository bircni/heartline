import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api.ts';
import { fieldErrorsOf } from './ui.tsx';

describe('fieldErrorsOf', () => {
  const fields = { 'spec.url': 'm-url', 'spec.expect': 'm-expect', 'spec.expect.status': 'm-status' };

  it('maps issues to the inputs that show them, using the longest matching path', () => {
    const e = new ApiError(400, 'bad', [
      { path: 'spec.url', message: 'Invalid URL' },
      { path: 'spec.expect.status.0', message: 'Too small' },
      { path: 'spec.expect.1', message: 'Not a string' },
    ]);
    expect(fieldErrorsOf(e, fields)).toEqual({
      byId: { 'm-url': 'Invalid URL', 'm-status': 'Too small', 'm-expect': 'Not a string' },
      rest: [],
    });
  });

  it('lists issues no field shows, and plain errors, in the summary', () => {
    const e = new ApiError(400, 'bad', [{ path: 'spec.timeout', message: 'Invalid duration' }]);
    expect(fieldErrorsOf(e, fields).rest).toEqual(['spec.timeout: Invalid duration']);
    expect(fieldErrorsOf(new ApiError(409, 'already exists'), fields).rest).toEqual(['already exists']);
    expect(fieldErrorsOf(null, fields)).toEqual({ byId: {}, rest: [] });
  });
});
