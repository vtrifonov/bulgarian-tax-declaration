# Ръководство за подаване на СПБ-8 в БНБ с B-Trust КЕП на Mac

## Обзор

Това ръководство описва процеса за подаване на статистическа форма **СПБ-8** (Годишен отчет за вземанията и задълженията на местни физически лица от/към чуждестранни лица) в Българска Народна Банка (БНБ), използвайки квалифициран електронен подпис (КЕП) от B-Trust на macOS.

**Кога се подава СПБ-8?**
- Когато общата стойност на чуждестранните активи (акции, ETF-и, облигации и др.) надвишава **50,000 лв** към 31.12 на съответната година
- Крайният срок е **31 март** на следващата година

---

## Част 1: Инсталиране на необходимия софтуер

### 1.1 SafeNet Authentication Client

SafeNet Authentication Client е софтуерът, който позволява на Mac да комуникира с USB токена на B-Trust.

1. Изтеглете SafeNet Authentication Client за Mac от официалния сайт на B-Trust или Thales
2. Отворете .dmg файла и инсталирайте приложението
3. Рестартирайте компютъра след инсталация

**Проверка на инсталацията:**
- Включете КЕП токена в USB порт
- Трябва да светне светлинка на токена
- SafeNet Authentication Client трябва автоматично да се стартира (икона в menu bar)
- Кликнете на иконата — трябва да виждате вашия сертификат

### 1.2 BISS (B-Trust Integrated Signing Solution)

BISS е софтуер за електронно подписване, разработен от БОР ООД.

1. Изтеглете BISS от: https://www.b-trust.bg/
2. Инсталирайте BISS.app в папка Applications
3. При първо стартиране, macOS може да поиска разрешение - одобрете го в System Preferences → Security & Privacy

---

## Част 2: Конфигуриране на BISS за Mac

**Това е критичната стъпка!** По подразбиране BISS не е конфигуриран правилно за SafeNet токени на Mac.

### 2.1 Намиране на PKCS11 библиотеката

SafeNet инсталира PKCS11 библиотеки на следните локации:

```
/Library/Frameworks/eToken.framework/Versions/A/libIDPrimePKCS11.dylib
/usr/local/lib/libIDPrimePKCS11.dylib
```

Проверете коя съществува:
```bash
ls -la /Library/Frameworks/eToken.framework/Versions/A/libIDPrimePKCS11.dylib
ls -la /usr/local/lib/libIDPrimePKCS11.dylib
```

### 2.2 Конфигуриране на BISS Settings.xml

BISS съхранява настройките си в нестандартна локация на Mac:

```
/Users/[вашето_име]/AppData/Roaming/BISS/Settings.xml
```

**Забележка:** Тази папка симулира Windows път и се създава от BISS.

#### Стъпки за конфигуриране:

1. **Затворете BISS** ако е стартиран:
```bash
pkill -f BISS
```

2. **Създайте/редактирайте Settings.xml:**
```bash
mkdir -p ~/AppData/Roaming/BISS

cat > ~/AppData/Roaming/BISS/Settings.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">
<properties>
<entry key="pkcs11Path">/Library/Frameworks/eToken.framework/Versions/A/libIDPrimePKCS11.dylib</entry>
<entry key="signAPI">PKCS11</entry>
<entry key="language">bg</entry>
<entry key="osStarted">true</entry>
<entry key="newSacRequired">true</entry>
<entry key="pfxPath"></entry>
</properties>
EOF
```

3. **Проверете файла:**
```bash
cat ~/AppData/Roaming/BISS/Settings.xml
```

**Важно:**
- Encoding трябва да е `UTF-8` (НЕ UTF-16)
- `pkcs11Path` трябва да сочи към съществуваща .dylib библиотека
- Не трябва да има `\>` - само `>`

### 2.3 Стартиране на BISS

1. Стартирайте BISS от Applications
2. Иконата трябва да се появи в menu bar
3. Уверете се, че КЕП токенът е включен и SafeNet го вижда

---

## Част 3: Подписване на документи

### 3.1 Използване на B-Trust Web Signing Portal

1. Отворете: **https://wsp.b-trust.bg/**
2. Качете PDF файла за подписване
3. Изберете настройки:
   - **Ниво на подпис:** BASELINE_B
   - **Тип:** DETACHED (подпис отделно от файла)
   - **Хеш алгоритъм:** SHA256
4. Натиснете **"Подпиши"**
5. Въведете **PIN кода** на КЕП токена
6. Изтеглете генерирания **.p7s файл**

### 3.2 Troubleshooting

**Грешка: "Не са намерени сертификати"**
- Проверете дали SafeNet Authentication Client вижда токена
- Рестартирайте токена (извадете и включете отново)
- Проверете Settings.xml конфигурацията

**Грешка: "Name is null" в BISS лога**
- Проверете encoding на Settings.xml (трябва да е UTF-8)
- Проверете дали pkcs11Path сочи към валидна библиотека

**Преглед на BISS лога:**
```bash
tail -100 ~/AppData/Roaming/BISS/BISS.log
```

---

## Част 4: Регистрация в БНБ Статистически портал

### 4.1 Първоначална регистрация (Образец 1)

1. Отворете: **https://stat.bnb.bg/BNBStatPortal**
2. Изберете **"Статистическо деклариране"** или **"Заявления за достъп"**
3. Допълнете **Образец 1** (Заявление за достъп)
4. Свалете генерирания PDF
5. Подпишете го чрез wsp.b-trust.bg (вижте Част 3)
6. Качете .p7s файла с encoding: **binary**
7. Подайте заявлението

### 4.2 Получаване на достъп

- След одобрение на Образец 1, ще получите **временна парола** на имейла
- Влезте в портала и сменете паролата
- Вече имате достъп до статистическата отчетност

---

## Част 5: Подаване на СПБ-8

### 5.1 Достъп до формата

1. Влезте в: **https://stat.bnb.bg/BNBStatPortal**
2. Придете на: **Статистическа отчетност** → **Опционални форми**
3. Изберете: **Форма СПБ-8**

### 5.2 Попълване на формата

**Основни данни:**
- Тип на отчета: **Първоначален**
- ЕГН: [вашето ЕГН]
- Година: [отчетната година, напр. 2025]

**Секция "Вземания по придобити ценни книжа":**

За всяка акция/ETF добавете ред:
- **ISIN код:** Международният идентификационен номер (напр. US0231351067 за Amazon)
- **Размер в началото:** Брой акции към 01.01 на годината
- **Размер в края:** Брой акции към 31.12 на годината

**Секция "Вземания/задължения по финансови кредити и сметки":**
- Тук се декларира кеш баланс в чуждестранни брокерски сметки (ако е значителен)

### 5.3 Подаване

1. Натиснете **"Запиши"**
2. Свалете генерирания PDF
3. Подпишете го чрез wsp.b-trust.bg
4. Качете .p7s файла с encoding: **binary**
5. Подайте формата

---

## Част 6: Източници на данни

### Trading 212
- **History** → **Statements** → **Annual Statement**
- Показва позиции към 31.12

### Interactive Brokers
- **Reports** → **Statements** → **Annual Statement**
- Или **Activity Statement** за конкретен период

### Полезни ISIN кодове (примери)

| Компания | ISIN |
|----------|------|
| Apple | US0378331005 |
| Amazon | US0231351067 |
| Alphabet | US02079K3059 |
| Microsoft | US5949181045 |
| Netflix | US64110L1061 |
| Visa | US92826C8394 |
| Mastercard | US57636Q1040 |
| ASML | NL0010273215 |
| iShares Core S&P 500 (SXR8) | IE00B5BMR087 |

---

## Част 7: Контакти и помощ

**БНБ:**
- Въпроси за СПБ-8: 0882 103 561
- ISSIS портал: 02/9145-1405
- Email: spb@bnbank.bg
- Хартиено подаване: БНБ, пл. "Княз Александър I" №1, София 1000

**B-Trust:**
- Поддръжка: 0700 199 10
- Уебсайт: https://www.b-trust.bg/

---

## Бързи команди за troubleshooting

```bash
# Провери дали BISS работи
ps aux | grep -i biss

# Виж BISS лога
tail -50 ~/AppData/Roaming/BISS/BISS.log

# Виж Settings.xml
cat ~/AppData/Roaming/BISS/Settings.xml

# Рестартирай BISS
pkill -f BISS

# Провери PKCS11 библиотеки
ls -la /Library/Frameworks/eToken.framework/Versions/A/*.dylib
ls -la /usr/local/lib/libIDPrimePKCS11.dylib
```

---

## Версии и съвместимост

- **Тествано на:** macOS (Sonoma/Ventura)
- **BISS версия:** 3.44
- **SafeNet Authentication Client:** Актуална версия към 2026

---

*Последна актуализация: Март 2026*
