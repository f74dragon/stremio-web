/* global describe, test, expect */

const {
    DEFAULT_MAX_CONCURRENT_DOWNLOADS,
    UNLIMITED_CONCURRENT_DOWNLOADS,
    parseMaxConcurrentDownloads,
    getPersistedQueueOrder,
    sortQueuedDownloadRecords,
    DownloadScheduler
} = require('../local-backend/downloadScheduler');

const createDeferred = () => {
    let resolve;
    const promise = new Promise((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
};

const waitFor = async (callback, timeoutMs = 2000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const result = callback();
        if (result) {
            return result;
        }
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('Timed out waiting for scheduler state');
};

describe('DownloadScheduler', () => {
    test('enforces its concurrency cap and starts waiting tasks in FIFO order', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 2 });
        const gates = [createDeferred(), createDeferred(), createDeferred()];
        const started = [];

        ['first', 'second', 'third'].forEach((id, index) => {
            scheduler.enqueue(id, async () => {
                started.push(id);
                await gates[index].promise;
            });
        });

        expect(started).toEqual(['first', 'second']);
        expect(scheduler.getSnapshot()).toMatchObject({ activeCount: 2, queuedCount: 1 });

        gates[0].resolve();
        await waitFor(() => started.length === 3);
        expect(started).toEqual(['first', 'second', 'third']);

        gates[1].resolve();
        gates[2].resolve();
        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
    });

    test('removes a queued task without running it', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 1 });
        const activeGate = createDeferred();
        const started = [];

        scheduler.enqueue('active', async () => {
            started.push('active');
            await activeGate.promise;
        });
        scheduler.enqueue('removed', () => started.push('removed'));

        expect(scheduler.remove('removed')).toBe(true);
        expect(scheduler.isQueued('removed')).toBe(false);
        activeGate.resolve();
        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
        expect(started).toEqual(['active']);
    });

    test('moves waiting tasks without affecting the active transfer', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 1 });
        const activeGate = createDeferred();
        const started = [];

        scheduler.enqueue('active', async () => {
            started.push('active');
            await activeGate.promise;
        });
        scheduler.enqueue('first', () => started.push('first'));
        scheduler.enqueue('second', () => started.push('second'));
        scheduler.enqueue('third', () => started.push('third'));

        expect(scheduler.move('third', 1).queuedIds).toEqual(['third', 'first', 'second']);
        expect(scheduler.move('third', 2).queuedIds).toEqual(['first', 'third', 'second']);
        expect(scheduler.move('missing', 1)).toBe(false);
        expect(() => scheduler.move('first', 0)).toThrow(RangeError);
        expect(() => scheduler.move('first', 4)).toThrow(RangeError);

        activeGate.resolve();
        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
        expect(started).toEqual(['active', 'first', 'third', 'second']);
    });

    test('restores a complete waiting order for persistence rollback', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 1 });
        const activeGate = createDeferred();
        scheduler.enqueue('active', () => activeGate.promise);
        scheduler.enqueue('first', () => undefined);
        scheduler.enqueue('second', () => undefined);
        scheduler.enqueue('third', () => undefined);

        expect(scheduler.setQueueOrder(['third', 'first', 'second']).queuedIds).toEqual(['third', 'first', 'second']);
        expect(() => scheduler.setQueueOrder(['first', 'second'])).toThrow(TypeError);
        expect(() => scheduler.setQueueOrder(['first', 'second', 'unknown'])).toThrow(TypeError);

        activeGate.resolve();
        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
    });

    test('releases a slot after task failure and reports the error', async () => {
        const errors = [];
        const started = [];
        const scheduler = new DownloadScheduler({
            maxConcurrentDownloads: 1,
            onTaskError: (error, id) => errors.push({ error, id })
        });

        scheduler.enqueue('failed', async () => {
            started.push('failed');
            throw new Error('network failed');
        });
        scheduler.enqueue('next', () => started.push('next'));

        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
        expect(started).toEqual(['failed', 'next']);
        expect(errors).toMatchObject([{ id: 'failed', error: { message: 'network failed' } }]);
    });

    test('stops dispatching new work while leaving the waiting queue intact', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 1 });
        const activeGate = createDeferred();
        const started = [];

        scheduler.enqueue('active', async () => {
            started.push('active');
            await activeGate.promise;
        });
        scheduler.enqueue('waiting', () => started.push('waiting'));
        scheduler.stop();
        activeGate.resolve();

        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
        expect(scheduler.getSnapshot()).toMatchObject({ queuedCount: 1, queuedIds: ['waiting'] });
        expect(started).toEqual(['active']);
    });

    test('starts additional queued work immediately when the limit increases', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 1 });
        const firstGate = createDeferred();
        const secondGate = createDeferred();
        const started = [];

        scheduler.enqueue('first', async () => {
            started.push('first');
            await firstGate.promise;
        });
        scheduler.enqueue('second', async () => {
            started.push('second');
            await secondGate.promise;
        });

        expect(started).toEqual(['first']);
        scheduler.setMaxConcurrentDownloads(2);
        expect(started).toEqual(['first', 'second']);
        expect(scheduler.getSnapshot()).toMatchObject({ maxConcurrentDownloads: 2, activeCount: 2, queuedCount: 0 });

        firstGate.resolve();
        secondGate.resolve();
        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
    });

    test('does not interrupt active work when the limit decreases', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 2 });
        const gates = [createDeferred(), createDeferred(), createDeferred()];
        const started = [];

        ['first', 'second', 'third'].forEach((id, index) => {
            scheduler.enqueue(id, async () => {
                started.push(id);
                await gates[index].promise;
            });
        });

        scheduler.setMaxConcurrentDownloads(1);
        expect(scheduler.getSnapshot()).toMatchObject({ maxConcurrentDownloads: 1, activeCount: 2, queuedCount: 1 });

        gates[0].resolve();
        await waitFor(() => scheduler.getSnapshot().activeCount === 1);
        expect(started).toEqual(['first', 'second']);

        gates[1].resolve();
        await waitFor(() => started.length === 3);
        expect(started).toEqual(['first', 'second', 'third']);
        gates[2].resolve();
        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
    });

    test('starts all waiting work when concurrency becomes unlimited', async () => {
        const scheduler = new DownloadScheduler({ maxConcurrentDownloads: 1 });
        const gates = [createDeferred(), createDeferred(), createDeferred()];
        const started = [];

        ['first', 'second', 'third'].forEach((id, index) => {
            scheduler.enqueue(id, async () => {
                started.push(id);
                await gates[index].promise;
            });
        });

        expect(started).toEqual(['first']);
        scheduler.setMaxConcurrentDownloads(UNLIMITED_CONCURRENT_DOWNLOADS);
        expect(started).toEqual(['first', 'second', 'third']);
        expect(scheduler.getSnapshot()).toMatchObject({
            maxConcurrentDownloads: UNLIMITED_CONCURRENT_DOWNLOADS,
            activeCount: 3,
            queuedCount: 0
        });

        gates.forEach(({ resolve }) => resolve());
        await waitFor(() => scheduler.getSnapshot().activeCount === 0);
    });
});

describe('download scheduler configuration', () => {
    test('accepts custom and unlimited limits and falls back for invalid values', () => {
        expect(parseMaxConcurrentDownloads('1')).toBe(1);
        expect(parseMaxConcurrentDownloads('128')).toBe(128);
        expect(parseMaxConcurrentDownloads('unlimited')).toBe(UNLIMITED_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads(' Unlimited ')).toBe(UNLIMITED_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads('0')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads('-1')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads('1.5')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads(String(Number.MAX_SAFE_INTEGER + 1))).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads('invalid', 4)).toBe(4);
    });

    test('sorts persisted queue choices before FIFO fallbacks', () => {
        const records = [
            { id: 'third', queuedAt: '2026-07-16T12:03:00.000Z' },
            { id: 'first', queueOrder: 1, queuedAt: '2026-07-16T12:04:00.000Z' },
            { id: 'second', queueOrder: 2, createdAt: '2026-07-16T12:05:00.000Z' },
            { id: 'fallback', queuedAt: 'invalid', createdAt: '2026-07-16T12:02:30.000Z' },
            { id: 'legacy-a' },
            { id: 'legacy-b' }
        ];

        expect(sortQueuedDownloadRecords(records).map((record) => record.id)).toEqual([
            'first',
            'second',
            'fallback',
            'third',
            'legacy-a',
            'legacy-b'
        ]);
        expect(getPersistedQueueOrder(records[1])).toBe(1);
        expect(getPersistedQueueOrder({ queueOrder: 0 })).toBe(null);
    });
});
