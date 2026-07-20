/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createFileIdentity,
    isSameFileIdentity,
    finalizePartialDownload
} = require('../local-backend/fileUtils');

describe('download file finalization safety', () => {
    let tempDirectory;
    let partialPath;
    let localPath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-finalize-'));
        localPath = path.join(tempDirectory, 'movie.mp4');
        partialPath = `${localPath}.part`;
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('moves a verified partial file and returns the final file identity', async () => {
        fs.writeFileSync(partialPath, 'downloaded media');

        const identity = await finalizePartialDownload(partialPath, localPath, Buffer.byteLength('downloaded media'));

        expect(fs.existsSync(partialPath)).toBe(false);
        expect(fs.readFileSync(localPath, 'utf8')).toBe('downloaded media');
        expect(isSameFileIdentity(identity, createFileIdentity(fs.lstatSync(localPath)))).toBe(true);
    });

    test('never overwrites an existing final destination', async () => {
        fs.writeFileSync(localPath, 'unrelated existing media');
        fs.writeFileSync(partialPath, 'new partial media');

        await expect(finalizePartialDownload(partialPath, localPath, Buffer.byteLength('new partial media')))
            .rejects.toMatchObject({ code: 'DOWNLOAD_DESTINATION_EXISTS' });

        expect(fs.readFileSync(localPath, 'utf8')).toBe('unrelated existing media');
        expect(fs.readFileSync(partialPath, 'utf8')).toBe('new partial media');
    });

    test('rejects a directory masquerading as a partial file', async () => {
        fs.mkdirSync(partialPath);

        await expect(finalizePartialDownload(partialPath, localPath, 0))
            .rejects.toMatchObject({ code: 'DOWNLOAD_ARTIFACT_INVALID' });
        expect(fs.existsSync(partialPath)).toBe(true);
        expect(fs.existsSync(localPath)).toBe(false);
    });
});
