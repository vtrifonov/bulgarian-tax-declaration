import { describe, it, expect } from 'vitest';
import { FxService } from '../../src/fx/fx-service.js';
import { InMemoryFxCache } from '../../src/fx/fx-cache.js';

describe('FxService.getRate', () => {
  const rates = {
    USD: { '2025-01-02': 1.0353 },  // 1 EUR = 1.0353 USD
    GBP: { '2025-01-02': 0.8290 },
  };

  it('converts USD to BGN', () => {
    const svc = new FxService(new InMemoryFxCache(), 'BGN');
    const rate = svc.getRate('USD', '2025-01-02', rates);
    // 1 USD = 1.95583 / 1.0353 BGN ≈ 1.8889
    expect(rate).toBeCloseTo(1.95583 / 1.0353, 4);
  });

  it('converts USD to EUR', () => {
    const svc = new FxService(new InMemoryFxCache(), 'EUR');
    const rate = svc.getRate('USD', '2025-01-02', rates);
    // 1 USD = 1/1.0353 EUR ≈ 0.9659
    expect(rate).toBeCloseTo(1 / 1.0353, 4);
  });

  it('returns 1 for same currency', () => {
    const svc = new FxService(new InMemoryFxCache(), 'EUR');
    expect(svc.getRate('EUR', '2025-01-02', rates)).toBe(1);
  });

  it('returns fixed rate for EUR→BGN', () => {
    const svc = new FxService(new InMemoryFxCache(), 'BGN');
    expect(svc.getRate('EUR', '2025-01-02', rates)).toBe(1.95583);
  });

  it('returns null for missing rate', () => {
    const svc = new FxService(new InMemoryFxCache(), 'BGN');
    expect(svc.getRate('USD', '2025-06-15', rates)).toBeNull();
  });
});
