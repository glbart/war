// Стороны конфликта (спеки 2026-08-29-factions-design.md и -nonproliferation-design.md):
// восемь ядерных держав, восемь стран-претендентов (оружия нет, программа есть) и псевдо-
// фракция «нейтральные» для всех прочих городов. Чистые данные и функции над ними — без
// three.js и без состояния: изменяемое (арсенал, живое население) живёт в Simulation.
//
// Принадлежность города задана ЯВНЫМ списком имён (не географией): границы по координатам
// пришлось бы выдумывать, а список сверяется с CITY_DATA тестом — опечатка в имени сразу
// красит тест. Город, не попавший ни в один список, — 'neutral'.

export type FactionId =
  // ядерные державы
  | 'usa'
  | 'russia'
  | 'china'
  | 'europe'
  | 'india'
  | 'pakistan'
  | 'dprk'
  | 'israel'
  // претенденты: оружия нет, но есть ядерная программа (спека 2026-08-29-nonproliferation)
  | 'iran'
  | 'saudi'
  | 'turkey'
  | 'egypt'
  | 'japan'
  | 'korea'
  | 'brazil'
  | 'safrica'
  | 'neutral';

export interface Faction {
  id: FactionId;
  name: string; // русское название для HUD
  color: [number, number, number]; // цвет стороны (r,g,b 0..1): маркеры городов, след ракеты
  arsenal: number; // стартовый запас боеголовок (игровая шкала, не реальные цифры)
  aspirant?: boolean; // страна без оружия, но со своей ядерной программой
}

// Порядок в этом списке = порядок строк в панели сторон HUD; 'neutral' всегда последний.
export const FACTIONS: readonly Faction[] = [
  { id: 'usa', name: 'США', color: [0.25, 0.5, 0.95], arsenal: 36 },
  { id: 'russia', name: 'Россия', color: [0.92, 0.24, 0.22], arsenal: 38 },
  { id: 'china', name: 'Китай', color: [0.95, 0.82, 0.2], arsenal: 14 },
  { id: 'europe', name: 'Европа', color: [0.25, 0.85, 0.8], arsenal: 12 },
  { id: 'india', name: 'Индия', color: [0.96, 0.55, 0.15], arsenal: 6 },
  { id: 'pakistan', name: 'Пакистан', color: [0.25, 0.75, 0.3], arsenal: 6 },
  { id: 'dprk', name: 'КНДР', color: [0.75, 0.3, 0.85], arsenal: 3 },
  { id: 'israel', name: 'Израиль', color: [0.55, 0.5, 0.95], arsenal: 4 },
  { id: 'iran', name: 'Иран', color: [0.15, 0.65, 0.5], arsenal: 0, aspirant: true },
  { id: 'saudi', name: 'Саудовская Аравия', color: [0.85, 0.75, 0.45], arsenal: 0, aspirant: true },
  { id: 'turkey', name: 'Турция', color: [0.9, 0.45, 0.45], arsenal: 0, aspirant: true },
  { id: 'egypt', name: 'Египет', color: [0.75, 0.65, 0.3], arsenal: 0, aspirant: true },
  { id: 'japan', name: 'Япония', color: [0.95, 0.6, 0.7], arsenal: 0, aspirant: true },
  { id: 'korea', name: 'Южная Корея', color: [0.5, 0.65, 0.9], arsenal: 0, aspirant: true },
  { id: 'brazil', name: 'Бразилия', color: [0.45, 0.8, 0.35], arsenal: 0, aspirant: true },
  { id: 'safrica', name: 'ЮАР', color: [0.7, 0.5, 0.3], arsenal: 0, aspirant: true },
  { id: 'neutral', name: 'Нейтральные', color: [0.62, 0.64, 0.68], arsenal: 0 },
];

// Страны-претенденты: у них нет оружия, но есть программа (sim/proliferation.ts).
export const ASPIRANTS: readonly Faction[] = FACTIONS.filter((f) => f.aspirant === true);

// Ядерные державы на старте партии (у претендентов арсенал появится, если они дойдут до бомбы).
export const NUCLEAR_POWERS: readonly Faction[] = FACTIONS.filter(
  (f) => f.id !== 'neutral' && f.aspirant !== true,
);

// Стороны, способные воевать (всё, кроме нейтральных) — источник списков для выбора
// агрессора/цели в симуляции и для селектов HUD.
export const BELLIGERENTS: readonly Faction[] = FACTIONS.filter((f) => f.id !== 'neutral');

// Города сторон (имена — как в CITY_DATA, src/sim/cities.ts). Спорные принадлежности не
// присваиваем: Тайбэй, Киев, Минск, Белград и т.п. остаются нейтральными (см. спеку §9).
export const FACTION_CITIES: Readonly<Record<Exclude<FactionId, 'neutral'>, readonly string[]>> = {
  usa: [
    'New York',
    'Los Angeles',
    'Chicago',
    'Dallas',
    'Houston',
    'Washington',
    'Miami',
    'Atlanta',
    'Philadelphia',
    'Boston',
    'Phoenix',
    'San Francisco',
    'Detroit',
    'Seattle',
    'Minneapolis',
    'San Diego',
    'Tampa',
    'St. Louis',
    'Baltimore',
    'Charlotte',
    'Orlando',
    'San Antonio',
    'Portland',
    'Sacramento',
    'Pittsburgh',
    'Austin',
    'Las Vegas',
    'Cincinnati',
    'Kansas City',
    'Cleveland',
    'Columbus',
    'Indianapolis',
    'Nashville',
    'Oklahoma City',
    'Salt Lake City',
    'New Orleans',
    'Memphis',
    'Honolulu',
    'Anchorage',
    'San Juan',
  ],
  russia: [
    'Moscow',
    'Saint Petersburg',
    'Novosibirsk',
    'Yekaterinburg',
    'Kazan',
    'Nizhny Novgorod',
    'Chelyabinsk',
    'Omsk',
    'Samara',
    'Rostov-on-Don',
    'Ufa',
    'Krasnoyarsk',
    'Voronezh',
    'Perm',
    'Volgograd',
    'Vladivostok',
    'Sochi',
    'Kaliningrad',
  ],
  china: [
    'Shanghai',
    'Beijing',
    'Chongqing',
    'Chengdu',
    'Tianjin',
    'Guangzhou',
    'Shenzhen',
    "Xi'an",
    'Suzhou',
    'Zhengzhou',
    'Hangzhou',
    'Wuhan',
    'Dongguan',
    'Qingdao',
    'Nanjing',
    'Foshan',
    'Shenyang',
    'Hong Kong',
  ],
  europe: [
    'London',
    'Paris',
    'Madrid',
    'Berlin',
    'Rome',
    'Milan',
    'Barcelona',
    'Munich',
    'Vienna',
    'Birmingham',
    'Manchester',
    'Hamburg',
    'Frankfurt',
    'Naples',
    'Lisbon',
    'Amsterdam',
    'Brussels',
    'Warsaw',
    'Budapest',
    'Athens',
    'Prague',
    'Copenhagen',
    'Stockholm',
    'Dublin',
    'Helsinki',
    'Oslo',
    'Bucharest',
    'Sofia',
    'Zurich',
  ],
  india: [
    'Delhi',
    'Mumbai',
    'Kolkata',
    'Bangalore',
    'Chennai',
    'Hyderabad',
    'Ahmedabad',
    'Surat',
    'Pune',
    'Jaipur',
    'Lucknow',
    'Kanpur',
    'Nagpur',
  ],
  pakistan: ['Karachi', 'Lahore', 'Rawalpindi', 'Faisalabad', 'Peshawar'],
  dprk: ['Pyongyang'],
  israel: ['Tel Aviv', 'Jerusalem'],
  iran: ['Tehran'],
  saudi: ['Riyadh', 'Jeddah'],
  turkey: ['Istanbul', 'Ankara', 'Izmir'],
  egypt: ['Cairo', 'Alexandria'],
  japan: ['Tokyo', 'Osaka', 'Nagoya', 'Fukuoka', 'Sapporo'],
  korea: ['Seoul', 'Busan'],
  brazil: [
    'São Paulo',
    'Rio de Janeiro',
    'Belo Horizonte',
    'Brasília',
    'Porto Alegre',
    'Recife',
    'Fortaleza',
    'Salvador',
    'Curitiba',
  ],
  safrica: ['Johannesburg', 'Cape Town', 'Durban'],
};

// Обратный индекс «имя города → сторона», строится один раз при загрузке модуля.
const CITY_TO_FACTION = new Map<string, FactionId>();
for (const [id, names] of Object.entries(FACTION_CITIES)) {
  for (const name of names) CITY_TO_FACTION.set(name, id as FactionId);
}

export function factionOfCity(name: string): FactionId {
  return CITY_TO_FACTION.get(name) ?? 'neutral';
}

export function factionById(id: FactionId): Faction {
  // FACTIONS покрывает все значения FactionId — обращение по неизвестному id невозможно
  // без каста, поэтому non-null здесь безопасен (а тест на полноту таблицы это стережёт).
  return FACTIONS.find((f) => f.id === id)!;
}

// Runtime-проверка id на границе применения команд/UI: значение может прийти из будущего
// сетевого слоя произвольным, а неизвестная сторона молча провалилась бы в «пускать некому».
export function isFactionId(v: unknown): v is FactionId {
  return typeof v === 'string' && FACTIONS.some((f) => f.id === v);
}
