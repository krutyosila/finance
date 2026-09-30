# Still uygulamasını kurma

Still aynı web arayüzünü telefon ve bilgisayarda kurulabilir uygulama olarak açar. Kurulum, ayrı bir finansal veritabanı veya çevrimdışı defter oluşturmaz. Web sürümünde veriler sunucuda; yerel sürümde veriler yerel hizmetin SQLite dosyasındadır.

## Kurulum

Üretim sitesi HTTPS üzerinden açılmalıdır. `localhost` ve `127.0.0.1` geliştirme için kullanılabilir; geliştirme sunucusunda service worker kaydedilmez.

- Android Chrome ve destekleyen masaüstü tarayıcılarda, giriş ekranındaki veya **Kişisel alanım** penceresindeki **Uygulamayı yükle** düğmesini kullanın. Düğme, tarayıcı kurulum olanağı sunduğunda görünür. Alternatif olarak tarayıcı menüsündeki kurulum seçeneğini kullanın.
- iPhone/iPad Safari’de **Paylaş → Ana Ekrana Ekle** seçeneğini kullanın.
- Diğer destekleyen tarayıcılarda tarayıcının uygulama kurulum menüsünü kullanın.

Kurulan uygulama kendi penceresinde açılır. Uygulama kimliği ve başlangıç adresi `/`, görünümü `standalone` olarak tanımlanmıştır. Manifestte 192 ve 512 piksel PNG simgeleri ile Android için ayrı bir maskable simge bulunur. Apple ana ekran simgesi 180 pikseldir; tüm simgeler yerel SVG kaynaklarından üretilmiştir.

## Giriş ve çıkış

Finansal arayüz açılmadan önce `/api/auth/session` doğrulanır. Korumalı web sürümünde giriş gereklidir; yerel modda bu doğrulama giriş ekranı gerektirmeyebilir. E-posta ve parola kaynak kodda sabit değildir. Form parola yöneticisini ve yapıştırmayı destekler.

Parola yalnızca giriş isteğinde gönderilir. Tarayıcıdaki JavaScript oturum çerezini okumaz; çerez sunucu tarafından yönetilir. Girişten sonra oturum yeniden doğrulanır. **Çıkış yap**, sunucu oturumunu sonlandırır ve finansal arayüzü kaldırır. Açık istekler iptal edilir; önceki oturuma ait gecikmiş yanıtların yeni ekrana ulaşması engellenir. Sunucuya ulaşılamazsa arayüz yine kapanır ve çıkışın sunucuda tamamlanamadığı açıkça belirtilir.

Finansal bir API isteği `401` döndürürse yanıt gövdesi beklenmeden giriş ekranına dönülür. Aynı tarayıcıdaki diğer sekmeler çıkış bildirimiyle finansal arayüzünü kapatır. BroadcastChannel yalnız `logout` ve `session-changed` sinyallerini taşır; finansal veri veya parola taşımaz, kalıcı depolama kullanmaz. Sayfa yeniden görünür olduğunda veya odaklandığında oturum yeniden denetlenir; geçerli bir oturumda açık form korunur. Geri/ileri önbelleğinden geri yüklenen sayfada finansal arayüz açılmadan oturum doğrulanır.

## Çevrimdışı sınırları ve önbellek

Service worker yalnızca üretim derlemesinde kaydedilir. Önbellek izin listesi `/assets/` altındaki uygulama dosyaları, manifest, simgeler ve `offline.html` ile sınırlıdır. Tüm `/api` istekleri ve GET dışındaki istekler service worker önbelleğini atlar. Başka bir adrese yönlendirilen dosya yanıtları da önbelleğe alınmaz. API istekleri tarayıcı HTTP önbelleği için de `cache: no-store` kullanır.

Finansal API yanıtları, giriş bilgileri ve dışa aktarılan kayıtlar Cache Storage, localStorage, sessionStorage veya IndexedDB’ye yazılmaz. Açılış sayfası ağdan istenir; çevrimdışıyken yalnızca bağlantı gerektiğini anlatan statik ekran gösterilir. Açık bir oturumdaki görüntülenen veriler yalnızca bellektedir; kalıcı çevrimdışı erişim sağlanmaz.

Yeni kayıt oluşturmak, kayıt değiştirmek, rapor okumak ve giriş yapmak sunucu bağlantısı gerektirir. Çevrimdışı işlemler sıraya alınmaz ve sonradan otomatik kaydedilmez. Yerel bilgisayarın veritabanı kendiliğinden telefona veya web sunucusuna aktarılmaz.

## Doğrulama

`npm run build`, manifest ve statik dosyaları `dist/` içine kopyalar. `tests/frontend-security.test.ts`, oturum değişiminde açık isteklerin iptalini, gecikmiş yanıtların reddini, API/cache ayrımını ve statik çevrimdışı açıklamayı doğrular. Kurulum isteminin görünümü tarayıcıya ve platforma bağlıdır; HTTPS üretim adresinde ayrıca denenmelidir.

Platform davranışları için [MDN kurulum rehberi](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [kurulum istemi](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt) ve [web.dev manifest rehberi](https://web.dev/learn/pwa/web-app-manifest) temel alınmıştır.
