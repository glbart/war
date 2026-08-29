// ПРО: данные обороны сторон и чистые функции перехвата (спека
// 2026-08-29-abm-escalation-victory-design.md §2). Без состояния: остаток перехватчиков
// живёт в Simulation, как и арсеналы.

import { ABM_COVER_ANGLE } from '../assets/config';
import { angleBetween, type Vec3 } from './geo';
import type { City } from './cities';
import type { FactionId } from './factions';

export interface Defense {
  interceptors: number; // сколько перехватчиков у стороны на партию (тратятся безвозвратно)
  abm: number; // шанс сбить одну боеголовку (0..1)
}

// Значения игровые, не справочные: сильная эшелонированная ПРО у США/России, точечная и
// очень эффективная у Израиля (мало, но метко), слабая у КНДР/Пакистана.
export const DEFENSES: Record<FactionId, Defense> = {
  usa: { interceptors: 14, abm: 0.55 },
  russia: { interceptors: 14, abm: 0.5 },
  china: { interceptors: 9, abm: 0.42 },
  europe: { interceptors: 8, abm: 0.45 },
  india: { interceptors: 5, abm: 0.35 },
  pakistan: { interceptors: 3, abm: 0.25 },
  dprk: { interceptors: 2, abm: 0.2 },
  israel: { interceptors: 6, abm: 0.7 },
  neutral: { interceptors: 0, abm: 0 }, // нейтральные не обороняются
};

export function interceptChance(id: FactionId): number {
  return DEFENSES[id].abm;
}

// Кто прикрывает точку удара: сторона ближайшего ЖИВОГО города в пределах ABM_COVER_ANGLE.
// ПРО защищает свою территорию, а не всю планету; удар в пустыню/океан не перехватывает никто.
export function defenderFor(cities: City[], target: Vec3): FactionId | undefined {
  let best: City | undefined;
  let bestAng = ABM_COVER_ANGLE;
  for (const c of cities) {
    const ang = angleBetween(c.dir, target);
    if (ang <= bestAng) {
      bestAng = ang;
      best = c;
    }
  }
  return best?.faction;
}
