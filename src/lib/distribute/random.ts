import { randomInt } from 'node:crypto';
import type { RandomInt } from './distribute';

/** Источник случайности распределения на сервере: криптостойкий, без смещения по модулю. */
export const secureRandomInt: RandomInt = (max) => randomInt(max);
