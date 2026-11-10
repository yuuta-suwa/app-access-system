// ローカル PostgreSQL（疑似 Supabase）に対する認可テスト用ヘルパ
// 実際の Supabase では PostgREST が JWT を検証した上で
//   SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{...}'
// を発行して SQL を実行する。ここではその挙動を直接再現する。
import pg from 'pg';

export const conn = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 55432),
  user: 'postgres',
  database: process.env.PGDATABASE ?? 'leihub',
};

export async function superuser(sql, params = []) {
  const c = new pg.Client(conn);
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

/**
 * 指定ユーザー（または anon）として 1 トランザクションで SQL を実行する。
 * @param {string|null} uid  auth.users.id。null なら anon ロール
 */
export async function as(uid, sql, params = []) {
  const c = new pg.Client(conn);
  await c.connect();
  try {
    await c.query('begin');
    if (uid) {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
    } else {
      await c.query('set local role anon');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    }
    const res = await c.query(sql, params);
    await c.query('commit');
    return { rows: res.rows, rowCount: res.rowCount };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

/** 拒否（例外）を期待。返り値はエラー */
export async function denied(uid, sql, params = []) {
  try {
    await as(uid, sql, params);
  } catch (e) {
    return e;
  }
  throw new Error(`expected denial but succeeded: ${sql}`);
}

export async function createAuthUser(email, name) {
  const [row] = await superuser(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data, last_sign_in_at)
     values ($1, now(), jsonb_build_object('full_name', $2::text), now()) returning id`,
    [email, name],
  );
  return row.id;
}
