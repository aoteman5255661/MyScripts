function parseTimerSeconds(minutes) {
    if (typeof minutes !== 'number' && typeof minutes !== 'string') return 0;
    if (!/^\d+$/.test(String(minutes).trim())) return 0;
    const seconds = Number(minutes) * 60;
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0;
}

function timerChanges(response, args) {
    const seconds = parseTimerSeconds(args && args.timer_mins);
    if (!seconds) return {};
    const status = response.statusCode ?? response.status;
    if (status != null && !(status >= 200 && status < 300 && (status < 204 || status > 206))) return {};
    const body = response.body;
    if (typeof body !== 'string' || !body) return {};
    const data = JSON.parse(body);
    if (!data || data.error || data.errorCode || !Array.isArray(data.liveOpsChallenges)) return {};

    let changed = false;
    const lists = ['initialLevelTimes', 'initialSessionTimes'];
    for (const challenge of data.liveOpsChallenges) {
        if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) return {};
        const time = challenge.initialTime;
        if (time != null && (!Number.isFinite(time) || time < 0)) return {};
        if (time > 0 && time !== seconds) {
            challenge.initialTime = seconds;
            changed = true;
        }
        for (const key of lists) {
            const times = challenge[key];
            if (times == null) continue;
            if (!Array.isArray(times)) return {};
            for (let i = 0; i < times.length; i++) {
                if (!Number.isFinite(times[i]) || times[i] < 0) return {};
                if (times[i] !== seconds) {
                    times[i] = seconds;
                    changed = true;
                }
            }
        }
    }
    return changed ? { body: JSON.stringify(data) } : {};
}

{
    let result = {};
    try {
        result = timerChanges($response, typeof $argument === 'undefined' ? null : $argument);
    } catch (e) {
        // 无法解析时保留原始响应。
    }
    $done(result);
}
