/**
 * Разметка сообщений бота (`parse_mode: 'HTML'`): экранирование, HTML из `entities` нажатия,
 * длина и обрезка по видимому тексту, текст без тегов для повтора. Только чистые функции.
 */

/** Сущность разметки из сообщения Telegram (`message.entities`): смещение и длина — в единицах UTF-16. */
export type MessageEntity = { type: string; offset: number; length: number; url?: string };

/** Текст из базы и от людей (названия, имена, должности) — в HTML сообщения: `&`, `<`, `>`. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const escapeAttr = (text: string): string => escapeHtml(text).replace(/"/g, '&quot;');

/** Виды сущностей, которые переносятся тегами; прочие (url, mention, hashtag…) — простым текстом. */
const TAGS: Readonly<Record<string, string>> = {
  bold: 'b', italic: 'i', underline: 'u', strikethrough: 's', spoiler: 'tg-spoiler',
  code: 'code', pre: 'pre', blockquote: 'blockquote',
};

type Span = { offset: number; end: number; open: string; close: string; order: number };

function spanOf(e: MessageEntity, order: number, size: number): Span | null {
  const { offset, length } = e;
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length <= 0 || offset + length > size) return null;
  const end = offset + length;
  if (e.type === 'text_link') {
    return e.url ? { offset, end, open: `<a href="${escapeAttr(e.url)}">`, close: '</a>', order } : null;
  }
  const tag = Object.hasOwn(TAGS, e.type) ? TAGS[e.type] : undefined;
  return tag ? { offset, end, open: `<${tag}>`, close: `</${tag}>`, order } : null;
}

/**
 * Текст сообщения и его `entities` (так их присылает Telegram в нажатии) → HTML для `editMessageText`.
 * Смещения — в UTF-16, как индексы строки JS (эмодзи из суррогатной пары — 2). Вложенные сущности
 * сохраняются (при одном начале внешней считается более длинная); пересекающиеся — внутренняя
 * закрывается и открывается заново. Сущности вне текста или с неверными числами пропускаются.
 * Весь текст экранируется.
 */
export function entitiesToHtml(text: string, entities: readonly MessageEntity[]): string {
  const spans = entities
    .map((e, i) => spanOf(e, i, text.length))
    .filter((s): s is Span => s !== null)
    .sort((a, b) => a.offset - b.offset || b.end - a.end || a.order - b.order);
  const points = [...new Set([0, text.length, ...spans.flatMap((s) => [s.offset, s.end])])].sort((a, b) => a - b);
  const stack: Span[] = [];
  let out = '';
  let next = 0;
  points.forEach((pos, k) => {
    const reopen: Span[] = [];
    while (stack.some((s) => s.end === pos)) {
      const top = stack.pop();
      if (!top) break;
      out += top.close;
      if (top.end !== pos) reopen.unshift(top);
    }
    for (const s of reopen) {
      out += s.open;
      stack.push(s);
    }
    while (next < spans.length && spans[next].offset === pos) {
      out += spans[next].open;
      stack.push(spans[next]);
      next += 1;
    }
    if (k + 1 < points.length) out += escapeHtml(text.slice(pos, points[k + 1]));
  });
  return out;
}

/** Тег, ссылка на символ (`&amp;` и т. п.) или кусок текста. HTML бота строится только этим модулем и сборщиками сообщений. */
const TOKENS = /(<\/?[a-zA-Z][a-zA-Z-]*(?:\s[^<>]*)?>)|(&(?:amp|lt|gt|quot);)|([^<&]+|[<&])/g;
const DECODE: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

/** Длина видимого текста в единицах UTF-16 (так считает Telegram): теги не в счёт, `&amp;` — один символ. */
export function visibleLength(html: string): number {
  let n = 0;
  for (const [token, tag, entity] of html.matchAll(TOKENS)) {
    if (tag) continue;
    n += entity ? 1 : token.length;
  }
  return n;
}

/** Первые `n` единиц UTF-16 без половинки суррогатной пары. */
function cutUtf16(text: string, n: number): string {
  const head = text.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/**
 * Не длиннее `max` видимых символов: обрезается содержимое, а не теги — открытые теги
 * закрываются, `&amp;` и эмодзи не разрезаются. Влезает — возвращается как есть.
 */
export function clipHtml(html: string, max: number): string {
  if (visibleLength(html) <= max) return html;
  const open: string[] = [];
  let out = '';
  let used = 0;
  for (const [token, tag, entity] of html.matchAll(TOKENS)) {
    if (used >= max) break;
    if (tag) {
      const name = /^<\/?([a-zA-Z][a-zA-Z-]*)/.exec(tag)?.[1].toLowerCase() ?? '';
      if (!tag.startsWith('</')) open.push(name);
      else if (open.at(-1) === name) open.pop();
      out += tag;
      continue;
    }
    const size = entity ? 1 : token.length;
    if (used + size <= max) {
      out += token;
      used += size;
      continue;
    }
    if (!entity) out += cutUtf16(token, max - used);
    break;
  }
  return out + open.reverse().map((name) => `</${name}>`).join('');
}

/** Текст без тегов (для повтора без `parse_mode`): теги убираются, `&amp;` и т. п. — обратно в символы. */
export function stripHtml(html: string): string {
  let out = '';
  for (const [token, tag, entity] of html.matchAll(TOKENS)) {
    if (tag) continue;
    out += entity ? DECODE[entity] : token;
  }
  return out;
}
