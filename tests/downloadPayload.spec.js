/* global describe, test, expect */

const { buildDownloadPayload } = require('../src/customStremio/downloadPayload');

describe('downloadPayload', () => {
    test('includes title and episode artwork in a download request', () => {
        const payload = buildDownloadPayload({
            metaId: 'tt123',
            type: 'series',
            parentTitle: 'Example Show',
            poster: 'https://images.example/poster.jpg',
            background: 'https://images.example/background.jpg',
            mediaMetadata: {
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
            videoId: 'tt123:1:2',
            videoTitle: 'Second Episode',
            videoThumbnail: 'https://images.example/episode.jpg',
            season: 1,
            episode: 2,
            videoReleased: '2026-07-15T12:00:00.000Z',
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
});
