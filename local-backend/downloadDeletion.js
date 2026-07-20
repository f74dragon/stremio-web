const fs = require('fs');
const path = require('path');
const {
    getDefaultDownloadsRoot,
    deriveLocalPath,
    derivePartialPath,
    createFileIdentity,
    isSameFileIdentity
} = require('./fileUtils');

const DELETABLE_DOWNLOAD_STATUSES = new Set(['paused', 'completed', 'failed', 'canceled']);
const TRANSIENT_FILE_LOCK_CODES = new Set(['EBUSY', 'EACCES', 'EPERM']);
const DELETE_ATTEMPTS = 4;
const DELETE_RETRY_DELAY_MS = 75;

class DownloadDeletionError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'DownloadDeletionError';
        this.code = code;
        this.cause = cause;
    }
}

const isDownloadMediaDeletable = (record) => DELETABLE_DOWNLOAD_STATUSES.has(record?.status);

const isPathInside = (rootPath, candidatePath) => {
    const relativePath = path.relative(rootPath, candidatePath);
    return relativePath !== '' && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
};

const normalizeComparablePath = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const assertRecordedPathMatches = (recordedPath, expectedPath, fieldName) => {
    if (recordedPath === null || recordedPath === undefined || recordedPath === '') {
        return null;
    }
    if (typeof recordedPath !== 'string' || !path.isAbsolute(recordedPath) ||
        normalizeComparablePath(recordedPath) !== normalizeComparablePath(expectedPath)) {
        throw new DownloadDeletionError(
            'DOWNLOAD_RECORDED_PATH_MISMATCH',
            `The recorded ${fieldName} does not match the trusted derived download path.`
        );
    }
    return path.resolve(recordedPath);
};

const getDownloadArtifactPaths = (record) => {
    const rootPath = path.resolve(getDefaultDownloadsRoot());
    const localPath = path.resolve(deriveLocalPath(record));
    const partialPath = path.resolve(derivePartialPath(localPath));
    if (!isPathInside(rootPath, localPath) || !isPathInside(rootPath, partialPath)) {
        throw new DownloadDeletionError(
            'DOWNLOAD_DELETE_PATH_UNSAFE',
            'The derived download path is outside the configured download directory.'
        );
    }
    return { rootPath, localPath, partialPath };
};

const getDownloadDeletionPlan = (record) => {
    if (!record || typeof record !== 'object' || !record.id) {
        throw new DownloadDeletionError('DOWNLOAD_DELETE_RECORD_INVALID', 'The download record is invalid.');
    }
    if (!isDownloadMediaDeletable(record)) {
        throw new DownloadDeletionError(
            'DOWNLOAD_MEDIA_NOT_DELETABLE',
            'Only paused, completed, failed, or canceled downloads can have their local data deleted.'
        );
    }

    const paths = getDownloadArtifactPaths(record);
    const recordedLocalPath = record.status === 'completed' ?
        assertRecordedPathMatches(record.localPath, paths.localPath, 'final path')
        : null;
    const recordedPartialPath = assertRecordedPathMatches(record.partialPath, paths.partialPath, 'partial path');
    if (record.status === 'completed' && !recordedLocalPath) {
        throw new DownloadDeletionError(
            'DOWNLOAD_FINAL_PATH_UNRECORDED',
            'The completed download has no verified recorded file path. Remove only its record or inspect it manually.'
        );
    }

    const artifacts = [];
    if (record.status === 'completed' && recordedLocalPath) {
        artifacts.push({ path: recordedLocalPath, identity: record.localFileIdentity ?? null });
    }
    if (recordedPartialPath) {
        artifacts.push({ path: recordedPartialPath, identity: record.partialFileIdentity ?? null });
    }

    return {
        ...paths,
        artifacts
    };
};

const getDownloadDestinationPathKeys = (record) => {
    const { localPath, partialPath } = getDownloadArtifactPaths(record);
    return [localPath, partialPath].map(normalizeComparablePath);
};

const getSharedDownloadDestinationRecords = (record, records) => {
    let requested;
    try {
        requested = new Set(getDownloadDestinationPathKeys(record));
    } catch {
        return [];
    }
    return Array.from(records || []).filter((candidate) => {
        if (!candidate || candidate.id === record.id || candidate.status === 'deleted') {
            return false;
        }
        try {
            return getDownloadDestinationPathKeys(candidate).some((candidatePath) => requested.has(candidatePath));
        } catch {
            return false;
        }
    });
};

const getSharedDownloadArtifactRecords = (record, records) => {
    const requestedPaths = getDownloadDeletionPlan(record);
    const requested = new Set(requestedPaths.artifacts.map((artifact) => normalizeComparablePath(artifact.path)));
    if (requested.size === 0) {
        return [];
    }
    return Array.from(records || []).filter((candidate) => {
        if (!candidate || candidate.id === record.id || candidate.status === 'deleted') {
            return false;
        }
        try {
            return getDownloadDestinationPathKeys(candidate).some((candidatePath) => requested.has(candidatePath));
        } catch {
            return false;
        }
    });
};

const getSharedDownloadPartialOwnerRecords = (record, records) => {
    if (!record?.partialPath || !record?.partialFileIdentity) {
        return [];
    }

    let requestedPartialPath;
    try {
        const paths = getDownloadArtifactPaths(record);
        requestedPartialPath = assertRecordedPathMatches(record.partialPath, paths.partialPath, 'partial path');
    } catch {
        return [];
    }

    return Array.from(records || []).filter((candidate) => {
        if (!candidate || candidate.id === record.id || candidate.status === 'deleted' ||
            !candidate.partialPath || !candidate.partialFileIdentity ||
            !isSameFileIdentity(record.partialFileIdentity, candidate.partialFileIdentity)) {
            return false;
        }
        try {
            const candidatePaths = getDownloadArtifactPaths(candidate);
            const candidatePartialPath = assertRecordedPathMatches(
                candidate.partialPath,
                candidatePaths.partialPath,
                'partial path'
            );
            return normalizeComparablePath(candidatePartialPath) === normalizeComparablePath(requestedPartialPath);
        } catch {
            return false;
        }
    });
};

const hasExistingDownloadArtifacts = async (record) => {
    const { artifacts } = getDownloadDeletionPlan(record);
    for (const artifact of artifacts) {
        try {
            await fs.promises.lstat(artifact.path);
            return true;
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw new DownloadDeletionError(
                    'DOWNLOAD_ARTIFACT_INSPECTION_FAILED',
                    `Could not safely inspect the recorded download artifact: ${artifact.path}`,
                    error
                );
            }
        }
    }
    return false;
};

const getRealPathIfPresent = async (targetPath) => {
    try {
        return await fs.promises.realpath(targetPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
};

const assertSafeExistingFile = async (rootPath, targetPath, recordedIdentity) => {
    let stats;
    try {
        stats = await fs.promises.lstat(targetPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new DownloadDeletionError(
            'DOWNLOAD_DELETE_ARTIFACT_INVALID',
            `The download artifact is not a regular file: ${targetPath}`
        );
    }

    const realRootPath = await getRealPathIfPresent(rootPath);
    const realParentPath = await getRealPathIfPresent(path.dirname(targetPath));
    if (!realRootPath || !realParentPath || !isPathInside(realRootPath, path.join(realParentPath, path.basename(targetPath)))) {
        throw new DownloadDeletionError(
            'DOWNLOAD_DELETE_PATH_UNSAFE',
            `The download artifact resolves outside the configured download directory: ${targetPath}`
        );
    }
    if (!recordedIdentity) {
        throw new DownloadDeletionError(
            'DOWNLOAD_FILE_IDENTITY_UNRECORDED',
            `The existing download artifact has no recorded identity and will not be deleted automatically: ${targetPath}`
        );
    }
    if (!isSameFileIdentity(recordedIdentity, createFileIdentity(stats))) {
        throw new DownloadDeletionError(
            'DOWNLOAD_FILE_IDENTITY_MISMATCH',
            `The file at the recorded download path has changed and will not be deleted automatically: ${targetPath}`
        );
    }
    return stats;
};

const removeFileWithRetry = async (targetPath, expectedStats) => {
    for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt += 1) {
        try {
            const currentStats = await fs.promises.lstat(targetPath);
            if (!currentStats.isFile() || currentStats.isSymbolicLink() ||
                !isSameFileIdentity(createFileIdentity(expectedStats), createFileIdentity(currentStats))) {
                throw new DownloadDeletionError(
                    'DOWNLOAD_DELETE_ARTIFACT_CHANGED',
                    `The download artifact changed while deletion was being prepared: ${targetPath}`
                );
            }
            await fs.promises.rm(targetPath);
            return;
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return;
            }
            const shouldRetry = TRANSIENT_FILE_LOCK_CODES.has(error?.code) && attempt < DELETE_ATTEMPTS;
            if (!shouldRetry) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, DELETE_RETRY_DELAY_MS * attempt));
        }
    }
};

const removeEmptyParentDirectories = async (startPath, rootPath) => {
    const removedDirectories = [];
    let currentPath = path.dirname(startPath);
    while (normalizeComparablePath(currentPath) !== normalizeComparablePath(rootPath) && isPathInside(rootPath, currentPath)) {
        try {
            const stats = await fs.promises.lstat(currentPath);
            if (!stats.isDirectory() || stats.isSymbolicLink()) {
                break;
            }
            await fs.promises.rmdir(currentPath);
            removedDirectories.push(currentPath);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                currentPath = path.dirname(currentPath);
                continue;
            }
            if (['ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) {
                break;
            }
            throw error;
        }
        currentPath = path.dirname(currentPath);
    }
    return removedDirectories;
};

const deleteDownloadArtifacts = async (record) => {
    const { rootPath, localPath, partialPath, artifacts: plannedArtifacts } = getDownloadDeletionPlan(record);
    const deletedFiles = [];
    let bytesFreed = 0;
    const verifiedArtifacts = [];
    for (const artifact of plannedArtifacts) {
        const targetPath = artifact.path;
        try {
            const stats = await assertSafeExistingFile(rootPath, targetPath, artifact.identity);
            if (stats) {
                verifiedArtifacts.push({ targetPath, stats });
            }
        } catch (error) {
            if (error instanceof DownloadDeletionError) {
                throw error;
            }
            throw new DownloadDeletionError(
                'DOWNLOAD_MEDIA_DELETE_FAILED',
                `Could not delete the local download data: ${targetPath}`,
                error
            );
        }
    }

    for (const { targetPath, stats } of verifiedArtifacts) {
        try {
            await removeFileWithRetry(targetPath, stats);
        } catch (error) {
            if (error instanceof DownloadDeletionError) {
                throw error;
            }
            throw new DownloadDeletionError(
                'DOWNLOAD_MEDIA_DELETE_FAILED',
                `Could not delete the local download data: ${targetPath}`,
                error
            );
        }
        deletedFiles.push(targetPath);
        bytesFreed += stats.size;
    }

    let removedDirectories = [];
    let directoryCleanupWarning = null;
    if (deletedFiles.length > 0) {
        try {
            removedDirectories = await removeEmptyParentDirectories(localPath, rootPath);
        } catch (_error) {
            directoryCleanupWarning = 'The media was deleted, but an empty download directory could not be removed.';
        }
    }

    return {
        localPath,
        partialPath,
        deletedFiles,
        bytesFreed,
        removedDirectories,
        directoryCleanupWarning
    };
};

module.exports = {
    DELETABLE_DOWNLOAD_STATUSES,
    DownloadDeletionError,
    isDownloadMediaDeletable,
    getDownloadArtifactPaths,
    getDownloadDeletionPlan,
    getDownloadDestinationPathKeys,
    getSharedDownloadDestinationRecords,
    getSharedDownloadArtifactRecords,
    getSharedDownloadPartialOwnerRecords,
    hasExistingDownloadArtifacts,
    deleteDownloadArtifacts
};
