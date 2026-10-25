const React = require('react');
const { createPortal } = require('react-dom');
const PropTypes = require('prop-types');
const { default: Icon } = require('@stremio/stremio-icons/react');
const styles = require('./SelectMenu.less');

// Render outside scrolling panels so menus are never clipped by the app shell.
const SelectMenu = ({ label, value, options, onSelect, disabled = false, className }) => {
    const [open, setOpen] = React.useState(false);
    const [position, setPosition] = React.useState(null);
    const triggerRef = React.useRef(null);
    const menuRef = React.useRef(null);
    const typeaheadRef = React.useRef({ text: '', time: 0 });
    const id = React.useId();
    const selected = options.find((option) => option.value === value);
    const close = (restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) {
            triggerRef.current?.focus();
        }
    };

    React.useEffect(() => {
        if (disabled) {
            setOpen(false);
        }
    }, [disabled]);

    React.useEffect(() => {
        if (!open) {
            setPosition(null);
            return undefined;
        }
        const trigger = triggerRef.current;
        const menu = menuRef.current;
        const anchor = trigger.getBoundingClientRect();
        menu.style.width = `${Math.min(Math.max(anchor.width, 224), window.innerWidth - 16)}px`;
        const { width, height } = menu.getBoundingClientRect();
        const below = window.innerHeight - anchor.bottom - 16;
        const above = anchor.top - 16;
        const useBelow = height <= below || below >= above;
        const maxHeight = Math.max(48, useBelow ? below : above);
        setPosition({
            width,
            maxHeight,
            left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
            top: useBelow ? anchor.bottom + 6 : Math.max(8, anchor.top - Math.min(height, maxHeight) - 6)
        });
        const closeOutside = (event) => {
            if (!trigger.contains(event.target) && !menu.contains(event.target)) {
                setOpen(false);
            }
        };
        const closeViewport = (event) => {
            if (!menu.contains(event.target)) {
                setOpen(false);
            }
        };
        const escape = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                trigger.focus();
            }
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('focusin', closeOutside);
        document.addEventListener('keydown', escape, true);
        window.addEventListener('resize', closeViewport);
        window.addEventListener('scroll', closeViewport, true);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('focusin', closeOutside);
            document.removeEventListener('keydown', escape, true);
            window.removeEventListener('resize', closeViewport);
            window.removeEventListener('scroll', closeViewport, true);
        };
    }, [open]);

    React.useEffect(() => {
        if (open && position) {
            const menu = menuRef.current;
            (menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role="option"]'))?.focus();
        }
    }, [open, position]);

    const onMenuKeyDown = (event) => {
        const items = Array.from(menuRef.current.querySelectorAll('[role="option"]'));
        const current = items.indexOf(document.activeElement);
        let next;
        if (event.key === 'Tab') {
            close(true);
            return;
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            next = (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        } else if (event.key === 'Home' || event.key === 'End') {
            next = event.key === 'Home' ? 0 : items.length - 1;
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
            const previous = typeaheadRef.current;
            const text = (Date.now() - previous.time < 600 ? previous.text : '') + event.key.toLocaleLowerCase();
            typeaheadRef.current = { text, time: Date.now() };
            next = items.findIndex((item) => item.textContent.trim().toLocaleLowerCase().startsWith(text));
        } else {
            return;
        }
        event.preventDefault();
        items[next]?.focus();
    };

    return (
        <div className={className}>
            <button
                ref={triggerRef}
                type={'button'}
                className={styles['select-trigger']}
                aria-label={`${label}: ${selected?.label || value}`}
                aria-haspopup={'listbox'}
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                disabled={disabled}
                title={selected?.label || label}
                onClick={() => setOpen(!open)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <span className={styles['trigger-content']}>
                    <span className={styles['control-label']}>{label}</span>
                    <span className={styles['selected-value']}>{selected?.label || value}</span>
                </span>
                <Icon name={'caret-down'} className={styles['caret']} aria-hidden={'true'} />
            </button>
            {open ? createPortal(
                <div
                    ref={menuRef}
                    id={id}
                    role={'listbox'}
                    aria-label={label}
                    className={styles['options-menu']}
                    style={position || { visibility: 'hidden' }}
                    onKeyDown={onMenuKeyDown}
                >
                    {options.map((option) => <button
                        type={'button'}
                        role={'option'}
                        aria-selected={option.value === value}
                        tabIndex={-1}
                        key={option.value}
                        onClick={() => {
                            onSelect(option.value);
                            close(true);
                        }}
                    >
                        <span>{option.label}</span>
                        {option.value === value ? <Icon name={'checkmark'} aria-hidden={'true'} /> : null}
                    </button>)}
                </div>, document.body
            ) : null}
        </div>
    );
};

SelectMenu.propTypes = {
    label: PropTypes.string.isRequired,
    value: PropTypes.string.isRequired,
    options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })).isRequired,
    onSelect: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    className: PropTypes.string
};

module.exports = SelectMenu;
