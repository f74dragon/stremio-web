const { runRealDebridAvailabilityCheck } = require('../src/customStremio/debridAvailabilityCheck');
const { checkRealDebridAvailability, probeRealDebridAvailability } = require('../src/customStremio/localBackendClient');

jest.mock('../src/customStremio/localBackendClient', () => ({
    checkRealDebridAvailability: jest.fn(),
    probeRealDebridAvailability: jest.fn()
}));

const sources = [{ key: 'one', hash: 'one' }, { key: 'two', hash: 'two' }];
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};

beforeEach(() => jest.resetAllMocks());

test('cancel during a cache check preserves its result and cleanup warning, skipping its probe and remaining sources', async () => {
    const controller = new AbortController();
    const pending = deferred();
    const onItems = jest.fn();
    const item = { ...sources[0], status: 'unknown' };
    checkRealDebridAvailability.mockReturnValueOnce(pending.promise);
    const checking = runRealDebridAvailabilityCheck(sources, { signal: controller.signal, onItems });

    controller.abort();
    pending.resolve({ connected: true, items: [item], cleanupWarning: 'Cleanup pending.' });
    await expect(checking).resolves.toEqual({ connected: true, items: [item], cleanupWarning: 'Cleanup pending.', canceled: true });
    expect(onItems).toHaveBeenCalledWith([item]);
    expect(checkRealDebridAvailability).toHaveBeenCalledTimes(1);
    expect(probeRealDebridAvailability).not.toHaveBeenCalled();
});

test('cancel during a resolver probe lets it finish and retains its resolved observation', async () => {
    const controller = new AbortController();
    const pending = deferred();
    const started = deferred();
    const onItems = jest.fn();
    const cacheItem = { ...sources[0], status: 'unknown' };
    const readyItem = { ...sources[0], status: 'ready' };
    checkRealDebridAvailability.mockResolvedValueOnce({ connected: true, items: [cacheItem] });
    probeRealDebridAvailability.mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const checking = runRealDebridAvailabilityCheck(sources, { signal: controller.signal, onItems });

    await started.promise;
    controller.abort();
    pending.resolve({ connected: true, item: readyItem, cleanupWarning: 'Probe cleanup pending.' });
    await expect(checking).resolves.toMatchObject({ items: [readyItem], canceled: true, cleanupWarning: 'Probe cleanup pending.' });
    expect(onItems).toHaveBeenLastCalledWith([readyItem]);
    expect(checkRealDebridAvailability).toHaveBeenCalledTimes(1);
    expect(probeRealDebridAvailability).toHaveBeenCalledTimes(1);
});

test('a previously canceled run performs no cache check or probe', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runRealDebridAvailabilityCheck(sources, { signal: controller.signal })).resolves.toMatchObject({
        connected: undefined, items: [], canceled: true
    });
    expect(checkRealDebridAvailability).not.toHaveBeenCalled();
    expect(probeRealDebridAvailability).not.toHaveBeenCalled();
});

test('a normal run checks every source, probes unresolved results, and reports progress', async () => {
    const onProgress = jest.fn();
    const cached = { ...sources[0], status: 'cached' };
    const ready = { ...sources[1], status: 'ready' };
    checkRealDebridAvailability
        .mockResolvedValueOnce({ connected: true, items: [cached], cleanupWarning: 'A warning.' })
        .mockResolvedValueOnce({ connected: true, items: [{ ...sources[1], status: 'unknown' }] });
    probeRealDebridAvailability.mockResolvedValueOnce({ connected: true, item: ready, cleanupWarning: 'A warning.' });

    await expect(runRealDebridAvailabilityCheck(sources, { onProgress })).resolves.toEqual({
        connected: true, items: [cached, ready], cleanupWarning: 'A warning.', canceled: false
    });
    expect(checkRealDebridAvailability).toHaveBeenCalledTimes(2);
    expect(probeRealDebridAvailability).toHaveBeenCalledWith(sources[1]);
    expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 2, currentKey: 'two', stage: 'resolver' });
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 2, total: 2, currentKey: null, stage: null });
});

test('a failure keeps observations already published and does not continue to another source', async () => {
    const onItems = jest.fn();
    const cached = { ...sources[0], status: 'cached' };
    checkRealDebridAvailability
        .mockResolvedValueOnce({ connected: true, items: [cached] })
        .mockRejectedValueOnce(new Error('Backend unavailable'));
    await expect(runRealDebridAvailabilityCheck([...sources, { key: 'three' }], { onItems })).rejects.toThrow('Backend unavailable');
    expect(onItems).toHaveBeenCalledWith([cached]);
    expect(checkRealDebridAvailability).toHaveBeenCalledTimes(2);
});
