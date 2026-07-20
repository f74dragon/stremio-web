/* global jest, describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileIdentity } = require('../local-backend/fileUtils');
const {
    DownloadDeletionError,
    getDownloadArtifactPaths,
    getSharedDownloadDestinationRecords,
    getSharedDownloadArtifactRecords,
    getSharedDownloadPartialOwnerRecords,
    hasExistingDownloadArtifacts,
    deleteDownloadArtifacts
} = require('../local-backend/downloadDeletion');

const createRecord = (overrides = {}) => {
    const record = {
        id: 'download-1',
        status: 'completed',
        type: 'movie',
        metaId: 'tt-delete-test',
        parentTitle: 'Delete Test',
        videoTitle: 'Delete Test',
        sourceUrl: 'https://example.com/delete-test.mp4',
        ...overrides
    };
    const paths = getDownloadArtifactPaths(record);
    return {
        ...record,
        localPath: Object.prototype.hasOwnProperty.call(overrides, 'localPath') ? overrides.localPath : paths.localPath,
        partialPath: Object.prototype.hasOwnProperty.call(overrides, 'partialPath') ?
            overrides.partialPath
            : record.status === 'completed' ? null : paths.partialPath
    };
};

const recordIdentity = (record, fieldName, filePath) => {
    record[fieldName] = createFileIdentity(fs.lstatSync(filePath));
};

describe('download media deletion', () => {
    let tempDirectory;
    let previousDownloadDirectory;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-delete-'));
        previousDownloadDirectory = process.env.CUSTOM_STREMIO_DOWNLOAD_DIR;
        process.env.CUSTOM_STREMIO_DOWNLOAD_DIR = tempDirectory;
    });

    afterEach(() => {
        if (previousDownloadDirectory === undefined) {
            delete process.env.CUSTOM_STREMIO_DOWNLOAD_DIR;
        } else {
            process.env.CUSTOM_STREMIO_DOWNLOAD_DIR = previousDownloadDirectory;
        }
        jest.restoreAllMocks();
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('deletes a completed file and removes only its empty title directory', async () => {
        const record = createRecord();
        const { rootPath, localPath, partialPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'completed media');
        recordIdentity(record, 'localFileIdentity', localPath);

        await expect(deleteDownloadArtifacts(record)).resolves.toMatchObject({
            localPath,
            partialPath,
            deletedFiles: [localPath],
            bytesFreed: Buffer.byteLength('completed media'),
            directoryCleanupWarning: null
        });
        expect(fs.existsSync(localPath)).toBe(false);
        expect(fs.existsSync(path.dirname(localPath))).toBe(false);
        expect(fs.existsSync(rootPath)).toBe(true);
    });

    test('deletes resumable partial data for a paused episode', async () => {
        const record = createRecord({
            status: 'paused',
            type: 'series',
            parentTitle: 'Delete Show',
            videoTitle: 'Paused Episode',
            season: 2,
            episode: 3
        });
        const { rootPath, partialPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(partialPath), { recursive: true });
        fs.writeFileSync(partialPath, 'partial media');
        recordIdentity(record, 'partialFileIdentity', partialPath);

        const result = await deleteDownloadArtifacts(record);

        expect(result.deletedFiles).toEqual([partialPath]);
        expect(result.bytesFreed).toBe(Buffer.byteLength('partial media'));
        expect(fs.existsSync(partialPath)).toBe(false);
        expect(fs.existsSync(path.join(rootPath, 'Delete Show'))).toBe(false);
        expect(fs.existsSync(rootPath)).toBe(true);
    });

    test('keeps nonempty sibling folders and unrelated media', async () => {
        const record = createRecord({
            type: 'series',
            parentTitle: 'Shared Show',
            videoTitle: 'Episode One',
            season: 1,
            episode: 1
        });
        const { localPath } = getDownloadArtifactPaths(record);
        const siblingPath = path.join(path.dirname(localPath), 'S01E02 - Episode Two.mp4');
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'episode one');
        fs.writeFileSync(siblingPath, 'episode two');
        recordIdentity(record, 'localFileIdentity', localPath);

        await deleteDownloadArtifacts(record);

        expect(fs.existsSync(localPath)).toBe(false);
        expect(fs.readFileSync(siblingPath, 'utf8')).toBe('episode two');
        expect(fs.existsSync(path.dirname(localPath))).toBe(true);
    });

    test.each(['queued', 'downloading'])(
        'rejects %s records without touching their partial data',
        async (status) => {
            const record = createRecord({ status });
            const { partialPath } = getDownloadArtifactPaths(record);
            fs.mkdirSync(path.dirname(partialPath), { recursive: true });
            fs.writeFileSync(partialPath, 'active partial');

            await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
                name: DownloadDeletionError.name,
                code: 'DOWNLOAD_MEDIA_NOT_DELETABLE'
            });
            expect(fs.readFileSync(partialPath, 'utf8')).toBe('active partial');
        }
    );

    test('detects another record that resolves to the same local artifact', () => {
        const record = createRecord();
        const duplicate = createRecord({ id: 'download-2', sourceUrl: 'https://another.example/delete-test.mp4' });
        const unrelated = createRecord({ id: 'download-3', parentTitle: 'Another Movie', videoTitle: 'Another Movie' });

        expect(getSharedDownloadArtifactRecords(record, [record, duplicate, unrelated])).toEqual([duplicate]);
    });

    test('finds duplicate destinations even when their claimed partial file is already missing', async () => {
        const record = createRecord({ status: 'canceled' });
        const duplicateOne = createRecord({
            id: 'download-2',
            status: 'canceled',
            sourceUrl: 'https://another.example/delete-test.mp4'
        });
        const duplicateTwo = createRecord({
            id: 'download-3',
            status: 'canceled',
            sourceUrl: 'https://third.example/delete-test.mp4'
        });

        expect(getSharedDownloadDestinationRecords(record, [record, duplicateOne, duplicateTwo])).toEqual([
            duplicateOne,
            duplicateTwo
        ]);
        await expect(hasExistingDownloadArtifacts(record)).resolves.toBe(false);
    });

    test('reports a shared partial artifact as existing before destructive deletion', async () => {
        const record = createRecord({ status: 'canceled' });
        const { partialPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(partialPath), { recursive: true });
        fs.writeFileSync(partialPath, 'shared partial');

        await expect(hasExistingDownloadArtifacts(record)).resolves.toBe(true);
    });

    test('transfers partial ownership only to a record with the same trusted path and identity', () => {
        const record = createRecord({ status: 'canceled' });
        const duplicate = createRecord({ id: 'download-2', status: 'canceled' });
        const unverifiedDuplicate = createRecord({ id: 'download-3', status: 'canceled' });
        const { partialPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(partialPath), { recursive: true });
        fs.writeFileSync(partialPath, 'shared partial');
        recordIdentity(record, 'partialFileIdentity', partialPath);
        duplicate.partialFileIdentity = { ...record.partialFileIdentity };

        expect(getSharedDownloadPartialOwnerRecords(
            record,
            [record, duplicate, unverifiedDuplicate]
        )).toEqual([duplicate]);
    });

    test('succeeds when the record has no remaining local artifacts', async () => {
        const record = createRecord({ status: 'canceled' });

        await expect(deleteDownloadArtifacts(record)).resolves.toMatchObject({
            deletedFiles: [],
            bytesFreed: 0,
            removedDirectories: []
        });
    });

    test('does not delete derived files that an unstarted canceled record never claimed', async () => {
        const record = createRecord({ status: 'canceled', localPath: null, partialPath: null });
        const { localPath, partialPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'unrelated completed file');
        fs.writeFileSync(partialPath, 'unrelated partial file');

        const result = await deleteDownloadArtifacts(record);

        expect(result.deletedFiles).toEqual([]);
        expect(fs.readFileSync(localPath, 'utf8')).toBe('unrelated completed file');
        expect(fs.readFileSync(partialPath, 'utf8')).toBe('unrelated partial file');
        expect(fs.existsSync(path.dirname(localPath))).toBe(true);
    });

    test('deletes only a failed record partial and never an existing final file at its destination', async () => {
        const record = createRecord({ status: 'failed' });
        const { localPath, partialPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'preexisting final media');
        fs.writeFileSync(partialPath, 'failed partial media');
        recordIdentity(record, 'partialFileIdentity', partialPath);

        const result = await deleteDownloadArtifacts(record);

        expect(result.deletedFiles).toEqual([partialPath]);
        expect(fs.readFileSync(localPath, 'utf8')).toBe('preexisting final media');
        expect(fs.existsSync(partialPath)).toBe(false);
    });

    test('rejects a completed record without a verified recorded final path', async () => {
        const record = createRecord({ localPath: null });
        const { localPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'unclaimed media');

        await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
            code: 'DOWNLOAD_FINAL_PATH_UNRECORDED'
        });
        expect(fs.readFileSync(localPath, 'utf8')).toBe('unclaimed media');
    });

    test('refuses to delete an existing legacy file without recorded identity', async () => {
        const record = createRecord();
        const { localPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'legacy media without identity');

        await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
            code: 'DOWNLOAD_FILE_IDENTITY_UNRECORDED'
        });
        expect(fs.readFileSync(localPath, 'utf8')).toBe('legacy media without identity');
    });

    test('refuses to delete a file that was replaced after its identity was recorded', async () => {
        const record = createRecord();
        const { localPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'original completed media');
        recordIdentity(record, 'localFileIdentity', localPath);
        fs.writeFileSync(localPath, 'replacement file with different content and length');

        await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
            code: 'DOWNLOAD_FILE_IDENTITY_MISMATCH'
        });
        expect(fs.readFileSync(localPath, 'utf8')).toBe('replacement file with different content and length');
    });

    test('keeps the file when the operating system refuses removal', async () => {
        const record = createRecord();
        const { localPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'locked media');
        recordIdentity(record, 'localFileIdentity', localPath);
        jest.spyOn(fs.promises, 'rm').mockRejectedValue(Object.assign(new Error('locked'), { code: 'EACCES' }));

        await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
            code: 'DOWNLOAD_MEDIA_DELETE_FAILED'
        });
        expect(fs.readFileSync(localPath, 'utf8')).toBe('locked media');
    });

    test('rejects tampered recorded paths without touching either location', async () => {
        const outsidePath = path.join(path.dirname(tempDirectory), 'outside-do-not-delete.mp4');
        const record = createRecord({ localPath: outsidePath });
        const { localPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'trusted location');
        fs.writeFileSync(outsidePath, 'outside location');

        try {
            await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
                code: 'DOWNLOAD_RECORDED_PATH_MISMATCH'
            });
            expect(fs.readFileSync(localPath, 'utf8')).toBe('trusted location');
            expect(fs.readFileSync(outsidePath, 'utf8')).toBe('outside location');
        } finally {
            fs.rmSync(outsidePath, { force: true });
        }
    });

    test('rejects a directory junction that resolves outside the download root', async () => {
        const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-outside-'));
        const record = createRecord();
        const { rootPath, localPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(rootPath, { recursive: true });
        fs.writeFileSync(path.join(outsideDirectory, path.basename(localPath)), 'outside media');
        fs.symlinkSync(outsideDirectory, path.dirname(localPath), 'junction');

        try {
            await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
                code: 'DOWNLOAD_DELETE_PATH_UNSAFE'
            });
            expect(fs.readFileSync(path.join(outsideDirectory, path.basename(localPath)), 'utf8')).toBe('outside media');
        } finally {
            fs.rmSync(outsideDirectory, { recursive: true, force: true });
        }
    });

    test('aborts if the file identity changes after validation and before removal', async () => {
        const record = createRecord();
        const { localPath } = getDownloadArtifactPaths(record);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, 'original media');
        recordIdentity(record, 'localFileIdentity', localPath);
        const originalRealpath = fs.promises.realpath.bind(fs.promises);
        let realpathCalls = 0;
        jest.spyOn(fs.promises, 'realpath').mockImplementation(async (targetPath) => {
            const resolved = await originalRealpath(targetPath);
            realpathCalls += 1;
            if (realpathCalls === 2) {
                fs.writeFileSync(localPath, 'replacement media with a different identity');
            }
            return resolved;
        });

        await expect(deleteDownloadArtifacts(record)).rejects.toMatchObject({
            code: 'DOWNLOAD_DELETE_ARTIFACT_CHANGED'
        });
        expect(fs.readFileSync(localPath, 'utf8')).toBe('replacement media with a different identity');
    });
});
