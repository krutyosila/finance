# AI ile işlem girişi ve yönetici ayarları

Kullanıcı hızlı girişin OpenAI tarafından yorumlanıp açık işlemleri kaydetmesini istedi. OpenAI anahtarını uygulama panelinden eklemeyi ve mevcut giriş parolasını değiştirmeyi de istedi.

## Davranış

Hızlı giriş OpenAI Responses API ile bir işlem taslağı alır; eski kurallı ayrıştırıcıya dönmez. Tek açık işlem muhasebe servisi tarafından doğrulanıp kaydedilir. Eksik tutar, para birimi, borç/hesap seçimi, çelişki veya birden fazla ayrı işlem varsa kayıt yapılmaz; mevcut düzenleme formu açıklamayı gösterir. Elle işlem girişi kullanılmaya devam eder. API ve doğal dil CLI aynı AI işlem servisini çağırır.

Model serbest komut çalıştıramaz; yalnızca izinli JSON işlem alanlarını önerebilir. Hesap/borç adları ve kimlikleri, güncel yerel tarih ve kullanıcının notu gönderilir; bütün defter, bakiyeler, e-posta, parolalar ve API anahtarı prompt'a eklenmez. OpenAI istekleri store:false kullanır. Ağ, kota, kimlik veya biçim hatasında hiçbir finans kaydı oluşmaz. Aynı istemci istek kimliği tekrarlandığında kayıt yinelenmez; kimlik ve metin eşleşmesi kalıcı SQLite kaydıyla denetlenir.

## Ayarlar

Yalnız mevcut yetkili kullanıcı OpenAI anahtarını ve model adını yönetir. Başlangıç modeli gpt-5.4-mini; model değiştirilebilir. Anahtar kaynak ağacı dışındaki özel 600 izinli yapılandırma dosyasında saklanır; GET yalnız configured ve model döndürür. Anahtar veya sağlayıcı hata gövdesi günlük/yanıtlarda görünmez. Bağlantı testi model erişimini kontrol eder ve finans kaydı oluşturmaz.

Sunucu modunda mevcut parola doğrulanarak en az 16 karakterli yeni parola belirlenir; bütün oturumlar iptal edilir ve güvenli cookie temizlenir. Yerel modda parola bölümü kullanılmaz. HTTPS, mevcut origin kontrolü, oturum koruması ve finans verilerinin önbellekten dışlanması korunur.

## Doğrulama ve yayın

Testler geçici veritabanları ve sağlayıcı sınırında kontrollü yanıtlar kullanır: açık/belirsiz işlem, biçim/refusal/incomplete/ağ hatası, bilinmeyen referanslar, eşzamanlı ve tekrar istekler, yapılandırma gizliliği/izinler ve parola değişiminden sonra oturum iptali. Üretim defterine deneme işlemi kaydedilmez. Gerçek sağlayıcı bağlantısı, kullanıcının panelden kendi anahtarını eklemesiyle etkinleşir. Kod MIT depoya ve mevcut HTTPS sunucusuna yayımlanır; anahtar tanımlanana kadar arayüz bağlantının hazır olmadığını açıkça gösterir.
