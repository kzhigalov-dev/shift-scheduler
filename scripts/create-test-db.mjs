import postgres from 'postgres';

process.loadEnvFile('.env.local');

const target = new URL(process.env.DATABASE_URL_TEST);
const name = target.pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(name)) {
  throw new Error(`Имя тестовой базы должно оканчиваться на _test, получено: ${name}`);
}

const admin = new URL(target);
admin.pathname = '/postgres';
const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });

const exists = await sql`select 1 from pg_database where datname = ${name}`;
if (exists.length === 0) await sql.unsafe(`create database ${name}`);
console.log(exists.length === 0 ? `создана база ${name}` : `база ${name} уже есть`);
await sql.end();
