use std::marker::PhantomData;

use chrono::{DateTime, Duration, Utc};

use crate::{
    constants::CREDITS_THRESHOLD_COEF,
    runtime::Env,
    types::{library::{LibraryBucket, LibraryItem}, resource::MetaItem},
};

// A verified external observation is a replacement position (including backward
// seeks), never evidence of elapsed watch time. Persist through UpdateLibraryItem.
pub fn update_external_playback<E: Env + 'static>(
    library: &LibraryBucket,
    meta: &MetaItem,
    video_id: &str,
    time: u64,
    duration: u64,
    observed_at: DateTime<Utc>,
) -> Option<LibraryItem> {
    let now = E::now();
    if meta.preview.id.is_empty() || video_id.is_empty() || duration == 0 || time > duration
        || observed_at.timestamp() < 0 || observed_at > now + Duration::minutes(1)
        || !matches!(meta.preview.r#type.as_str(), "movie" | "series") {
        return None;
    }
    let previous = library.items.get(&meta.preview.id);
    if previous.is_some_and(|item| item.r#type != meta.preview.r#type
        || item.state.last_watched.is_some_and(|last| last >= observed_at)) {
        return None;
    }
    let is_series = meta.preview.r#type == "series";
    let current_index = meta.videos.iter().position(|video| video.id == video_id);
    if is_series && current_index.is_none() {
        return None;
    }
    if !is_series && video_id != meta.preview.behavior_hints.default_video_id
        .as_deref().unwrap_or(&meta.preview.id) && current_index.is_none() {
        return None;
    }
    if current_index.is_some_and(|index| meta.videos[index].released.is_some_and(|date| date > now)) {
        return None;
    }
    let mut item = previous.map(|item| LibraryItem::from((&meta.preview, item)))
        .unwrap_or_else(|| LibraryItem::from((&meta.preview, PhantomData::<E>)));
    if item.state.video_id.as_deref() != Some(video_id) {
        item.state.time_watched = 0;
        item.state.flagged_watched = 0;
    }
    item.state.last_watched = Some(observed_at);
    item.state.video_id = Some(video_id.to_owned());
    item.state.time_offset = time;
    item.state.duration = duration;
    if time as f64 / (duration as f64) < CREDITS_THRESHOLD_COEF {
        return Some(item);
    }
    item.state.time_offset = 0;
    if let Some(index) = current_index.filter(|_| is_series) {
        let mut watched = item.state.watched_bitfield(&meta.videos);
        if !watched.get_video(video_id) {
            watched.set_video(video_id, true);
            item.state.times_watched = item.state.times_watched.saturating_add(1);
        }
        item.state.watched = Some(watched.into());
        // Use the complete addon list, in Core's canonical order. Do not jump
        // across an upcoming/unknown release or from normal episodes to specials.
        let next = meta.videos.get(index + 1).filter(|next| {
            next.released.is_some_and(|date| date <= now)
                && (next.series_info.as_ref().is_none_or(|info| info.season != 0)
                    || meta.videos[index].series_info.as_ref().is_some_and(|info| info.season == 0))
        });
        if let Some(next) = next {
            item.state.video_id = Some(next.id.to_owned());
            item.state.time_offset = 1;
            item.state.duration = 0;
            item.state.time_watched = 0;
            item.state.flagged_watched = 0;
        }
    } else {
        if !item.watched() {
            item.state.times_watched = item.state.times_watched.saturating_add(1);
        }
        item.state.flagged_watched = 1;
    }
    Some(item)
}
