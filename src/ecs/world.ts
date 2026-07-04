import { World } from 'miniplex';
import type { Entity } from './components';

export type { Entity, Warhead, Blast } from './components';

// Создаёт новый ECS-мир для одной симуляции (miniplex 2.0: архетипные запросы через world.with(...)).
export function createWorld(): World<Entity> {
  return new World<Entity>();
}
