import { describe, it, expect } from 'vitest';
import { resolveCountry } from '../src/country-map.js';

describe('resolveCountry', () => {
  it('resolves US stocks to САЩ', () => {
    expect(resolveCountry('AAPL')).toBe('САЩ');
    expect(resolveCountry('MSFT')).toBe('САЩ');
    expect(resolveCountry('NVDA')).toBe('САЩ');
  });

  it('resolves Irish ETFs to Ирландия', () => {
    expect(resolveCountry('CSPX')).toBe('Ирландия');
    expect(resolveCountry('VWCE')).toBe('Ирландия');
  });

  it('resolves German stocks to Германия', () => {
    expect(resolveCountry('SAP')).toBe('Германия');
    expect(resolveCountry('ISPA')).toBe('Германия');
  });

  it('resolves special cases', () => {
    expect(resolveCountry('ASML')).toBe('Нидерландия (Холандия)');
    expect(resolveCountry('RIO')).toBe('Великобритания');
    expect(resolveCountry('BABA')).toBe('Хонконг');
    expect(resolveCountry('1810')).toBe('Хонконг');
  });

  it('returns empty string for unknown symbols', () => {
    expect(resolveCountry('UNKNOWN')).toBe('');
    expect(resolveCountry('XYZ')).toBe('');
  });

  it('is case-sensitive', () => {
    expect(resolveCountry('aapl')).toBe('');
    expect(resolveCountry('AaPl')).toBe('');
  });
});
