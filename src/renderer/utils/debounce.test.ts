import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delays function execution until after wait time', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 2000);

    debounced('arg1');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledWith('arg1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 2000);

    debounced('first');
    vi.advanceTimersByTime(1000);
    debounced('second');
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledWith('second');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('allows canceling pending execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 2000);

    debounced('arg1');
    debounced.cancel();
    vi.advanceTimersByTime(2000);

    expect(fn).not.toHaveBeenCalled();
  });

  it('calls function with latest arguments', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 2000);

    debounced('a', 1);
    debounced('b', 2);
    debounced('c', 3);

    vi.advanceTimersByTime(2000);

    expect(fn).toHaveBeenCalledWith('c', 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('preserves this context', () => {
    const obj = {
      value: 42,
      fn: vi.fn(function(this: any) { return this.value; }),
    };
    const debounced = debounce(obj.fn, 2000);

    debounced.call(obj);
    vi.advanceTimersByTime(2000);

    expect(obj.fn).toHaveBeenCalled();
  });
});
