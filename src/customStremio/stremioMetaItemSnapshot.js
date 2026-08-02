const MAX_META_ITEM_SNAPSHOT_BYTES = 128 * 1024;
const SNAPSHOT_FIELDS = [
    'id',
    'type',
    'name',
    'description',
    'logo',
    'background',
    'poster',
    'posterShape',
    'releaseInfo',
    'runtime',
    'trailerStreams',
    'links',
    'behaviorHints'
];

const normalizeText = (value, maxLength = 4096) => {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
};

const cloneJsonValue = (value) => {
    if (value === undefined) {
        return undefined;
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
};

const getUtf8ByteLength = (value) => {
    let bytes = 0;
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return bytes;
};

const buildStremioMetaItemSnapshot = (metaItem) => {
    if (!metaItem || typeof metaItem !== 'object' || Array.isArray(metaItem)) {
        return null;
    }

    const id = normalizeText(metaItem.id, 512);
    const type = normalizeText(metaItem.type, 64);
    const name = normalizeText(metaItem.name, 1024);
    if (!id || !type || !name) {
        return null;
    }

    const snapshot = Object.fromEntries(SNAPSHOT_FIELDS
        .filter((field) => Object.prototype.hasOwnProperty.call(metaItem, field))
        .map((field) => [field, cloneJsonValue(metaItem[field])])
        .filter(([, value]) => value !== undefined));
    snapshot.id = id;
    snapshot.type = type;
    snapshot.name = name;
    snapshot.released = metaItem.released instanceof Date ?
        (!isNaN(metaItem.released.getTime()) ? metaItem.released.toISOString() : null)
        : normalizeText(metaItem.released, 64);

    const serialized = JSON.stringify(snapshot);
    return getUtf8ByteLength(serialized) <= MAX_META_ITEM_SNAPSHOT_BYTES ? snapshot : null;
};

const validateStremioMetaItemSnapshot = (metaItem, { metaId = null, type = null } = {}) => {
    const snapshot = buildStremioMetaItemSnapshot(metaItem);
    if (!snapshot || (metaId && snapshot.id !== metaId) || (type && snapshot.type !== type)) {
        return null;
    }
    return snapshot;
};

const buildLegacyStremioMetaItemSnapshot = (record) => buildStremioMetaItemSnapshot({
    id: record?.metaId,
    type: record?.type,
    name: record?.parentTitle || record?.videoTitle,
    description: record?.description ?? null,
    logo: record?.logo ?? null,
    background: record?.background ?? null,
    poster: record?.poster ?? null,
    posterShape: 'poster',
    releaseInfo: record?.releaseInfo ?? null,
    runtime: record?.runtime ?? null,
    released: record?.titleReleased ?? null,
    trailerStreams: [],
    links: Array.isArray(record?.metaLinks) ? record.metaLinks : [],
    behaviorHints: {}
});

module.exports = {
    MAX_META_ITEM_SNAPSHOT_BYTES,
    buildStremioMetaItemSnapshot,
    buildLegacyStremioMetaItemSnapshot,
    validateStremioMetaItemSnapshot
};
