const crypto = require('crypto');
const { isSameWindowsMediaPath } = require('./mpcHcStatusClient');
const { createPlaybackContentKey } = require('./playbackProgressStore');

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_STARTUP_TIMEOUT_MS = 30000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

class MpcHcPlaybackTracker {
    constructor({
        client,
        store,
        pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
        startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
        maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAILURES,
        now = () => Date.now(),
        idFactory = () => crypto.randomUUID(),
        setTimer = setTimeout,
        clearTimer = clearTimeout,
        onWarning = console.warn
    }) {
        if (!client || !store) {
            throw new Error('MpcHcPlaybackTracker requires a client and progress store');
        }
        this.client = client;
        this.store = store;
        this.pollIntervalMs = pollIntervalMs;
        this.startupTimeoutMs = startupTimeoutMs;
        this.maxConsecutiveFailures = maxConsecutiveFailures;
        this.now = now;
        this.idFactory = idFactory;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.onWarning = onWarning;
        this.sessions = new Map();
    }

    start(record, { port }) {
        if (!record?.id || !record?.localPath) {
            throw new Error('A completed download record with a local path is required for playback tracking');
        }
        Array.from(this.sessions.keys()).forEach((sessionId) => this.stop(sessionId, 'superseded_by_new_launch'));

        const startedAtMs = this.now();
        const session = {
            id: `playback_${this.idFactory()}`,
            downloadId: record.id,
            contentKey: createPlaybackContentKey(record),
            targetPath: record.localPath,
            port,
            record: { ...record },
            startedAtMs,
            startedAt: new Date(startedAtMs).toISOString(),
            matched: false,
            observedActive: false,
            consecutiveFailures: 0,
            timer: null,
            stopped: false,
            endReason: null
        };
        this.sessions.set(session.id, session);
        this.schedule(session, 250);
        return this.getSession(session.id);
    }

    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? {
            id: session.id,
            downloadId: session.downloadId,
            contentKey: session.contentKey,
            matched: session.matched,
            startedAt: session.startedAt,
            active: !session.stopped,
            endReason: session.endReason
        } : null;
    }

    schedule(session, delay = this.pollIntervalMs) {
        if (session.stopped) {
            return;
        }
        session.timer = this.setTimer(() => {
            session.timer = null;
            this.poll(session).catch((error) => {
                this.onWarning(`Unexpected MPC-HC playback tracking error: ${error.message || 'unknown error'}`);
                this.stop(session.id, 'tracker_error');
            });
        }, delay);
    }

    async poll(session) {
        if (session.stopped) {
            return;
        }
        try {
            const status = await this.client.getStatus(session.port);
            if (session.stopped) {
                return;
            }
            session.consecutiveFailures = 0;
            if (!isSameWindowsMediaPath(status.filePath, session.targetPath)) {
                if (session.matched) {
                    this.stop(session.id, 'file_changed');
                    return;
                }
                if (this.now() - session.startedAtMs >= this.startupTimeoutMs) {
                    this.stop(session.id, 'file_not_observed');
                    return;
                }
                this.schedule(session);
                return;
            }

            session.matched = true;
            if (status.state === 'stopped' && !session.observedActive) {
                if (this.now() - session.startedAtMs >= this.startupTimeoutMs) {
                    this.stop(session.id, 'playback_not_started');
                    return;
                }
                this.schedule(session);
                return;
            }
            session.observedActive = true;
            const observedAt = new Date(this.now()).toISOString();
            this.store.upsert({
                contentKey: session.contentKey,
                downloadId: session.record.id,
                metaId: session.record.metaId,
                videoId: session.record.videoId,
                mediaType: session.record.type,
                title: session.record.videoTitle || session.record.parentTitle,
                parentTitle: session.record.parentTitle,
                season: session.record.season,
                episode: session.record.episode,
                localPath: session.targetPath,
                positionMs: status.positionMs,
                durationMs: status.durationMs,
                state: status.state,
                startedAt: session.startedAt,
                lastObservedAt: observedAt,
                lastPlayedAt: observedAt,
                sessionEndedReason: null
            });
            if (status.state === 'stopped') {
                this.stop(session.id, 'player_stopped');
                return;
            }
            this.schedule(session);
        } catch (_error) {
            if (session.stopped) {
                return;
            }
            session.consecutiveFailures += 1;
            const startupExpired = this.now() - session.startedAtMs >= this.startupTimeoutMs;
            if (session.consecutiveFailures >= this.maxConsecutiveFailures || (!session.matched && startupExpired)) {
                this.stop(session.id, session.matched ? 'player_unreachable' : 'telemetry_unavailable', {
                    markUnreachable: session.matched
                });
                return;
            }
            this.schedule(session);
        }
    }

    stop(sessionId, reason = 'stopped', { markUnreachable = false } = {}) {
        const session = this.sessions.get(sessionId);
        if (!session || session.stopped) {
            return false;
        }
        session.stopped = true;
        session.endReason = reason;
        if (session.timer !== null) {
            this.clearTimer(session.timer);
            session.timer = null;
        }
        const existing = this.store.get(session.contentKey);
        if (session.matched && existing) {
            const observedAt = new Date(this.now()).toISOString();
            this.store.upsert({
                ...existing,
                state: markUnreachable ? 'unreachable' : existing.state,
                lastObservedAt: markUnreachable ? observedAt : existing.lastObservedAt,
                sessionEndedReason: reason
            });
        }
        this.sessions.delete(sessionId);
        return true;
    }

    stopAll(reason = 'backend_shutdown') {
        Array.from(this.sessions.keys()).forEach((sessionId) => this.stop(sessionId, reason));
    }
}

module.exports = {
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_STARTUP_TIMEOUT_MS,
    DEFAULT_MAX_CONSECUTIVE_FAILURES,
    MpcHcPlaybackTracker
};
