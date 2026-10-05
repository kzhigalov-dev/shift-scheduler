import { describe, it, expect } from 'vitest';
import {
  clipHtml, entitiesToHtml, escapeHtml, stripHtml, visibleLength, type MessageEntity,
} from '@/lib/telegram/html';

const b = (offset: number, length: number): MessageEntity => ({ type: 'bold', offset, length });
const i = (offset: number, length: number): MessageEntity => ({ type: 'italic', offset, length });

describe('escapeHtml', () => {
  it('экранирует &, <, >; кавычки и прочее не трогает', () => {
    expect(escapeHtml('A & B <C> "q" «Лунный свет»')).toBe('A &amp; B &lt;C&gt; "q" «Лунный свет»');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('entitiesToHtml', () => {
  it('без сущностей — экранированный текст', () => {
    expect(entitiesToHtml('a < b & c', [])).toBe('a &lt; b &amp; c');
  });

  it('вложенные теги; при одном начале внешний — длиннее, порядок во входе не важен', () => {
    expect(entitiesToHtml('abcdef', [b(0, 6), i(2, 2)])).toBe('<b>ab<i>cd</i>ef</b>');
    expect(entitiesToHtml('abcdef', [i(0, 3), b(0, 6)])).toBe('<b><i>abc</i>def</b>');
    expect(entitiesToHtml('abc', [b(0, 3), i(0, 3)])).toBe('<b><i>abc</i></b>');
  });

  it('пересечение — внутренний тег закрывается и открывается заново', () => {
    expect(entitiesToHtml('abcdef', [b(0, 4), i(2, 4)])).toBe('<b>ab<i>cd</i></b><i>ef</i>');
  });

  it('смещения в UTF-16: эмодзи из суррогатной пары занимает 2', () => {
    expect(entitiesToHtml('🎵 Лунный свет & <Co>', [b(3, 6)])).toBe('🎵 <b>Лунный</b> свет &amp; &lt;Co&gt;');
    expect(entitiesToHtml('x🎉y', [i(1, 2)])).toBe('x<i>🎉</i>y');
  });

  it('сообщение бота туда и обратно: заголовок жирным, текст из базы экранирован', () => {
    const text = '✅ Вас поставили на смену\n🗓 Пт, 10 июля\n🎵 Rock & <Roll>';
    expect(entitiesToHtml(text, [b(2, 22)]))
      .toBe('✅ <b>Вас поставили на смену</b>\n🗓 Пт, 10 июля\n🎵 Rock &amp; &lt;Roll&gt;');
  });

  it('text_link — ссылка с экранированным адресом; прочие виды — простым текстом', () => {
    expect(entitiesToHtml('ссылка', [{ type: 'text_link', offset: 0, length: 6, url: 'https://a.app/?q="x"&y' }]))
      .toBe('<a href="https://a.app/?q=&quot;x&quot;&amp;y">ссылка</a>');
    expect(entitiesToHtml('/shifts a.app', [{ type: 'bot_command', offset: 0, length: 7 }, { type: 'url', offset: 8, length: 5 }]))
      .toBe('/shifts a.app');
  });

  it('неверные сущности пропускаются', () => {
    const bad: MessageEntity[] = [
      b(-1, 2), b(2, 5), b(1, 0), b(0.5, 1), { type: 'toString', offset: 0, length: 1 },
      { type: 'text_link', offset: 0, length: 1 },
    ];
    expect(entitiesToHtml('abc', bad)).toBe('abc');
  });

  it('теги поддерживаемых видов', () => {
    const kinds = ['underline', 'strikethrough', 'spoiler', 'code', 'pre', 'blockquote'];
    expect(kinds.map((type) => entitiesToHtml('x', [{ type, offset: 0, length: 1 }]))).toEqual([
      '<u>x</u>', '<s>x</s>', '<tg-spoiler>x</tg-spoiler>', '<code>x</code>', '<pre>x</pre>', '<blockquote>x</blockquote>',
    ]);
  });
});

describe('видимая длина и обрезка', () => {
  it('visibleLength: теги не в счёт, &amp; — один символ, эмодзи — 2 (UTF-16)', () => {
    expect(visibleLength('<b>a&amp;b</b>🎉')).toBe(5);
    expect(visibleLength('<a href="https://a.app">ab</a>')).toBe(2);
  });

  it('clipHtml: влезает — как есть; режется содержимое, теги закрываются', () => {
    expect(clipHtml('<b>ab</b>', 5)).toBe('<b>ab</b>');
    expect(clipHtml('<b>абв</b>где', 2)).toBe('<b>аб</b>');
    expect(clipHtml('<i>x</i><b>yz</b>', 1)).toBe('<i>x</i>');
    expect(clipHtml('<b><i>abc</i></b>', 1)).toBe('<b><i>a</i></b>');
    expect(clipHtml('<a href="https://x">abc</a>d', 2)).toBe('<a href="https://x">ab</a>');
  });

  it('clipHtml: не режет &amp; и суррогатную пару', () => {
    expect(clipHtml('a&amp;b', 2)).toBe('a&amp;');
    expect(clipHtml('a&amp;b', 1)).toBe('a');
    expect(clipHtml('a🎉', 2)).toBe('a');
  });

  it('clipHtml: длинный текст — ровно max видимых символов', () => {
    const clipped = clipHtml(`<b>${'я'.repeat(5000)}</b>`, 4000);
    expect(visibleLength(clipped)).toBe(4000);
    expect(clipped.endsWith('</b>')).toBe(true);
  });
});

describe('stripHtml', () => {
  it('без тегов, ссылки на символы — обратно; одинокий «<» остаётся', () => {
    expect(stripHtml('<b>A &amp; B</b> &lt;3 <a href="x">ссылка</a> a<3')).toBe('A & B <3 ссылка a<3');
  });
});
