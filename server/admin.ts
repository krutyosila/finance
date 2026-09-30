import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthService } from './auth';
export interface AdminRunOptions {
  auth?: AuthService;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}
export async function runAdmin(args: string[], options: AdminRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((text) => process.stdout.write(text)),
    stderr = options.stderr ?? ((text) => process.stderr.write(text));
  let service: AuthService | undefined;
  try {
    const values = new Map<string, string>();
    let reset = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--reset') {
        if (reset) throw new Error('--reset yalnızca bir kez kullanılabilir.');
        reset = true;
        continue;
      }
      if (
        !['--email', '--password-file'].includes(arg) ||
        !args[index + 1] ||
        args[index + 1].startsWith('--') ||
        values.has(arg)
      )
        throw new Error(
          'Kullanım: npm run admin -- --email EPOSTA --password-file DOSYA [--reset]. Parolayı komut satırına yazmayın.',
        );
      values.set(arg, args[++index]);
    }
    const address = values.get('--email'),
      passwordPath = values.get('--password-file');
    if (!address || !passwordPath)
      throw new Error('--email ve --password-file alanları gereklidir.');
    const path = resolve(passwordPath),
      stat = statSync(path);
    if (!stat.isFile() || stat.size > 8192)
      throw new Error('Parola dosyası normal bir dosya olmalı ve 8 KB sınırını aşmamalıdır.');
    if (
      process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
    )
      throw new Error(
        'Parola dosyası mevcut kullanıcıya ait olmalı ve yalnızca sahibi tarafından okunabilmelidir (chmod 600).',
      );
    const password = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    if (password.includes('\n') || password.includes('\r'))
      throw new Error('Parola dosyası tek satır içermelidir.');
    service = options.auth ?? new AuthService();
    const user = await service.provisionAdmin(address, password, { reset });
    stdout(`Yönetici hazır: ${user.email}\n`);
    return 0;
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : 'Yönetici oluşturulamadı.'}\n`);
    return 1;
  } finally {
    if (service && !options.auth) service.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runAdmin(process.argv.slice(2));
