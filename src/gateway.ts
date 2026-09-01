import { supabase } from './data'

/**
 * Same-origin helper for private gateway requests.
 * In cloud mode it forwards the current Supabase access token as Bearer auth.
 * In localStorage demo mode no Authorization header is added.
 */
export async function gatewayFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('accept', headers.get('accept') || 'application/json')

  if (supabase) {
    const { data, error } = await supabase.auth.getSession()
    if (!error && data.session?.access_token) {
      headers.set('authorization', `Bearer ${data.session.access_token}`)
    }
  }

  return fetch(input, { ...init, headers })
}
