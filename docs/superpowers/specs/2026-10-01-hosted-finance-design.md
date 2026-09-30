# Finance: açık kaynak, parola korumalı web ve PWA

Kullanıcı `finance` adlı herkese açık GitHub deposu, kendi Hestia sunucusu `SUNUCU_IP` üzerinde `finance.example.com`, Cloudflare yönlendirmesi, şifreli erişim, yönetici hesabı ve masaüstü/mobil kurulum istedi. Tarayıcıdan kurulan PWA seçimini açıkça onayladı.

## Tasarım

Finans servisi aynı kalır: SQLite kaynak kayıtları, API ve yerel CLI. Varsayılan yerel çalışma hâlâ loopback adresine bağlı ve sıfır finans kaydıyla başlar. Sunucu modu `FINANCE_PUBLIC_URL=https://finance.example.com` ile açıkça etkinleşir; Hestia HTTPS ters vekili yalnız loopback Node API adresine bağlanır. Sunucudaki kalıcı veri kaynak koddan ayrılır. Web ve PWA cihazları aynı sunucu kayıtlarına erişir; bu sürüm çevrimdışı finans kaydı birleştirmesi yapmaz.

Sunucu modu tek yönetici girişi ister. `admin@example.com` hesabı açık kullanıcı talebiyle hazırlanır; rastgele güçlü parola GitHub'a yazılmaz. Ayrı `auth.sqlite` içinde tuzlu scrypt parola özeti ve süreli, özetlenmiş oturumlar tutulur. HttpOnly/Secure/SameSite cookie, tam origin kontrolü, login deneme sınırı ve oturum iptali kullanılır. Finans API'si giriş olmadan erişilemez. CLI sadece sunucu dosya erişimine sahip kullanıcı için çalışır.

PWA: Türkçe giriş, manifest, yerel ikonlar, masaüstü/telefon kurulum desteği. Service worker yalnız statik uygulama dosyalarını önbelleğe alır; API yanıtları, finans verileri ve parola kaydedilmez. Sunucuya bağlantı yoksa kayıt oluşturma bekletilmeden açık hata verir.

MIT lisanslı public repo: sadece kaynak, test, şema ve belgeler. Veritabanı, .env, özel anahtar, parola, yedek, dışa aktarım ve deneme çıktısı hariç tutulur. CI test ve build çalıştırır. Güncelleme betiği veri yedeği alır, git fast-forward ile kaynak günceller ve başarılı build sonrası hizmeti yeniden başlatır.

Sunucuda mevcut Hestia alan adı ve diğer uygulamalar incelenir; yalnız finance alt alanı için ek yapılandırma yapılır. DNS/TLS ve çalışır login doğrulanmadan yayın tamamlandı denmez. SSH anahtarı kullanıcı tarafından eklenir; Cloudflare mevcut oturum/API yöntemi kullanıcıdan alınır.
