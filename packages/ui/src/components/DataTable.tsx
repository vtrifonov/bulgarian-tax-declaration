import { t } from '@bg-tax/core';
import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    type Row,
    type SortingState,
    useReactTable,
} from '@tanstack/react-table';
import {
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { AutocompleteInput } from './AutocompleteInput';
import type { AutocompleteOption } from './AutocompleteInput';
import './DataTable.css';

declare module '@tanstack/react-table' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData, TValue> {
        align?: 'left' | 'right' | 'center';
        editable?: boolean;
        inputType?: 'text' | 'number' | 'date' | 'select' | 'dropdown';
        selectOptions?: AutocompleteOption[];
        onSave?: (rowIndex: number, value: string) => void;
        /** Provide initial edit value for columns without accessorKey */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editInitialValue?: (row: any) => string;
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
    /** If set, this row index enters edit mode immediately (used for new rows). Nonce ensures re-trigger. */
    editRowOnMount?: { index: number; nonce: number; focusColumn?: string };
    /** Called when a row is saved — receives row index and all edited field values */
    onSaveRow?: (rowIndex: number, values: Record<string, string>) => void;
    /** Called when an autocomplete option is selected — returns fields to auto-fill */
    onAutoFill?: (columnId: string, selectedValue: string) => Record<string, string> | undefined;
    /** Column accessorKey to focus when entering edit mode (defaults to first editable) */
    focusColumnOnEdit?: string;
    /** Called to delete a row by index */
    onDeleteRow?: (rowIndex: number) => void;
    onSplitRow?: (rowIndex: number) => void;
    /** Row indices that should be rendered with strikethrough (consumed by FIFO) */
    strikeThroughRows?: Set<number>;
    /** Row indices that should be highlighted as partially consumed / linked */
    highlightRows?: Set<number>;
    /** Called to reorder a row — enables ▲/▼ buttons in "#" column when sorted by "#" or unsorted */
    onMoveRow?: (fromIndex: number, toIndex: number) => void;
    /** Called when the user changes column sorting — receives the new SortingState */
    onSortingChange?: (sorting: { id: string; desc: boolean }[]) => void;
    /** Initial sorting state (e.g. restored from store) */
    initialSorting?: { id: string; desc: boolean }[];
}

export function DataTable<TData extends object>({
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
    editRowOnMount,
    onSaveRow,
    onAutoFill,
    focusColumnOnEdit,
    onDeleteRow,
    onSplitRow,
    strikeThroughRows,
    highlightRows,
    onMoveRow,
    onSortingChange,
    initialSorting,
}: DataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
    const onSortingChangeRef = useRef(onSortingChange);

    onSortingChangeRef.current = onSortingChange;
    useEffect(() => {
        onSortingChangeRef.current?.(sorting);
    }, [sorting]);
    const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
    const [editValues, setEditValues] = useState<Record<string, string>>({});
    const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
    const [clickedColumn, setClickedColumn] = useState<string | null>(null);
    const [mountFocusColumn, setMountFocusColumn] = useState<string | null>(null);
    const firstInputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
    const consumedNonce = useRef<number | undefined>(undefined);

    // Date conversion helpers: ISO (YYYY-MM-DD) ↔ display (DD.MM.YYYY)
    const isoToDisplay = (iso: string): string => {
        const m = iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

        if (!m) {
            return iso;
        }

        return `${m[3].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[1]}`;
    };
    const displayToIso = (display: string): string => {
        const m = display.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

        if (!m) {
            return display;
        }

        return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    };
    const isValidIsoDate = (iso: string): boolean => {
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (!m) {
            return false;
        }
        const [, y, mo, d] = m.map(Number);
        const date = new Date(y, mo - 1, d);

        return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
    };
    const hasDateErrors = (): boolean => {
        for (const col of columns) {
            const meta = col.meta;

            if (meta?.inputType !== 'date' || meta?.editable === false) {
                continue;
            }
            const key = (col as { accessorKey?: string }).accessorKey;

            if (!key) {
                continue;
            }
            const val = editValues[key];

            if (val !== undefined && val !== '' && !isValidIsoDate(displayToIso(val))) {
                return true;
            }
        }

        return false;
    };

    // Handle editRowOnMount — wait until data actually contains the row, fire only once per nonce
    useEffect(() => {
        if (
            editRowOnMount
            && editRowOnMount.index >= 0
            && editRowOnMount.index < data.length
            && consumedNonce.current !== editRowOnMount.nonce
        ) {
            consumedNonce.current = editRowOnMount.nonce;

            // Save current editing row before switching to the new one
            if (editingRowIndex !== null && !hasDateErrors()) {
                const saveValues: Record<string, string> = {};

                for (const [key, val] of Object.entries(editValues)) {
                    const col = columns.find((c) => (c as { accessorKey?: string }).accessorKey === key);

                    saveValues[key] = col?.meta?.inputType === 'date' ? displayToIso(val) : val;
                }
                onSaveRow?.(editingRowIndex, saveValues);
            }
            setMountFocusColumn(editRowOnMount.focusColumn ?? null);
            enterEditMode(editRowOnMount.index);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editRowOnMount, data.length]);

    // Cancel edit if the edited row was deleted
    useEffect(() => {
        if (editingRowIndex !== null && editingRowIndex >= data.length) {
            setEditingRowIndex(null);
            setEditValues({});
        }
    }, [data.length, editingRowIndex]);

    // Merge editValues into the editing row so computed columns update live
    const tableData = useMemo(() => {
        if (editingRowIndex === null) {
            return data;
        }
        // Build a set of date column keys for conversion
        const dateKeys = new Set<string>();

        for (const col of columns) {
            if (col.meta?.inputType === 'date') {
                const key = (col as { accessorKey?: string }).accessorKey;

                if (key) {
                    dateKeys.add(key);
                }
            }
        }

        return data.map((row, idx) => {
            if (idx !== editingRowIndex) {
                return row;
            }
            const merged = { ...row };

            for (const [key, val] of Object.entries(editValues)) {
                const original = (row as Record<string, unknown>)[key];

                if (typeof original === 'number') {
                    (merged as Record<string, unknown>)[key] = parseFloat(val) || 0;
                } else if (dateKeys.has(key)) {
                    // Convert display format back to ISO for computed columns
                    (merged as Record<string, unknown>)[key] = displayToIso(val);
                } else {
                    (merged as Record<string, unknown>)[key] = val;
                }
            }

            return merged;
        });
    }, [data, editingRowIndex, editValues, columns]);

    const table = useReactTable({
        data: tableData,
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

    const enterEditMode = (rowIndex: number) => {
        // Collect current values for all editable columns
        const row = data[rowIndex];

        if (!row) {
            return;
        }
        const values: Record<string, string> = {};

        for (const col of columns) {
            const meta = col.meta;

            if (meta?.editable === false) {
                continue;
            }
            const key = (col as { accessorKey?: string }).accessorKey
                ?? (col as { id?: string }).id;

            if (!key) {
                continue;
            }
            const rowValues = row as Record<string, unknown>;
            const rawValue = key in rowValues ? String(rowValues[key] ?? '') : '';
            const raw = meta?.editInitialValue?.(row) ?? rawValue;

            // Store date fields as display format (DD.MM.YYYY)
            values[key] = meta?.inputType === 'date' ? isoToDisplay(raw) : raw;
        }
        setEditValues(values);

        setEditingRowIndex(rowIndex);
    };

    const handleSaveRow = () => {
        if (editingRowIndex === null) {
            return;
        }

        if (hasDateErrors()) {
            return;
        }
        // Convert date display values back to ISO for saving
        const saveValues: Record<string, string> = {};

        for (const [key, val] of Object.entries(editValues)) {
            const col = columns.find((c) => ((c as { accessorKey?: string }).accessorKey ?? (c as { id?: string }).id) === key);

            saveValues[key] = col?.meta?.inputType === 'date' ? displayToIso(val) : val;
        }

        // Use global onSaveRow if provided, otherwise fall back to per-column onSave
        if (onSaveRow) {
            onSaveRow(editingRowIndex, saveValues);
        } else {
            // Fall back to per-column onSave only when no global handler
            for (const col of columns) {
                const meta = col.meta;

                if (meta?.editable === false || !meta?.onSave) {
                    continue;
                }
                const key = (col as { accessorKey?: string }).accessorKey
                    ?? (col as { id?: string }).id;

                if (!key) {
                    continue;
                }
                const newValue = saveValues[key];

                if (newValue !== undefined) {
                    meta.onSave(editingRowIndex, newValue);
                }
            }
        }
        setEditingRowIndex(null);
        setEditValues({});
    };

    const handleCancelRow = () => {
        setEditingRowIndex(null);
        setEditValues({});
    };

    const handleRowKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveRow();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancelRow();
        }
    };

    const updateEditValue = (key: string, value: string) => {
        setEditValues((prev) => ({ ...prev, [key]: value }));
    };

    // Show move buttons when sorted by "#" ascending or no sort active
    const isNaturalOrder = sorting.length === 0
        || (sorting.length === 1 && sorting[0].id === '#' && !sorting[0].desc);

    const filteredRows = table.getRowModel().rows.filter((_, idx) => {
        if (!showWarningsOnly) {
            return true;
        }

        return warningRows?.has(idx) ?? false;
    });

    const getSourceRowIndex = (row: Row<TData>): number => {
        const original = row.original as Record<string, unknown>;
        const id = typeof original.id === 'string' ? original.id : null;

        if (id) {
            return data.findIndex((item) => {
                const candidate = item as Record<string, unknown>;

                return candidate.id === id;
            });
        }

        return data.indexOf(row.original);
    };

    const renderEditInput = (
        columnId: string,
        meta: NonNullable<ColumnDef<TData>['meta']>,
        isFirst: boolean,
    ) => {
        const value = editValues[columnId] ?? '';
        const inputType = meta.inputType ?? 'text';
        const inputRefProp = isFirst
            ? {
                ref: (el: HTMLInputElement | null) => {
                    firstInputRef.current = el;
                },
            }
            : {};
        const selectRefProp = isFirst
            ? {
                ref: (el: HTMLSelectElement | null) => {
                    firstInputRef.current = el;
                },
            }
            : {};

        // Autocomplete input for select fields
        if (inputType === 'select') {
            const options = meta.selectOptions ?? [];

            return (
                <AutocompleteInput
                    inputRef={isFirst
                        ? (el) => {
                            firstInputRef.current = el;
                        }
                        : undefined}
                    className='edit-input edit-autocomplete'
                    data-column={columnId}
                    value={value}
                    options={options}
                    onChange={(v) => updateEditValue(columnId, v)}
                    onSelect={(v) => {
                        const fills = onAutoFill?.(columnId, v);

                        if (fills) {
                            setEditValues((prev) => ({ ...prev, ...fills }));
                            // Skip auto-filled fields: focus the next input after the filled ones
                            const filledKeys = new Set(Object.keys(fills));

                            setTimeout(() => {
                                const row = document.querySelector('tr.editing-row');

                                if (!row) {
                                    return;
                                }
                                const inputs = Array.from(row.querySelectorAll<HTMLInputElement>('.edit-input'));
                                const currentIdx = inputs.findIndex((el) => el.dataset.column === columnId);

                                // Find the next input that wasn't auto-filled
                                for (let i = currentIdx + 1; i < inputs.length; i++) {
                                    const col = inputs[i].dataset.column;

                                    if (col && !filledKeys.has(col)) {
                                        inputs[i].focus();

                                        return;
                                    }
                                }
                            }, 0);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            handleCancelRow();
                        }
                    }}
                />
            );
        }

        if (inputType === 'dropdown') {
            const options = meta.selectOptions ?? [];

            return (
                <select
                    {...selectRefProp}
                    data-column={columnId}
                    className='edit-input'
                    value={value}
                    onChange={(e) => updateEditValue(columnId, e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            handleCancelRow();
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveRow();
                        }
                    }}
                >
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            );
        }

        // Date input as text with DD.MM.YYYY format
        // editValues stores display format (DD.MM.YYYY) for dates; converted to ISO on save
        if (inputType === 'date') {
            const iso = displayToIso(value);
            const isInvalid = value !== '' && !isValidIsoDate(iso);

            return (
                <input
                    {...inputRefProp}
                    type='text'
                    data-column={columnId}
                    className={`edit-input edit-date ${isInvalid ? 'edit-input-error' : ''}`}
                    value={value}
                    placeholder='DD.MM.YYYY'
                    title={isInvalid ? 'Invalid date — use DD.MM.YYYY' : undefined}
                    onChange={(e) => updateEditValue(columnId, e.target.value)}
                    onBlur={() => {
                        // Normalize: "1.5.2025" → "01.05.2025"
                        const normalized = displayToIso(value);

                        if (isValidIsoDate(normalized)) {
                            updateEditValue(columnId, isoToDisplay(normalized));
                        }
                    }}
                    onKeyDown={handleRowKeyDown}
                />
            );
        }

        if (inputType === 'number') {
            return (
                <input
                    {...inputRefProp}
                    type='number'
                    step='any'
                    data-column={columnId}
                    className='edit-input edit-number'
                    value={value}
                    onChange={(e) => updateEditValue(columnId, e.target.value)}
                    onKeyDown={handleRowKeyDown}
                />
            );
        }

        // Default: text input
        return (
            <input
                {...inputRefProp}
                type='text'
                data-column={columnId}
                className='edit-input'
                value={value}
                onChange={(e) => updateEditValue(columnId, e.target.value)}
                onKeyDown={handleRowKeyDown}
            />
        );
    };

    // Focus first input when entering edit mode
    useEffect(() => {
        if (editingRowIndex !== null) {
            // Small delay to allow render
            const timer = setTimeout(() => {
                firstInputRef.current?.focus();

                if (clickedColumn !== null) {
                    setClickedColumn(null);
                }

                if (mountFocusColumn !== null) {
                    setMountFocusColumn(null);
                }
            }, 0);

            return () => clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-run when editingRowIndex changes
    }, [editingRowIndex]);

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
                            <th className='edit-col-header' style={onSplitRow ? undefined : { width: 60 }} />
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
                        const rowIndex = getSourceRowIndex(row);

                        if (rowIndex === -1) {
                            return null;
                        }
                        const isEditing = editingRowIndex === rowIndex;
                        const hasWarning = warningRows?.has(rowIndex) ?? false;
                        const isConsumed = strikeThroughRows?.has(rowIndex) ?? false;
                        const isHighlighted = highlightRows?.has(rowIndex) ?? false;
                        const rowWarnings = warningMessages?.get(rowIndex);
                        let firstEditableFound = false;

                        return (
                            <tr
                                key={row.id}
                                className={`${rowIndex % 2 === 0 ? 'even' : 'odd'} ${hasWarning ? 'warning-row' : ''} ${isEditing ? 'editing-row' : ''} ${
                                    isConsumed ? 'consumed-row' : ''
                                } ${isHighlighted ? 'linked-row' : ''}`}
                                onDoubleClick={(e) => {
                                    if (isEditing) {
                                        return;
                                    }
                                    // Find which column was clicked
                                    const td = (e.target as HTMLElement).closest('td');
                                    const cellIndex = td ? Array.from(td.parentElement!.children).indexOf(td) - 1 : -1; // -1 for edit-action-cell
                                    const visibleCells = row.getVisibleCells();
                                    const clickedCol = cellIndex >= 0 && cellIndex < visibleCells.length
                                        ? (visibleCells[cellIndex].column.columnDef as { accessorKey?: string }).accessorKey ?? null
                                        : null;

                                    setClickedColumn(clickedCol);
                                    enterEditMode(rowIndex);
                                }}
                                title={hasWarning && rowWarnings ? rowWarnings.join('\n') : undefined}
                            >
                                <td className='edit-action-cell'>
                                    {isEditing
                                        ? (
                                            <div className='edit-actions'>
                                                <button
                                                    className='edit-action-btn save-btn'
                                                    onClick={handleSaveRow}
                                                    title='Save (Enter)'
                                                    aria-label='Save row changes'
                                                >
                                                    ✓
                                                </button>
                                                <button
                                                    className='edit-action-btn cancel-btn'
                                                    onClick={handleCancelRow}
                                                    title='Cancel (Escape)'
                                                    aria-label='Cancel row edit'
                                                >
                                                    ✗
                                                </button>
                                            </div>
                                        )
                                        : onSplitRow
                                        ? (
                                            <div className='edit-actions'>
                                                <button
                                                    className='edit-action-btn pencil-btn'
                                                    onClick={() => enterEditMode(rowIndex)}
                                                    title={t('button.edit')}
                                                    aria-label={`Edit row ${rowIndex + 1}`}
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    className='edit-action-btn split-btn'
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onSplitRow(rowIndex);
                                                    }}
                                                    title={t('button.split')}
                                                    aria-label='Split row'
                                                >
                                                    ✂
                                                </button>
                                            </div>
                                        )
                                        : (
                                            <button
                                                className='edit-action-btn pencil-btn'
                                                onClick={() => enterEditMode(rowIndex)}
                                                title={t('button.edit')}
                                                aria-label={`Edit row ${rowIndex + 1}`}
                                            >
                                                ✏️
                                            </button>
                                        )}
                                </td>
                                {row.getVisibleCells().map((cell) => {
                                    const isDeleteColumn = cell.column.id === 'delete';
                                    const meta = cell.column.columnDef.meta;
                                    const accessorKey = (cell.column.columnDef as { accessorKey?: string }).accessorKey ?? cell.column.id;
                                    const isEditableCell = isEditing && meta?.editable !== false && !!accessorKey;
                                    const focusCol = clickedColumn ?? mountFocusColumn ?? focusColumnOnEdit;
                                    const isFocusTarget = focusCol
                                        ? isEditableCell && accessorKey === focusCol && !firstEditableFound
                                        : isEditableCell && !firstEditableFound;

                                    if (isFocusTarget) {
                                        firstEditableFound = true;
                                    }

                                    return (
                                        <td
                                            key={cell.id}
                                            className={`
                                                cell
                                                ${isDeleteColumn ? 'delete-cell' : ''}
                                                ${meta?.align === 'right' ? 'align-right' : ''}
                                                ${meta?.align === 'center' ? 'align-center' : ''}
                                            `}
                                        >
                                            {cell.column.id === '#' && onMoveRow && isNaturalOrder && !isEditing
                                                ? (
                                                    <div className='move-row-cell'>
                                                        <button
                                                            className='move-row-btn'
                                                            disabled={rowIndex === 0}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onMoveRow(rowIndex, rowIndex - 1);
                                                            }}
                                                            aria-label={`Move row ${rowIndex + 1} up`}
                                                        >
                                                            ▲
                                                        </button>
                                                        <span className='move-row-num'>{rowIndex + 1}</span>
                                                        <button
                                                            className='move-row-btn'
                                                            disabled={rowIndex === data.length - 1}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onMoveRow(rowIndex, rowIndex + 1);
                                                            }}
                                                            aria-label={`Move row ${rowIndex + 1} down`}
                                                        >
                                                            ▼
                                                        </button>
                                                    </div>
                                                )
                                                : isEditableCell
                                                ? renderEditInput(accessorKey, meta!, isFocusTarget)
                                                : isDeleteColumn && onDeleteRow
                                                ? pendingDeleteIndex === rowIndex
                                                    ? (
                                                        <div className='delete-confirm'>
                                                            <button
                                                                className='delete-button delete-confirm-btn'
                                                                aria-label='Confirm delete'
                                                                onClick={() => {
                                                                    if (isEditing) {
                                                                        handleCancelRow();
                                                                    }
                                                                    setPendingDeleteIndex(null);
                                                                    onDeleteRow(rowIndex);
                                                                }}
                                                            >
                                                                ✓
                                                            </button>
                                                            <button
                                                                className='delete-cancel-btn'
                                                                aria-label='Cancel delete'
                                                                onClick={() => setPendingDeleteIndex(null)}
                                                            >
                                                                ✗
                                                            </button>
                                                        </div>
                                                    )
                                                    : (
                                                        <button
                                                            className='delete-button'
                                                            onClick={() => setPendingDeleteIndex(rowIndex)}
                                                        >
                                                            {t('button.delete')}
                                                        </button>
                                                    )
                                                : flexRender(cell.column.columnDef.cell, cell.getContext())}
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
                            <td />
                            {table.getAllColumns().map((col) => {
                                const key = col.id || (col.columnDef as { accessorKey?: string }).accessorKey || '';
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
