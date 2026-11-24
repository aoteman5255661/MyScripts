function rewriteProfileBody(response, updateProfile) {
    // 204、205 无正文，206 只有部分正文。
    const hasContent = status => status == null ||
        (status >= 200 && status < 300 && (status < 204 || status > 206));
    const isRecord = value => value && typeof value === 'object' &&
        !Array.isArray(value) && !value.error && !value.errorCode;
    if (!hasContent(response.statusCode ?? response.status)) return;
    const body = response.body;
    if (typeof body !== 'string' || !body) return;

    const data = JSON.parse(body);
    if (!isRecord(data)) return;
    let profile = data;
    let entry;
    if ('responses' in data) {
        if (!Array.isArray(data.responses) || data.responses.length < 2) return;
        entry = data.responses[0];
        if (!isRecord(entry) || !hasContent(entry.statusCode ?? entry.status)) return;
        if (Object.keys(entry.headers || {}).some(key => key.toLowerCase() === 'etag')) return;
        profile = typeof entry.body === 'string' ? JSON.parse(entry.body) : entry.body;
        if (!isRecord(profile)) return;
    }

    const { shopItems, subscriberLevel, trackingProperties } = profile;
    if (shopItems != null && !Array.isArray(shopItems)) return;
    if (trackingProperties != null && (typeof trackingProperties !== 'object' || Array.isArray(trackingProperties))) return;
    if (!Array.isArray(shopItems) && typeof subscriberLevel !== 'string' && !(profile.id && trackingProperties)) return;

    updateProfile(profile);
    if (entry && typeof entry.body === 'string') entry.body = JSON.stringify(profile);
    return JSON.stringify(data);
}

function profileChanges(response) {
    const applyGold = (userdata) => {
        const now = Math.floor(Date.now() / 1000);
        if (!userdata.shopItems) userdata.shopItems = [];
        const hasGold = userdata.shopItems.some(item => item?.id === 'gold_subscription');
        if (!hasGold) {
            userdata.shopItems.push({
                id: 'gold_subscription',
                purchaseDate: now - 172800,
                purchasePrice: 0,
                subscriptionInfo: {
                    expectedExpiration: now + 31536000,
                    productId: "com.duolingo.DuolingoMobile.subscription.Gold.TwelveMonth.24Q2Max.168",
                    renewer: 'APPLE',
                    renewing: true,
                    tier: 'twelve_month',
                    type: 'gold'
                }
            });
        }
        userdata.subscriberLevel = 'GOLD';
        if (!userdata.trackingProperties) userdata.trackingProperties = {};
        userdata.trackingProperties.has_item_immersive_subscription = true;
        userdata.trackingProperties.has_item_premium_subscription = true;
        userdata.trackingProperties.has_item_live_subscription = true;
        userdata.trackingProperties.has_item_gold_subscription = true;
        userdata.trackingProperties.has_item_max_subscription = true;
    };

    return rewriteProfileBody(response, applyGold);
}

{
    let body;
    try {
        body = profileChanges($response);
    } catch (e) {
        // 无法解析时保留原始响应。
    }
    $done(body === undefined ? {} : { body });
}
