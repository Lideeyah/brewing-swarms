/**
 * Silently refresh a Google OAuth implicit-flow token using a tiny popup.
 * The popup loads /dashboard, detects it's in popup context, posts the token
 * back via postMessage, and closes itself — no user interaction needed.
 */
export async function silentRefreshGoogle(
  clientId: string,
  scope: string,
  stateKey: string,
): Promise<string> {
  const redirectUri = `${window.location.origin}/dashboard`
  const silentState = `${stateKey}_silent`

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'token',
    scope,
    prompt:        'none',
    state:         silentState,
  })

  return new Promise((resolve, reject) => {
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'google_silent_refresh',
      'width=1,height=1,left=-2000,top=-2000',
    )
    if (!popup) { reject(new Error('popup_blocked')); return }

    const tid = setTimeout(() => {
      window.removeEventListener('message', onMsg)
      popup.close()
      reject(new Error('timeout'))
    }, 15_000)

    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'google_silent_token') return
      if (e.data?.state !== silentState) return
      clearTimeout(tid)
      window.removeEventListener('message', onMsg)
      if (e.data.token) resolve(e.data.token)
      else reject(new Error(e.data.error ?? 'no_token'))
    }
    window.addEventListener('message', onMsg)
  })
}
