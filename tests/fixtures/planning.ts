import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fixtureAdmin, literal } from './storage';

export function planningFixtureSQL(sql: string) {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Planning tests require local Supabase');
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_atelier-aurelia-studio',
      'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { throw new Error('Local planning fixture SQL failed'); }
}

export async function provisionPlanningOwner() {
  const email = `planning-${randomUUID()}@example.test`;
  const created = await fixtureAdmin().auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Cannot provision planning fixture user');
  const userId = literal(created.data.user.id);
  planningFixtureSQL(`do $$ declare account uuid; begin
    insert into public.accounts(name,created_by) values ('Planning admission acceptance',${userId}) returning id into account;
    insert into public.account_memberships(account_id,user_id,role) values(account,${userId},'owner');
  end $$;`);
  return email;
}
