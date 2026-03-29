import {
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { Spb8 } from './Spb8';

const { fillBnbTemplateMock } = vi.hoisted(() => ({
    fillBnbTemplateMock: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

const mockStore = {
    holdings: [],
    sales: [],
    fxRates: {},
    taxYear: 2025,
    foreignAccounts: [],
    spb8PersonalData: {
        name: 'Иван Петров',
        egn: '8181818181',
        phone: '+359888888888',
        email: 'ivan.petrov@gmail.com',
        address: {
            city: 'София',
            postalCode: '1712',
            district: 'Младост',
            street: 'Св. Киприян',
            number: '15',
            entrance: 'Вх. 5, ап. 10',
        },
    },
    addForeignAccount: vi.fn(),
    updateForeignAccount: vi.fn(),
    deleteForeignAccount: vi.fn(),
    updateHolding: vi.fn(),
    setSpb8PersonalData: vi.fn(),
    yearEndPrices: {},
    setYearEndPrices: vi.fn(),
};

vi.mock('../store/app-state', () => ({
    useAppStore: Object.assign(
        (selector?: (state: typeof mockStore) => unknown) => selector ? selector(mockStore) : mockStore,
        { getState: () => mockStore },
    ),
}));

vi.mock('@bg-tax/core', () => ({
    assembleSpb8: vi.fn(() => ({
        year: 2025,
        reportType: 'P',
        personalData: mockStore.spb8PersonalData,
        accounts: [],
        securities: [],
        thresholdMet: false,
        totalBgn: 0,
    })),
    fetchYearEndPrices: vi.fn(),
    fillBnbTemplate: fillBnbTemplateMock,
    fxToBaseCurrency: vi.fn(() => 1),
    generateSpb8Excel: vi.fn(),
    resolveIsinSync: vi.fn(() => ''),
    t: vi.fn((key: string) => {
        const labels: Record<string, string> = {
            'spb8.personalData': 'Лични данни',
            'spb8.personalData.sectionHint': 'По избор — съхранява се локално',
            'spb8.personalData.noDataEntered': 'Без въведени лични данни',
            'spb8.personalData.editButton': 'Редактирай личните данни',
            'spb8.personalData.clearButton': 'Изчисти личните данни',
            'spb8.personalData.privacyNotice': 'notice',
            'spb8.personalData.name': 'Име',
            'spb8.personalData.egn': 'ЕГН',
            'spb8.personalData.phone': 'Телефон',
            'spb8.personalData.email': 'Имейл',
            'spb8.personalData.city': 'Град',
            'spb8.personalData.postalCode': 'Пощенски код',
            'spb8.personalData.district': 'Община',
            'spb8.personalData.street': 'Улица',
            'spb8.personalData.number': 'Номер',
            'spb8.personalData.entrance': 'вх./ап.',
            'button.save': 'Запази',
            'button.cancel': 'Отмени',
            'spb8.exportBnb': 'Изтегли BNB шаблон',
        };

        return labels[key] ?? key;
    }),
}));

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const originalAnchorClick = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'click');

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
    if (descriptor) {
        Object.defineProperty(target, key, descriptor);
        return;
    }

    Reflect.deleteProperty(target, key);
}


describe('Spb8 page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: vi.fn(() => 'blob:spb8'),
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: vi.fn(),
        });
        Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
            configurable: true,
            value: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        restoreProperty(URL, 'createObjectURL', originalCreateObjectURL);
        restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
        restoreProperty(HTMLAnchorElement.prototype, 'click', originalAnchorClick);
    });

    it('shows saved address fields in the collapsed personal data summary', () => {
        render(<Spb8 />);

        expect(screen.getByText('Иван Петров')).toBeTruthy();
        expect(screen.getByText('Град: София')).toBeTruthy();
        expect(screen.getByText('Пощенски код: 1712')).toBeTruthy();
        expect(screen.getByText('Община: Младост')).toBeTruthy();
        expect(screen.getByText('Улица: Св. Киприян')).toBeTruthy();
        expect(screen.getByText('Номер: 15')).toBeTruthy();
        expect(screen.getByText('вх./ап.: Вх. 5, ап. 10')).toBeTruthy();
    });

    it('renders address inputs in edit mode and saves edited values', () => {
        render(<Spb8 />);

        fireEvent.click(screen.getByLabelText('Редактирай личните данни'));

        const cityInput = screen.getByLabelText('Град') as HTMLInputElement;
        const entranceInput = screen.getByLabelText('вх./ап.') as HTMLInputElement;

        fireEvent.change(cityInput, { target: { value: 'Пловдив' } });
        fireEvent.change(entranceInput, { target: { value: 'Вх. B, ап. 12' } });
        fireEvent.click(screen.getByLabelText('Запази'));

        expect(mockStore.setSpb8PersonalData).toHaveBeenCalledWith(
            expect.objectContaining({
                address: expect.objectContaining({
                    city: 'Пловдив',
                    entrance: 'Вх. B, ап. 12',
                }),
            }),
        );
    });

    it('exports the BNB template without fetching over the network', () => {
        render(<Spb8 />);

        fireEvent.click(screen.getByText('Изтегли BNB шаблон'));

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(fillBnbTemplateMock).toHaveBeenCalledTimes(1);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
});
