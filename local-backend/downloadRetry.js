const fs = require('fs');
const { deriveLocalPath, derivePartialPath } = require('./fileUtils');
const { deleteDownloadArtifacts } = require('./downloadDeletion');

const RETRYABLE_DOWNLOAD_STATUSES = new Set(['failed', 'canceled']);

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
        await fs.promises.lstat(localPath);
        throw new DownloadRetryError(
            'DOWNLOAD_DESTINATION_EXISTS',
            `The final download destination already exists and will not be overwritten: ${localPath}`
        );
    } catch (error) {
        if (error instanceof DownloadRetryError) {
            throw error;
        }
        if (error?.code !== 'ENOENT') {
            throw new DownloadRetryError(
                'DOWNLOAD_RETRY_DESTINATION_CHECK_FAILED',
                `Could not safely inspect the final download destination before retrying: ${localPath}`,
                error
            );
        }
    }

    try {
        await deleteDownloadArtifacts(record);
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
        localFileIdentity: null,
        partialFileIdentity: null,
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
