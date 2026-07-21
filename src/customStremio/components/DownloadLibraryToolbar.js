const React = require('react');
const PropTypes = require('prop-types');
const { default: Icon } = require('@stremio/stremio-icons/react');
const styles = require('./DownloadLibraryToolbar.less');

const DownloadLibraryToolbar = ({
    label,
    searchValue,
    searchPlaceholder,
    clearLabel,
    sortLabel,
    sortValue,
    sortOptions,
    resultSummary,
    disabled,
    onSearchChange,
    onClear,
    onSortChange
}) => {
    return (
        <section className={`${styles['toolbar']} ${disabled ? styles['toolbar-disabled'] : ''}`} aria-label={label}>
            <div className={styles['search-field']}>
                <Icon name={'search'} aria-hidden={'true'} />
                <input
                    type={'search'}
                    value={searchValue}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    disabled={disabled}
                    autoComplete={'off'}
                    spellCheck={false}
                    onChange={(event) => onSearchChange(event.target.value)}
                />
                {searchValue ?
                    <button type={'button'} aria-label={clearLabel} title={clearLabel} disabled={disabled} onClick={onClear}>
                        <Icon name={'close'} aria-hidden={'true'} />
                    </button>
                    : null}
            </div>
            <label className={styles['sort-field']}>
                <span>{sortLabel}</span>
                <select value={sortValue} disabled={disabled} onChange={(event) => onSortChange(event.target.value)}>
                    {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </label>
            <div className={styles['result-count']} aria-live={'polite'}>
                <span>{resultSummary}</span>
            </div>
        </section>
    );
};

DownloadLibraryToolbar.propTypes = {
    label: PropTypes.string.isRequired,
    searchValue: PropTypes.string.isRequired,
    searchPlaceholder: PropTypes.string.isRequired,
    clearLabel: PropTypes.string.isRequired,
    sortLabel: PropTypes.string.isRequired,
    sortValue: PropTypes.string.isRequired,
    sortOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })).isRequired,
    resultSummary: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    onSearchChange: PropTypes.func.isRequired,
    onClear: PropTypes.func.isRequired,
    onSortChange: PropTypes.func.isRequired
};

module.exports = DownloadLibraryToolbar;
