# Gokhan AI

Kurumsal kullanıma yönelik, girişi ve kullanımı denetlenebilen yapay zekâ sohbet uygulaması ile tanıtım sitesi.

![Gokhan AI ekranı](gknsoftware-site/gorsel/ekran-gokhanai.png)

## Bu repoda ne var

| Klasör | İçerik |
|---|---|
| [`gokhanaigithub/`](gokhanaigithub/) | Uygulama: Node.js + Express sunucusu, PostgreSQL veritabanı |
| [`gknsoftware-site/`](gknsoftware-site/) | Türkçe, İngilizce ve Almanca statik tanıtım sitesi |

## Öne çıkanlar

- **Güvenli giriş:** Şifreler `scrypt` ile saklanır. Oturum anahtarının veritabanında yalnızca SHA-256 özeti durur, çerezler HttpOnly ve SameSite=Strict'tir.
- **Kaba kuvvet koruması:** 5 hatalı denemede hesap 15 dakika kilitlenir, IP başına istek sınırı uygulanır.
- **Yönetim paneli:** Kullanıcı ekleme ve kapatma, yetkilendirme, şifre sıfırlama, açık oturumları görme.
- **Denetim kayıtları:** Zaman, kullanıcı, IP, cihaz ve sonuç tutulur; arama ve CSV dışa aktarma vardır, kayıtlar 180 gün sonra otomatik silinir.
- **Birden çok yapay zekâ sağlayıcısı:** Gemini, Groq, OpenRouter ve Anthropic ortam değişkeniyle seçilir. Hassas dosyalar için ayrı bir sağlayıcı tanımlanabilir.
- **Belge işleme:** Excel, CSV, PDF ve Word dosyaları modele gönderilmeden önce sunucuda metne ve özete çevrilir, böylece token kullanımı düşer.
- **Kullanım sınırları:** Kullanıcı başına aylık token ve günlük istek limiti.

## Teknolojiler

Node.js 20+, Express, PostgreSQL, ExcelJS, Mammoth, pdf-parse, Render.

## Çalıştırma

```bash
cd gokhanaigithub
npm install
export DATABASE_URL="postgresql://kullanici:sifre@sunucu:5432/veritabani"
npm start
```

Yapay zekâ anahtarı tanımlanmazsa uygulama demo cevaplarla çalışır. Tüm ayarlar için [uygulama README'sine](gokhanaigithub/README.md) bakın.

## Geliştirme

İhtiyaç analizi, tasarım kararları, test ve canlıya alma Ercan Gökhan tarafından yapıldı. Kodlamada Claude Code'dan yapay zekâ desteği alındı.
