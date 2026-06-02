const React = require('react');
const PropTypes = require('prop-types');
const { Button } = require('stremio/components');
const styles = require('./TitleDownloadsPanel.less');

const formatProgress = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? `${Math.round(numericValue)}%` : '0%';
};

const formatCreatedAt = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const getRecordTitle = (record) => {
    if (record?.videoTitle) {
        if (typeof record.season === 'number' && typeof record.episode === 'number') {
            return `S${record.season}E${record.episode} ${record.videoTitle}`;
        }

        return record.videoTitle;
    }

    return 'Untitled download';
};

const TitleDownloadsPanel = ({ metaId, items = [], initialLoading = false, refreshing = false, error = '', onRefresh }) => {
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
                    <div className={styles['panel-title']}>Downloads for this title</div>
                    {
                        refreshing ?
                            <div className={styles['panel-refreshing']}>Refreshing...</div>
                            :
                            null
                    }
                </div>
                <Button className={styles['refresh-button']} title={'Refresh downloads'} onClick={onRefresh}>
                    Refresh
                </Button>
            </div>
            {
                showInitialLoading ?
                    <div className={styles['panel-state']}>Loading downloads...</div>
                    :
                    showInitialError ?
                        <div className={styles['panel-error']}>{error}</div>
                        :
                        !hasItems ?
                            <div className={styles['panel-state']}>No downloads for this title yet.</div>
                            :
                            <div className={styles['records-container']}>
                                {
                                    showInlineError ?
                                        <div className={styles['panel-error-inline']}>{error}</div>
                                        :
                                        null
                                }
                                {items.map((record) => (
                                    <div key={record.id || `${record.videoId}-${record.createdAt}`} className={styles['record-card']}>
                                        <div className={styles['record-title']}>{getRecordTitle(record)}</div>
                                        <div className={styles['record-meta']}>
                                            <span>{record.addonName || 'Unknown addon'}</span>
                                            <span>{record.streamName || 'Unknown stream'}</span>
                                            <span>Status: {record.status || 'unknown'}</span>
                                            <span>Progress: {formatProgress(record.progress)}</span>
                                        </div>
                                        {
                                            record.localPath ?
                                                <div className={styles['record-path']} title={record.localPath}>
                                                    {record.localPath}
                                                </div>
                                                :
                                                null
                                        }
                                        {
                                            record.createdAt ?
                                                <div className={styles['record-created']}>
                                                    Created: {formatCreatedAt(record.createdAt)}
                                                </div>
                                                :
                                                null
                                        }
                                    </div>
                                ))}
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
    onRefresh: PropTypes.func
};

module.exports = TitleDownloadsPanel;
