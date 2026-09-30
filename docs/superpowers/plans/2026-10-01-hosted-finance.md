# Finance sunucu ve PWA uygulama planı

**Hedef:** MIT lisanslı public finance deposu, parola korumalı finance.example.com ve kurulabilir masaüstü/mobil PWA.

**Mimari:** Mevcut ortak FinanceService korunur. Hosted auth server/auth.ts içinde, UI oturum kapısı src içinde, kalıcı SQLite sunucu veri dizininde.

## Kurallar

- Yerel varsayılan çalışma korunur; Node sunucu loopback dinler.
- Finans verileri, parolalar, anahtarlar ve .env GitHub'a girmez.
- Gerçek yönetici yalnız provisioning komutuyla eklenir; hesap finans kaydı değildir.
- Finans önbelleği veya otomatik kur/ödeme eklenmez.
- Dış bağlantılar kullanıcı tarafından verilen sunucu ve alan adıyla sınırlıdır.

## Bağımsız işler

- [ ] Backend: server/auth.ts ve admin.ts, server/app.ts/index.ts entegrasyonu. API sözleşmesi GET /api/auth/session → required/authenticated/user; POST login email/password; POST logout. Özel auth.sqlite, scrypt, güvenli session, origin ve login deneme sınırı. tests/auth.test.ts ile yetkisiz finans erişimi, doğru/yanlış parola, session/logout/CSRF, yerel geriye uyumluluk.
- [ ] UI/PWA: src oturum kapısı ve giriş/çıkış, manifest/ikonlar, üretimde statik service worker, kurulum eylemi ve çevrimdışı mesaj. Typecheck/build ve tarayıcıyla giriş/çıkış/manifest doğrulaması.
- [ ] Dağıtım/belgeler: MIT lisansı, .gitignore ve örnek env, systemd/Hestia ters vekil şablonları, güvenli güncelleme betiği, GitHub CI, Türkçe kullanım/kurulum/backup belgeleri.

## Entegrasyon ve yayın

- [ ] Kullanıcının SSH anahtarını eklemesini bekle; kullanıcı/port ve host parmak izini doğrula. Hestia/sunucu mevcut durumu salt okunur incele.
- [ ] Repo öncesi kaynak/secret dosya listesini incele, git başlat ve finance public reposunu oluştur/push et. Aynı ad varsa içeriği ezme.
- [ ] Birleşik testler ve build; bağımsız güvenlik incelemesi, bulunan hatalara regresyon.
- [ ] Sunucuda projeyi git reposundan kur, kalıcı boş finans DB ve tek admin hazırlama. Parolayı korunan yerel dosyada üret, server'a güvenli aktar, hash dışında saklama.
- [ ] Hestia alt alan ve HTTPS ters vekil ayarı, Cloudflare DNS. Mevcut projeleri bozmadan yeniden yüklemeden önce yapılandırma doğrula.
- [ ] Gerçek HTTPS uygulamada login olmadan finans API erişimi reddediliyor; doğru giriş, çıkış, telefon/masaüstü PWA meta ve kayıt akışı geçici doğrulama DB'sinde çalışıyor. Üretim finans DB sıfır, auth admin bir kayıt.
- [ ] Public repo, URL, kurulum, şifreyi güvenli alma dosyası ve kalan sınırları kullanıcıya ver.
