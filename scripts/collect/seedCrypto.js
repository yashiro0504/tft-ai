/**
 * 시드 선수 PUUID 보호.
 *
 * TFT_SEED_KEY(32바이트 이상 임의 문자열, GitHub secret) 하나에서 HKDF 로 두 키를 만든다.
 *  - hash : HMAC-SHA256(puuid) → 기본키·중복 제거 (원문을 몰라도 같은 선수인지 안다)
 *  - enc  : AES-256-GCM(puuid) → Riot 호출 직전에만 복호화
 * 키를 잃으면 시드만 다시 만들면 된다 (리그 목록에서 매일 갱신하므로 데이터 손실 없음).
 */
const crypto = require('crypto')

function deriveKeys(secret) {
  if (!secret || String(secret).length < 32) {
    throw new Error('TFT_SEED_KEY 는 32자 이상이어야 합니다 (예: openssl rand -base64 48)')
  }
  const ikm = Buffer.from(String(secret), 'utf8')
  const salt = Buffer.from('tft-lab/seed/v1')
  return {
    hashKey: Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('hash'), 32)),
    encKey: Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('enc'), 32)),
  }
}

function createSeedCrypto(secret) {
  const { hashKey, encKey } = deriveKeys(secret)
  return {
    hash(puuid) {
      return crypto.createHmac('sha256', hashKey).update(puuid).digest('hex')
    },
    encrypt(puuid) {
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv)
      const ct = Buffer.concat([cipher.update(puuid, 'utf8'), cipher.final()])
      return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')
    },
    decrypt(token) {
      const [iv, tag, ct] = String(token).split('.').map((s) => Buffer.from(s, 'base64url'))
      const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
    },
  }
}

module.exports = { createSeedCrypto }
