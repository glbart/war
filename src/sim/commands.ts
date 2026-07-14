import type { Vec3 } from './geo';

// Команды, которыми внешний слой (ввод/сеть) управляет симуляцией.
export type Command =
  | { kind: 'detonate'; dir: Vec3; yield: number }
  | { kind: 'salvo' } // залп МБР: случайные старты с суши → случайные живые города (текущий yield)
  | { kind: 'setYield'; yield: number }
  | { kind: 'reset' }
  | { kind: 'toggleLabels' };
