const fs = require('fs');
const { deriveLocalPath, derivePartialPath } = require('./fileUtils');

const RETRYABLE_DOWNLOAD_STATUSES = new Set(['failed', 'canceled']);
const TRANSIENT_FILE_LOCK_CODES = new Set(['EBUSY', 'EACCES', 'EPERM']);
const CLEANUP_ATTEMPTS = 4;
const CLEANUP_RETRY_DELAY_MS = 50;

class DownloadRetryError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'DownloadRetryError';
        this.code = code;
        this.cause = cause;
    }
}

const isDownloadRetryable = (record) => RETRYABLE_DOWNLOAD_STATUSES.has(record?.status);

const getNextAttemptCount = (record) => {
    const attemptCount = Number(record?.attemptCount);
    return Number.isInteger(attemptCount) && attemptCount > 0 ? attemptCount + 1 : 2;
};

const removePartialFile = async (localPath) => {
    for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt += 1) {
        try {
            await fs.promises.rm(localPath, { force: true });
            return;
        } catch (error) {
            const shouldRetry = TRANSIENT_FILE_LOCK_CODES.has(error?.code) && attempt < CLEANUP_ATTEMPTS;
            if (!shouldRetry) {
                throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, CLEANUP_RETRY_DELAY_MS * attempt));
        }
    }
};

const prepareDownloadRetry = async (record, now = new Date().toISOString()) => {
    if (!record || typeof record !== 'object' || !record.id) {
        throw new DownloadRetryError('DOWNLOAD_RETRY_RECORD_INVALID', 'The download record is invalid.');
    }

    if (!isDownloadRetryable(record)) {
        throw new DownloadRetryError('DOWNLOAD_NOT_RETRYABLE', 'Only failed or canceled downloads can be retried.');
    }

    const localPath = deriveLocalPath(record);
    const partialPath = derivePartialPath(localPath);
    try {
        await removePartialFile(partialPath);
        await removePartialFile(localPath);
    } catch (error) {
        throw new DownloadRetryError(
            'DOWNLOAD_RETRY_CLEANUP_FAILED',
            `Could not remove the incomplete download before retrying: ${localPath}`,
            error
        );
    }

    return {
        ...record,
        status: 'queued',
        localPath,
        partialPath,
        bytesDownloaded: 0,
        bytesTotal: null,
        progress: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        queuedAt: now,
        queueOrder: null,
        updatedAt: now,
        completedAt: null,
        error: null,
        errorCode: null,
        resumeSupported: null,
        sourceEtag: null,
        sourceLastModified: null,
        attemptCount: getNextAttemptCount(record),
        lastAttemptAt: now
    };
};

module.exports = {
    RETRYABLE_DOWNLOAD_STATUSES,
    DownloadRetryError,
    isDownloadRetryable,
    prepareDownloadRetry
};
