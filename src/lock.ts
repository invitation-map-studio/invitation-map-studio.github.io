export const securityMode = 'pages-only'
const localKey = 'wedding-map-local-verifier'
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
export const configured = () =>
  import.meta.env.VITE_LOCK_VERIFIER || (isLocal ? localStorage.getItem(localKey) : null)
export const canSetup = () => isLocal && !configured()
const hex = (u: Uint8Array) => Array.from(u, (n) => n.toString(16).padStart(2, '0')).join('')
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: Uint8Array.from(salt.match(/../g)!, (v) => parseInt(v, 16)),
      iterations: 600000,
    },
    key,
    256,
  )
  return hex(new Uint8Array(bits))
}
export async function unlock(password: string) {
  if (password.length > 128) throw Error('이용 암호는 128자까지 입력할 수 있습니다.')
  if (canSetup()) {
    if (password.length < 12)
      throw Error('이 작업실에서 사용할 전용 문구를 12자 이상 입력해 주세요.')
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
    localStorage.setItem(localKey, `v1.600000.${salt}.${await derive(password, salt)}`)
    return
  }
  const verifier = configured() ?? ''
  if (!/^v1\.600000\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(verifier))
    throw Error('운영자가 이 배포의 이용 암호를 설정해야 합니다.')
  const [, , salt, hash] = verifier.split('.')
  if ((await derive(password, salt)) !== hash) throw Error('이용 암호를 다시 확인해 주세요.')
}
