import { useState } from 'react';

const codeBlockStyle: React.CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '0.82rem',
    lineHeight: '1.5',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    padding: '0.75rem 1rem',
    borderRadius: '4px',
    overflowX: 'auto',
    whiteSpace: 'pre',
    margin: '0.5rem 0',
    color: 'var(--text)',
};

const inlineCodeStyle: React.CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '0.85em',
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    padding: '0.15rem 0.4rem',
    borderRadius: '3px',
};

const linkStyle: React.CSSProperties = {
    color: 'var(--accent)',
};

const noteStyle: React.CSSProperties = {
    padding: '0.75rem',
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    border: '1px solid rgba(255, 193, 7, 0.3)',
    borderRadius: '4px',
    fontSize: '0.85rem',
    lineHeight: '1.4',
    marginBottom: '0.75rem',
};

const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
    margin: '0.5rem 0',
};

const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '0.5rem 0.75rem',
    borderBottom: '2px solid var(--border)',
    color: 'var(--text-secondary)',
    fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
    padding: '0.4rem 0.75rem',
    borderBottom: '1px solid var(--border)',
};

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
        <div style={{ borderBottom: '1px solid var(--border)' }}>
            <div
                onClick={() => setOpen(!open)}
                style={{
                    padding: '0.75rem 0',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    userSelect: 'none',
                }}
            >
                <span style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--text)' }}>{title}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', transition: 'transform 0.2s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                    ▼
                </span>
            </div>
            {open && <div style={{ paddingBottom: '1rem', fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--text)' }}>{children}</div>}
        </div>
    );
}

function P({ children }: { children: React.ReactNode }) {
    return <p style={{ margin: '0.4rem 0' }}>{children}</p>;
}

function Code({ children }: { children: string }) {
    return <div style={codeBlockStyle}>{children}</div>;
}

function Ol({ children }: { children: React.ReactNode }) {
    return <ol style={{ margin: '0.4rem 0', paddingLeft: '1.5rem' }}>{children}</ol>;
}

function Ul({ children }: { children: React.ReactNode }) {
    return <ul style={{ margin: '0.4rem 0', paddingLeft: '1.5rem' }}>{children}</ul>;
}

export function Spb8FilingGuide() {
    return (
        <div>
            <div style={noteStyle}>
                ⚠ Това ръководство е специфично за <strong>macOS</strong> с физически <strong>B-Trust КЕП</strong> (USB токен).
            </div>

            <SubSection title='1. Инсталиране на необходимия софтуер'>
                <P>
                    <strong>1.1 SafeNet Authentication Client</strong>
                </P>
                <P>SafeNet Authentication Client позволява на Mac да комуникира с USB токена на B-Trust.</P>
                <Ol>
                    <li>
                        Изтеглете SafeNet Authentication Client за Mac от официалния сайт на{' '}
                        <a href='https://www.b-trust.bg/' target='_blank' rel='noopener noreferrer' style={linkStyle}>B-Trust</a> или Thales
                    </li>
                    <li>Отворете .dmg файла и инсталирайте приложението</li>
                    <li>Рестартирайте компютъра след инсталация</li>
                </Ol>
                <P>
                    <strong>Проверка:</strong> Включете КЕП токена → светлинката свети → SafeNet иконата се появява в menu bar → виждате сертификата си.
                </P>

                <P>
                    <strong>1.2 BISS (B-Trust Integrated Signing Solution)</strong>
                </P>
                <Ol>
                    <li>
                        Изтеглете BISS от <a href='https://www.b-trust.bg/' target='_blank' rel='noopener noreferrer' style={linkStyle}>b-trust.bg</a>
                    </li>
                    <li>Инсталирайте BISS.app в папка Applications</li>
                    <li>При първо стартиране одобрете в System Preferences → Security & Privacy</li>
                </Ol>
            </SubSection>

            <SubSection title='2. Конфигуриране на BISS за Mac (критична стъпка!)'>
                <div style={noteStyle}>
                    По подразбиране BISS не е конфигуриран правилно за SafeNet токени на Mac. Тази стъпка е задължителна!
                </div>

                <P>
                    <strong>2.1 Намиране на PKCS11 библиотеката</strong>
                </P>
                <P>SafeNet инсталира библиотеки на тези локации:</P>
                <Code>{`/Library/Frameworks/eToken.framework/Versions/A/libIDPrimePKCS11.dylib\n/usr/local/lib/libIDPrimePKCS11.dylib`}</Code>
                <P>Проверете коя съществува:</P>
                <Code>{`ls -la /Library/Frameworks/eToken.framework/Versions/A/libIDPrimePKCS11.dylib\nls -la /usr/local/lib/libIDPrimePKCS11.dylib`}</Code>

                <P>
                    <strong>2.2 Конфигуриране на Settings.xml</strong>
                </P>
                <P>
                    BISS съхранява настройките в нестандартна локация: <code style={inlineCodeStyle}>~/AppData/Roaming/BISS/Settings.xml</code>
                </P>

                <Ol>
                    <li>
                        Затворете BISS: <code style={inlineCodeStyle}>pkill -f BISS</code>
                    </li>
                    <li>Създайте/редактирайте Settings.xml:</li>
                </Ol>
                <Code>
                    {`mkdir -p ~/AppData/Roaming/BISS

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
EOF`}
                </Code>

                <P>
                    <strong>Важно:</strong>
                </P>
                <Ul>
                    <li>
                        Encoding трябва да е <code style={inlineCodeStyle}>UTF-8</code> (НЕ UTF-16)
                    </li>
                    <li>
                        <code style={inlineCodeStyle}>pkcs11Path</code> трябва да сочи към съществуваща .dylib библиотека
                    </li>
                    <li>
                        Не трябва да има <code style={inlineCodeStyle}>{`\\>`}</code> — само <code style={inlineCodeStyle}>{'>'}</code>
                    </li>
                </Ul>
            </SubSection>

            <SubSection title='3. Подписване на документи'>
                <P>
                    <strong>Използване на B-Trust Web Signing Portal</strong>
                </P>
                <Ol>
                    <li>
                        Отворете <a href='https://wsp.b-trust.bg/' target='_blank' rel='noopener noreferrer' style={linkStyle}>wsp.b-trust.bg</a>
                    </li>
                    <li>Качете PDF файла за подписване</li>
                    <li>
                        Изберете настройки:
                        <Ul>
                            <li>
                                <strong>Ниво на подпис:</strong> BASELINE_B
                            </li>
                            <li>
                                <strong>Тип:</strong> DETACHED (подпис отделно от файла)
                            </li>
                            <li>
                                <strong>Хеш алгоритъм:</strong> SHA256
                            </li>
                        </Ul>
                    </li>
                    <li>
                        Натиснете <strong>„Подпиши"</strong>
                    </li>
                    <li>
                        Въведете <strong>PIN кода</strong> на КЕП токена
                    </li>
                    <li>
                        Изтеглете генерирания <strong>.p7s файл</strong>
                    </li>
                </Ol>
            </SubSection>

            <SubSection title='4. Регистрация в БНБ Статистически портал'>
                <P>
                    <strong>Първоначална регистрация (Образец 1)</strong>
                </P>
                <Ol>
                    <li>
                        Отворете <a href='https://stat.bnb.bg/BNBStatPortal' target='_blank' rel='noopener noreferrer' style={linkStyle}>stat.bnb.bg/BNBStatPortal</a>
                    </li>
                    <li>Изберете „Статистическо деклариране" или „Заявления за достъп"</li>
                    <li>
                        Допълнете <strong>Образец 1</strong> (Заявление за достъп)
                    </li>
                    <li>Свалете генерирания PDF</li>
                    <li>Подпишете го чрез wsp.b-trust.bg (вижте стъпка 3)</li>
                    <li>
                        Качете .p7s файла с encoding: <strong>binary</strong>
                    </li>
                    <li>Подайте заявлението</li>
                </Ol>
                <P>
                    След одобрение ще получите <strong>временна парола</strong> на имейла. Влезте и я сменете.
                </P>
            </SubSection>

            <SubSection title='5. Подаване на СПБ-8'>
                <Ol>
                    <li>
                        Влезте в <a href='https://stat.bnb.bg/BNBStatPortal' target='_blank' rel='noopener noreferrer' style={linkStyle}>stat.bnb.bg/BNBStatPortal</a>
                    </li>
                    <li>Статистическа отчетност → Опционални форми → Форма СПБ-8</li>
                    <li>Попълнете формата (тип отчет, ЕГН, година, ценни книжа, сметки)</li>
                    <li>
                        Натиснете <strong>„Запиши"</strong>
                    </li>
                    <li>Свалете генерирания PDF</li>
                    <li>Подпишете го чрез wsp.b-trust.bg</li>
                    <li>
                        Качете .p7s файла с encoding: <strong>binary</strong>
                    </li>
                    <li>Подайте формата</li>
                </Ol>
            </SubSection>

            <SubSection title='6. Troubleshooting'>
                <P>
                    <strong>Грешка: „Не са намерени сертификати"</strong>
                </P>
                <Ul>
                    <li>Проверете дали SafeNet Authentication Client вижда токена</li>
                    <li>Рестартирайте токена (извадете и включете отново)</li>
                    <li>Проверете Settings.xml конфигурацията</li>
                </Ul>

                <P>
                    <strong>Грешка: „Name is null" в BISS лога</strong>
                </P>
                <Ul>
                    <li>Проверете encoding на Settings.xml (трябва да е UTF-8)</li>
                    <li>Проверете дали pkcs11Path сочи към валидна библиотека</li>
                </Ul>

                <P>
                    <strong>Бързи команди:</strong>
                </P>
                <Code>
                    {`# Провери дали BISS работи
ps aux | grep -i biss

# Виж BISS лога
tail -50 ~/AppData/Roaming/BISS/BISS.log

# Виж Settings.xml
cat ~/AppData/Roaming/BISS/Settings.xml

# Рестартирай BISS
pkill -f BISS

# Провери PKCS11 библиотеки
ls -la /Library/Frameworks/eToken.framework/Versions/A/*.dylib
ls -la /usr/local/lib/libIDPrimePKCS11.dylib`}
                </Code>
            </SubSection>

            <SubSection title='7. Контакти и помощ'>
                <P>
                    <strong>БНБ:</strong>
                </P>
                <table style={tableStyle}>
                    <tbody>
                        <tr>
                            <td style={tdStyle}>Въпроси за СПБ-8</td>
                            <td style={tdStyle}>0882 103 561</td>
                        </tr>
                        <tr>
                            <td style={tdStyle}>ISSIS портал</td>
                            <td style={tdStyle}>02/9145-1405</td>
                        </tr>
                        <tr>
                            <td style={tdStyle}>Email</td>
                            <td style={tdStyle}>
                                <a href='mailto:spb@bnbank.bg' style={linkStyle}>spb@bnbank.bg</a>
                            </td>
                        </tr>
                        <tr>
                            <td style={tdStyle}>Хартиено подаване</td>
                            <td style={tdStyle}>БНБ, пл. „Княз Александър I" №1, София 1000</td>
                        </tr>
                    </tbody>
                </table>
                <P>
                    <strong>B-Trust:</strong> 0700 199 10 | <a href='https://www.b-trust.bg/' target='_blank' rel='noopener noreferrer' style={linkStyle}>b-trust.bg</a>
                </P>
            </SubSection>

            <SubSection title='8. Източници на данни (ISIN кодове)'>
                <P>
                    За Trading 212: <strong>History</strong> → <strong>Statements</strong> → <strong>Annual Statement</strong>
                </P>
                <P>
                    За Interactive Brokers: <strong>Reports</strong> → <strong>Statements</strong> → <strong>Annual Statement</strong>
                </P>
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            <th style={thStyle}>Компания</th>
                            <th style={thStyle}>ISIN</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[
                            ['Apple', 'US0378331005'],
                            ['Amazon', 'US0231351067'],
                            ['Alphabet', 'US02079K3059'],
                            ['Microsoft', 'US5949181045'],
                            ['Netflix', 'US64110L1061'],
                            ['Visa', 'US92826C8394'],
                            ['Mastercard', 'US57636Q1040'],
                            ['ASML', 'NL0010273215'],
                            ['iShares Core S&P 500 (SXR8)', 'IE00B5BMR087'],
                        ].map(([name, isin]) => (
                            <tr key={isin}>
                                <td style={tdStyle}>{name}</td>
                                <td style={{ ...tdStyle, fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.85em' }}>{isin}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </SubSection>

            <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Тествано на macOS Sonoma/Ventura · BISS 3.44 · Последна актуализация: Март 2026
            </div>
        </div>
    );
}
