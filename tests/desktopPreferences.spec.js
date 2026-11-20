/* global test, expect */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createDesktopPreferences } = require('../desktop/preferences.cjs');
test('desktop close behavior is validated, persisted, and does not overwrite invalid data on read', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-preferences-'));
    try {
        const prefs = createDesktopPreferences(root);
        expect(prefs.get().closeBehavior).toBe('tray');
        prefs.setCloseBehavior('quit');
        expect(createDesktopPreferences(root).get().closeBehavior).toBe('quit');
        expect(() => prefs.setCloseBehavior('../erase')).toThrow();
        fs.writeFileSync(path.join(root, 'desktop-preferences.json'), 'unsupported existing data');
        expect(createDesktopPreferences(root).get().closeBehavior).toBe('tray');
        expect(fs.readFileSync(path.join(root, 'desktop-preferences.json'), 'utf8')).toBe('unsupported existing data');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
