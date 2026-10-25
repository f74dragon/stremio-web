use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use stremio_derive::Model;

use crate::{
    constants::LIBRARY_RECENT_STORAGE_KEY,
    models::ctx::Ctx,
    runtime::{msg::{Action, ActionCtx}, EnvFutureExt, Runtime, RuntimeAction},
    types::{api::{APIResult, SuccessResponse}, library::LibraryItem, profile::{Auth, AuthKey, User}, resource::MetaItem, True},
    unit_tests::{TestEnv, NOW, STORAGE, REQUESTS, FETCH_HANDLER},
};

#[derive(Model, Clone, Default)]
#[model(TestEnv)]
struct TestModel { ctx: Ctx }

fn meta(kind: &str) -> MetaItem {
    serde_json::from_value(json!({
        "id": "tt123", "type": kind, "name": "Test",
        "videos": [
            {"id": "tt123:1:1", "season": 1, "episode": 1, "released": "2020-01-01T00:00:00Z"},
            {"id": "tt123:1:2", "season": 1, "episode": 2, "released": "2020-01-02T00:00:00Z"},
            {"id": "tt123:2:1", "season": 2, "episode": 1, "released": "2020-01-03T00:00:00Z"}
        ]
    })).unwrap()
}

fn dispatch(runtime: &Runtime<TestEnv, TestModel>, meta_item: MetaItem, id: &str, time: u64, duration: u64) {
    TestEnv::run(|| runtime.dispatch(RuntimeAction {
        field: None,
        action: Action::Ctx(ActionCtx::ExternalPlaybackProgressChanged {
            meta_item, video_id: id.to_owned(), time, duration, observed_at: *NOW.read().unwrap(),
        }),
    }));
}

fn tick() { *NOW.write().unwrap() += Duration::seconds(10); }

#[test]
fn external_progress_persists_and_rewinds_without_inflating_watch_time() {
    let _guard = TestEnv::reset().unwrap();
    *NOW.write().unwrap() = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let (runtime, _rx) = Runtime::<TestEnv, _>::new(TestModel::default(), vec![], 1000);
    dispatch(&runtime, meta("movie"), "tt123", 400, 1000);
    {
        let model = runtime.model().unwrap();
        let item = &model.ctx.library.items["tt123"];
        assert!(item.is_in_continue_watching());
        assert!(item.temp && item.removed);
        assert_eq!(item.state.time_offset, 400);
        assert_eq!(item.state.overall_time_watched, 0);
    }
    assert!(STORAGE.read().unwrap().contains_key(LIBRARY_RECENT_STORAGE_KEY));
    tick();
    dispatch(&runtime, meta("movie"), "tt123", 100, 1000);
    assert_eq!(runtime.model().unwrap().ctx.library.items["tt123"].state.time_offset, 100);
    tick();
    dispatch(&runtime, meta("movie"), "tt123", 900, 1000);
    tick();
    dispatch(&runtime, meta("movie"), "tt123", 950, 1000);
    let model = runtime.model().unwrap();
    let item = &model.ctx.library.items["tt123"];
    assert!(!item.is_in_continue_watching());
    assert_eq!(item.state.times_watched, 1);
}

#[test]
fn external_series_completion_marks_each_episode_and_advances_across_seasons() {
    let _guard = TestEnv::reset().unwrap();
    *NOW.write().unwrap() = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let (runtime, _rx) = Runtime::<TestEnv, _>::new(TestModel::default(), vec![], 1000);
    dispatch(&runtime, meta("series"), "tt123:1:1", 900, 1000);
    {
        let model = runtime.model().unwrap();
        let item = &model.ctx.library.items["tt123"];
        assert_eq!(item.state.video_id.as_deref(), Some("tt123:1:2"));
        assert_eq!(item.state.time_offset, 1);
        assert!(item.state.watched_bitfield(&meta("series").videos).get_video("tt123:1:1"));
    }
    tick();
    dispatch(&runtime, meta("series"), "tt123:1:2", 900, 1000);
    assert_eq!(runtime.model().unwrap().ctx.library.items["tt123"].state.video_id.as_deref(), Some("tt123:2:1"));
    tick();
    dispatch(&runtime, meta("series"), "tt123:2:1", 900, 1000);
    let model = runtime.model().unwrap();
    let item = &model.ctx.library.items["tt123"];
    assert!(!item.is_in_continue_watching());
    assert!(meta("series").videos.iter().all(|video| item.state.watched_bitfield(&meta("series").videos).get_video(&video.id)));
}

#[test]
fn external_progress_rejects_invalid_identity_duration_and_stale_observations() {
    let _guard = TestEnv::reset().unwrap();
    *NOW.write().unwrap() = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let (runtime, _rx) = Runtime::<TestEnv, _>::new(TestModel::default(), vec![], 1000);
    dispatch(&runtime, meta("series"), "wrong", 400, 1000);
    dispatch(&runtime, meta("movie"), "tt123", 400, 0);
    dispatch(&runtime, meta("movie"), "tt123", 1100, 1000);
    assert!(runtime.model().unwrap().ctx.library.items.is_empty());
    dispatch(&runtime, meta("movie"), "tt123", 400, 1000);
    dispatch(&runtime, meta("movie"), "tt123", 200, 1000);
    assert_eq!(runtime.model().unwrap().ctx.library.items["tt123"].state.time_offset, 400);
}

#[test]
fn external_progress_preserves_library_flags_and_does_not_advance_to_unreleased_episode() {
    let _guard = TestEnv::reset().unwrap();
    *NOW.write().unwrap() = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let (runtime, _rx) = Runtime::<TestEnv, _>::new(TestModel::default(), vec![], 1000);
    TestEnv::run(|| runtime.dispatch(RuntimeAction { field: None,
        action: Action::Ctx(ActionCtx::AddToLibrary(meta("series").preview)) }));
    let mut series = meta("series");
    series.videos[1].released = Some(Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap());
    tick();
    dispatch(&runtime, series, "tt123:1:1", 900, 1000);
    let model = runtime.model().unwrap();
    let item = &model.ctx.library.items["tt123"];
    assert!(!item.temp && !item.removed);
    assert_eq!(item.state.time_offset, 0);
    assert_eq!(item.state.video_id.as_deref(), Some("tt123:1:1"));
}

#[test]
fn external_progress_uses_normal_account_api_persistence() {
    let _guard = TestEnv::reset().unwrap();
    *NOW.write().unwrap() = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    *FETCH_HANDLER.write().unwrap() = Box::new(|request| {
        assert_eq!(request.url, "https://api.strem.io/api/datastorePut");
        let body: serde_json::Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["collection"], "libraryItem");
        assert_eq!(body["changes"][0]["state"]["timeOffset"], 400);
        futures::future::ok(Box::new(APIResult::Ok(SuccessResponse { success: True {} }))
            as Box<dyn std::any::Any + Send>).boxed_env()
    });
    let mut model = TestModel::default();
    model.ctx.profile.auth = Some(Auth { key: AuthKey("synthetic-key".into()),
        user: User { id: "synthetic-user".into(), ..Default::default() } });
    let (runtime, _rx) = Runtime::<TestEnv, _>::new(model, vec![], 1000);
    dispatch(&runtime, meta("movie"), "tt123", 400, 1000);
    assert_eq!(REQUESTS.read().unwrap().len(), 1);
    assert!(STORAGE.read().unwrap().contains_key(LIBRARY_RECENT_STORAGE_KEY));
}

#[test]
fn external_episode_change_resets_episode_counters_but_keeps_overall_watch_time() {
    let _guard = TestEnv::reset().unwrap();
    *NOW.write().unwrap() = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let mut item = LibraryItem::from((&meta("series").preview, std::marker::PhantomData::<TestEnv>));
    item.state.last_watched = None;
    item.state.video_id = Some("tt123:1:1".into());
    item.state.flagged_watched = 1;
    item.state.time_watched = 350;
    item.state.overall_time_watched = 500;
    let mut model = TestModel::default();
    model.ctx.library.items.insert("tt123".into(), item);
    let (runtime, _rx) = Runtime::<TestEnv, _>::new(model, vec![], 1000);
    dispatch(&runtime, meta("series"), "tt123:1:2", 400, 1000);
    let model = runtime.model().unwrap();
    let state = &model.ctx.library.items["tt123"].state;
    assert_eq!(state.time_watched, 0);
    assert_eq!(state.flagged_watched, 0);
    assert_eq!(state.overall_time_watched, 500);
}
