import postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

let sqlInstance: Sql | null = null;

export function getSql(): Sql {
  if (sqlInstance) return sqlInstance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  sqlInstance = postgres(url, {
    onnotice: () => {},
    connection: { application_name: 'cw-manage-mcp' },
  });
  return sqlInstance;
}

export async function closeSql(): Promise<void> {
  if (sqlInstance) {
    await sqlInstance.end({ timeout: 5 });
    sqlInstance = null;
  }
}

export async function pingDb(): Promise<void> {
  const sql = getSql();
  await sql`SELECT 1`;
}
