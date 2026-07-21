const normalizeLibrarySearchValue = (value) => {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
};

const matchesLibrarySearch = (values, query) => {
    const normalizedQuery = normalizeLibrarySearchValue(query);
    if (!normalizedQuery) {
        return true;
    }
    const searchable = normalizeLibrarySearchValue((values || []).filter(Boolean).join(' '));
    return normalizedQuery.split(/\s+/).every((term) => searchable.includes(term));
};

const compareLibraryTitles = (left, right) => {
    return String(left?.title || '').localeCompare(String(right?.title || ''), undefined, {
        sensitivity: 'base',
        numeric: true
    });
};

const getEpisodeSearchValues = ({ season, episode } = {}) => {
    const values = [];
    if (Number.isSafeInteger(season)) {
        values.push(`season ${season}`);
    }
    if (Number.isSafeInteger(episode)) {
        values.push(`episode ${episode}`);
    }
    if (Number.isSafeInteger(season) && Number.isSafeInteger(episode)) {
        values.push(`s${season}e${episode}`, `s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`);
    }
    return values;
};

module.exports = {
    normalizeLibrarySearchValue,
    matchesLibrarySearch,
    compareLibraryTitles,
    getEpisodeSearchValues
};
