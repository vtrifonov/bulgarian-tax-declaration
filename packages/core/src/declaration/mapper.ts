export interface TaxResults {
    capitalGains: {
        totalProceeds: number;
        totalCost: number;
        profit: number;
        taxDue: number;
    };
    dividends: {
        totalGross: number;
        totalWht: number;
        totalBgTax: number;
        totalWhtCredit: number;
    };
    interest: {
        totalGross: number;
        totalTax: number;
    };
}

export interface FormConfigField {
    ref: string;
    label: string;
    source: string;
}

export interface FormConfigSection {
    title: string;
    fields: FormConfigField[];
}

export interface FormConfig {
    year: number;
    baseCurrency: string;
    appendix5: FormConfigSection;
    appendix8table1: FormConfigSection;
    appendix8table6: FormConfigSection;
}

export interface DeclarationField {
    ref: string;
    label: string;
    value: number;
}

export interface DeclarationSection {
    title: string;
    fields: DeclarationField[];
}

function getValueBySource(source: string, taxResults: TaxResults): number {
    const parts = source.split('.');
    let current: unknown = taxResults;

    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return 0;
        }
        current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'number' ? current : 0;
}

export function mapToDeclaration(
    taxResults: TaxResults,
    formConfig: FormConfig,
): DeclarationSection[] {
    const sectionKeys: (keyof Pick<FormConfig, 'appendix5' | 'appendix8table1' | 'appendix8table6'>)[] = [
        'appendix5',
        'appendix8table1',
        'appendix8table6',
    ];

    return sectionKeys
        .map((key) => formConfig[key])
        .filter((section): section is FormConfigSection => !!section)
        .map((section) => ({
            title: section.title,
            fields: section.fields.map((field) => ({
                ref: field.ref,
                label: field.label,
                value: getValueBySource(field.source, taxResults),
            })),
        }));
}
