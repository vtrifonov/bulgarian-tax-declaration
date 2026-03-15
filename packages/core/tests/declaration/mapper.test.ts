import { describe, it, expect } from 'vitest';
import { mapToDeclaration } from '../../src/declaration/mapper.js';
import formConfig2025 from '../../src/declaration/form-config/2025.json';

describe('mapToDeclaration', () => {
  it('maps tax results to declaration sections', () => {
    const taxResults = {
      capitalGains: {
        totalProceeds: 10000,
        totalCost: 8000,
        profit: 2000,
        taxDue: 200,
      },
      dividends: {
        totalGross: 500,
        totalWht: 50,
        totalBgTax: 22.5,
        totalWhtCredit: 50,
      },
      interest: {
        totalGross: 100,
        totalTax: 10,
      },
    };

    const result = mapToDeclaration(taxResults, formConfig2025);

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes appendix5 section with capital gains fields', () => {
    const taxResults = {
      capitalGains: {
        totalProceeds: 10000,
        totalCost: 8000,
        profit: 2000,
        taxDue: 200,
      },
      dividends: {
        totalGross: 0,
        totalWht: 0,
        totalBgTax: 0,
        totalWhtCredit: 0,
      },
      interest: {
        totalGross: 0,
        totalTax: 0,
      },
    };

    const result = mapToDeclaration(taxResults, formConfig2025);
    const appendix5 = result.find(s => s.title === formConfig2025.appendix5.title);

    expect(appendix5).toBeDefined();
    expect(appendix5!.fields).toHaveLength(4);
    expect(appendix5!.fields[0].value).toBe(10000);
    expect(appendix5!.fields[2].value).toBe(2000);
  });

  it('includes appendix8table1 section with dividend fields', () => {
    const taxResults = {
      capitalGains: {
        totalProceeds: 0,
        totalCost: 0,
        profit: 0,
        taxDue: 0,
      },
      dividends: {
        totalGross: 500,
        totalWht: 50,
        totalBgTax: 22.5,
        totalWhtCredit: 50,
      },
      interest: {
        totalGross: 0,
        totalTax: 0,
      },
    };

    const result = mapToDeclaration(taxResults, formConfig2025);
    const appendix8 = result.find(s => s.title === formConfig2025.appendix8table1.title);

    expect(appendix8).toBeDefined();
    expect(appendix8!.fields).toHaveLength(4);
    expect(appendix8!.fields[0].value).toBe(500);
  });

  it('includes appendix8table6 section with interest fields', () => {
    const taxResults = {
      capitalGains: {
        totalProceeds: 0,
        totalCost: 0,
        profit: 0,
        taxDue: 0,
      },
      dividends: {
        totalGross: 0,
        totalWht: 0,
        totalBgTax: 0,
        totalWhtCredit: 0,
      },
      interest: {
        totalGross: 100,
        totalTax: 10,
      },
    };

    const result = mapToDeclaration(taxResults, formConfig2025);
    const appendix6 = result.find(s => s.title === formConfig2025.appendix8table6.title);

    expect(appendix6).toBeDefined();
    expect(appendix6!.fields).toHaveLength(2);
    expect(appendix6!.fields[0].value).toBe(100);
    expect(appendix6!.fields[1].value).toBe(10);
  });

  it('handles zero values correctly', () => {
    const taxResults = {
      capitalGains: {
        totalProceeds: 0,
        totalCost: 0,
        profit: 0,
        taxDue: 0,
      },
      dividends: {
        totalGross: 0,
        totalWht: 0,
        totalBgTax: 0,
        totalWhtCredit: 0,
      },
      interest: {
        totalGross: 0,
        totalTax: 0,
      },
    };

    const result = mapToDeclaration(taxResults, formConfig2025);

    expect(result).toHaveLength(3);
    result.forEach(section => {
      section.fields.forEach(field => {
        expect(field.value).toBe(0);
      });
    });
  });
});
