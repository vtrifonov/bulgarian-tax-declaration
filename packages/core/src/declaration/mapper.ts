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
    let current: any = taxResults;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return 0;
        }
        current = current[part];
    }

    return typeof current === 'number' ? current : 0;
}

export function mapToDeclaration(
    taxResults: TaxResults,
    formConfig: FormConfig,
): DeclarationSection[] {
    const sections: DeclarationSection[] = [];

    // Add appendix5
    if (formConfig.appendix5) {
        sections.push({
            title: formConfig.appendix5.title,
            fields: formConfig.appendix5.fields.map(field => ({
                ref: field.ref,
                label: field.label,
                value: getValueBySource(field.source, taxResults),
            })),
        });
    }

    // Add appendix8table1
    if (formConfig.appendix8table1) {
        sections.push({
            title: formConfig.appendix8table1.title,
            fields: formConfig.appendix8table1.fields.map(field => ({
                ref: field.ref,
                label: field.label,
                value: getValueBySource(field.source, taxResults),
            })),
        });
    }

    // Add appendix8table6
    if (formConfig.appendix8table6) {
        sections.push({
            title: formConfig.appendix8table6.title,
            fields: formConfig.appendix8table6.fields.map(field => ({
                ref: field.ref,
                label: field.label,
                value: getValueBySource(field.source, taxResults),
            })),
        });
    }

    return sections;
}
