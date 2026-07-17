import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { Address, Hex } from '@preflight/shared'

export class ReportSigner {
  private constructor(private readonly account: PrivateKeyAccount) {}

  static async create(dataDir: string, configuredKey?: Hex): Promise<ReportSigner> {
    let key = configuredKey
    if (!key) {
      await mkdir(dataDir, { recursive: true })
      const keyPath = join(dataDir, 'local-report-signer.key')
      try {
        key = (await readFile(keyPath, 'utf8')).trim() as Hex
      } catch {
        key = generatePrivateKey()
        await writeFile(keyPath, key, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      }
    }
    return new ReportSigner(privateKeyToAccount(key))
  }

  get issuer(): Address {
    return this.account.address
  }

  async sign(hash: Hex): Promise<Hex> {
    return this.account.signMessage({ message: { raw: hash } })
  }
}
