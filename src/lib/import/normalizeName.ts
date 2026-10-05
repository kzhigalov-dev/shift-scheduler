/** Отображаемое имя: без звёздочек и лишних пробелов. */
export function cleanName(raw: string): string {
  return raw.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Ключ сопоставления. Один человек записан по-разному: «Демонстрационная Полина»
 * и «Полина Демонстрационная», «Демонстрационный» со звёздочками и без. Сортировка слов
 * делает порядок неважным.
 */
export function nameKey(raw: string): string {
  return cleanName(raw)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}
