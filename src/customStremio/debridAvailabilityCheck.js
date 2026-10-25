const { checkRealDebridAvailability, probeRealDebridAvailability } = require('./localBackendClient');
const { shouldProbeRealDebridAvailability } = require('./debridSourceReadiness');

// Cancel between provider requests, retaining observations and allowing cleanup
// of the currently active cache check or resolver probe to finish.
const runRealDebridAvailabilityCheck = async (sources, { signal, onProgress, onItems } = {}) => {
    const items = [];
    const cleanupWarnings = new Set();
    let connected;
    const collectResponse = (response) => {
        connected = connected !== false && response?.connected !== false;
        if (response?.cleanupWarning) {
            cleanupWarnings.add(response.cleanupWarning);
        }
    };

    for (let index = 0; index < sources.length && !signal?.aborted; index += 1) {
        const source = sources[index];
        onProgress?.({ completed: index, total: sources.length, currentKey: source.key, stage: 'cache' });
        if (signal?.aborted) {
            break;
        }
        const cacheResult = await checkRealDebridAvailability([source]);
        collectResponse(cacheResult);
        let item = Array.isArray(cacheResult?.items) ? cacheResult.items[0] : null;
        onItems?.(item ? [item] : []);

        if (!signal?.aborted && shouldProbeRealDebridAvailability(item)) {
            onProgress?.({ completed: index, total: sources.length, currentKey: source.key, stage: 'resolver' });
            if (!signal?.aborted) {
                const probeResult = await probeRealDebridAvailability(source);
                collectResponse(probeResult);
                item = probeResult?.item || item;
                onItems?.(item ? [item] : []);
            }
        }
        if (item) {
            items.push(item);
        }
        onProgress?.({ completed: index + 1, total: sources.length, currentKey: null, stage: null });
    }

    return {
        connected,
        items,
        cleanupWarning: Array.from(cleanupWarnings).join(' ') || null,
        canceled: signal?.aborted === true
    };
};

module.exports = { runRealDebridAvailabilityCheck };
