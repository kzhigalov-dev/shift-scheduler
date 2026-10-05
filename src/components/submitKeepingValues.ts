import { startTransition, type FormEvent } from 'react';

/**
 * Обработчик onSubmit для формы с useActionState, который НЕ сбрасывает поля.
 *
 * React 19 после action, переданного в `<form action={…}>`, сбрасывает
 * неуправляемые поля (requestFormReset в startHostTransition). При ошибке
 * («На это время уже есть событие») введённое пропадало бы. Здесь action
 * вызывается вручную в переходе: `pending` у useActionState работает, а
 * сброса нет. При успехе поля обновит сервер (revalidatePath/redirect).
 *
 * Использовать вместе с `action={formAction}`: до гидратации форма уходит
 * POST'ом на server action, а не GET'ом с полями в адресе. После гидратации
 * React видит отменённое событие и запущенный переход и action второй раз
 * не вызывает (ветка defaultPrevented в плагине форм React DOM).
 */
export function submitKeepingValues(dispatch: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => dispatch(form));
  };
}
