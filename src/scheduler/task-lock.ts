import type { Pool } from 'pg'
/** Hold a session-level lock until the child has exited. Lost DB sessions abort the child. */
export async function withTaskLock<T>(pool: Pool, task: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const client = await pool.connect()
  const abort = new AbortController()
  const lost = () => abort.abort()
  client.on('error', lost)
  let locked = false, broken = false
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(741004,hashtext($1)) AS acquired', [task])).rows[0].acquired
    if (!locked) return null
    return await operation(abort.signal)
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(741004,hashtext($1))', [task]).catch(() => { broken = true })
    client.removeListener('error', lost)
    client.release(broken || abort.signal.aborted)
  }
}
