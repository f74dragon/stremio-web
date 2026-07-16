const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { Button } = require('stremio/components');
const DownloadRecordCard = require('./DownloadRecordCard');
const styles = require('./TitleDownloadsPanel.less');

const TitleDownloadsPanel = ({
    metaId,
    items = [],
    initialLoading = false,
    refreshing = false,
    error = '',
    actionStates = {},
    actionErrors = {},
    onRefresh,
    onCancel,
    onPlay,
    onRemove
}) => {
    const { t } = useTranslation();

    if (!metaId) {
        return null;
    }

    const hasItems = items.length > 0;
    const showInitialLoading = initialLoading && !hasItems;
    const showInitialError = !hasItems && error;
    const showInlineError = hasItems && error;

    return (
        <div className={styles['panel-container']}>
            <div className={styles['panel-header']}>
                <div className={styles['panel-title-row']}>
                    <div className={styles['panel-title']}>
                        {t('CUSTOM_DOWNLOADS_TITLE', { defaultValue: 'Downloads for this title' })}
                    </div>
                    {
                        refreshing ?
                            <div className={styles['panel-refreshing']}>
                                {t('CUSTOM_DOWNLOADS_REFRESHING', { defaultValue: 'Refreshing...' })}
                            </div>
                            :
                            null
                    }
                </div>
                <Button
                    className={styles['refresh-button']}
                    title={t('CUSTOM_DOWNLOADS_REFRESH_TITLE', { defaultValue: 'Refresh downloads' })}
                    onClick={onRefresh}
                >
                    {t('CUSTOM_DOWNLOADS_REFRESH', { defaultValue: 'Refresh' })}
                </Button>
            </div>
            {
                showInitialLoading ?
                    <div className={styles['panel-state']}>
                        {t('CUSTOM_DOWNLOADS_LOADING', { defaultValue: 'Loading downloads...' })}
                    </div>
                    :
                    showInitialError ?
                        <div className={styles['panel-error']}>{error}</div>
                        :
                        !hasItems ?
                            <div className={styles['panel-state']}>
                                {t('CUSTOM_DOWNLOADS_EMPTY', { defaultValue: 'No downloads for this title yet.' })}
                            </div>
                            :
                            <div className={styles['records-container']}>
                                {
                                    showInlineError ?
                                        <div className={styles['panel-error-inline']}>{error}</div>
                                        :
                                        null
                                }
                                {items.map((record) => {
                                    const recordId = record?.id;

                                    return (
                                        <DownloadRecordCard
                                            key={recordId || `${record.videoId}-${record.createdAt}`}
                                            record={record}
                                            action={recordId ? actionStates[recordId] : null}
                                            actionError={recordId ? actionErrors[recordId] : null}
                                            onCancel={onCancel}
                                            onPlay={onPlay}
                                            onRemove={onRemove}
                                        />
                                    );
                                })}
                            </div>
            }
        </div>
    );
};

TitleDownloadsPanel.propTypes = {
    metaId: PropTypes.string,
    items: PropTypes.arrayOf(PropTypes.object),
    initialLoading: PropTypes.bool,
    refreshing: PropTypes.bool,
    error: PropTypes.string,
    actionStates: PropTypes.objectOf(PropTypes.oneOf(['cancel', 'play', 'remove'])),
    actionErrors: PropTypes.objectOf(PropTypes.string),
    onRefresh: PropTypes.func,
    onCancel: PropTypes.func,
    onPlay: PropTypes.func,
    onRemove: PropTypes.func
};

module.exports = TitleDownloadsPanel;
