function sessionChanges(response) {
    const status = response.statusCode ?? response.status;
    if (status != null && !(status >= 200 && status < 300 && (status < 204 || status > 206))) return {};
    const body = response.body;
    if (typeof body !== 'string' || !body) return {};

    const session = JSON.parse(body);
    if (!session || typeof session !== 'object' || Array.isArray(session) || session.error || session.errorCode) return {};
    const type = session.type;
    if (type != null && typeof type !== 'string') return {};
    if (type === 'SIDE_QUEST_RAMP_UP_PRACTICE' || type === 'MATCH_PRACTICE') return {};

    const pools = ['elements'];
    if (type) {
        pools.push('challenges', 'adaptiveChallenges', 'adaptiveInterleavedChallenges', 'mistakesReplacementChallenges');
    }

    let changed = false;
    for (const pool of pools) {
        const items = session[pool];
        if (items == null) continue;
        if (!Array.isArray(items)) return {};
        if (items.length > 0) {
            session[pool] = [];
            changed = true;
        }
    }
    return changed ? { body: JSON.stringify(session) } : {};
}

{
    let result = {};
    try {
        result = sessionChanges($response);
    } catch (e) {
        // 无法解析时保留原始响应。
    }
    $done(result);
}
