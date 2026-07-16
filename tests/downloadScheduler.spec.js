/* global describe, test, expect */

const {
    DEFAULT_MAX_CONCURRENT_DOWNLOADS,
    MAX_CONCURRENT_DOWNLOADS_LIMIT,
    parseMaxConcurrentDownloads,
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
});

describe('download scheduler configuration', () => {
    test('accepts safe positive limits and falls back for invalid values', () => {
        expect(parseMaxConcurrentDownloads('1')).toBe(1);
        expect(parseMaxConcurrentDownloads('8')).toBe(8);
        expect(parseMaxConcurrentDownloads('0')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads('-1')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads('1.5')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads(String(MAX_CONCURRENT_DOWNLOADS_LIMIT + 1))).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
        expect(parseMaxConcurrentDownloads('invalid', 4)).toBe(4);
    });

    test('sorts persisted queued records by queued time with stable fallbacks', () => {
        const records = [
            { id: 'third', queuedAt: '2026-07-16T12:03:00.000Z' },
            { id: 'first', queuedAt: '2026-07-16T12:01:00.000Z' },
            { id: 'second', createdAt: '2026-07-16T12:02:00.000Z' },
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
    });
});
