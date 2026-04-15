grant select on table public.subscriptions to authenticated;

drop policy if exists "subscriptions_select_own" on public.subscriptions;

create policy "subscriptions_select_own"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);
