import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    type SortingState,
    useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import { t } from '@bg-tax/core';
import './DataTable.css';

declare module '@tanstack/react-table' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData extends unknown, TValue> {
        align?: 'left' | 'right' | 'center';
        editable?: boolean;
        onSave?: (rowIndex: number, value: string) => void;
    }
}

export interface DataTableProps<TData> {
    columns: ColumnDef<TData>[];
    data: TData[];
    onAddRow?: () => void;
    addRowLabel?: string;
    /** Row indices that have warnings — these rows get highlighted */
    warningRows?: Set<number>;
    /** Warning messages per row index */
    warningMessages?: Map<number, string[]>;
    /** Whether to show only warning rows */
    showWarningsOnly?: boolean;
    onToggleWarningsOnly?: () => void;
    warningCount?: number;
    /** Footer row with totals — maps column accessor key or id to display value */
    footerRow?: Record<string, string>;
}

export function DataTable<TData extends Record<string, any>>({
    columns,
    data,
    onAddRow,
    addRowLabel = t('button.addRow'),
    warningRows,
    warningMessages,
    showWarningsOnly = false,
    onToggleWarningsOnly,
    warningCount = 0,
    footerRow,
}: DataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnId: string } | null>(
        null,
    );
    const [editValue, setEditValue] = useState('');

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        columnResizeMode: 'onChange',
        enableColumnResizing: true,
    });

    const handleCellDoubleClick = (rowIndex: number, columnId: string, currentValue: any) => {
        setEditingCell({ rowIndex, columnId });
        setEditValue(String(currentValue ?? ''));
    };

    const handleSaveEdit = (
        rowIndex: number,
        _columnId: string,
        value: string,
        onSave?: (rowIndex: number, value: string) => void,
    ) => {
        onSave?.(rowIndex, value);
        setEditingCell(null);
    };

    const handleCancelEdit = () => {
        setEditingCell(null);
        setEditValue('');
    };

    const handleKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>,
        rowIndex: number,
        _columnId: string,
        onSave?: (rowIndex: number, value: string) => void,
    ) => {
        if (e.key === 'Enter') {
            handleSaveEdit(rowIndex, _columnId, editValue, onSave);
        } else if (e.key === 'Escape') {
            handleCancelEdit();
        }
    };

    const filteredRows = table.getRowModel().rows.filter((_, idx) => {
        if (!showWarningsOnly) return true;
        return warningRows?.has(idx) ?? false;
    });

    return (
        <div className='data-table-container'>
            {warningCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <button
                        onClick={onToggleWarningsOnly}
                        style={{
                            padding: '0.3rem 0.75rem',
                            borderRadius: '12px',
                            fontSize: '0.8rem',
                            border: '1px solid',
                            borderColor: showWarningsOnly ? '#dc3545' : 'var(--border)',
                            backgroundColor: showWarningsOnly ? '#dc3545' : 'transparent',
                            color: showWarningsOnly ? 'white' : 'var(--text-secondary)',
                            cursor: 'pointer',
                        }}
                    >
                        {showWarningsOnly ? `Showing ${warningCount} warnings` : `${warningCount} warnings`}
                    </button>
                </div>
            )}
            <table className='data-table'>
                <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <th
                                    key={header.id}
                                    style={{ width: header.getSize(), position: 'relative' }}
                                >
                                    <div
                                        className={`header-content ${header.column.getCanSort() ? 'sortable' : ''}`}
                                        onClick={header.column.getToggleSortingHandler()}
                                    >
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {header.column.getCanSort() && (
                                            <span className='sort-indicator'>
                                                {header.column.getIsSorted() === 'asc'
                                                    ? ' ↑'
                                                    : header.column.getIsSorted() === 'desc'
                                                    ? ' ↓'
                                                    : ' ⇅'}
                                            </span>
                                        )}
                                    </div>
                                    {header.column.getCanResize() && (
                                        <div
                                            onMouseDown={header.getResizeHandler()}
                                            onTouchStart={header.getResizeHandler()}
                                            className={`resize-handle ${header.column.getIsResizing() ? 'resizing' : ''}`}
                                        />
                                    )}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {filteredRows.map((row) => {
                        const rowIndex = row.index;
                        const hasWarning = warningRows?.has(rowIndex) ?? false;
                        const rowWarnings = warningMessages?.get(rowIndex);
                        return (
                            <tr
                                key={row.id}
                                className={`${rowIndex % 2 === 0 ? 'even' : 'odd'} ${hasWarning ? 'warning-row' : ''}`}
                                title={hasWarning && rowWarnings ? rowWarnings.join('\n') : undefined}
                            >
                                {row.getVisibleCells().map((cell) => {
                                    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnId === cell.column.id;
                                    const isDeleteColumn = cell.column.id === 'delete';
                                    const meta = cell.column.columnDef.meta;

                                    return (
                                        <td
                                            key={cell.id}
                                            className={`
                      cell
                      ${isDeleteColumn ? 'delete-cell' : ''}
                      ${
                                                meta?.align === 'right'
                                                    ? 'align-right'
                                                    : ''
                                            }
                      ${
                                                meta?.align === 'center'
                                                    ? 'align-center'
                                                    : ''
                                            }
                    `}
                                            onDoubleClick={() => {
                                                if (!isDeleteColumn && meta?.editable !== false) {
                                                    handleCellDoubleClick(rowIndex, cell.column.id, cell.getValue());
                                                }
                                            }}
                                        >
                                            {isEditing
                                                ? (
                                                    <input
                                                        autoFocus
                                                        type='text'
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            handleKeyDown(e, rowIndex, cell.column.id, meta?.onSave);
                                                        }}
                                                        onBlur={() => handleCancelEdit()}
                                                        className='edit-input'
                                                    />
                                                )
                                                : (
                                                    flexRender(cell.column.columnDef.cell, cell.getContext())
                                                )}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
                {footerRow && (
                    <tfoot>
                        <tr className='footer-row'>
                            {table.getAllColumns().map((col) => {
                                const key = col.id || (col.columnDef as any).accessorKey;
                                const value = footerRow[key];
                                const meta = col.columnDef.meta;
                                return (
                                    <td
                                        key={col.id}
                                        className={meta?.align === 'right' ? 'align-right' : ''}
                                        style={{ fontWeight: 700 }}
                                    >
                                        {value ?? ''}
                                    </td>
                                );
                            })}
                        </tr>
                    </tfoot>
                )}
            </table>

            {onAddRow && (
                <button onClick={onAddRow} className='add-row-button'>
                    + {addRowLabel}
                </button>
            )}
        </div>
    );
}
