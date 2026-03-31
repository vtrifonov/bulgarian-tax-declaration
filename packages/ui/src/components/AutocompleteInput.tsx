import {
    useEffect,
    useRef,
    useState,
} from 'react';

export interface AutocompleteOption {
    label: string;
    value: string;
}

interface AutocompleteInputProps {
    value: string;
    options: AutocompleteOption[];
    onChange: (value: string) => void;
    /** Called when an option is explicitly selected (from dropdown), not just typed */
    onSelect?: (value: string) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    className?: string;
    inputRef?: (el: HTMLInputElement | null) => void;
    'data-column'?: string;
}

export function AutocompleteInput({
    value,
    options,
    onChange,
    onSelect,
    onKeyDown,
    className,
    inputRef,
    'data-column': dataColumn,
}: AutocompleteInputProps) {
    const [open, setOpen] = useState(false);
    const [highlightIdx, setHighlightIdx] = useState(0);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Filter options by current input
    const filtered = value
        ? options.filter((option) =>
            option.label.toLowerCase().includes(value.toLowerCase())
            || option.value.toLowerCase().includes(value.toLowerCase())
        )
        : options;

    // Reset highlight when value changes
    useEffect(() => {
        setHighlightIdx(0); // eslint-disable-line react-hooks/set-state-in-effect -- resetting derived state on input change
    }, [value]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (!listRef.current) {
            return;
        }
        const item = listRef.current.children[highlightIdx] as HTMLElement | undefined;

        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIdx]);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handler);

        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const selectOption = (option: AutocompleteOption) => {
        onChange(option.value);
        onSelect?.(option.value);
        setOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (open && filtered.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));

                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx((prev) => Math.max(prev - 1, 0));

                return;
            }

            if (e.key === 'Tab' || e.key === 'Enter') {
                // Select highlighted option, then let Tab propagate to move focus
                if (filtered[highlightIdx]) {
                    selectOption(filtered[highlightIdx]);
                }

                if (e.key === 'Enter') {
                    e.preventDefault(); // Don't save the row on Enter in autocomplete
                }

                // For Tab: don't preventDefault — let it move focus naturally
                return;
            }
        }

        if (e.key === 'Escape') {
            if (open) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);

                return;
            }
        }
        onKeyDown?.(e);
    };

    return (
        <div ref={wrapperRef} className='autocomplete-wrapper'>
            <input
                ref={inputRef}
                type='text'
                className={className}
                data-column={dataColumn}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={handleKeyDown}
            />
            {open && filtered.length > 0 && (
                <ul ref={listRef} className='autocomplete-dropdown'>
                    {filtered.map((option, idx) => (
                        <li
                            key={`${option.value}-${idx}`}
                            className={`autocomplete-option ${idx === highlightIdx ? 'highlighted' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault(); // Don't blur input
                                selectOption(option);
                            }}
                            onMouseEnter={() => setHighlightIdx(idx)}
                        >
                            {option.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
