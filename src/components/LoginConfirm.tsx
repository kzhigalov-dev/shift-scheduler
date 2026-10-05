import { Card, CardContent } from './ui/card';
import { SubmitButton } from './SubmitButton';

/**
 * «Войти как <Имя>?» — вход работника по ссылке только после нажатия (POST формы с server action):
 * GET ссылки ничего не меняет (ревью, L3). `closes` — какая роль этого браузера закроется; `fields` —
 * скрытые поля формы (код или токен ссылки и путь после входа).
 */
export function LoginConfirm({ name, closes, action, fields }: {
  name: string;
  closes: string | null;
  action: (form: FormData) => Promise<void>;
  fields: Record<string, string>;
}) {
  return (
    <Card className="w-full max-w-[360px] [--card-spacing:--spacing(6)]">
      <CardContent className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold break-words" data-allow-wrap>Войти как {name}?</h1>
        <p className="text-sm">Откроется кабинет работника: смены, свободные места и заработок.</p>
        {closes ? (
          <p className="w-full rounded-lg bg-status-warning-bg p-3 text-sm text-status-warning-fg" data-allow-wrap>{closes}</p>
        ) : null}
        <form action={action}>
          {Object.entries(fields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <SubmitButton className="h-11 w-full md:h-9">Войти</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
