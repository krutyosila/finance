# HTTPS sunucusu: Hestia, systemd ve kalıcı SQLite

Bu kılavuz Ubuntu 22.04, Hestia Nginx + PHP-FPM ve `finance.example.com` için hazırlanmıştır. Kaynak deposu [krutyosila/finance](https://github.com/krutyosila/finance). Şablonlar kurulum araçlarıdır; dosyaların depoda bulunması uygulamanın yayımlandığını göstermez. Docker gerekmez.

Uygulama tek yönetici içindir. HTTPS Nginx üzerinde sonlanır; Node.js yalnızca `127.0.0.1:4317` dinler. Kaynak güncellemeleri kalıcı veritabanlarının dışında yapılır. Sistemin diğer Node.js uygulamaları, Hestia domainleri veya varsayılan web şablonları değiştirilmez.

## Dosya ve kullanıcı düzeni

| Yol                                    | Kullanım / izin                                               |
| -------------------------------------- | ------------------------------------------------------------- |
| `/opt/finance/runtime/node/`           | Ayrı resmi Node.js 22 runtime; root yönetir                   |
| `/opt/finance/repo/`                   | Git deposu; `finance-build` sahipliği                         |
| `/opt/finance/releases/`               | Kontrol edilmiş kaynak, bağımlılıklar ve `dist`; root:finance |
| `/opt/finance/current`                 | Çalışan release'e atomik değişen sembolik bağ                 |
| `/var/cache/finance-build/`            | Ayrı build kullanıcısının npm önbelleği                       |
| `/var/lib/finance/data/finance.sqlite` | Özel finans defteri; finance kullanıcısı                      |
| `/var/lib/finance/data/auth.sqlite`    | Yönetici hash'i ve hash'lenmiş oturumlar; finance kullanıcısı |
| `/var/lib/finance/backups/`            | Finans SQLite yedekleri ve metadata yan dosyaları             |
| `/var/lib/finance/auth-backups/`       | Ayrı kimlik SQLite yedekleri                                  |
| `/var/lib/finance/exports/`            | Özel finans JSON/CSV dışa aktarmaları                         |
| `/etc/finance/finance.env`             | Root sahipli, izinleri 600 olan harici yapılandırma           |

`FINANCE_DB` yolunda `data/finance.sqlite` düzenini koruyun: finans yedeği ve dışa aktarma klasörleri veritabanı klasörünün bir üstünde oluşturulur. Kimlik yedekleme yardımcısı da aynı kökü kullanır; `FINANCE_AUTH_BACKUP_DIR` ile yalnız kimlik yedeği konumu değiştirilebilir.

Hizmet hesabı `finance` yalnız kalıcı state alanına yazabilir. Derleme hesabı `finance-build` özel state alanına erişmez. Finans/kimlik dosyaları, WAL/SHM yardımcıları ve yedekler web docroot'una konulmaz; Nginx bunları servis etmez.

## İlk kurulum

Aşağıdaki sunucu komutlarını root olarak çalıştırın. Yeni kurulum içindir; mevcut veritabanlarının üstüne boş dosya kopyalamayın. Gerekli araçlar: Git, curl, tar/xz, build-essential, Python 3, util-linux ve systemd. Node 22 native SQLite bağımlılığını derleyebilmelidir.

```sh
useradd --system --user-group --home-dir /var/lib/finance --shell /usr/sbin/nologin finance
useradd --system --user-group --home-dir /var/cache/finance-build --shell /usr/sbin/nologin finance-build
install -d -m 755 /opt/finance /opt/finance/releases /opt/finance/runtime
install -d -o finance -g finance -m 700 /var/lib/finance /var/lib/finance/data
install -d -o finance-build -g finance-build -m 700 /var/cache/finance-build
install -d -o root -g root -m 700 /etc/finance
install -d -o finance-build -g finance-build -m 700 /opt/finance/repo
runuser -u finance-build -- git clone https://github.com/krutyosila/finance.git /opt/finance/repo
```

Node.js 22.13 veya daha yeni bir **22.x** Linux x64 dağıtımını [resmi Node.js arşivinden](https://nodejs.org/dist/) seçin. İndirdiğiniz arşivin SHA-256 değerini aynı sürümün resmi `SHASUMS256.txt` kaydıyla doğrulayın; doğrulanmış arşivi `/opt/finance/runtime/node/` içine açın. `node`, `npm` ve ilgili dosyalar bu dizin altında kalır. Sistem `/usr/bin/node` bağlantısını veya global Node sürümünü değiştirmeyin.

```sh
/opt/finance/runtime/node/bin/node --version
PATH=/opt/finance/runtime/node/bin:/usr/bin:/bin /opt/finance/runtime/node/bin/npm --version
```

Harici ortam dosyasını `.env.example` örneğine göre oluşturun. İçine parola yazmayın. `FINANCE_PUBLIC_URL` yalnız HTTPS kaynağı içermelidir; yol/sorgu/kullanıcı eklemeyin:

```dotenv
FINANCE_PORT=4317
FINANCE_TIMEZONE=Europe/Istanbul
FINANCE_PUBLIC_URL=https://finance.example.com
FINANCE_DB=/var/lib/finance/data/finance.sqlite
FINANCE_AUTH_DB=/var/lib/finance/data/auth.sqlite
FINANCE_NODE_BIN=/opt/finance/runtime/node/bin/node
```

```sh
chown root:root /etc/finance/finance.env
chmod 600 /etc/finance/finance.env
```

Bu dosya root tarafından yönetilen düz `KEY=value` satırları içermelidir; güncelleme betiği dosyayı shell ile yükler. Kullanıcı yüklemesi veya web üzerinden düzenleme kabul etmez.

İlk release'i kaynak commit'inden oluşturup ayrı kullanıcıyla doğrulayın:

```sh
finance_first_release="/opt/finance/releases/$(date -u +%Y%m%dT%H%M%SZ)-initial"
install -d -o finance-build -g finance-build -m 700 "$finance_first_release"
runuser -u finance-build -- git -C /opt/finance/repo archive HEAD | tar -xf - -C "$finance_first_release"
chown -R finance-build:finance-build "$finance_first_release"
cd "$finance_first_release"
runuser -u finance-build -- env PATH=/opt/finance/runtime/node/bin:/usr/bin:/bin NODE_ENV=development /opt/finance/runtime/node/bin/npm ci --include=dev --cache /var/cache/finance-build/npm
runuser -u finance-build -- env PATH=/opt/finance/runtime/node/bin:/usr/bin:/bin NODE_ENV=development /opt/finance/runtime/node/bin/npm test
runuser -u finance-build -- env PATH=/opt/finance/runtime/node/bin:/usr/bin:/bin NODE_ENV=production /opt/finance/runtime/node/bin/npm run build
chown -R root:finance "$finance_first_release"
chmod -R g+rX,o-rwx "$finance_first_release"
ln -s "$finance_first_release" /opt/finance/current
```

`tsx` çalışma zamanı için gerektiğinden devDependencies kurulur; `npm ci --omit=dev` bu düzene uygun değildir. Testler geçici SQLite dosyaları kullanır; bu aşamada gerçek deftere kayıt eklenmez. Kaynak indirmeyi/build'i hizmet hesabında veya finans ortamı yüklenmiş bir shell'de yapmayın.

Boş finans şemasını doğru kalıcı konumda başlatın. Bu komut örnek işlem/hesap/borç oluşturmaz:

```sh
cd /opt/finance/current
runuser -u finance -- env PATH=/opt/finance/runtime/node/bin:/usr/bin:/bin FINANCE_DB=/var/lib/finance/data/finance.sqlite /opt/finance/runtime/node/bin/node --import tsx server/migrate.ts
```

## Yönetici oluşturma ve sıfırlama

Yönetici e-postası `admin@example.com`. Kayıt olma ucu yoktur. En az 16 karakterli parolayı güvenli parola yöneticisinde oluşturun ve yalnızca sahibinin okuyabildiği tek satırlı geçici dosyaya aktarın. Parolayı shell argümanı, Git dosyası, `.env`, günlük veya GitHub secret olarak kullanmayın.

Parola dosyasının sahibi komutu çalıştıran kullanıcı olmalıdır. Root sahipli `/root/finance-admin-password.txt` için:

```sh
chmod 600 /root/finance-admin-password.txt
cd /opt/finance/current
FINANCE_AUTH_DB=/var/lib/finance/data/auth.sqlite /opt/finance/runtime/node/bin/node --import tsx server/admin.ts --email admin@example.com --password-file /root/finance-admin-password.txt
for finance_auth_file in /var/lib/finance/data/auth.sqlite /var/lib/finance/data/auth.sqlite-wal /var/lib/finance/data/auth.sqlite-shm; do
  if [ -e "$finance_auth_file" ]; then chown finance:finance "$finance_auth_file"; chmod 600 "$finance_auth_file"; fi
done
```

Yerel geliştirme komutu `npm run admin -- --email admin@example.com --password-file PATH` ile aynıdır. Mevcut yönetici parolasını değiştirmek için aynı komuta **`--reset`** ekleyin. Reset bütün önceki oturumları iptal eder. Sunucuda reset bakımında hizmeti durdurun, komutu çalıştırın, dosya sahipliğini tekrar finance hesabına verip hizmeti başlatın. Geçici parola dosyasını parola yöneticisine aktardıktan sonra kaldırın; parola çıktıya yazılmaz.

Kimlik veritabanı ayrı tutulur. Parola, her yönetici için rastgele 32 bayt salt ile scrypt `N=131072, r=8, p=1` kullanılarak 64 bayt hash'e dönüştürülür; bellek üst sınırı 256 MiB'dir. Bu parametreler [OWASP parola saklama önerileriyle](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) hizalıdır. Oturum belirteçleri de hash olarak saklanır. Salt/hash içeren auth yedeği yine özel veridir.

## systemd hizmeti

```sh
install -o root -g root -m 644 /opt/finance/current/deploy/finance.service /etc/systemd/system/finance.service
systemd-analyze verify /etc/systemd/system/finance.service
systemctl daemon-reload
systemctl enable --now finance.service
systemctl status finance.service --no-pager
```

Unit ayrı Node runtime ile uygulamayı `finance` olarak başlatır, `/opt/finance/current` kaynağını salt okunur tutar ve `/var/lib/finance` yazımına izin verir. PID/kilit dosyaları gerçek finans DB klasöründe tutulur. Port 4317'yi dış dünyaya açmayın. Hizmeti durdurmak için `systemctl stop finance.service`, başlatmak için `systemctl start finance.service` kullanın. Sunucu servisinde terminali kapatmak hizmeti durdurmaz. Günlükler: `journalctl -u finance.service -n 100 --no-pager`.

## Hestia ve Cloudflare

Cloudflare DNS'te `finance.example.com` A kaydını sunucu IP'sine yönlendirin. Proxy kullanılıyorsa SSL/TLS modu **Full (strict)** olmalı; origin üzerinde bu domain için geçerli Let's Encrypt veya Cloudflare Origin CA sertifikası bulunmalıdır. [Cloudflare Full (strict) koşulları](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), origin sertifikasının doğrulanmasını gerektirir.

Hestia'da domaini seçilmiş web kullanıcısına ekleyin; kullanıcı adını kendi Hestia hesabınıza göre seçin. Yalnız hedef domain için yeni web şablonu kullanın:

```sh
install -m 644 /opt/finance/current/deploy/hestia/finance.tpl /usr/local/hestia/data/templates/web/nginx/php-fpm/finance.tpl
install -m 644 /opt/finance/current/deploy/hestia/finance.stpl /usr/local/hestia/data/templates/web/nginx/php-fpm/finance.stpl
```

Hestia panelinde **finance.example.com → Düzenle → Gelişmiş → Web şablonu → finance** seçin ve kaydedin; SSL/Let's Encrypt açık olsun. Bu seçim başka domainleri etkilemez. HTTP şablonu ACME doğrulama yolunu korur, kalan istekleri HTTPS'e yönlendirir. HTTPS şablonu tüm uygulama yollarını loopback API'ye geçirir; Host ve `X-Forwarded-Proto: https` başlıklarını sağlar. Native Nginx + PHP-FPM için `%web_port%`/`%web_ssl_port%` yer tutucuları kullanılır.

`deploy/nginx-finance.conf`, mevcut Nginx sunucu bloğu için alternatif location örneğidir; aynı blokta ikinci `location /` olarak eklemeyin. Hestia'nın oluşturduğu domain yapılandırmasını doğrudan düzenlemek yerine özel şablon kullanın; Hestia bu yapılandırmaları yeniden oluşturabilir. [Hestia özel şablon kılavuzu](https://hestiacp.com/docs/server-administration/web-templates) bunu açıklar. Proxy başlıkları [Nginx proxy modülü](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) tarafından ayarlanır.

Değişiklik sonrası `nginx -t` başarılı olmadan reload yapmayın. Domainin `/api/*` yanıtlarına Cloudflare Cache Everything kuralı uygulamayın; API `no-store` kullanır. Cloudflare oturum çerezlerini kaldıran kurallar kullanmayın. Uygulama, Cloudflare IP listesini ayrı güvenilir proxy olarak tanımaz; hız sınırı Nginx'in ilettiği istemci IP'sini kullanır. Origin'e doğrudan erişimle istemci IP başlığı güveni, ilgili Nginx real-IP/firewall politikasında ayrıca yönetilir.

Kontrol komutları:

```sh
curl --fail --silent https://finance.example.com/api/health
curl --fail --silent http://127.0.0.1:4317/api/health -H 'Host: finance.example.com' -H 'X-Forwarded-Proto: https'
curl --silent --output /dev/null --write-out '%{http_code}\n' https://finance.example.com/api/context
```

Sağlık sonucu `{ "status": "ok", "local": false }`, girişsiz finans isteği **401** olmalıdır. Tarayıcıda yöneticinin giriş/çıkışını kontrol edin; ilk kurulumda gerçek finans verisi yoksa sayaçlar sıfır kalır. Mutasyon yapan test isteklerini gerçek deftere göndermeyin. PWA yükleme ve çevrimdışı sınırları [PWA.md](PWA.md) dosyasındadır.

## Yedekleme, dışa aktarma ve geri yükleme

CLI'yi sunucuda **doğru `FINANCE_DB`** ile, `/opt/finance/current` içinde çalıştırın. Yerel ve sunucu defterleri eşitlenmez:

```sh
cd /opt/finance/current
runuser -u finance -- env FINANCE_DB=/var/lib/finance/data/finance.sqlite /opt/finance/runtime/node/bin/node --import tsx server/cli.ts backup --json
runuser -u finance -- env FINANCE_DB=/var/lib/finance/data/finance.sqlite FINANCE_AUTH_DB=/var/lib/finance/data/auth.sqlite /opt/finance/runtime/node/bin/node scripts/backup-auth.mjs
runuser -u finance -- env FINANCE_DB=/var/lib/finance/data/finance.sqlite /opt/finance/runtime/node/bin/node --import tsx server/cli.ts export --json
```

Finans yedeği SQLite ve `.sqlite.metadata.json` dosyasını birlikte üretir; kimlik yedeği ayrı dizinde SQLite snapshot'ı üretir. İkisi de WAL içindeki tamamlanmış kayıtları tutarlı biçimde içerir. Finans export'u auth verisini içermez. Snapshot'lar birbirinden bağımsızdır; tek ortak veritabanı transaction'ı değildir. Dosya izinleri 600 olur. Yedekler şifrelenmez; sunucu dışına kopyalanacaksa erişimi sınırlandırın ve kendi şifreli yedek konumunuzu kullanın. Bu proje otomatik uzak yedek veya zamanlanmış yedek oluşturmaz.

Finans geri yüklemesinde önce API'yi ve aynı veritabanını kullanan diğer CLI işlemlerini durdurun:

```sh
systemctl stop finance.service
cd /opt/finance/current
runuser -u finance -- env FINANCE_DB=/var/lib/finance/data/finance.sqlite /opt/finance/runtime/node/bin/node --import tsx server/cli.ts restore-backup /var/lib/finance/backups/finance-YYYY-MM-DD-HHmm.sqlite --json
systemctl start finance.service
```

Komut çalışan API'yi, farklı kaynak yolunu, farklı şemayı veya bozuk yedeği reddeder; önce mevcut finans defterinin güvenlik yedeğini alır, sonra WAL checkpoint ve atomik değiştirme yapar. Çıktıdaki `safetyBackup` dosyasını doğrulama tamamlanana kadar saklayın. Bu komut başka bir sunucu yoluna taşıma veya şema düşürme yapmaz. Finans rollback'i auth DB'yi değiştirmez.

Kimlik snapshot'ı için ayrı otomatik restore komutu yoktur. Auth kurtarmasında hizmet durmalı, mevcut auth DB ve WAL/SHM durumu korunmalı, yedeğin bütünlüğü/şeması doğrulanmalı ve hedef dosya finance:finance/600 izinleriyle atomik değiştirilmelidir. Eski oturumlar yedekte bulunabilir; kurtarma sonrası admin `--reset` ile yeni parola oluşturup tüm oturumları iptal edin. Bu işlemi finans `restore-backup` komutuyla veya açık SQLite dosyalarını gelişigüzel kopyalayarak yapmayın.

## Güvenli kaynak güncellemesi

İlk kurulum tamamlandıktan sonra root olarak:

```sh
/opt/finance/current/scripts/deploy-update.sh
```

Betik harici root:600 yapılandırmayı ve kalıcı iki veritabanını kontrol eder. Aynı anda tek güncelleme çalışır. Yerel değişiklik varsa veya Git kaynağı detached HEAD ise durur. Çalışan kaynakla **önce finans ve kimlik yedeği** alır; sonra `git pull --ff-only` yapar. Yeni commit ayrı staging alanında `finance-build` kullanıcısıyla `npm ci`, testler ve derleme tamamlanmadan etkinleştirilmez. Gizli DB/ortam değişkenleri build/test sürecinden çıkarılır.

Kontroller geçince yeni release root:finance olur, `current` bağı atomik değiştirilir ve yalnız finance hizmeti yeniden başlatılır. Sağlık kontrolü başarısızsa kaynak bağı önceki release'e alınır ve hizmet yeniden başlatılır. **Veritabanları otomatik eski snapshot'a alınmaz**: yeni sürümün şema değişimi eski kodla uyumlu olmayabilir. Bu durumda günlükleri ve ayrı yedekleri inceleyin; kontrollü geri yükleme yapın. Git force/reset, DB silme veya eski release'lerin otomatik temizliği yapılmaz. Başarılı sürümlerin retention/yedek saklama süresi sunucu sahibi tarafından yönetilir.

Varsayılan dışındaki kurulum için betik `FINANCE_INSTALL_ROOT`, `FINANCE_ENV_FILE`, `FINANCE_BUILD_USER`, `FINANCE_SERVICE_USER`, `FINANCE_SERVICE_NAME` değişkenlerini kabul eder. Systemd unit'i ve dizin/grup izinlerini aynı düzene göre güncellemek gerekir. Sabit production yollarının dışındaki değerler otomatik kurulmaz.

GitHub Actions yalnız public kaynak üzerinde Node 22 ile `npm ci`, test ve derleme yapar; eylemler resmi v7 commit kimliklerine sabitlenmiştir. Actions'a deploy parolası veya root SSH anahtarı verilmez; bu repoda otomatik SSH deploy işi yoktur. Güncelleme sunucuda yetkili kullanıcı tarafından başlatılır.
