// Чистая (без three.js) логика выбора слота пула — вынесена из MissileView, чтобы
// поведение "какой слот свободен / пул полон" было юнит-тестируемо без моков three.
// Единственное требование к элементу — поле active; MissileSlot (three-зависимый) ему
// структурно удовлетворяет, так что MissileView передаёт свой this.slots как есть.

export interface SlotActivity {
  readonly active: boolean;
}

// Индекс первого свободного (active === false) слота, либо undefined, если пул полон.
// Никогда не возвращает индекс занятого слота — вызывающий код обязан трактовать
// undefined как "пул исчерпан", а не красть чужой слот.
export function findFreeSlotIndex(slots: readonly SlotActivity[]): number | undefined {
  const idx = slots.findIndex((s) => !s.active);
  return idx === -1 ? undefined : idx;
}
