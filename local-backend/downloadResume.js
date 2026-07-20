const {
    deriveLocalPath,
    derivePartialPath,
    getRegularFileIdentity,
    isSameFileIdentity
} = require('./fileUtils');

class DownloadResumeError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'DownloadResumeError';
        this.code = code;
        this.cause = cause;
    }
}

const isDownloadResumable = (record) => record?.status === 'paused';

const getProgress = (bytesDownloaded, bytesTotal) => {
    return bytesTotal > 0 ? Math.min(100, Number(((bytesDownloaded / bytesTotal) * 100).toFixed(2))) : 0;
};

const getPartialFileSize = async (partialPath, expectedBytes, recordedIdentity) => {
    try {
        const actualIdentity = await getRegularFileIdentity(partialPath);
        if (!recordedIdentity) {
            throw new DownloadResumeError(
                'DOWNLOAD_PARTIAL_IDENTITY_UNRECORDED',
                `The saved partial file has no recorded identity and will not be resumed automatically: ${partialPath}`
            );
        }
        if (!isSameFileIdentity(recordedIdentity, actualIdentity)) {
            throw new DownloadResumeError(
                'DOWNLOAD_PARTIAL_IDENTITY_MISMATCH',
                `The saved partial file changed after the download stopped and will not be resumed: ${partialPath}`
            );
        }
        return actualIdentity.size;
    } catch (error) {
        if (error instanceof DownloadResumeError) {
            throw error;
        }
        if (error?.code === 'ENOENT' && expectedBytes === 0) {
            return 0;
        }
        if (error?.code === 'ENOENT') {
            throw new DownloadResumeError('DOWNLOAD_PARTIAL_FILE_MISSING', `The partial download file is missing: ${partialPath}`, error);
        }
        if (error?.code === 'DOWNLOAD_ARTIFACT_INVALID') {
            throw new DownloadResumeError('DOWNLOAD_PARTIAL_FILE_INVALID', error.message, error);
        }
        throw new DownloadResumeError('DOWNLOAD_PARTIAL_FILE_UNAVAILABLE', `The partial download could not be inspected: ${partialPath}`, error);
    }
};

const prepareDownloadResume = async (record, now = new Date().toISOString()) => {
    if (!record || typeof record !== 'object' || !record.id) {
        throw new DownloadResumeError('DOWNLOAD_RESUME_RECORD_INVALID', 'The download record is invalid.');
    }
    if (!isDownloadResumable(record)) {
        throw new DownloadResumeError('DOWNLOAD_NOT_RESUMABLE', 'Only paused downloads can be resumed.');
    }

    const localPath = deriveLocalPath(record);
    const partialPath = derivePartialPath(localPath);
    const recordedBytes = Number(record.bytesDownloaded);
    const expectedBytes = Number.isFinite(recordedBytes) && recordedBytes > 0 ? recordedBytes : 0;
    const resumeOffset = await getPartialFileSize(partialPath, expectedBytes, record.partialFileIdentity);
    const recordedTotal = Number(record.bytesTotal);
    const bytesTotal = Number.isFinite(recordedTotal) && recordedTotal > 0 ? recordedTotal : null;

    if (bytesTotal !== null && resumeOffset > bytesTotal) {
        throw new DownloadResumeError(
            'DOWNLOAD_PARTIAL_FILE_TOO_LARGE',
            `The partial download is larger than the expected media file: ${partialPath}`
        );
    }

    return {
        record: {
            ...record,
            status: 'queued',
            localPath,
            partialPath,
            bytesDownloaded: resumeOffset,
            bytesTotal,
            progress: getProgress(resumeOffset, bytesTotal),
            speedBytesPerSecond: 0,
            etaSeconds: null,
            queuedAt: now,
            queueOrder: null,
            updatedAt: now,
            completedAt: null,
            error: null,
            errorCode: null,
            localFileIdentity: null,
            partialFileIdentity: record.partialFileIdentity ?? null
        },
        resumeOffset
    };
};

module.exports = {
    DownloadResumeError,
    isDownloadResumable,
    prepareDownloadResume
};
