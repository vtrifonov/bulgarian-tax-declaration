import {
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { YearSetup } from './YearSetup';

const mockNavigate = vi.fn();
const mockStore = {
    taxYear: 2025,
    baseCurrency: 'BGN',
    holdings: [],
    sales: [],
    dividends: [],
    stockYield: [],
    brokerInterest: [],
    setTaxYear: vi.fn(),
    setBaseCurrency: vi.fn(),
    importHoldings: vi.fn(),
    reset: vi.fn(),
    clearImportedFiles: vi.fn(),
};

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../store/app-state', () => ({
    useAppStore: Object.assign(
        () => mockStore,
        { getState: () => mockStore },
    ),
}));

vi.mock('@bg-tax/core', () => ({
    importFullExcel: vi.fn(),
    importHoldingsFromCsv: vi.fn(),
    importHoldingsFromExcel: vi.fn(),
    t: vi.fn((key: string) => {
        const labels: Record<string, string> = {
            'page.setup': 'Setup',
            'label.taxYear': 'Tax Year',
            'label.baseCurrency': 'Base Currency',
            'label.fixedFor2025': '(fixed for ≤2025)',
            'label.fixedFor2026': '(fixed for ≥2026)',
            'label.importHoldings': 'Import Previous Holdings',
            'import.fresh': 'Start fresh',
            'import.freshDesc': 'No previous holdings',
            'ui.continue': 'Continue',
        };

        return labels[key] ?? key;
    }),
}));

describe('YearSetup page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates tax year and base currency when the year changes', () => {
        render(<YearSetup />);

        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2026' } });

        expect(mockStore.setTaxYear).toHaveBeenCalledWith(2026);
        expect(mockStore.setBaseCurrency).toHaveBeenCalledWith('EUR');
    });

    it('shows the import options section', () => {
        render(<YearSetup />);

        expect(screen.getByText('Import Previous Holdings')).toBeTruthy();
        expect(screen.getByRole('radio', { name: /start fresh/i })).toBeTruthy();
    });
});
