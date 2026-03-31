import {
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { DataTable } from './DataTable';

vi.mock('@bg-tax/core', () => ({
    t: vi.fn((key: string) => {
        const labels: Record<string, string> = {
            'button.edit': 'Edit',
            'button.delete': 'Delete',
            'button.addRow': 'Add row',
        };

        return labels[key] ?? key;
    }),
}));

describe('DataTable', () => {
    it('saves the original row index when editing a sorted row through a dropdown', () => {
        const onSaveRow = vi.fn();
        const data = [
            { id: 'sale-1', symbol: 'MSFT', saleTaxClassification: 'taxable' },
            { id: 'sale-2', symbol: 'AAPL', saleTaxClassification: 'taxable' },
        ];
        const columns: ColumnDef<(typeof data)[number]>[] = [
            {
                accessorKey: 'symbol',
                header: 'Symbol',
                meta: { editable: true },
            },
            {
                accessorKey: 'saleTaxClassification',
                header: 'Tax',
                meta: {
                    editable: true,
                    inputType: 'dropdown',
                    selectOptions: [
                        { label: 'Taxable', value: 'taxable' },
                        { label: 'EU Regulated', value: 'eu-regulated-market' },
                    ],
                },
            },
        ];

        render(
            (
                <DataTable
                    columns={columns}
                    data={data}
                    onSaveRow={onSaveRow}
                    initialSorting={[{ id: 'symbol', desc: false }]}
                />
            ),
        );

        fireEvent.click(screen.getAllByRole('button', { name: /Edit row/i })[0]!);

        const dropdown = screen.getByRole('combobox');

        fireEvent.change(dropdown, { target: { value: 'eu-regulated-market' } });
        fireEvent.keyDown(dropdown, { key: 'Enter' });

        expect(onSaveRow).toHaveBeenCalledWith(
            1,
            expect.objectContaining({
                symbol: 'AAPL',
                saleTaxClassification: 'eu-regulated-market',
            }),
        );
    });
});
