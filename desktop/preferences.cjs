const fs = require('node:fs');
const path = require('node:path');

const createDesktopPreferences = (directory) => {
    const filename = path.join(directory, 'desktop-preferences.json');
    let closeBehavior = 'tray';
    try {
        const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (value.version === 1 && ['tray', 'quit'].includes(value.closeBehavior)) closeBehavior = value.closeBehavior;
    } catch { /* An unreadable preference never prevents startup or changes stored data. */ }
    return {
        get: () => ({ closeBehavior }),
        setCloseBehavior(value) {
            if (!['tray', 'quit'].includes(value)) throw new Error('Choose tray or quit.');
            const temporary = `${filename}.tmp`;
            fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, closeBehavior: value })}\n`, { mode: 0o600 });
            fs.renameSync(temporary, filename);
            closeBehavior = value;
            return { closeBehavior };
        }
    };
};
module.exports = { createDesktopPreferences };
