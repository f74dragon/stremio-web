/* global describe, test, expect */

const { buildDownloadPayload, parseStreamVideoSize } = require('../src/customStremio/downloadPayload');

describe('downloadPayload', () => {
    test('includes title and episode artwork in a download request', () => {
        const payload = buildDownloadPayload({
            metaId: 'tt123',
            type: 'series',
            parentTitle: 'Example Show',
            poster: 'https://images.example/poster.jpg',
            background: 'https://images.example/background.jpg',
            mediaMetadata: {
                id: 'tt123',
                type: 'series',
                name: 'Example Show',
                logo: 'https://images.example/logo.png',
                description: 'A test show summary.',
                runtime: '52 min',
                releaseInfo: '2024-',
                released: new Date('2024-01-01T00:00:00.000Z'),
                links: [
                    { category: 'Genres', name: 'Drama', url: 'stremio:///discover/drama' },
                    { category: 'imdb', name: '8.4', url: 'https://imdb.com/title/tt123' }
                ]
            },
            video: {
                id: 'tt123:1:2',
                title: 'Second Episode',
                thumbnail: 'https://images.example/episode.jpg',
                season: 1,
                episode: 2,
                released: new Date('2026-07-15T12:00:00.000Z')
            },
            addonName: 'Example Addon',
            stream: {
                name: '1080p',
                infoHash: '842783E3005495D5D1637F5364B59343C7844707',
                fileIdx: 3,
                behaviorHints: {
                    filename: 'Episode.Title.S01E02.mkv',
                    videoSize: 1234567890
                },
                deepLinks: {
                    externalPlayer: {
                        download: 'https://media.example/episode.mkv'
                    }
                }
            }
        });

        expect(payload).toMatchObject({
            metaId: 'tt123',
            type: 'series',
            parentTitle: 'Example Show',
            poster: 'https://images.example/poster.jpg',
            background: 'https://images.example/background.jpg',
            logo: 'https://images.example/logo.png',
            description: 'A test show summary.',
            runtime: '52 min',
            releaseInfo: '2024-',
            titleReleased: '2024-01-01T00:00:00.000Z',
            metaLinks: [
                { category: 'Genres', name: 'Drama', url: 'stremio:///discover/drama' },
                { category: 'imdb', name: '8.4', url: 'https://imdb.com/title/tt123' }
            ],
            stremioMetaItem: expect.objectContaining({
                id: 'tt123',
                type: 'series',
                name: 'Example Show'
            }),
            videoId: 'tt123:1:2',
            videoTitle: 'Second Episode',
            videoThumbnail: 'https://images.example/episode.jpg',
            season: 1,
            episode: 2,
            videoReleased: '2026-07-15T12:00:00.000Z',
            infoHash: '842783e3005495d5d1637f5364b59343c7844707',
            sourceReadiness: 'unknown',
            fileIdx: 3,
            behaviorHints: {
                filename: 'Episode.Title.S01E02.mkv',
                videoSize: 1234567890
            },
            downloadUrl: 'https://media.example/episode.mkv'
        });
    });

    test('keeps optional artwork nullable for older and incomplete metadata', () => {
        expect(buildDownloadPayload({})).toMatchObject({
            poster: null,
            background: null,
            logo: null,
            description: null,
            runtime: null,
            releaseInfo: null,
            titleReleased: null,
            metaLinks: [],
            videoThumbnail: null
        });
    });

    test('recovers file size from addon source text when behavior hints omit it', () => {
        const expectedBytes = Math.round(7.43 * (1024 ** 3));
        expect(parseStreamVideoSize({ description: '1080p WEB-DL · 💾 7.43 GB · 18 seeders' })).toBe(expectedBytes);
        expect(buildDownloadPayload({
            stream: { name: 'Torrentio 1080p', title: 'Size: 7.43 GiB' }
        }).behaviorHints.videoSize).toBe(expectedBytes);
    });

    test('rejects malformed torrent hashes without affecting the Stremio download URL', () => {
        const payload = buildDownloadPayload({
            stream: {
                infoHash: 'not-a-hash',
                url: 'https://stream.example/video',
                deepLinks: { externalPlayer: { download: 'https://download.example/video.mkv' } }
            }
        });
        expect(payload.infoHash).toBeNull();
        expect(payload.downloadUrl).toBe('https://download.example/video.mkv');
    });

    test('keeps Torrentio download-route rows unknown without resolving or blocking the URL', () => {
        const payload = buildDownloadPayload({
            stream: {
                name: '[AD Download] 1080p',
                deepLinks: { externalPlayer: { download: 'https://torrentio.example/resolve' } }
            }
        });

        expect(payload.sourceReadiness).toBe('unknown');
        expect(payload.downloadUrl).toBe('https://torrentio.example/resolve');
    });

    test('extracts a torrent hash embedded in a Torrentio download URL', () => {
        const hash = '842783e3005495d5d1637f5364b59343c7844707';
        const payload = buildDownloadPayload({
            stream: {
                deepLinks: { externalPlayer: { download: `https://torrentio.example/resolve/${hash}/file.mkv` } }
            }
        });
        expect(payload.infoHash).toBe(hash);
    });

    test('carries the provider identity and provider-scoped readiness into the backend request', () => {
        const payload = buildDownloadPayload({
            addonName: 'Torrentio RD',
            stream: {
                name: '[RD Download] 1080p',
                infoHash: '842783e3005495d5d1637f5364b59343c7844707',
                deepLinks: { externalPlayer: { download: 'https://realdebrid.example/file.mkv' } }
            }
        });

        expect(payload).toMatchObject({
            debridProvider: 'realdebrid',
            sourceReadiness: 'unknown'
        });
    });
});
