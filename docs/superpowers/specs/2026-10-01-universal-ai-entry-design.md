# Tüm finans kayıtları için AI girişi

Kullanıcı, önceki mesajda önerilen eksik bilgileri soran ve onay isteyen AI girişini hesap, abonelik, borç ve düzenli ödemeler için de istedi. Bu talep mevcut tasarımın uygulama yetkisidir.

## Yaklaşım

Aynı hızlı giriş alanı bir veya birden fazla finans kaydını yorumlar. Yalnız mevcut işlem ayrıştırıcısını büyütmek hesap ve abonelikleri işlem gibi kaydetme riskini taşır. Ayrı giriş alanları ise kullanıcının önce kayıt türünü seçmesini gerektirir. Seçilen yaklaşım, tek giriş alanından türü belirlenmiş kayıt planı üretmek ve planı onayla atomik kaydetmektir.

Desteklenen oluşturma türleri: transaction, account, debt, obligation, subscription, cycle. Mevcut kayıtları silme/düzenleme, banka bağlantısı ve dosya içe aktarma kapsam dışındadır. Planlı bir ödemeyi tanımlamak harcama oluşturmaz; gerçekleşmiş ödeme açıkça belirtilmişse bağlı transaction oluşturulur.

## Akış

1. Kullanıcı Türkçe metin veya çok satırlı liste yazar.
2. AI bütün kayıtları JSON şemalı bir plana dönüştürür. Maksimum 12.000 karakter ve 25 kayıt.
3. Sunucu mevcut muhasebe servisini geri alınan SQLite işlemi içinde çalıştırarak bütün planı doğrular. Önizleme hiçbir kayıt, denetim izi veya makbuz bırakmaz.
4. Arayüz Türkçe tür adları, tutarlar, hesap bağlantıları ve tarihlerle bütün kayıtları gösterir.
5. Eksik veya belirsiz ayrıntılar soru olarak gösterilir. Kullanıcı ek bilgi verir; aynı özgün metin ve biriken ek bilgiler tekrar yorumlanır. Sonraki açıklama önceki ayrıntıyı düzeltebilir.
6. Geçerli plan kullanıcının açık onayından sonra tek SQLite işlemi içinde kaydedilir. Herhangi bir hata tüm planı geri alır. Aynı istek kimliği ve aynı plan tekrar gönderilirse yeni kayıt oluşturulmaz.

## Sınırlar ve veri

AI para birimini, açılış bakiyesini/borcunu, kuru veya plan tarihini uyduramaz. Açık tutarı olan sıradan TL gelir/giderde mevcut TRY varsayımı korunur. Hesap/borç için gerçek başlangıç tutarı gereklidir; sıfır ancak kullanıcı belirtmişse kullanılır. Abonelik ve düzenli ödeme tutarı, sıklığı ve sonraki tarihi gereklidir. Yeni hesaplar aynı plandaki diğer kayıtlara `@key` biçiminde bağlanabilir. Bağlı kredi kartı/KMH borcunu muhasebe servisi oluşturur.

AI'a yalnız kullanıcının metni, hesap/borç/abonelik/düzenli ödeme kimlikleri ve adları, tür ve para birimi ile yerel tarih/saat dilimi gönderilir. Mevcut bakiyeler, ücretler, tüm defter, kimlik bilgileri ve anahtarlar gönderilmez. Modelin çıktısı yalnız izinli oluşturma alanlarından oluşur. Mevcut oturum, origin, anahtar gizliliği ve veri önbellekleme kuralları korunur.

## Uygulama sınırları

Eski `/api/parse` ve `/api/ai/transaction` ile CLI add/parse davranışı korunur. Yeni `/api/ai/entry` önizleme ve `/api/ai/entry/confirm` onay uçları eklenir. CLI `ai preview METİN` ve `ai confirm --data PLAN --request-id ID` aynı servisi kullanır. Yeni plan makbuzları mevcut makbuz tablosunda ayrı ad alanında tutulur; şema göçü gerekmez.

## Doğrulama

Geçici veritabanlarında bütün türlerin oluşması, bağlı toplu plan, önizleme yan etkisizliği, eksik alanlar, yanlış tür/kimlik/para birimi, çift kayıt, tam geri alma, oturum iptali ve sağlayıcı hataları test edilir. Gerçek finans verisine ve ücretli OpenAI API'sine test isteği gönderilmez. Tür kontrolü, üretim derlemesi ve tarayıcıda önizleme/ek bilgi/onay akışı doğrulanır.
