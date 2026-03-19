import { buildNraFormRows } from '@bg-tax/core';
import type {
    BaseCurrency,
    Dividend,
} from '@bg-tax/core';
import {
    useCallback,
    useState,
} from 'react';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface UseNraFillerReturn {
    /** Generate JS script and copy to clipboard (web + desktop) */
    startFilling: () => Promise<void>;
    /** Launch browser and fill automatically (desktop only) */
    startBrowser: () => Promise<void>;
    /** Whether browser option is available */
    canUseBrowser: boolean;
    status: 'idle' | 'copied' | 'browser' | 'error';
    rowCount: number;
    script: string | null;
    error: string | null;
}

/**
 * Generate a self-contained JavaScript snippet that fills the NRA Приложение 8 Част III form.
 * The snippet is meant to be pasted into the browser's DevTools console.
 */
function generateFillScript(rows: ReturnType<typeof buildNraFormRows>): string {
    const data = JSON.stringify(rows);

    return `(async () => {
  const rows = ${data};
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const FIELD_DELAY = 300;
  const ROW_DELAY = 800;

  // Stop flag — set by the stop button
  window.__nraFillStopped = false;

  // Status overlay with stop button
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
    if (window.__nraFillStopped) {
      console.warn('Fill stopped by user at row ' + (i + 1));
      break;
    }
    const row = rows[i];
    const n = i + 1;
    statusText.textContent = 'Попълване: ' + n + '/' + rows.length + ' — ' + row.name;

    if (!document.getElementById('A8D5:' + n + '_name')) {
      if (typeof addDynamicElement === 'function') {
        addDynamicElement('A8D5');
      }
      await delay(800);
    }

    let attempts = 0;
    while (!document.getElementById('A8D5:' + n + '_name') && attempts < 20) {
      await delay(300);
      attempts++;
    }
    if (!document.getElementById('A8D5:' + n + '_name')) {
      warnings.push('Ред ' + n + ': не се появи');
      continue;
    }

    const p = 'A8D5:' + n;
    await set(p + '_name', row.name || '');
    if (!(await sel(p + '_country', row.country || ''))) {
      warnings.push('Ред ' + n + ': държава "' + row.country + '" не е намерена');
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
  const stopped = window.__nraFillStopped ? ' (спряно)' : '';
  statusText.textContent = (filled === rows.length ? 'Готово' : 'Попълнени ' + filled + '/' + rows.length) + stopped;
  statusBar.style.background = filled === rows.length ? '#28a745' : '#ffc107';
  if (warnings.length > 0) {
    console.warn('NRA fill warnings:', warnings);
    const warnDiv = document.createElement('div');
    warnDiv.style.cssText = 'margin-top:4px;font-size:12px;color:#fff8';
    warnDiv.textContent = warnings.length + ' предупреждения (вижте конзолата)';
    statusBar.appendChild(warnDiv);
  }
  setTimeout(() => statusBar.remove(), 15000);
  console.log('NRA form fill complete: ' + filled + '/' + rows.length + ' rows');
  return { filled, total: rows.length, warnings };
})()`;
}

export function useNraFiller(
    dividends: Dividend[],
    fxRates: Record<string, Record<string, number>>,
    baseCurrency: BaseCurrency,
): UseNraFillerReturn {
    const [status, setStatus] = useState<UseNraFillerReturn['status']>('idle');
    const [rowCount, setRowCount] = useState(0);
    const [script, setScript] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const startFilling = useCallback(async () => {
        if (status !== 'idle' && status !== 'error' && status !== 'copied') {
            return;
        }

        setError(null);

        try {
            const rows = buildNraFormRows(dividends, fxRates, baseCurrency);

            if (rows.length === 0) {
                setStatus('error');
                setError('Няма дивиденти за попълване. Проверете дали има импортирани дивиденти.');

                return;
            }

            const generated = generateFillScript(rows);

            setScript(generated);
            try {
                await navigator.clipboard.writeText(generated);
            } catch { /* clipboard may be blocked — user can copy from textarea */ }
            setRowCount(rows.length);
            setStatus('copied');
        } catch (err) {
            setStatus('error');
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [dividends, fxRates, baseCurrency, status]);

    const startBrowser = useCallback(async () => {
        if (!isTauri || (status !== 'idle' && status !== 'error' && status !== 'copied')) {
            return;
        }

        setError(null);

        try {
            const { Command } = await import('@tauri-apps/plugin-shell');

            // Check Node.js
            try {
                const result = await Command.create('node', ['--version']).execute();
                const major = parseInt(result.stdout.trim().replace('v', '').split('.')[0], 10);

                if (result.code !== 0 || major < 20) {
                    throw new Error('old');
                }
            } catch {
                setStatus('error');
                setError('Node.js (>= 20) е необходим. Инсталирайте от https://nodejs.org/en/download');

                return;
            }

            const rows = buildNraFormRows(dividends, fxRates, baseCurrency);

            if (rows.length === 0) {
                setStatus('error');
                setError('Няма дивиденти за попълване. Проверете дали има импортирани дивиденти.');

                return;
            }

            setRowCount(rows.length);
            setStatus('browser');

            // Write input to temp file
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            const { tempDir, resolveResource } = await import('@tauri-apps/api/path');
            const tmpBase = await tempDir();
            const inputFile = `${tmpBase}/nra-input-${Date.now()}.json`;

            await writeTextFile(inputFile, JSON.stringify({ rows }));

            // Resolve script path
            const resourceDir = await resolveResource('.');
            const isDev = resourceDir.includes('src-tauri/target/');
            const scriptPath = isDev
                ? resourceDir.replace(/packages\/ui\/src-tauri\/target\/[^/]+\/?$/, '') + 'scripts/nra-fill-form.mjs'
                : await resolveResource('scripts/nra-fill-form.mjs');

            // Spawn sidecar
            const cmd = Command.create('node', [scriptPath, inputFile]);
            const stderrLines: string[] = [];

            cmd.stdout.on('data', (line: string) => {
                try {
                    const event = JSON.parse(line.trim());

                    if (event.type === 'complete') {
                        setStatus('idle');
                    } else if (event.type === 'error') {
                        setStatus('error');
                        setError(event.message);
                    }
                } catch { /* non-JSON */ }
            });
            cmd.stderr.on('data', (line: string) => stderrLines.push(line));
            cmd.on('close', (data: { code: number | null }) => {
                if (data.code !== null && data.code !== 0) {
                    setStatus('error');
                    setError(stderrLines.join('\n').trim() || `Код ${data.code}`);
                } else {
                    // Process ended normally (user closed browser or fill completed)
                    setStatus('idle');
                }
            });

            await cmd.spawn();
        } catch (err) {
            setStatus('error');
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [dividends, fxRates, baseCurrency, status]);

    return { startFilling, startBrowser, canUseBrowser: isTauri, status, rowCount, script, error };
}
