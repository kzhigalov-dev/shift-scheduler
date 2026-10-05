import { randomBytes, scryptSync } from 'node:crypto';

let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, '');
// Длинный случайный пароль — основная защита от подбора (README: на бою — 24+ символов); короче 12 — отказ.
const MIN_LENGTH = 12;
if ([...password].length < MIN_LENGTH) {
  console.error(`Пароль короче ${MIN_LENGTH} символов — возьмите длинный случайный: openssl rand -base64 24`);
  console.error('Использование: read -s P && printf %s "$P" | node scripts/hash-password.mjs');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
console.log(`${salt}:${scryptSync(password, salt, 64).toString('hex')}`);
