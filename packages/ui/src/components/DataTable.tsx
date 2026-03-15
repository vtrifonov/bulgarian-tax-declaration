import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table';
import { useState } from 'react';
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
}

export function DataTable<TData extends Record<string, any>>({
  columns,
  data,
  onAddRow,
  addRowLabel = 'Add Row',
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnId: string } | null>(
    null
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
    onSave?: (rowIndex: number, value: string) => void
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
    onSave?: (rowIndex: number, value: string) => void
  ) => {
    if (e.key === 'Enter') {
      handleSaveEdit(rowIndex, _columnId, editValue, onSave);
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <div className="data-table-container">
      <table className="data-table">
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
                      <span className="sort-indicator">
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
          {table.getRowModel().rows.map((row, rowIndex) => (
            <tr key={row.id} className={rowIndex % 2 === 0 ? 'even' : 'odd'}>
              {row.getVisibleCells().map((cell) => {
                const isEditing =
                  editingCell?.rowIndex === rowIndex && editingCell?.columnId === cell.column.id;
                const isDeleteColumn = cell.column.id === 'delete';
                const meta = cell.column.columnDef.meta;

                return (
                  <td
                    key={cell.id}
                    className={`
                      cell
                      ${isDeleteColumn ? 'delete-cell' : ''}
                      ${meta?.align === 'right' ? 'align-right' : ''}
                      ${meta?.align === 'center' ? 'align-center' : ''}
                    `}
                    onDoubleClick={() => {
                      if (!isDeleteColumn && meta?.editable !== false) {
                        handleCellDoubleClick(rowIndex, cell.column.id, cell.getValue());
                      }
                    }}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          handleKeyDown(e, rowIndex, cell.column.id, meta?.onSave);
                        }}
                        onBlur={() => handleCancelEdit()}
                        className="edit-input"
                      />
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {onAddRow && (
        <button onClick={onAddRow} className="add-row-button">
          + {addRowLabel}
        </button>
      )}
    </div>
  );
}
