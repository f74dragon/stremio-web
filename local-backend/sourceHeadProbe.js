const http = require('http');
const https = require('https');
const { classifyKnownPlaceholderSourceUrl } = require('./downloadManager');

const DEFAULT_HEAD_TIMEOUT_MS = 5000;
const DEFAULT_MAX_REDIRECTS = 5;
const VIDEO_PATH_PATTERN = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm|wmv)(?:$|[?#])/i;
const MEDIA_CONTENT_TYPE_PATTERN = /^(?:video\/|application\/(?:octet-stream|x-matroska|vnd\.apple\.mpegurl))/i;

const parseContentLength = (value) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const hasCredibleMediaHeaders = (url, headers) => {
    const contentType = String(headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    const contentLength = parseContentLength(headers?.['content-length']);
    const contentDisposition = String(headers?.['content-disposition'] || '');
    const mediaNameVisible = VIDEO_PATH_PATTERN.test(url) || VIDEO_PATH_PATTERN.test(contentDisposition);
    return {
        credible: contentLength !== 0 && (MEDIA_CONTENT_TYPE_PATTERN.test(contentType) || mediaNameVisible),
        contentType: contentType || null,
        contentLength
    };
};

const placeholderResult = (placeholder) => ({
    status: placeholder.status,
    verification: 'resolver_head',
    errorCode: placeholder.errorCode,
    error: placeholder.status === 'unavailable' ?
        'The resolver reported that this source is unavailable.'
        : 'The resolver reported that this source is still being prepared.'
});

const probeSourceHead = async (sourceUrl, {
    timeoutMs = DEFAULT_HEAD_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS
} = {}) => {
    const initialPlaceholder = classifyKnownPlaceholderSourceUrl(sourceUrl);
    if (initialPlaceholder) {
        return placeholderResult(initialPlaceholder);
    }

    let initialUrl;
    try {
        initialUrl = new URL(sourceUrl);
    } catch {
        return { status: 'unknown', verification: 'resolver_head', error: 'Resolver link is not a valid URL.' };
    }
    if (!['http:', 'https:'].includes(initialUrl.protocol)) {
        return { status: 'unknown', verification: 'resolver_head', error: 'Resolver link does not use HTTP or HTTPS.' };
    }

    const requestHead = (url, redirectCount) => new Promise((resolve) => {
        const parsedUrl = new URL(url);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;
        let settled = false;
        const finish = (result) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        const request = requestModule.request(parsedUrl, {
            method: 'HEAD',
            headers: { Accept: 'video/*, application/octet-stream;q=0.9, */*;q=0.1' }
        }, (response) => {
            const statusCode = Number(response.statusCode) || 0;
            const location = response.headers.location;
            response.destroy();

            if (statusCode >= 300 && statusCode < 400) {
                if (!location) {
                    finish({ status: 'unknown', verification: 'resolver_head', error: `Resolver returned HTTP ${statusCode} without a redirect location.` });
                    return;
                }
                if (redirectCount >= maxRedirects) {
                    finish({ status: 'unknown', verification: 'resolver_head', error: 'Resolver HEAD check exceeded the redirect limit.' });
                    return;
                }
                let redirectUrl;
                try {
                    redirectUrl = new URL(location, parsedUrl).toString();
                } catch {
                    finish({ status: 'unknown', verification: 'resolver_head', error: 'Resolver returned an invalid redirect URL.' });
                    return;
                }
                const placeholder = classifyKnownPlaceholderSourceUrl(redirectUrl);
                if (placeholder) {
                    finish(placeholderResult(placeholder));
                    return;
                }
                requestHead(redirectUrl, redirectCount + 1).then(finish);
                return;
            }

            if (statusCode === 451) {
                finish({
                    status: 'unavailable',
                    verification: 'resolver_head',
                    errorCode: 'SOURCE_UNAVAILABLE',
                    error: 'The resolver or provider rejected this source with HTTP 451.'
                });
                return;
            }

            if ([403, 405, 501].includes(statusCode)) {
                finish({
                    status: 'unknown',
                    verification: 'resolver_head',
                    error: `Resolver link does not permit a conclusive HEAD check (HTTP ${statusCode}).`
                });
                return;
            }

            if (statusCode >= 200 && statusCode < 300) {
                const media = hasCredibleMediaHeaders(parsedUrl.toString(), response.headers);
                finish(media.credible ? {
                    status: 'ready',
                    verification: 'resolver_head',
                    httpStatus: statusCode,
                    contentType: media.contentType,
                    contentLength: media.contentLength
                } : {
                    status: 'unknown',
                    verification: 'resolver_head',
                    error: 'Resolver HEAD response did not include credible media headers.'
                });
                return;
            }

            finish({
                status: 'unknown',
                verification: 'resolver_head',
                error: `Resolver HEAD check returned HTTP ${statusCode || 'unknown'}.`
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(Object.assign(new Error('Resolver HEAD check timed out.'), { code: 'HEAD_PROBE_TIMEOUT' }));
        });
        request.on('error', (error) => {
            finish({
                status: 'unknown',
                verification: 'resolver_head',
                error: error?.code === 'HEAD_PROBE_TIMEOUT' ? error.message : `Resolver HEAD check failed: ${error?.message || 'network error'}`
            });
        });
        request.end();
    });

    return requestHead(initialUrl.toString(), 0);
};

module.exports = {
    DEFAULT_HEAD_TIMEOUT_MS,
    DEFAULT_MAX_REDIRECTS,
    hasCredibleMediaHeaders,
    probeSourceHead
};
