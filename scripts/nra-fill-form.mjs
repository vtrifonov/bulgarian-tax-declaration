#!/usr/bin/env node

/**
 * NRA Form Filler — Playwright sidecar script.
 *
 * Launches a browser, waits for the user to navigate to the NRA
 * Приложение 8 Част III form, then injects a JS script to fill
 * all dividend rows.
 *
 * Usage: node nra-fill-form.mjs <input.json> [--dry-run]
 * Input JSON: { rows: NraFormRow[] }
 */

import { chromium } from 'playwright';
import {
    readFileSync,
    unlinkSync,
} from 'fs';
import { homedir } from 'os';

// ============================================================================
// Input Reading
// ============================================================================

const inputFile = process.argv[2];
if (!inputFile || inputFile.startsWith('--')) {
    console.error('Usage: node nra-fill-form.mjs <input.json> [--dry-run]');
    process.exit(1);
}

let input;
try {
    input = readFileSync(inputFile, 'utf-8');
} catch {
    console.error(`Failed to read input file: ${inputFile}`);
    process.exit(1);
}

let parsedInput;
try {
    parsedInput = JSON.parse(input);
} catch (e) {
    console.error(`Failed to parse input JSON: ${e.message}`);
    process.exit(1);
}

const { rows = [] } = parsedInput;

// Clean up temp input file immediately
try {
    unlinkSync(inputFile);
} catch {}

const dryRun = process.argv.includes('--dry-run');

// ============================================================================
// Helpers
// ============================================================================

function emit(data) {
    process.stdout.write(JSON.stringify(data) + '\n');
}

// ============================================================================
// Fill Script Generator (same logic as clipboard approach in useNraFiller.ts)
// ============================================================================

function generateFillScript(rows) {
    const data = JSON.stringify(rows);
    return `(async () => {
  const rows = ${data};
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const FIELD_DELAY = 300;
  const ROW_DELAY = 800;
  window.__nraFillStopped = false;

  const statusBar = document.createElement('div');
  statusBar.id = '__nra_fill_status';
  statusBar.style.cssText = 'position:fixed;top:10px;right:10px;background:#1976D2;color:white;padding:12px 20px;border-radius:8px;z-index:99999;font-family:sans-serif;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;gap:12px';
  const statusText = document.createElement('span');
  statusBar.appendChild(statusText);
  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Спри';
  stopBtn.style.cssText = 'padding:4px 12px;background:#dc3545;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px';
  stopBtn.onclick = () => { window.__nraFillStopped = true; };
  statusBar.appendChild(stopBtn);
  document.body.appendChild(statusBar);

  async function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(50);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(50);
    el.blur();
    await delay(FIELD_DELAY);
  }

  async function sel(id, val) {
    const el = document.getElementById(id);
    if (!el) return false;
    el.focus();
    await delay(50);
    const norm = val.trim().toLowerCase();
    let found = false;
    for (const opt of el.options) {
      if (opt.value === val || opt.text === val ||
          opt.value.trim().toLowerCase() === norm || opt.text.trim().toLowerCase() === norm) {
        el.value = opt.value;
        found = true;
        break;
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(50);
    el.blur();
    await delay(FIELD_DELAY);
    return found;
  }

  let filled = 0;
  const warnings = [];
  for (let i = 0; i < rows.length; i++) {
    if (window.__nraFillStopped) break;
    const row = rows[i];
    const n = i + 1;
    statusText.textContent = 'Попълване: ' + n + '/' + rows.length + ' — ' + row.name;

    if (!document.getElementById('A8D5:' + n + '_name')) {
      if (typeof addDynamicElement === 'function') addDynamicElement('A8D5');
      await delay(800);
    }

    let attempts = 0;
    while (!document.getElementById('A8D5:' + n + '_name') && attempts < 20) {
      await delay(300);
      attempts++;
    }
    if (!document.getElementById('A8D5:' + n + '_name')) {
      warnings.push('Row ' + n + ' did not appear');
      continue;
    }

    const p = 'A8D5:' + n;
    await set(p + '_name', row.name || '');
    if (!(await sel(p + '_country', row.country || ''))) {
      warnings.push('Row ' + n + ': country "' + row.country + '" not found');
    }
    await sel(p + '_incomecode', '8141');
    await sel(p + '_methodcode', '1');
    await delay(500);
    await set(p + '_sum', (row.grossAmount || 0).toFixed(2));
    if (row.incomeCode === 8142) await set(p + '_value', (row.acquisitionCost || 0).toFixed(2));
    await set(p + '_paidtax', (row.foreignTax || 0).toFixed(2));
    await set(p + '_permitedtax', (row.allowedCredit || 0).toFixed(2));
    await set(p + '_tax', (row.recognizedCredit || 0).toFixed(2));
    await set(p + '_owetax', (row.taxDue || 0).toFixed(2));

    filled++;
    await delay(ROW_DELAY);
  }

  stopBtn.remove();
  statusText.textContent = filled === rows.length
    ? 'Готово! Попълнени ' + filled + ' реда'
    : 'Попълнени ' + filled + '/' + rows.length + (window.__nraFillStopped ? ' (спряно)' : '');
  statusBar.style.background = filled === rows.length ? '#28a745' : '#ffc107';
  setTimeout(() => statusBar.remove(), 15000);
  return { filled, total: rows.length, warnings };
})()`;
}

// ============================================================================
// Dry-Run Mode
// ============================================================================

if (dryRun) {
    emit({ type: 'status', message: 'dry_run_mode' });
    for (let i = 0; i < rows.length; i++) {
        emit({ type: 'progress', current: i + 1, total: rows.length, symbol: rows[i].name || 'Unknown' });
    }
    emit({ type: 'complete', filled: rows.length, skipped: 0 });
    process.exit(0);
}

// ============================================================================
// Browser Launch & Form Fill
// ============================================================================

async function main() {
    const userDataDir = `${homedir()}/.bgtax-chrome-profile`;
    let context;

    // Launch browser with persistent context (preserves cookies/sessions)
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            channel: 'chrome',
            args: ['--disable-blink-features=AutomationControlled'],
        });
    } catch {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: ['--disable-blink-features=AutomationControlled'],
        });
    }

    const page = context.pages()[0] || await context.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto('https://portal.nra.bg/details/dec-50');

    // Auto-dismiss alerts from NRA validation
    page.on('dialog', async (dialog) => {
        emit({ type: 'warn', message: `Alert: ${dialog.message()}` });
        await dialog.accept();
    });

    emit({ type: 'status', message: 'browser_launched' });
    emit({ type: 'status', message: 'waiting_for_form' });

    // Poll all tabs for the NRA form
    const FORM_HEADER = 'Определяне на дължимия окончателен данък по чл. 38 от ЗДДФЛ';
    let formPage = null;

    for (let attempt = 0; attempt < 300 && !formPage; attempt++) {
        for (const p of context.pages()) {
            try {
                // Check both text content and A8D5 form elements as fallback
                const found = await p.evaluate((header) => {
                    return (document.body?.innerText?.includes(header) ?? false)
                        || !!document.querySelector('[id^="A8D5:"]');
                }, FORM_HEADER);

                if (found) {
                    formPage = p;
                    break;
                }
            } catch { /* page loading */ }
        }
        if (!formPage) await new Promise(r => setTimeout(r, 2000));
    }

    if (!formPage) {
        emit({ type: 'error', message: 'Form not found after 10 minutes. Navigate to Приложение 8, Част III.' });
        await new Promise(resolve => context.on('close', resolve));
        return;
    }

    formPage.on('dialog', async (dialog) => {
        emit({ type: 'warn', message: `Alert: ${dialog.message()}` });
        await dialog.accept();
    });

    emit({ type: 'status', message: 'form_detected' });

    // Show confirmation overlay (XSS-safe: use textContent for user data)
    await formPage.evaluate(({ count, names }) => {
        const overlay = document.createElement('div');
        overlay.id = '__nra_overlay';
        overlay.style.cssText =
            'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:sans-serif';
        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;padding:24px;border-radius:8px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
        const h3 = document.createElement('h3');
        h3.style.marginTop = '0';
        h3.textContent = 'Данъчна декларация — Дивиденти';
        box.appendChild(h3);
        const p1 = document.createElement('p');
        p1.innerHTML = `Готови за попълване: <strong>${count}</strong> реда`;
        box.appendChild(p1);
        const p2 = document.createElement('p');
        p2.style.cssText = 'color:#666;font-size:14px';
        p2.textContent = names.join(', ') + '...';
        box.appendChild(p2);
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:8px;margin-top:16px';
        const fillBtn = document.createElement('button');
        fillBtn.textContent = 'Попълни';
        fillBtn.style.cssText = 'padding:8px 20px;background:#28a745;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px;font-weight:bold';
        fillBtn.onclick = () => {
            window.__nraFillerAction = 'fill';
        };
        btns.appendChild(fillBtn);
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Отказ';
        cancelBtn.style.cssText = 'padding:8px 20px;background:#6c757d;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px';
        cancelBtn.onclick = () => {
            window.__nraFillerAction = 'cancel';
        };
        btns.appendChild(cancelBtn);
        box.appendChild(btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        window.__nraFillerAction = null;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.__nraFillerAction = 'cancel';
        });
    }, { count: rows.length, names: rows.slice(0, 3).map(r => r.name) });

    // Wait for user action
    let action = null;
    const actionTimeout = Date.now() + 5 * 60 * 1000;
    while (!action && Date.now() < actionTimeout) {
        action = await formPage.evaluate(() => window.__nraFillerAction).catch(() => null);
        if (!action) await new Promise(r => setTimeout(r, 500));
    }

    await formPage.evaluate(() => {
        const o = document.getElementById('__nra_overlay');
        if (o) o.remove();
    });

    if (action === 'cancel' || !action) {
        emit({ type: 'status', message: 'user_cancelled' });
        await new Promise(resolve => context.on('close', resolve));
        return;
    }

    // Inject and execute the fill script
    emit({ type: 'status', message: 'filling' });
    const fillScript = generateFillScript(rows);

    try {
        const result = await formPage.evaluate((script) => eval(script), fillScript);
        emit({ type: 'complete', filled: result.filled, total: result.total, warnings: result.warnings });
    } catch (error) {
        emit({ type: 'error', message: error.message });
        // Show error safely (textContent, no innerHTML with user data)
        await formPage.evaluate((msg) => {
            const div = document.createElement('div');
            div.style.cssText =
                'position:fixed;top:20px;right:20px;background:#f8d7da;border:2px solid #dc3545;padding:16px 24px;border-radius:8px;z-index:99999;font-family:sans-serif;max-width:400px';
            const strong = document.createElement('strong');
            strong.textContent = 'Грешка';
            div.appendChild(strong);
            div.appendChild(document.createElement('br'));
            const span = document.createElement('span');
            span.style.fontSize = '13px';
            span.textContent = msg;
            div.appendChild(span);
            document.body.appendChild(div);
        }, error.message).catch(() => {});
    }

    // Keep browser open until user closes it
    await new Promise(resolve => context.on('close', resolve));
}

main().catch((error) => {
    emit({ type: 'error', message: `Fatal: ${error.message}` });
    process.exit(1);
});
