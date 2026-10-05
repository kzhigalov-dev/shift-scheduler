const NBSP = '\u00a0';

/**
 * Склонение существительного по числу для интерфейса на русском:
 * `forms` — [одна, две..четыре, пять..и остальные], например
 * `pluralRu(n, ['смена', 'смены', 'смен'])`.
 */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/**
 * Дата `YYYY-MM-DD` → «9 июля» без опций, «Чт, 9 июля» с `weekday: 'short'`,
 * «Четверг, 9 июля» с `weekday: 'long'`. Порядок слов выбирает сам Intl для
 * ru-RU (с днём недели он ставит его первым) — здесь только доопределяем
 * заглавную первую букву. Число и месяц связаны неразрывным пробелом.
 * Единое место для всех дат в интерфейсе.
 */
export function formatDate(date: string, options?: { weekday?: 'short' | 'long' }): string {
  const [y, m, d] = date.split('-').map(Number);
  const text = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', timeZone: 'UTC',
    ...(options?.weekday ? { weekday: options.weekday } : {}),
  }).format(new Date(Date.UTC(y, m - 1, d)));
  // «9 июля» — число и месяц неразрывно; запятая после дня недели — обычный пробел.
  const tight = text.replace(/(\d+)\s+/u, `$1${NBSP}`);
  return `${tight[0].toUpperCase()}${tight.slice(1)}`;
}

/** Сумма в рублях: «1 300 ₽» — разряды и знак ₽ связаны неразрывными пробелами. Единое место для денег в интерфейсе. */
export function formatMoney(amount: number): string {
  const digits = amount.toLocaleString('ru-RU').replace(/\s/gu, NBSP);
  return `${digits}${NBSP}₽`;
}

/** Ставка одной суммой или «от–до»: «2 000 ₽», «1 500–2 000 ₽». */
export function formatMoneyRange(range: { min: number; max: number }): string {
  if (range.min === range.max) return formatMoney(range.min);
  const from = range.min.toLocaleString('ru-RU').replace(/\s/gu, NBSP);
  return `${from}–${formatMoney(range.max)}`;
}

/**
 * Размер файла: «512 Б», «678 КБ», «1,2 МБ» — число и единица связаны неразрывным пробелом.
 * Килобайты целые; всё, что округляется до 1024 КБ, — уже мегабайты с одним знаком после запятой.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}${NBSP}Б`;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${kb}${NBSP}КБ`;
  const mb = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024);
  return `${mb.replace(/\s/gu, NBSP)}${NBSP}МБ`;
}

/**
 * Дата для ответов бота: «пт, 10 июля» (`month: 'long'`) или «пт, 10 июл.» (`'short'`, подписи кнопок).
 * С маленькой буквы — строка списка или подпись после двоеточия. Число и месяц — неразрывно.
 */
export function formatBotDay(date: string, month: 'long' | 'short' = 'long'): string {
  const [y, m, d] = date.split('-').map(Number);
  const text = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short', day: 'numeric', month, timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return text.replace(/(\d+)\s+/u, `$1${NBSP}`);
}

/** Число и склонённая единица без разрыва строки. */
export function formatCount(n: number, forms: [string, string, string]): string {
  return `${n.toLocaleString('ru-RU').replace(/\s/gu,NBSP)}${NBSP}${pluralRu(n,forms)}`;
}

/** «в понедельник», «во вторник» … — по номеру дня недели (`getUTCDay`, 0 — воскресенье); предлог связан неразрывно. */
const WEEKDAYS_ACCUSATIVE = [
  'в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу',
].map((w) => w.replace(' ', NBSP));

/**
 * Дата словами относительно `today` (обе `YYYY-MM-DD`): «сегодня», «завтра»,
 * дальше — «в субботу, 10 октября»; в другом году — с годом («в пятницу, 8 января 2027»).
 * Со строчной: в начале строки первую букву делает заглавной вёрстка.
 */
export function dateInWords(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  const weekday = WEEKDAYS_ACCUSATIVE[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${formatDate(date)}${y === ty ? '' : ` ${y}`}`;
}
