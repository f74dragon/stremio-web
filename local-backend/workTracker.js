const createWorkTracker = () => {
    const active = new Set();
    return {
        run: (operation) => {
            const task = Promise.resolve().then(operation).finally(() => active.delete(task));
            active.add(task);
            return task;
        },
        waitForIdle: async () => {
            while (active.size > 0) await Promise.allSettled([...active]);
        }
    };
};

const createTrackedApi = (app, tracker) => Object.fromEntries(['get', 'post', 'patch', 'delete'].map((method) => [
    method,
    (route, ...handlers) => app[method](route, ...handlers.map((handler) => (request, response, next) => {
        tracker.run(() => handler(request, response, next)).catch(next);
    }))
]));

module.exports = { createWorkTracker, createTrackedApi };
