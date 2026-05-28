const React = require('react');
const PropTypes = require('prop-types');
const { Button } = require('stremio/components');
const { listDownloads } = require('stremio/customStremio/localBackendClient');
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

const TitleDownloadsPanel = ({ metaId, refreshKey = 0 }) => {
    const [items, setItems] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');

    const loadDownloads = React.useCallback(async () => {
        if (!metaId) {
            setItems([]);
            setError('');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await listDownloads(metaId);
            setItems(Array.isArray(response?.items) ? response.items : []);
        } catch (requestError) {
            setItems([]);
            setError(requestError?.message || 'Local backend is unavailable.');
        } finally {
            setLoading(false);
        }
    }, [metaId]);

    React.useEffect(() => {
        loadDownloads();
    }, [loadDownloads, refreshKey]);

    if (!metaId) {
        return null;
    }

    return (
        <div className={styles['panel-container']}>
            <div className={styles['panel-header']}>
                <div className={styles['panel-title']}>Downloads for this title</div>
                <Button className={styles['refresh-button']} title={'Refresh downloads'} onClick={loadDownloads}>
                    Refresh
                </Button>
            </div>
            {
                loading ?
                    <div className={styles['panel-state']}>Loading downloads...</div>
                    :
                    error ?
                        <div className={styles['panel-error']}>{error}</div>
                        :
                        items.length === 0 ?
                            <div className={styles['panel-state']}>No downloads for this title yet.</div>
                            :
                            <div className={styles['records-container']}>
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
    refreshKey: PropTypes.number
};

module.exports = TitleDownloadsPanel;
