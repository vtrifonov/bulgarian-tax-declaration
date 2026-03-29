import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';

const BNB_TEMPLATE_VIRTUAL_ID = 'virtual:spb8-bnb-template';
const BNB_TEMPLATE_RESOLVED_ID = `\0${BNB_TEMPLATE_VIRTUAL_ID}`;

export function bundledBnbTemplatePlugin(): Plugin {
    return {
        name: 'bundled-bnb-template',
        resolveId(id) {
            if (id === BNB_TEMPLATE_VIRTUAL_ID) {
                return BNB_TEMPLATE_RESOLVED_ID;
            }
        },
        load(id) {
            if (id !== BNB_TEMPLATE_RESOLVED_ID) {
                return;
            }

            // Bundle the same public template the UI used to fetch at runtime.
            const templatePath = new URL('../public/templates/SPB8_BPM6_meta.xls', import.meta.url);
            const templateBase64 = readFileSync(templatePath).toString('base64');
            const dataUrl = `data:application/vnd.ms-excel;base64,${templateBase64}`;

            return `export default ${JSON.stringify(dataUrl)};`;
        },
    };
}
