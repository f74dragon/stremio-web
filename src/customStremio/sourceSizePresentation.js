const { parseStreamVideoSize } = require('./downloadPayload');
const getSourceSizeLabel = (stream) => {
    const size = parseStreamVideoSize(stream);
    if (!size) return 'Size unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    return `${(size / (1024 ** index)).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
};
module.exports = { getSourceSizeLabel };
