import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toaster, toast } from './Toast.tsx';

describe('toasts', () => {
  afterEach(() => vi.useRealTimers());

  it('shows messages, hides success after a few seconds and keeps errors', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast('Saved');
      toast('Could not delete', 'bad');
    });
    expect(screen.getByRole('status').textContent).toContain('Saved');
    expect(screen.getByRole('alert').textContent).toContain('Could not delete');
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
