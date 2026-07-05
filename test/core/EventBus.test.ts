import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

type Events = { hello: { n: number }; bye: void };

describe('EventBus', () => {
  it('доставляет событие подписчику', () => {
    const bus = new EventBus<Events>();
    const fn = vi.fn();
    bus.on('hello', fn);
    bus.emit('hello', { n: 5 });
    expect(fn).toHaveBeenCalledWith({ n: 5 });
  });
  it('отписка прекращает доставку', () => {
    const bus = new EventBus<Events>();
    const fn = vi.fn();
    const off = bus.on('hello', fn);
    off();
    bus.emit('hello', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
});
